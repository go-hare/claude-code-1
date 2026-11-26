import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { AppState } from '../../../state/AppStateStore.js'
import type {
  Message,
  SystemCompactBoundaryMessage,
  UserMessage,
} from '../../../types/message.js'
import {
  _resetForTesting as resetAnalyticsForTesting,
  attachAnalyticsSink,
  type LogEventMetadata,
} from '../../analytics/index.js'
import {
  Precompute,
  type PrecomputeEntry,
} from '../../../utils/sessionSlots.js'
import { normalizeAttachmentForAPI } from '../../../utils/messages.js'
import { isGoalToolsOnly } from '../../../query.js'
import { getServerCacheKey } from '../../mcp/connectionHelpers.js'
import {
  armAutoCompactAfterTurn,
  AUTO_COMPACT_AFTER_TURN_FLAG,
  formatResumingFromSummaryNotice,
  getPrecomputeWorkerHostKind,
  hasReadyPrecomputedSummaryForMessages,
  isAutoCompactAfterTurnEnabled,
  isAutoCompactCoolingDownOrFailing,
  resumeFromSavedSummary,
  SAVED_SUMMARY_RESUME_NOTICE,
} from '../autoCompact.js'
import {
  emitPromptAsFileNotice,
  getOriginalPromptMessage,
  PROMPT_AS_FILE_NOTICE,
  rewriteOversizedPromptsForApi,
  trySaveOversizedPromptAsFile,
} from '../promptAsFile.js'
import {
  BashWaitAfterJobsState,
  computeSleepWaitGraceSeconds,
  isBashWaitAfterJobsEnabled,
  isSleepWaitCommand,
  recordBashWaitAfterJobsSettle,
  sanitizeBashWaitToolUseId,
  shouldMoveBashWaitAfterJobs,
} from '../../../tasks/LocalShellTask/LocalShellTask.js'
import {
  BACKGROUND_WORK_COMMIT_WARNING,
  CLAUDE_CODE_LAZY_WORKTREE_ENV,
  countActiveBackgroundWorkForCommit,
  getBackgroundWorkCommitWarning,
  isDesktopWorktreePutUpAllowed,
  isLazyWorktreeEnvSet,
} from '../../../utils/worktree.js'
import {
  AUTO_CONTINUE_AFTER_SWITCH_PROMPT,
  executeRateLimitSwitchModel,
  getRateLimitSwitchModelFallback,
  getSwitchModelTargetForRateLimit,
} from '../../../commands/rate-limit-options/rate-limit-options.js'
import {
  applyCapabilityServeTimeMiss,
  clearAllDiscoveryCacheEntries,
  createCachedMcpClient,
  discoverySourceForMiss,
  isCacheOutcomeMiss,
  logMcpDiscoverySource,
  markSwrRefreshDialInFlight,
  MCP_DISCOVERY_CACHE_FRESH_TTL_MS,
  MCP_DISCOVERY_CACHE_STALE_TTL_MS,
  persistLiveListing,
  persistRawDiscoveryIfComplete,
  readDiscoveryCacheEntry,
  recordDiscoveryRefreshStrike,
  recordRawCommandsForResult,
  recordRawResourcesForResult,
  recordRawToolsForResult,
  runCachedFirstDialArms,
  subscribeCachedAdopt,
  subscribeCachedDialFailed,
  takeSettledCachedDialFailure,
  unmarkSwrRefreshDialInFlight,
  writeDiscoveryCacheEntry,
} from '../../mcp/discoveryCache.js'
import type {
  ConnectedMCPServer,
  FailedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../mcp/types.js'

type RecordedEvent = {
  eventName: string
  metadata: LogEventMetadata
}

function makeUserMessage(
  text: string,
  uuid: string,
  extra?: Partial<UserMessage> & { origin?: { kind?: string } },
): UserMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    message: {
      role: 'user',
      content: text,
    },
    ...extra,
  } as UserMessage
}

function makeCompactBoundary(uuid: string): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: uuid as UUID,
    level: 'info',
    compactMetadata: {
      trigger: 'auto',
      preTokens: 100_000,
    },
  }
}

let events: RecordedEvent[] = []

beforeEach(() => {
  events = []
  resetAnalyticsForTesting()
  attachAnalyticsSink({
    logEvent(eventName, metadata) {
      events.push({ eventName, metadata })
    },
    async logEventAsync(eventName, metadata) {
      events.push({ eventName, metadata })
    },
  })
  clearAllDiscoveryCacheEntries()
})

afterEach(() => {
  clearAllDiscoveryCacheEntries()
  resetAnalyticsForTesting()
})

// ---------------------------------------------------------------------------
// 1. tengu_auto_compact_after_turn + prompt_as_file + saved summary resume + GOAL_TOOL_NAMES
// ---------------------------------------------------------------------------
describe('2.1.331 Area 1: auto_compact_after_turn, prompt_as_file, saved summary resume, GOAL_TOOL_NAMES', () => {
  test('detects precompute worker host kinds and gates tengu_hidden_rain', () => {
    expect(AUTO_COMPACT_AFTER_TURN_FLAG).toBe('tengu_hidden_rain')
    expect(getPrecomputeWorkerHostKind({})).toBe('none')
    expect(
      getPrecomputeWorkerHostKind({ CLAUDE_CODE_TOOL_CONTAINER_DAEMON: '1' }),
    ).toBe('tool_container_daemon')
    expect(
      getPrecomputeWorkerHostKind({ CLAUDE_CODE_CCS_TENANT: 'true' }),
    ).toBe('ccs_tenant')
    expect(
      getPrecomputeWorkerHostKind({
        CLAUDE_CODE_REMOTE: '1',
        CLAUDE_CODE_ENVIRONMENT_KIND: 'anthropic_cloud',
        CLAUDE_CODE_REMOTE_SESSION_ID: 'sess_123',
      }),
    ).toBe('hosted_worker')

    expect(
      isAutoCompactAfterTurnEnabled({
        workerHostKind: 'none',
        flagEnabled: true,
      }),
    ).toBe(false)
    expect(
      isAutoCompactAfterTurnEnabled({
        workerHostKind: 'hosted_worker',
        flagEnabled: false,
      }),
    ).toBe(false)
    expect(
      isAutoCompactAfterTurnEnabled({
        workerHostKind: 'hosted_worker',
        flagEnabled: true,
      }),
    ).toBe(true)
  })

  test('armAutoCompactAfterTurn arms precompute with armTrigger=after_turn and emits tengu_auto_compact_after_turn', async () => {
    const precompute = new Precompute()
    precompute.setSummaryReachesNextWorker(() => true)
    const msg = makeUserMessage(
      'Summarize this long work.',
      '00000000-0000-4000-8000-000000000001',
    )

    const result = await armAutoCompactAfterTurn({
      messages: [msg],
      model: 'claude-sonnet-4-6',
      precompute,
      querySource: 'repl_main_thread',
      limits: { status: 'allowed', overageInUse: false },
      shouldCompactCheck: async () => true,
      canSpendCheck: () => true,
      runSummarize: async () => ({
        ok: true,
        result: {
          boundaryMarker: makeCompactBoundary(
            '00000000-0000-4000-8000-000000000099',
          ),
          summaryMessages: [],
          attachments: [],
          hookResults: [],
          messagesToKeep: [],
          preCompactTokenCount: 120_000,
          postCompactTokenCount: 10_000,
        },
      }),
    })

    expect(result).toEqual({ armed: true })
    const entry = precompute.get('main') as PrecomputeEntry | undefined
    expect(entry).toBeDefined()
    expect(entry?.armTrigger).toBe('after_turn')
    await entry?.settled

    expect(
      (precompute.get('main') as PrecomputeEntry | undefined)?.status,
    ).toBe('ready')
    expect(hasReadyPrecomputedSummaryForMessages(precompute, [msg])).toBe(true)
    expect(
      events.some(e => e.eventName === 'tengu_auto_compact_after_turn'),
    ).toBe(true)
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_precomputed_compact_started' &&
          e.metadata.armTrigger === 'after_turn',
      ),
    ).toBe(true)
  })

  test('armAutoCompactAfterTurn skips with would_spend when billedToUsageCredits, overageInUse, rejected limits, or !canSpend', async () => {
    const msg = makeUserMessage('hello', '00000000-0000-4000-8000-000000000002')
    const cases = [
      {
        billedToUsageCredits: true,
        limits: { status: 'allowed' as const, overageInUse: false },
        canSpend: true,
      },
      {
        billedToUsageCredits: false,
        limits: { status: 'allowed' as const, overageInUse: true },
        canSpend: true,
      },
      {
        billedToUsageCredits: false,
        limits: { status: 'rejected' as const, overageInUse: false },
        canSpend: true,
      },
      {
        billedToUsageCredits: false,
        limits: { status: 'allowed' as const, overageInUse: false },
        canSpend: false,
      },
    ]

    for (const tc of cases) {
      events = []
      const precompute = new Precompute()
      precompute.setSummaryReachesNextWorker(() => true)
      const res = await armAutoCompactAfterTurn({
        messages: [msg],
        model: 'claude-sonnet-4-6',
        precompute,
        querySource: 'repl_main_thread',
        billedToUsageCredits: tc.billedToUsageCredits,
        limits: tc.limits,
        shouldCompactCheck: async () => true,
        canSpendCheck: () => tc.canSpend,
      })
      expect(res).toEqual({ armed: false, skipReason: 'would_spend' })
      expect(precompute.has('main')).toBe(false)
      expect(
        events.some(
          e =>
            e.eventName === 'tengu_feature_sad' &&
            e.metadata.feature_name === 'compact_after_turn' &&
            e.metadata.error_code === 'would_spend',
        ),
      ).toBe(true)
    }
  })

  test('armAutoCompactAfterTurn honors cooldown/failure, summaryReachesNextWorker, and threw recovery', async () => {
    expect(
      isAutoCompactCoolingDownOrFailing({
        compacted: true,
        turnCounter: 1,
        turnId: 't1',
      }),
    ).toBe(true)
    expect(
      isAutoCompactCoolingDownOrFailing({
        compacted: false,
        turnCounter: 5,
        turnId: 't2',
        consecutiveFailures: 1,
      }),
    ).toBe(true)

    const msg = makeUserMessage('hello', '00000000-0000-4000-8000-000000000003')
    const precomputeNoReach = new Precompute()
    precomputeNoReach.setSummaryReachesNextWorker(() => false)
    expect(
      await armAutoCompactAfterTurn({
        messages: [msg],
        model: 'claude-sonnet-4-6',
        precompute: precomputeNoReach,
        querySource: 'repl_main_thread',
        shouldCompactCheck: async () => true,
        canSpendCheck: () => true,
      }),
    ).toEqual({ armed: false })

    const precomputeThrow = new Precompute()
    precomputeThrow.setSummaryReachesNextWorker(() => true)
    const threwRes = await armAutoCompactAfterTurn({
      messages: [msg],
      model: 'claude-sonnet-4-6',
      precompute: precomputeThrow,
      querySource: 'repl_main_thread',
      shouldCompactCheck: async () => {
        throw new Error('boom')
      },
      canSpendCheck: () => true,
    })
    expect(threwRes).toEqual({ armed: false, skipReason: 'threw' })
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_sad' &&
          e.metadata.feature_name === 'compact_after_turn' &&
          e.metadata.error_code === 'threw',
      ),
    ).toBe(true)
  })

  test('prompt_as_file saves oversized prompt, rewrites to head/tail excerpt idempotently, and emits exact notice', async () => {
    const head = 'HEAD_MARKER_' + 'A'.repeat(2500)
    const middle = 'M'.repeat(40_000)
    const tail = 'Z'.repeat(2500) + '_TAIL_MARKER'
    const bigText = head + middle + tail
    const promptUuid = '00000000-0000-4000-8000-000000000010'
    const userMsg = makeUserMessage(bigText, promptUuid)

    let savedPath = ''
    let savedText = ''
    const saved = await trySaveOversizedPromptAsFile({
      rows: [userMsg],
      contextWindow: 10_000,
      needsProof: true,
      beforeCompaction: true,
      tools: [{ name: 'Read' }],
      flagEnabled: true,
      maxBytes: 10_000_000,
      savePromptFile: async (text, id) => {
        savedText = text
        savedPath = `/tmp/test-prompts/${id}.txt`
        return { filepath: savedPath }
      },
    })

    expect(saved).toBeDefined()
    expect(saved).not.toBe('no_file')
    expect(savedText).toBe(bigText)
    if (saved && saved !== 'no_file') {
      expect(saved.attachment.type).toBe('prompt_as_file')
      if (saved.attachment.type === 'prompt_as_file') {
        expect(saved.attachment.promptUuid).toBe(promptUuid)
        expect(saved.attachment.path).toBe(savedPath)
        expect(saved.attachment.characters).toBe(bigText.length)
      }
      // API normalization strips prompt_as_file attachment rows cleanly.
      expect(normalizeAttachmentForAPI(saved.attachment)).toEqual([])
    }
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_ok' &&
          e.metadata.feature_name === 'prompt_as_file_before_compaction',
      ),
    ).toBe(true)

    // User-facing notice copy matches official 2.1.331 verbatim.
    const queuedNotices: ReturnType<typeof emitPromptAsFileNotice>[] = []
    const emitted = emitPromptAsFileNotice(n => queuedNotices.push(n))
    expect(emitted?.content).toBe(
      'Your message was too long to send to Claude in full, so it was saved to a file for Claude to read.',
    )
    expect(emitted?.content).toBe(PROMPT_AS_FILE_NOTICE)
    expect(emitted?.tag).toBe('prompt_as_file')
    expect(queuedNotices.length).toBe(1)

    // Rewriting for API replaces the big prompt with bounded head/tail excerpts + reminder.
    const rowsWithAtt: Message[] = [
      userMsg,
      saved as Exclude<typeof saved, 'no_file' | undefined>,
    ]
    const rewrittenOnce = rewriteOversizedPromptsForApi(rowsWithAtt, 10_000)
    expect(rewrittenOnce).not.toBe(rowsWithAtt)
    const rewrittenUser = rewrittenOnce[0] as UserMessage
    expect(getOriginalPromptMessage(rewrittenUser)).toBe(userMsg)
    expect(Array.isArray(rewrittenUser.message.content)).toBe(true)
    const blocks = rewrittenUser.message.content as Array<{
      type: string
      text?: string
    }>
    const joined = blocks.map(b => b.text ?? '').join('\n')
    expect(joined).toContain(savedPath)
    expect(joined).toContain('HEAD_MARKER_')
    expect(joined).toContain('_TAIL_MARKER')
    expect(joined).toContain('characters left out')
    expect(joined.length).toBeLessThan(bigText.length / 4)

    // Idempotent on second pass.
    const rewrittenTwice = rewriteOversizedPromptsForApi(rewrittenOnce, 10_000)
    expect(rewrittenTwice).toBe(rewrittenOnce)
  })

  test('prompt_as_file enforces no_read_tool, over_max_bytes, not_allowed, and not_from_a_person guards', async () => {
    const bigText = 'X'.repeat(50_000)
    const promptUuid = '00000000-0000-4000-8000-000000000011'
    const userMsg = makeUserMessage(bigText, promptUuid)

    expect(
      await trySaveOversizedPromptAsFile({
        rows: [userMsg],
        contextWindow: 10_000,
        needsProof: false,
        beforeCompaction: false,
        tools: [{ name: 'Grep' }],
        flagEnabled: true,
        maxBytes: 1_000_000,
      }),
    ).toBe('no_file')
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_sad' &&
          e.metadata.feature_name === 'prompt_as_file' &&
          e.metadata.error_code === 'no_read_tool',
      ),
    ).toBe(true)

    expect(
      await trySaveOversizedPromptAsFile({
        rows: [userMsg],
        contextWindow: 10_000,
        needsProof: false,
        beforeCompaction: false,
        tools: [{ name: 'Read' }],
        flagEnabled: true,
        maxBytes: 100,
      }),
    ).toBe('no_file')
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_sad' &&
          e.metadata.feature_name === 'prompt_as_file' &&
          e.metadata.error_code === 'over_max_bytes',
      ),
    ).toBe(true)

    expect(
      await trySaveOversizedPromptAsFile({
        rows: [userMsg],
        contextWindow: 10_000,
        needsProof: false,
        beforeCompaction: false,
        tools: [{ name: 'Read' }],
        flagEnabled: true,
        maxBytes: null,
      }),
    ).toBe('no_file')
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_sad' &&
          e.metadata.feature_name === 'prompt_as_file' &&
          e.metadata.error_code === 'not_allowed',
      ),
    ).toBe(true)

    const nonHumanMsg = makeUserMessage(
      bigText,
      '00000000-0000-4000-8000-000000000012',
      {
        origin: { kind: 'task-notification' },
      },
    )
    expect(
      await trySaveOversizedPromptAsFile({
        rows: [nonHumanMsg],
        contextWindow: 10_000,
        needsProof: false,
        beforeCompaction: false,
        tools: [{ name: 'Read' }],
        flagEnabled: true,
        maxBytes: 1_000_000,
      }),
    ).toBeUndefined()
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_sad' &&
          e.metadata.feature_name === 'prompt_as_file_not_tried' &&
          e.metadata.error_code === 'not_from_a_person',
      ),
    ).toBe(true)
  })

  test('resumeFromSavedSummary announces exact saved-summary notice vs on-demand summary notice', async () => {
    const precompute = new Precompute()
    const msg = makeUserMessage(
      'resume work',
      '00000000-0000-4000-8000-000000000020',
    )
    precompute.put('main', {
      status: 'ready',
      armTrigger: 'after_turn',
      coverage: {
        lastUuid: msg.uuid,
        seenUuids: new Set([msg.uuid]),
        rowUuids: [msg.uuid],
      },
      preCompactTokens: 90_000,
      model: 'claude-sonnet-4-6',
      startedAt: 0,
      abortController: new AbortController(),
      settled: Promise.resolve(),
    })

    let messages: Message[] = [msg]
    const notices: string[] = []
    const savedRes = await resumeFromSavedSummary({
      precompute,
      getMessages: () => messages,
      appendNotice: c => notices.push(c),
      runCompact: async () => {
        messages = [
          ...messages,
          makeCompactBoundary('00000000-0000-4000-8000-000000000021'),
        ]
      },
    })

    expect(savedRes).toEqual({ applied: true, usedSavedSummary: true })
    expect(notices).toEqual(['Resumed from a saved summary to save usage.'])
    expect(notices[0]).toBe(SAVED_SUMMARY_RESUME_NOTICE)

    // Without a ready summary, announces the pre-compact notice with cancel key instead.
    const emptyPrecompute = new Precompute()
    let messages2: Message[] = [msg]
    const notices2: string[] = []
    const liveRes = await resumeFromSavedSummary({
      precompute: emptyPrecompute,
      getMessages: () => messages2,
      appendNotice: c => notices2.push(c),
      runCompact: async () => {
        messages2 = [
          ...messages2,
          makeCompactBoundary('00000000-0000-4000-8000-000000000022'),
        ]
      },
    })
    expect(liveRes).toEqual({ applied: true, usedSavedSummary: false })
    expect(notices2).toEqual([formatResumingFromSummaryNotice('esc')])
    expect(notices2[0]).toBe(
      'Resuming from a summary to save usage. Press esc to keep the full conversation.',
    )
  })

  test('isGoalToolsOnly recognizes both SetGoal and ProposeGoal seamlessly', () => {
    const mkBlock = (name: string): ToolUseBlock => ({
      type: 'tool_use',
      id: `tu_${name}`,
      name,
      input: {},
      caller: { type: 'direct' },
    })
    expect(isGoalToolsOnly([mkBlock('SetGoal')])).toBe(true)
    expect(isGoalToolsOnly([mkBlock('ProposeGoal')])).toBe(true)
    expect(isGoalToolsOnly([mkBlock('SetGoal'), mkBlock('ProposeGoal')])).toBe(
      true,
    )
    expect(
      isGoalToolsOnly([
        mkBlock('ProposeGoal'),
        mkBlock('PauseGoal'),
        mkBlock('GetGoal'),
      ]),
    ).toBe(true)
    expect(isGoalToolsOnly([mkBlock('ProposeGoal'), mkBlock('Bash')])).toBe(
      false,
    )
    expect(isGoalToolsOnly([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Foreground Bash wait grace period after background jobs (tengu_bash_wait_after_jobs)
// ---------------------------------------------------------------------------
describe('2.1.331 Area 2: Bash wait grace period after background jobs', () => {
  test('computeSleepWaitGraceSeconds, isSleepWaitCommand, isBashWaitAfterJobsEnabled, and sanitizeBashWaitToolUseId', () => {
    expect(computeSleepWaitGraceSeconds('sleep 30')).toBe(3)
    expect(
      computeSleepWaitGraceSeconds('while true; do sleep 5; ls; done'),
    ).toBe(8)
    expect(computeSleepWaitGraceSeconds('while true; do sleep 1m; done')).toBe(
      63,
    )

    expect(isSleepWaitCommand('sleep 20')).toBe(true)
    expect(isSleepWaitCommand('sleep 1m')).toBe(true)
    expect(isSleepWaitCommand('sleep 5')).toBe(false)
    expect(isSleepWaitCommand('while true; do sleep 2; done')).toBe(true)
    expect(isSleepWaitCommand('while ($true) { sleep 2 }', 'powershell')).toBe(
      true,
    )
    expect(isSleepWaitCommand('a'.repeat(10_001))).toBe(false)

    expect(
      isBashWaitAfterJobsEnabled({ entrypoint: 'cli', modeOverride: 'end' }),
    ).toBe(true)
    expect(
      isBashWaitAfterJobsEnabled({
        entrypoint: 'claude-desktop',
        modeOverride: 'count',
      }),
    ).toBe(true)
    expect(
      isBashWaitAfterJobsEnabled({
        entrypoint: 'sdk-ts',
        modeOverride: 'end',
      }),
    ).toBe(false)
    expect(
      isBashWaitAfterJobsEnabled({ entrypoint: 'cli', modeOverride: '' }),
    ).toBe(false)

    expect(sanitizeBashWaitToolUseId('toolu_123:preamble-abc')).toBe(
      'toolu_123',
    )
    expect(sanitizeBashWaitToolUseId('toolu_123:inner')).toBeUndefined()
    expect(sanitizeBashWaitToolUseId('toolu_456')).toBe('toolu_456')
  })

  test('byCall grace tracker enforces mode/graceMs/elapsed/movedForJob and emits tengu_bash_wait_after_jobs + task_local_shell_wait_after_jobs on settle', () => {
    const state = new BashWaitAfterJobsState()
    const task = {
      toolUseId: 'toolu_wait_01:preamble-x',
      command: 'while true; do sleep 5; done',
    }

    // First observation at t=1000 registers graceMs = (5 + 3) * 1000 = 8000ms.
    expect(shouldMoveBashWaitAfterJobs(state, task, true, 1000, 'end')).toBe(
      false,
    )
    const entry = state.byCall.get(task.toolUseId)
    expect(entry).toEqual({
      firstSeenAt: 1000,
      mode: 'end',
      graceMs: 8000,
      movedForJob: false,
    })

    // Still before graceMs at t=8999 -> false.
    expect(shouldMoveBashWaitAfterJobs(state, task, true, 8999, 'end')).toBe(
      false,
    )
    // Past graceMs but elapsedLongEnough=false -> false.
    expect(shouldMoveBashWaitAfterJobs(state, task, false, 9500, 'end')).toBe(
      false,
    )
    // Past graceMs and elapsedLongEnough=true -> true once, latches movedForJob.
    expect(shouldMoveBashWaitAfterJobs(state, task, true, 9500, 'end')).toBe(
      true,
    )
    expect(state.byCall.get(task.toolUseId)?.movedForJob).toBe(true)
    expect(shouldMoveBashWaitAfterJobs(state, task, true, 12_000, 'end')).toBe(
      false,
    )

    // On settle: deletes byCall entry and emits tengu_bash_wait_after_jobs + task_local_shell_wait_after_jobs.
    const emitted = recordBashWaitAfterJobsSettle(
      state,
      task.toolUseId,
      {
        code: 0,
        interrupted: false,
        backgroundTaskId: 'bash_bg_1',
      },
      10_000,
    )
    expect(emitted).toBe(true)
    expect(state.byCall.has(task.toolUseId)).toBe(false)

    const waitEvent = events.find(
      e => e.eventName === 'tengu_bash_wait_after_jobs',
    )
    expect(waitEvent).toBeDefined()
    expect(waitEvent?.metadata).toEqual({
      enabled: true,
      wait_ms: 9000,
      timeout_ms: 8000,
      timed_out: false,
      was_backgrounded: true,
      interrupted: false,
      exit_code: 0,
      tool_use_id: 'toolu_wait_01',
    })
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_ok' &&
          e.metadata.feature_name === 'task_local_shell_wait_after_jobs',
      ),
    ).toBe(true)

    // In 'count' mode, never moves even after grace period, and logs enabled: false on settle.
    events = []
    const countTask = { toolUseId: 'toolu_count_01', command: 'sleep 30' }
    expect(
      shouldMoveBashWaitAfterJobs(state, countTask, true, 1000, 'count'),
    ).toBe(false)
    expect(
      shouldMoveBashWaitAfterJobs(state, countTask, true, 100_000, 'count'),
    ).toBe(false)
    recordBashWaitAfterJobsSettle(
      state,
      countTask.toolUseId,
      { code: 0, interrupted: false },
      10_000,
    )
    const countEvent = events.find(
      e => e.eventName === 'tengu_bash_wait_after_jobs',
    )
    expect(countEvent?.metadata.enabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. CLAUDE_CODE_LAZY_WORKTREE + Background Work Commit Warning
// ---------------------------------------------------------------------------
describe('2.1.331 Area 3: CLAUDE_CODE_LAZY_WORKTREE and background work commit warning', () => {
  test('isLazyWorktreeEnvSet and isDesktopWorktreePutUpAllowed honor CLAUDE_CODE_LAZY_WORKTREE', () => {
    expect(CLAUDE_CODE_LAZY_WORKTREE_ENV).toBe('CLAUDE_CODE_LAZY_WORKTREE')
    expect(isLazyWorktreeEnvSet({})).toBe(false)
    expect(isLazyWorktreeEnvSet({ CLAUDE_CODE_LAZY_WORKTREE: '' })).toBe(true)
    expect(isLazyWorktreeEnvSet({ CLAUDE_CODE_LAZY_WORKTREE: '1' })).toBe(true)

    expect(
      isDesktopWorktreePutUpAllowed({
        desktopShipFlagEnabled: true,
        codeTabsOwnSession: true,
        env: {},
      }),
    ).toBe(true)
    expect(
      isDesktopWorktreePutUpAllowed({
        desktopShipFlagEnabled: true,
        codeTabsOwnSession: true,
        env: { CLAUDE_CODE_LAZY_WORKTREE: '1' },
      }),
    ).toBe(false)
    expect(
      isDesktopWorktreePutUpAllowed({
        desktopShipFlagEnabled: true,
        codeTabsOwnSession: true,
        isRemote: true,
        env: {},
      }),
    ).toBe(false)
    expect(
      isDesktopWorktreePutUpAllowed({
        desktopShipFlagEnabled: true,
        codeTabsOwnSession: true,
        isChildSession: true,
        env: {},
      }),
    ).toBe(false)
  })

  test('countActiveBackgroundWorkForCommit and getBackgroundWorkCommitWarning return exact warning when dirty with active bg agent', () => {
    const tasks = {
      bgAgent: { status: 'running', type: 'local_agent', isBackgrounded: true },
      observerAgent: {
        status: 'running',
        type: 'local_agent',
        isBackgrounded: true,
        isObserver: true,
      },
      fgAgent: {
        status: 'running',
        type: 'local_agent',
        isBackgrounded: false,
      },
      doneAgent: {
        status: 'completed',
        type: 'local_agent',
        isBackgrounded: true,
      },
      activeTeammate: {
        status: 'running',
        type: 'in_process_teammate',
        isIdle: false,
      },
      idleTeammate: {
        status: 'running',
        type: 'in_process_teammate',
        isIdle: true,
      },
      workflow: { status: 'running', type: 'local_workflow' },
      script: { status: 'running', type: 'local_script' },
      bgShell: { status: 'running', type: 'local_bash', isBackgrounded: true },
      fgShell: { status: 'running', type: 'local_bash', isBackgrounded: false },
    }

    expect(countActiveBackgroundWorkForCommit(tasks)).toEqual({
      agents: 4,
      shells: 1,
    })
    expect(
      countActiveBackgroundWorkForCommit(tasks, { includeLocalScript: false }),
    ).toEqual({
      agents: 3,
      shells: 1,
    })

    const warning = getBackgroundWorkCommitWarning({
      isClean: false,
      tasks: { bgAgent: tasks.bgAgent },
    })
    expect(warning).toBe(
      'Claude is still at work in the background in this session, and a commit would take along what it has half written. Once that work is done',
    )
    expect(warning).toBe(BACKGROUND_WORK_COMMIT_WARNING)

    // Clean repo, no target PR, or only background shell / completed agent -> undefined.
    expect(
      getBackgroundWorkCommitWarning({
        isClean: true,
        tasks: { bgAgent: tasks.bgAgent },
      }),
    ).toBeUndefined()
    expect(
      getBackgroundWorkCommitWarning({
        isClean: false,
        hasTargetPr: false,
        tasks: { bgAgent: tasks.bgAgent },
      }),
    ).toBeUndefined()
    expect(
      getBackgroundWorkCommitWarning({
        isClean: false,
        tasks: { bgShell: tasks.bgShell, doneAgent: tasks.doneAgent },
      }),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Rate-Limit Options Menu Switch-Model Action
// ---------------------------------------------------------------------------
describe('2.1.331 Area 4: Rate-limit options menu switch-model action', () => {
  test('getRateLimitSwitchModelFallback and getSwitchModelTargetForRateLimit gate seven_day_overage_included', () => {
    expect(
      getRateLimitSwitchModelFallback({
        candidates: ['claude-fable-5', 'claude-sonnet-4-6'],
        allowCheck: () => true,
      }),
    ).toBe('claude-sonnet-4-6')
    expect(
      getRateLimitSwitchModelFallback({
        noModelFallback: true,
        candidates: ['claude-sonnet-4-6'],
        allowCheck: () => true,
      }),
    ).toBeNull()

    const eligible = getSwitchModelTargetForRateLimit(
      { status: 'rejected', rateLimitType: 'seven_day_overage_included' },
      'claude-fable-5',
      {
        rawUtilization: {
          five_hour: { utilization: 0.4, resets_at: 1_900_000_000 },
          seven_day: { utilization: 0.6, resets_at: 1_900_000_000 },
        },
        isSubscriber: true,
        billingType: 'stripe_subscription',
        isInteractive: true,
        isRemote: false,
        flagEnabled: true,
        fallbackModel: 'claude-sonnet-4-6',
      },
    )
    expect(eligible).toBe('claude-sonnet-4-6')

    // Rejects when 5h util >= 1, wrong rateLimitType, usage_based, or flag off.
    expect(
      getSwitchModelTargetForRateLimit(
        { status: 'rejected', rateLimitType: 'seven_day_overage_included' },
        'claude-fable-5',
        {
          rawUtilization: {
            five_hour: { utilization: 1, resets_at: 1_900_000_000 },
            seven_day: { utilization: 0.6, resets_at: 1_900_000_000 },
          },
          isSubscriber: true,
          billingType: 'stripe_subscription',
          isInteractive: true,
          isRemote: false,
          flagEnabled: true,
          fallbackModel: 'claude-sonnet-4-6',
        },
      ),
    ).toBeNull()
    expect(
      getSwitchModelTargetForRateLimit(
        { status: 'rejected', rateLimitType: 'five_hour' },
        'claude-fable-5',
        {
          rawUtilization: {
            five_hour: { utilization: 0.2, resets_at: 1_900_000_000 },
            seven_day: { utilization: 0.2, resets_at: 1_900_000_000 },
          },
          isSubscriber: true,
          billingType: 'stripe_subscription',
          isInteractive: true,
          isRemote: false,
          flagEnabled: true,
          fallbackModel: 'claude-sonnet-4-6',
        },
      ),
    ).toBeNull()
    expect(
      getSwitchModelTargetForRateLimit(
        { status: 'rejected', rateLimitType: 'seven_day_overage_included' },
        'claude-fable-5',
        {
          rawUtilization: {
            five_hour: { utilization: 0.2, resets_at: 1_900_000_000 },
            seven_day: { utilization: 0.2, resets_at: 1_900_000_000 },
          },
          isSubscriber: true,
          billingType: 'usage_based',
          isInteractive: true,
          isRemote: false,
          flagEnabled: true,
          fallbackModel: 'claude-sonnet-4-6',
        },
      ),
    ).toBeNull()
    expect(
      getSwitchModelTargetForRateLimit(
        { status: 'rejected', rateLimitType: 'seven_day_overage_included' },
        'claude-fable-5',
        {
          rawUtilization: {
            five_hour: { utilization: 0.2, resets_at: 1_900_000_000 },
            seven_day: { utilization: 0.2, resets_at: 1_900_000_000 },
          },
          isSubscriber: true,
          billingType: 'stripe_subscription',
          isInteractive: true,
          isRemote: false,
          flagEnabled: false,
          fallbackModel: 'claude-sonnet-4-6',
        },
      ),
    ).toBeNull()
  })

  test('executeRateLimitSwitchModel emits tengu_rate_limit_options_menu_select_switch_model, updates mainLoopModel, and queues continuation', () => {
    let appState = { mainLoopModel: 'claude-fable-5' } as AppState
    const queuedPrompts: string[] = []
    let doneMsg: string | undefined
    let doneDisplay: string | undefined

    executeRateLimitSwitchModel({
      targetModel: 'claude-sonnet-4-6',
      setAppState: updater => {
        appState = updater(appState)
      },
      enqueueContinuation: prompt => queuedPrompts.push(prompt),
      onDone: (msg, opts) => {
        doneMsg = msg
        doneDisplay = opts?.display
      },
    })

    expect(appState.mainLoopModel).toBe('claude-sonnet-4-6')
    expect(queuedPrompts).toEqual([AUTO_CONTINUE_AFTER_SWITCH_PROMPT])
    expect(doneDisplay).toBe('system')
    expect(doneMsg).toContain('for this session · /model to change')
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_rate_limit_options_menu_select_switch_model',
      ),
    ).toBe(true)
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_ok' &&
          e.metadata.feature_name === 'model_switch',
      ),
    ).toBe(true)

    // Throwing setAppState records limit_menu_switch_threw and reports clean fallback message.
    events = []
    let errMsg: string | undefined
    executeRateLimitSwitchModel({
      targetModel: 'claude-sonnet-4-6',
      setAppState: () => {
        throw new Error('state boom')
      },
      onDone: msg => {
        errMsg = msg
      },
    })
    expect(errMsg).toBe("Couldn't switch models. Run /model to switch.")
    expect(
      events.some(
        e =>
          e.eventName === 'tengu_feature_bad' &&
          e.metadata.feature_name === 'model_switch' &&
          e.metadata.error_code === 'limit_menu_switch_threw',
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. MCP Cache-First Discovery (runCachedFirstDialArms / persistLiveListing)
// ---------------------------------------------------------------------------
describe('2.1.331 Area 5: MCP cache-first discovery (runCachedFirstDialArms & persistLiveListing)', () => {
  const stdioConfig: ScopedMcpServerConfig = {
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    scope: 'user',
  }

  function makeConnectedClient(
    name: string,
    config: ScopedMcpServerConfig = stdioConfig,
  ): ConnectedMCPServer {
    return {
      name,
      type: 'connected',
      config,
      capabilities: { tools: {}, prompts: {}, resources: {} },
      serverInfo: { name: 'demo-mcp', version: '1.0.0' },
      client: {} as ConnectedMCPServer['client'],
      cleanup: async () => {},
    }
  }

  test('readDiscoveryCacheEntry classifies fresh, stale, expired, strike-threshold, live-connection, and capability serve-time misses', () => {
    const baseTime = 1_700_000_000_000
    expect(
      writeDiscoveryCacheEntry(
        'demo',
        stdioConfig,
        {
          serverInfo: { name: 'demo', version: '1.0.0' },
          capabilities: { tools: {} },
          tools: [
            {
              name: 'ping',
              description: 'Ping tool',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          commands: [],
          resources: [],
          templates: [],
        },
        { now: baseTime },
      ),
    ).toBe('written')

    // Monotonicity: older timestamp is superseded.
    expect(
      writeDiscoveryCacheEntry(
        'demo',
        stdioConfig,
        {
          capabilities: { tools: {} },
          tools: [],
          commands: [],
          resources: [],
          templates: [],
        },
        { now: baseTime - 1000 },
      ),
    ).toBe('superseded')

    const fresh = readDiscoveryCacheEntry('demo', stdioConfig, {
      enabled: true,
      now: baseTime + 10_000,
    })
    expect(fresh.kind).toBe('fresh')
    if (fresh.kind === 'fresh') {
      const placeholder = createCachedMcpClient(
        'demo',
        stdioConfig,
        fresh.entry,
      )
      expect(placeholder.type).toBe('cached')
      expect(placeholder.cacheSavedAt).toBe(baseTime)
    }

    const stale = readDiscoveryCacheEntry('demo', stdioConfig, {
      enabled: true,
      now: baseTime + MCP_DISCOVERY_CACHE_FRESH_TTL_MS + 1000,
    })
    expect(stale.kind).toBe('stale')

    // Live connection short-circuits cache.
    expect(
      readDiscoveryCacheEntry('demo', stdioConfig, {
        enabled: true,
        hasLiveConnection: true,
        now: baseTime + 1000,
      }),
    ).toEqual({ kind: 'miss', reason: 'live-connection' })

    // Capability serve-time miss downgrades skills-capable & channel-capable entries.
    if (fresh.kind === 'fresh') {
      const skillsOutcome = applyCapabilityServeTimeMiss({
        ...fresh,
        entry: {
          ...fresh.entry,
          capabilities: {
            ...fresh.entry.capabilities,
            experimental: { skills: {} },
          },
        },
      })
      expect(skillsOutcome).toEqual({ kind: 'miss', reason: 'skills-capable' })
      expect(isCacheOutcomeMiss(skillsOutcome)).toBe(false)

      const channelOutcome = applyCapabilityServeTimeMiss({
        ...fresh,
        entry: {
          ...fresh.entry,
          capabilities: {
            ...fresh.entry.capabilities,
            experimental: { 'claude/channel': {} },
          },
        },
      })
      expect(channelOutcome).toEqual({
        kind: 'miss',
        reason: 'channel-capable',
      })
    }

    // 3 consecutive strikes trigger strike-threshold miss.
    expect(recordDiscoveryRefreshStrike('demo', stdioConfig)).toBe(1)
    expect(recordDiscoveryRefreshStrike('demo', stdioConfig)).toBe(2)
    expect(recordDiscoveryRefreshStrike('demo', stdioConfig)).toBe(3)
    const struck = readDiscoveryCacheEntry('demo', stdioConfig, {
      enabled: true,
      now: baseTime + 1000,
    })
    expect(struck).toEqual({ kind: 'miss', reason: 'strike-threshold' })
    expect(isCacheOutcomeMiss(struck)).toBe(true)
    expect(discoverySourceForMiss(struck)).toBe('miss_strike')

    // Expiry past 24h returns expired miss.
    writeDiscoveryCacheEntry(
      'demo-exp',
      stdioConfig,
      {
        capabilities: { tools: {} },
        tools: [],
        commands: [],
        resources: [],
        templates: [],
      },
      { now: baseTime },
    )
    const expired = readDiscoveryCacheEntry('demo-exp', stdioConfig, {
      enabled: true,
      now: baseTime + MCP_DISCOVERY_CACHE_STALE_TTL_MS + 1,
    })
    expect(expired).toEqual({ kind: 'miss', reason: 'expired' })
    expect(isCacheOutcomeMiss(expired)).toBe(true)
    expect(discoverySourceForMiss(expired)).toBe('miss_expired')
  })

  test('persistLiveListing and persistRawDiscoveryIfComplete write complete rounds and roll back on transient error', async () => {
    const client = makeConnectedClient('writer-srv')
    const toolsArr: unknown[] = []
    const cmdsArr: unknown[] = []
    const resArr: unknown[] = []
    const ts = 1_700_000_500_000

    recordRawToolsForResult(
      toolsArr,
      [
        {
          name: 'search',
          description: 'Search tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      ts,
    )
    recordRawCommandsForResult(
      cmdsArr,
      [{ name: 'help', description: 'Help' }],
      ts,
    )
    recordRawResourcesForResult(resArr, [], ts)

    // Transient write failure restores raw WeakMap entries so a retry succeeds.
    const transientOk = await persistRawDiscoveryIfComplete(
      client,
      {
        tools: toolsArr,
        commands: cmdsArr,
        resources: resArr,
        templates: [],
        identityEpoch: 1,
      },
      {
        getCurrentIdentityEpoch: () => 1,
        writeEntry: () => 'transient',
      },
    )
    expect(transientOk).toBe(true)

    // Now persistLiveListing commits the restored round into the discovery cache.
    const persisted = await persistLiveListing(
      client,
      {
        tools: toolsArr,
        commands: cmdsArr,
        resources: resArr,
        templates: [],
        identityEpoch: 1,
      },
      {
        enabled: true,
        isDisabled: () => false,
        peekSettledConnection: async () => client,
        getCurrentIdentityEpoch: () => 1,
      },
    )
    expect(persisted).toBe(true)

    const hit = readDiscoveryCacheEntry('writer-srv', stdioConfig, {
      enabled: true,
      now: ts + 1000,
    })
    expect(hit.kind).toBe('fresh')
    if (hit.kind === 'fresh') {
      expect(hit.entry.tools.map(t => t.name)).toEqual(['search'])
      expect(hit.entry.commands.map(c => c.name)).toEqual(['help'])
    }
  })

  test('runCachedFirstDialArms deduplicates, adopts connected/needs-auth, reports failed with ownStrike, and closes orphaned epoch dials', () => {
    const adopted: string[] = []
    const failedEvents: Array<{ name: string; ownStrike: boolean }> = []
    const unsubAdopt = subscribeCachedAdopt(name => adopted.push(name))
    const unsubFail = subscribeCachedDialFailed((failure, ownStrike) =>
      failedEvents.push({ name: failure.name, ownStrike }),
    )

    try {
      const connected = makeConnectedClient('adopt-srv')
      const dial1 = Promise.resolve<MCPServerConnection>(connected)
      const activeDials = new Map<string, Promise<MCPServerConnection>>()
      let epoch = 1
      const closed: string[] = []

      const makeDeps = (
        superseded: Set<Promise<MCPServerConnection>> = new Set(),
      ) => ({
        isSuperseded: (d: Promise<MCPServerConnection>) => superseded.has(d),
        getCurrentDial: (k: string) => activeDials.get(k),
        deleteCurrentDial: (k: string) => {
          activeDials.delete(k)
        },
        getIdentityEpoch: () => epoch,
        detachAndClose: (c: ConnectedMCPServer) => {
          closed.push(c.name)
        },
      })

      // 1) Connected dial adopts once and deduplicates repeat calls for same client object.
      const adoptKey = getServerCacheKey('adopt-srv', stdioConfig)
      activeDials.set(adoptKey, dial1)
      runCachedFirstDialArms(connected, dial1, 1, makeDeps())
      runCachedFirstDialArms(connected, dial1, 1, makeDeps())
      expect(adopted).toEqual(['adopt-srv'])

      // 2) Lazy failed dial deletes dial & reports ownStrike=true.
      const lazyFail: FailedMCPServer = {
        name: 'lazy-fail',
        type: 'failed',
        config: stdioConfig,
        error: 'ECONNREFUSED',
      }
      const lazyDial = Promise.resolve<MCPServerConnection>(lazyFail)
      const lazyKey = getServerCacheKey('lazy-fail', stdioConfig)
      activeDials.set(lazyKey, lazyDial)
      runCachedFirstDialArms(lazyFail, lazyDial, 1, makeDeps())
      expect(activeDials.has(lazyKey)).toBe(false)
      expect(failedEvents).toEqual([{ name: 'lazy-fail', ownStrike: true }])
      expect(takeSettledCachedDialFailure('lazy-fail', stdioConfig)).toEqual({
        failure: lazyFail,
        ownStrike: true,
      })
      expect(
        takeSettledCachedDialFailure('lazy-fail', stdioConfig),
      ).toBeUndefined()

      // 3) SWR refresh failed dial reports ownStrike=false while dial is in swrRefreshDialsInFlight.
      const swrFail: FailedMCPServer = {
        name: 'swr-fail',
        type: 'failed',
        config: stdioConfig,
        error: 'timeout',
      }
      const swrDial = Promise.resolve<MCPServerConnection>(swrFail)
      const swrKey = getServerCacheKey('swr-fail', stdioConfig)
      activeDials.set(swrKey, swrDial)
      markSwrRefreshDialInFlight(swrDial)
      runCachedFirstDialArms(swrFail, swrDial, 1, makeDeps())
      unmarkSwrRefreshDialInFlight(swrDial)
      expect(failedEvents).toEqual([
        { name: 'lazy-fail', ownStrike: true },
        { name: 'swr-fail', ownStrike: false },
      ])

      // 4) Orphaned connected dial after identity epoch bump is closed and NOT adopted.
      const orphan = makeConnectedClient('orphan-srv')
      const orphanDial = Promise.resolve<MCPServerConnection>(orphan)
      epoch = 2
      runCachedFirstDialArms(orphan, orphanDial, 1, makeDeps())
      expect(closed).toEqual(['orphan-srv'])
      expect(adopted).toEqual(['adopt-srv'])

      // 5) logMcpDiscoverySource emits tengu_mcp_discovery_source + mcp_discovery_cache ok.
      logMcpDiscoverySource({
        source: 'cache_fresh',
        transportType: 'stdio',
        entryAgeMs: 4200,
        cacheHit: true,
      })
      expect(
        events.some(
          e =>
            e.eventName === 'tengu_mcp_discovery_source' &&
            e.metadata.source === 'cache_fresh' &&
            e.metadata.entryAgeMs === 4200,
        ),
      ).toBe(true)
      expect(
        events.some(
          e =>
            e.eventName === 'tengu_feature_ok' &&
            e.metadata.feature_name === 'mcp_discovery_cache',
        ),
      ).toBe(true)
    } finally {
      unsubAdopt()
      unsubFail()
    }
  })
})
