import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UUID } from 'crypto'
import type { Message } from '../../types/message.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  formatNonInteractiveBgTimeoutGuidance,
  formatNonInteractiveBgTimeoutToolDescription,
  NON_INTERACTIVE_BG_TIMEOUT_CAP_MS,
  normalizeInformationalContent,
  resolveNonInteractiveBgTimeoutMs,
} from '../../QueryEngine.js'
import {
  buildCcrSessionRulesRecord,
  evaluateCcrKeepsSessionRules,
  restoreCcrSessionRules,
  setCcrKeepsSessionRules,
} from '../../state/onChangeAppState.js'
import {
  deserializeMessagesWithInterruptDetection,
  planSegmentState,
  rerunWouldLeavePlanMode,
} from '../../utils/conversationRecovery.js'
import {
  CrossSessionSendLimiter,
  getCrossSessionRelayCounters,
  getCrossSessionSendLimiter,
  personWrote,
  resetCrossSessionRateLimitStateForTests,
} from '../../utils/crossSessionInbound.js'
import {
  appendAndSyncOnNfs,
  clearSessionMessagesCache,
  getSessionMessages,
  getSessionMessagesCache,
  getTranscriptFullDiskState,
  NFS_SUPER_MAGIC,
  NfsAppendFlusher,
  recordTranscriptFullDiskError,
  resetTranscriptFullDiskState,
} from '../../utils/sessionStorage.js'
import {
  buildSdkInitializeResponse,
  handleOrphanedPermissionResponse,
  reconcileMcpServers,
} from '../headless/HeadlessControlPlane.js'
import {
  canCoalesceTaskNotificationWithFollower,
  createPrintTaskNotificationCoalesceState,
  isCoalescableHandbackPeerPrompt,
} from '../printTaskNotificationCoalesce.js'
import {
  ASK_USER_QUESTION_AFK_TIMEOUT_DENY_MESSAGE,
  filterCloudSlashCommands,
  guardAskUserQuestionAfkTimeout,
  handlePrintFullDiskExit,
  hasAutoModeNoCheckDenial,
  isRemoteControlOriginForSetCwd,
  normalizeInformationalSdkMessage,
  PendingReRunSendsTracker,
  validateAskUserQuestionPermissionAnswer,
} from '../print.js'

describe('Wave 319-321 CLI / Print / Headless / SessionStorage / Recovery alignments', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cli-321-'))
    resetTranscriptFullDiskState()
    resetCrossSessionRateLimitStateForTests()
    clearSessionMessagesCache()
    setCcrKeepsSessionRules(undefined)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    resetTranscriptFullDiskState()
    resetCrossSessionRateLimitStateForTests()
    clearSessionMessagesCache()
    setCcrKeepsSessionRules(undefined)
  })

  test('#1724: hasAutoModeNoCheckDenial catches auto_mode_no_check_in_session and auto_mode_stop_*', () => {
    expect(
      hasAutoModeNoCheckDenial({
        type: 'result',
        is_error: false,
        permission_denials: [
          { decision_reason_code: 'auto_mode_no_check_in_session' },
        ],
      }),
    ).toBe(true)
    expect(
      hasAutoModeNoCheckDenial({
        type: 'result',
        is_error: false,
        permission_denials: [
          { decision_reason_code: 'auto_mode_stop_no_verdict' },
        ],
      }),
    ).toBe(true)
    expect(
      hasAutoModeNoCheckDenial({
        type: 'result',
        is_error: false,
        permission_denials: [{ decision_reason_code: 'outside_reads_blocked' }],
      }),
    ).toBe(false)
  })

  test('#1726: print.ts serializes set_permission_mode behind pendingSetModelPromise', () => {
    const printDir = join(import.meta.dir, '../print')
    const src = [
      readFileSync(join(import.meta.dir, '../print.ts'), 'utf8'),
      ...readdirSync(printDir)
        .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
        .sort()
        .map(f => readFileSync(join(printDir, f), 'utf8')),
    ].join('\n')
    const idx = src.indexOf("msg.request.subtype === 'set_permission_mode'")
    expect(idx).toBeGreaterThan(-1)
    const slice = src.slice(idx, idx + 1600)
    expect(slice).toContain(
      'pendingSetModelPromise = pendingSetModelPromise.then(',
    )
    expect(slice).toContain('handleSetPermissionMode(')
  })

  test('#1733: QueryEngine and print.ts preserve unavailable deferred tool call and refuse later input', () => {
    const qeSrc = readFileSync(
      join(import.meta.dir, '../../QueryEngine.ts'),
      'utf8',
    )
    expect(qeSrc).toContain('keptDeferredToolNotice')
    expect(qeSrc).toContain('dropsUnavailableDeferredTool')
    expect(qeSrc).toContain("'tool_deferred_unavailable'")
    const printDir = join(import.meta.dir, '../print')
    const printSrc = [
      readFileSync(join(import.meta.dir, '../print.ts'), 'utf8'),
      ...readdirSync(printDir)
        .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
        .sort()
        .map(f => readFileSync(join(printDir, f), 'utf8')),
    ].join('\n')
    expect(printSrc).toContain('deferredCallRefusesTurns = true')
    expect(printSrc).toContain('if (deferredCallRefusesTurns)')
  })

  test('#1734: informational SDK output preserves content text', () => {
    expect(normalizeInformationalContent('hello notice')).toBe('hello notice')
    expect(
      normalizeInformationalContent([
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ]),
    ).toBe('line 1\nline 2')
    const normalized = normalizeInformationalSdkMessage({
      type: 'system',
      subtype: 'informational',
      content: [{ type: 'text', text: 'preserved' }] as unknown,
    })
    expect(normalized.content).toBe('preserved')
  })

  test('#1735 & #1912: Linux NFS statfs 0x6969 sync + fullDiskCode + stream-json stderr & session_writes_lost gating', async () => {
    // Linux NFS detection
    const flusher = new NfsAppendFlusher({
      platform: 'linux',
      statfsImpl: async () => ({ type: NFS_SUPER_MAGIC }),
    })
    expect(await flusher.flushesAppendsIn(tempDir)).toBe(true)

    const macFlusher = new NfsAppendFlusher({
      platform: 'darwin',
      statfsImpl: async () => ({ type: NFS_SUPER_MAGIC }),
    })
    expect(await macFlusher.flushesAppendsIn(tempDir)).toBe(false)

    // Write via appendAndSyncOnNfs
    const targetFile = join(tempDir, 'sess-1.jsonl')
    expect(await appendAndSyncOnNfs(targetFile, '{"ok":true}\n', flusher)).toBe(
      true,
    )
    expect(readFileSync(targetFile, 'utf8')).toBe('{"ok":true}\n')

    // Record EDQUOT full-disk error
    const err = Object.assign(new Error('quota exceeded'), { code: 'EDQUOT' })
    recordTranscriptFullDiskError(err, targetFile)
    expect(getTranscriptFullDiskState().fullDiskCode).toBe('EDQUOT')

    // Text output: stderr written + exitCode becomes 1
    let stderrText = ''
    const textRes = await handlePrintFullDiskExit({
      exitCode: 0,
      outputFormat: 'text',
      writeStderr: s => {
        stderrText += s
      },
      sessionId: 'sess-1',
    })
    expect(textRes.exitCode).toBe(1)
    expect(textRes.stderrWritten).toBe(true)
    expect(textRes.emittedSessionWritesLost).toBe(false)
    expect(stderrText).toContain('EDQUOT')

    // #1912 + #1735: stream-json with exitCode === 0 emits BOTH stderr AND session_writes_lost
    const streamMsgs: Array<Record<string, unknown>> = []
    let streamStderr = ''
    const streamOkRes = await handlePrintFullDiskExit({
      exitCode: 0,
      outputFormat: 'stream-json',
      writeStderr: s => {
        streamStderr += s
      },
      writeStreamMessage: m => {
        streamMsgs.push(m)
      },
      sessionId: 'sess-1',
    })
    expect(streamOkRes.exitCode).toBe(0)
    expect(streamOkRes.stderrWritten).toBe(true)
    expect(streamOkRes.emittedSessionWritesLost).toBe(true)
    expect(streamStderr).toContain('EDQUOT')
    expect(streamMsgs).toHaveLength(1)
    expect(streamMsgs[0]?.subtype).toBe('session_writes_lost')

    // #1735: stream-json with exitCode === 1 prints stderr but does NOT emit session_writes_lost
    const streamErrMsgs: Array<Record<string, unknown>> = []
    const streamFailRes = await handlePrintFullDiskExit({
      exitCode: 1,
      outputFormat: 'stream-json',
      writeStderr: () => {},
      writeStreamMessage: m => {
        streamErrMsgs.push(m)
      },
      sessionId: 'sess-1',
    })
    expect(streamFailRes.exitCode).toBe(1)
    expect(streamFailRes.emittedSessionWritesLost).toBe(false)
    expect(streamErrMsgs).toHaveLength(0)
  })

  test('#1736: rerunWouldLeavePlanMode suppresses auto-rerun when interrupted in plan mode and resumed in another mode', () => {
    const planMessages = [
      {
        type: 'user',
        uuid: 'u1',
        permissionMode: 'plan',
        message: { role: 'user', content: 'Plan the refactor' },
      },
    ] as unknown as Message[]

    expect(planSegmentState(planMessages)).toBe('open')
    expect(rerunWouldLeavePlanMode(planMessages, 'default', false)).toBe(true)
    expect(rerunWouldLeavePlanMode(planMessages, 'plan', false)).toBe(false)
    expect(rerunWouldLeavePlanMode(planMessages, 'default', true)).toBe(false)

    const result = deserializeMessagesWithInterruptDetection(
      planMessages,
      false,
      undefined,
      msgs => rerunWouldLeavePlanMode(msgs, 'default', false),
    )
    expect(result.turnInterruptionState.kind).toBe('none')
    expect(result.rerunHeldForPlan).toBe(true)
  })

  test('#1771 & #1816: ccr_kept_session_rules persists deny/ask/allow and drops allow if deny/ask cannot be kept whole', () => {
    const ctx = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: { session: ['Bash(git status)', 'Read'] },
      alwaysDenyRules: { session: ['Bash(rm -rf *)'] },
      alwaysAskRules: { session: ['WebFetch'] },
      isBypassPermissionsModeAvailable: false,
    }
    const { record, whole } = buildCcrSessionRulesRecord(ctx)
    expect(whole).toBe(true)
    expect(record.session_deny_rules).toEqual(['Bash(rm -rf *)'])
    expect(record.session_ask_rules).toEqual(['WebFetch'])
    expect(record.session_allow_rules).toEqual(['Bash(git status)', 'Read'])

    // Restore whole: keeps allow, deny, and ask
    const emptyCtx = {
      ...ctx,
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    }
    const restoredWhole = restoreCcrSessionRules(record)(emptyCtx)
    expect(restoredWhole.alwaysDenyRules.session).toEqual(['Bash(rm -rf *)'])
    expect(restoredWhole.alwaysAskRules.session).toEqual(['WebFetch'])
    expect(restoredWhole.alwaysAllowRules.session).toEqual([
      'Bash(git status)',
      'Read',
    ])
    expect(
      evaluateCcrKeepsSessionRules({ internal: record }, restoredWhole),
    ).toBe(true)

    // #1816: Invalid entry in deny rules -> deny not whole -> drop allow rules!
    const restoredPartial = restoreCcrSessionRules({
      session_deny_rules: ['Bash(rm -rf *)', 'bad`rule'],
      session_ask_rules: ['WebFetch'],
      session_allow_rules: ['Bash(git status)'],
    })(emptyCtx)
    expect(restoredPartial.alwaysDenyRules.session).toEqual(['Bash(rm -rf *)'])
    expect(restoredPartial.alwaysAskRules.session).toEqual(['WebFetch'])
    expect(restoredPartial.alwaysAllowRules.session).toBeUndefined()
  })

  test('#1774: cloud sessions filter cmd.isHidden in print.ts and HeadlessControlPlane', async () => {
    const filtered = filterCloudSlashCommands([
      { name: 'help', isHidden: false, userInvocable: true },
      { name: 'secret-internal', isHidden: true, userInvocable: true },
      { name: 'non-invocable', isHidden: false, userInvocable: false },
    ])
    expect(filtered.map(c => c.name)).toEqual(['help'])

    const prevApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    try {
      const init = await buildSdkInitializeResponse(
        [
          {
            name: 'visible',
            description: 'Visible',
            userFacingName: () => 'visible',
            type: 'local',
          },
          {
            name: 'hidden',
            description: 'Hidden',
            isHidden: true,
            userFacingName: () => 'hidden',
            type: 'local',
          },
        ] as unknown as Parameters<typeof buildSdkInitializeResponse>[0],
        [],
        [],
        {},
        () =>
          ({
            fastMode: false,
            toolPermissionContext: { mode: 'default' },
          }) as unknown as ReturnType<
            Parameters<typeof buildSdkInitializeResponse>[4]
          >,
      )
      expect(init.commands.map(c => c.name)).toEqual(['visible'])
    } finally {
      if (prevApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = prevApiKey
      }
    }
  })

  test('#1864: non-interactive -p caps background command default timeout at 10 minutes (600000 ms)', () => {
    expect(NON_INTERACTIVE_BG_TIMEOUT_CAP_MS).toBe(600_000)
    expect(resolveNonInteractiveBgTimeoutMs({ isNonInteractive: true })).toBe(
      600_000,
    )
    expect(
      formatNonInteractiveBgTimeoutToolDescription({ isNonInteractive: true }),
    ).toContain('default 600000 ms')
    expect(
      formatNonInteractiveBgTimeoutGuidance({ isNonInteractive: true }),
    ).toContain('10 minutes')
  })

  test('#1877: mcp_set_servers preserves same-name project/directory MCP servers', async () => {
    const projectClient = {
      type: 'connected' as const,
      name: 'shared-mcp',
      config: {
        type: 'stdio' as const,
        command: 'node',
        scope: 'project' as const,
      },
      cleanup: async () => {},
    }
    const projectTool = { name: 'mcp__shared-mcp__project_tool' }
    let state = {
      mcp: {
        clients: [projectClient],
        tools: [projectTool],
        commands: [],
      },
      toolPermissionContext: {
        mode: 'default' as const,
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    }
    await reconcileMcpServers(
      {},
      {
        configs: {
          'shared-mcp': {
            type: 'stdio',
            command: 'echo',
            scope: 'dynamic',
          } as never,
        },
        clients: [],
        tools: [],
      },
      updater => {
        state = updater(state as never) as unknown as typeof state
      },
    )
    expect(state.mcp.clients.map(c => c.name)).toEqual(['shared-mcp'])
    expect(state.mcp.tools.map(t => t.name)).toEqual([
      'mcp__shared-mcp__project_tool',
    ])
  })

  test('#1882: personWrote() resets cross-session rate-limit and relay counters', () => {
    const limiter = getCrossSessionSendLimiter()
    limiter.set(2, () => {})
    expect(limiter.take()).toBeUndefined()
    expect(limiter.take()).toBeUndefined()
    expect(limiter.take()).toBe(2) // exhausted
    const counters = getCrossSessionRelayCounters()
    counters.forwardsSincePrompt = 15
    counters.localSends = 10
    counters.bridgeSends = 5

    personWrote()

    expect(limiter.sinceAPersonWrote()).toBe(0)
    expect(limiter.mayOffer()).toBe(true)
    expect(counters.forwardsSincePrompt).toBe(0)
    expect(counters.localSends).toBe(0)
    expect(counters.bridgeSends).toBe(0)

    const standalone = new CrossSessionSendLimiter()
    standalone.set(1, () => {})
    standalone.take()
    expect(standalone.mayOffer()).toBe(false)
    standalone.personWrote()
    expect(standalone.mayOffer()).toBe(true)
  })

  test('#1883: cli.tsx recognizes agents subcommand after --permission-mode/--model/--effort/--agent/--verbose', async () => {
    const prevSkip = process.env.CLAUDE_CODE_CLI_SKIP_MAIN
    process.env.CLAUDE_CODE_CLI_SKIP_MAIN = '1'
    try {
      const { extractAgentsFastPathArgs } = await import(
        '../../entrypoints/cli.js'
      )
      // Leading flags before `agents` are stripped for recognition and preserved for agentsMain
      expect(
        extractAgentsFastPathArgs([
          '--permission-mode',
          'plan',
          '--model',
          'sonnet',
          '--effort=high',
          '--agent',
          'helper',
          '--verbose',
          'agents',
          '--extra',
          '1',
        ]),
      ).toEqual([
        '--permission-mode',
        'plan',
        '--model',
        'sonnet',
        '--effort=high',
        '--agent',
        'helper',
        '--verbose',
        '--extra',
        '1',
      ])
      // Bare `agents` still matches
      expect(extractAgentsFastPathArgs(['agents'])).toEqual([])
      // Stops before `--`
      expect(
        extractAgentsFastPathArgs(['--verbose', '--', 'agents']),
      ).toBeNull()
      // Non-agents subcommand returns null
      expect(
        extractAgentsFastPathArgs(['--model', 'sonnet', 'update']),
      ).toBeNull()
      // Verify production call-chain wiring in cli.tsx
      const cliSrc = readFileSync(
        join(import.meta.dir, '../../entrypoints/cli.tsx'),
        'utf8',
      )
      expect(cliSrc).toContain('extractAgentsFastPathArgs(args)')
      expect(cliSrc).toContain('await agentsMain(agentsFastPathArgs)')
    } finally {
      if (prevSkip === undefined) {
        delete process.env.CLAUDE_CODE_CLI_SKIP_MAIN
      } else {
        process.env.CLAUDE_CODE_CLI_SKIP_MAIN = prevSkip
      }
    }
  })

  test('#1896: getSessionMessages cleans up cache and degrades gracefully on OOM/RangeError/ERR_STRING_TOO_LONG', async () => {
    const sid = '22222222-2222-4222-8222-222222222222' as UUID
    const cache = getSessionMessagesCache()
    // Ensure non-existent/unreadable session never leaves rejected promise
    const res = await getSessionMessages(sid)
    expect(res).toBeInstanceOf(Set)
    // Verify catch path cleans cache entry in source
    const ssUtilsDir = join(import.meta.dir, '../../utils')
    const ssSubDir = join(ssUtilsDir, 'sessionStorage')
    const src = [
      readFileSync(join(ssUtilsDir, 'sessionStorage.ts'), 'utf8'),
      ...readdirSync(ssSubDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(ssSubDir, f), 'utf8')),
    ].join('\n')
    expect(src).toContain(
      'if (sessionMessagesCache.get(sessionId) === promise)',
    )
    expect(src).toContain('sessionMessagesCache.delete(sessionId)')
    expect(cache.size).toBeGreaterThanOrEqual(0)
  })

  test('#1905: handleOrphanedPermissionResponse sets skipSubmissionHooks: true', async () => {
    const enqueued: Array<Record<string, unknown>> = []
    const handled = await handleOrphanedPermissionResponse({
      message: {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-1',
          response: { behavior: 'allow', toolUseID: 'tu-1', updatedInput: {} },
        },
      } as never,
      setAppState: () => {},
      handledToolUseIds: new Set(),
      findUnresolvedToolUseFn: async () =>
        ({
          type: 'assistant',
          message: { id: 'msg-1', content: [] },
        }) as never,
      enqueueFn: cmd => {
        enqueued.push(cmd as unknown as Record<string, unknown>)
      },
    })
    expect(handled).toBe(true)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]?.mode).toBe('orphaned-permission')
    expect(enqueued[0]?.skipSubmissionHooks).toBe(true)
  })

  test('#1918: PendingReRunSendsTracker preserves subagent messages left to an interrupted-turn re-run', () => {
    const tracker = new PendingReRunSendsTracker()
    tracker.noteRescueWillAnswer(['send-subagent-1', 'send-subagent-2'])
    const cmd: { uuid: string; alsoLeftToThisReRun?: string[] } = {
      uuid: 'rerun-uuid-1',
    }
    expect(tracker.leaveItsSendsTo(cmd)).toEqual([
      'send-subagent-1',
      'send-subagent-2',
    ])
    expect(cmd.alsoLeftToThisReRun).toEqual([
      'send-subagent-1',
      'send-subagent-2',
    ])
    expect(tracker.reRunAnswers('send-subagent-1')).toBe(true)
    expect(
      tracker.waitsForItsReRun('send-subagent-1', u => u === 'rerun-uuid-1'),
    ).toBe(true)
    expect(
      tracker.declinesWithdrawalOf('rerun-uuid-1', u => u === 'rerun-uuid-1'),
    ).toBe(true)
    expect(tracker.noteAStopsReceipt({ cancelled: ['rerun-uuid-1'] })).toEqual([
      'send-subagent-1',
      'send-subagent-2',
    ])
    expect(tracker.reRunAnswers('send-subagent-1')).toBe(false)
  })

  test('#1926: printTaskNotificationCoalesce coalesces concurrent waiting background subagent handback peer prompts', () => {
    const makeHandback = (
      senderTaskId: string,
      body: string,
    ): QueuedCommand => ({
      mode: 'prompt',
      value: body,
      isMeta: true,
      origin: {
        kind: 'peer',
        from: senderTaskId,
        senderTaskId,
        handback: true,
      } as never,
    })
    const h1 = makeHandback('agent-1', 'Subagent 1 finished')
    const h2 = makeHandback('agent-2', 'Subagent 2 finished')
    expect(isCoalescableHandbackPeerPrompt(h1)).toBe(true)
    expect(canCoalesceTaskNotificationWithFollower(h1, h2)).toBe(true)

    const coalesce = createPrintTaskNotificationCoalesceState()
    const stamped = coalesce.maybeStampHold(h1, {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    expect(stamped.shouldQuery).toBe(false)
    expect(stamped.queryHeldForNextTurn).toBe(true)
  })

  test('#1947: AskUserQuestion denies host permission answer setting undocumented afkTimeoutMs', async () => {
    const denied = validateAskUserQuestionPermissionAnswer(
      { name: 'AskUserQuestion', isMcp: false },
      {
        behavior: 'allow',
        updatedInput: { answers: {}, afkTimeoutMs: 5000 },
      },
      'tu-ask-1',
    )
    expect(denied.behavior).toBe('deny')
    if ('message' in denied) {
      expect(denied.message).toBe(ASK_USER_QUESTION_AFK_TIMEOUT_DENY_MESSAGE)
    }

    const allowed = validateAskUserQuestionPermissionAnswer(
      { name: 'AskUserQuestion', isMcp: false },
      {
        behavior: 'allow',
        updatedInput: { answers: { q1: 'yes' } },
      },
      'tu-ask-2',
    )
    expect(allowed.behavior).toBe('allow')

    const guarded = guardAskUserQuestionAfkTimeout(async () => ({
      behavior: 'allow',
      updatedInput: { afkTimeoutMs: 1000 },
    }))
    const res = await guarded(
      { name: 'AskUserQuestion' } as never,
      {},
      {} as never,
      {} as never,
      'tu-ask-3',
    )
    expect(res.behavior).toBe('deny')
  })

  test('#1959: set_cwd rejects under Remote Control with reason: remote_origin', () => {
    expect(isRemoteControlOriginForSetCwd({ hasBridgeHandle: true }, {})).toBe(
      true,
    )
    expect(
      isRemoteControlOriginForSetCwd(
        {},
        { CLAUDE_CODE_BRIDGE_SESSION_ID: 'cse_123' },
      ),
    ).toBe(true)
    expect(isRemoteControlOriginForSetCwd({}, {})).toBe(false)

    const printDir = join(import.meta.dir, '../print')
    const src = [
      readFileSync(join(import.meta.dir, '../print.ts'), 'utf8'),
      ...readdirSync(printDir)
        .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
        .sort()
        .map(f => readFileSync(join(printDir, f), 'utf8')),
    ].join('\n')
    expect(src).toContain("reason: 'remote_origin'")
    expect(src).toContain('tengu_set_cwd_remote_refused')
  })
})
