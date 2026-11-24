import { afterEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyAgentDisallowedToolsDenyRules,
  filterDisabledMcpClients,
  filterDisabledMcpTools,
  sanitizeToolUseContextForResumeWake,
} from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import {
  getIsInteractive,
  getIsRemoteMode,
  getSessionId,
  setIsInteractive,
  setIsRemoteMode,
  switchSession,
} from '../../../bootstrap/state.js'
import {
  clearConversation,
  pruneAgentNameRegistry,
} from '../../../commands/clear/conversation.js'
import { isCoordinatorMode } from '../../../coordinator/coordinatorMode.js'
import {
  getDefaultAppState,
  type AppState,
} from '../../../state/AppStateStore.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import { asAgentId, asSessionId } from '../../../types/ids.js'
import type {
  Message,
  SystemCompactBoundaryMessage,
  UserMessage,
} from '../../../types/message.js'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'
import { createSubagentContext } from '../../../utils/forkedAgent.js'
import { applyPollEventDeliveryGuard } from '../../../utils/permissions/permissionSetup.js'
import {
  capOriginalFileForStorage,
  flushSessionStorage,
  getAgentTranscript,
  getAgentTranscriptPath,
  getTranscriptPathForSession,
  loadFullLog,
  MAX_ORIGINAL_FILE_STORAGE_CHARS,
  recordTranscript,
  resetSessionFilePointer,
  stripOldToolUseResultsForStorage,
  type StripForStorageTool,
} from '../../../utils/sessionStorage.js'
import { IDLE_WINDOW_KEEPALIVE_REASON } from '../../../utils/task/framework.js'
import {
  detectAutoCompactPrefixOverflow,
  getMinPromptTokensSinceLastCompact,
  getServerClearedTokens,
  recordAutoCompactFailure,
  shouldAutoCompact,
  shouldPutOffAutoCompact,
  type AutoCompactTrackingState,
} from '../autoCompact.js'
import {
  CompactionBlockedByHookError,
  collectSummarizedTurnPromptUuids,
  isCompactDespiteHookBlockEnabled,
  stampCompactBoundaryMetadata,
  stampSummarizedTurnPromptUuids,
  throwIfCompactBlockedByHook,
} from '../compact.js'
import {
  isAlreadyClearedOrPersistedToolResult,
  MIN_TIME_BASED_TOKEN_SAVINGS,
  TIME_BASED_MC_CLEARED_MESSAGE,
} from '../microCompact.js'

function makeUuid(n: number): UUID {
  return `32800000-0000-4000-8000-${String(n).padStart(12, '0')}` as UUID
}

function makeUserMsg(
  n: number,
  content: unknown,
  extra: Record<string, unknown> = {},
): UserMessage {
  return {
    type: 'user',
    uuid: makeUuid(n),
    timestamp: '2026-11-24T00:00:00.000Z',
    message: { role: 'user', content },
    ...extra,
  } as unknown as UserMessage
}

function makeAssistantMsg(
  n: number,
  content: unknown,
  extra: Record<string, unknown> = {},
  msgExtra: Record<string, unknown> = {},
): Message {
  return {
    type: 'assistant',
    uuid: makeUuid(n),
    timestamp: '2026-11-24T00:00:01.000Z',
    message: {
      id: `msg_${n}`,
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      content,
      ...msgExtra,
    },
    ...extra,
  } as unknown as Message
}

function makeBoundary(
  n: number,
  meta: Record<string, unknown> = {},
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    uuid: makeUuid(n),
    timestamp: '2026-11-24T00:00:02.000Z',
    level: 'info',
    compactMetadata: {
      trigger: 'auto',
      preTokens: 150_000,
      ...meta,
    },
  } as unknown as SystemCompactBoundaryMessage
}

const tempDirs: string[] = []
const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
const prevTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
const prevRemote = process.env.CLAUDE_CODE_REMOTE
const prevCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE
const prevInteractive = getIsInteractive()
const prevRemoteMode = getIsRemoteMode()
const prevSessionId = getSessionId()

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await flushSessionStorage().catch(() => {})
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
  if (prevTestPersist === undefined) {
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  } else {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = prevTestPersist
  }
  if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
  else process.env.CLAUDE_CODE_REMOTE = prevRemote
  if (prevCoord === undefined) delete process.env.CLAUDE_CODE_COORDINATOR_MODE
  else process.env.CLAUDE_CODE_COORDINATOR_MODE = prevCoord
  setIsInteractive(prevInteractive)
  setIsRemoteMode(prevRemoteMode)
  switchSession(asSessionId(prevSessionId))
  await resetSessionFilePointer().catch(() => {})
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('CF-4 Group 1 [P1-15]: stripOldToolUseResultsForStorage (f4r) & originalFile cap (oln)', () => {
  test('capOriginalFileForStorage nulls originalFile > 10_000 chars and preserves <= 10_000 chars', () => {
    expect(MAX_ORIGINAL_FILE_STORAGE_CHARS).toBe(10_000)
    const small = { type: 'update', originalFile: 'a'.repeat(10_000) }
    expect(capOriginalFileForStorage(small)).toBe(small)

    const large = {
      type: 'update',
      filePath: '/tmp/foo.ts',
      originalFile: 'a'.repeat(10_001),
    }
    const capped = capOriginalFileForStorage(large)
    expect(capped).not.toBe(large)
    expect(capped.originalFile).toBeNull()
    expect(capped.filePath).toBe('/tmp/foo.ts')

    expect(capOriginalFileForStorage(null)).toBeNull()
    expect(capOriginalFileForStorage('raw-string')).toBe('raw-string')
  })

  test('stripOldToolUseResultsForStorage strips aged toolUseResult, progress, and poll_events.replEvals while preserving recent messages', () => {
    const fakeWriteTool: StripForStorageTool = {
      name: 'Write',
      stripForStorage(out: unknown) {
        const rec = out as { type?: string; content?: string }
        if (rec?.type === 'update' && rec.content) {
          return { ...rec, content: '', originalFile: null }
        }
        return out
      },
    }

    const oldAssistant = makeAssistantMsg(1, [
      { type: 'tool_use', id: 'tu_old', name: 'Write', input: {} },
    ])
    const oldUserResult = makeUserMsg(
      2,
      [{ type: 'tool_result', tool_use_id: 'tu_old', content: 'ok' }],
      {
        toolUseResult: {
          type: 'update',
          content: 'HUGE_BODY',
          originalFile: 'OLD_FILE',
        },
      },
    )
    const oldProgress = {
      type: 'progress',
      uuid: makeUuid(3),
      toolUseID: 'agent_1',
      parentToolUseID: 'tu_parent',
      data: {
        type: 'agent_progress',
        message: {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'sub_tu',
                content: 'verbose subagent tool output',
              },
            ],
          },
          toolUseResult: { big: true },
          mcpMeta: { _meta: { foo: 1 } },
        },
      },
    } as unknown as Message
    const oldPollEvents = {
      type: 'attachment',
      uuid: makeUuid(4),
      attachment: {
        type: 'poll_events',
        replEvals: [
          {
            id: 'eval_1',
            calls: [
              {
                kind: 'ok',
                toolName: 'Write',
                result: {
                  type: 'update',
                  content: 'REPL_BIG',
                  originalFile: 'X',
                },
              },
              { kind: 'err', toolName: 'Write', error: 'boom' },
            ],
          },
        ],
      },
    } as unknown as Message

    const recentAssistant = makeAssistantMsg(5, [
      { type: 'tool_use', id: 'tu_new', name: 'Write', input: {} },
    ])
    const recentUserResult = makeUserMsg(
      6,
      [{ type: 'tool_result', tool_use_id: 'tu_new', content: 'ok' }],
      {
        toolUseResult: {
          type: 'update',
          content: 'KEEP_RECENT',
          originalFile: 'KEEP_ORIG',
        },
      },
    )

    const all = [
      oldAssistant,
      oldUserResult,
      oldProgress,
      oldPollEvents,
      recentAssistant,
      recentUserResult,
    ]
    // Under keepRecent threshold -> identity-preserving return
    expect(stripOldToolUseResultsForStorage(all, [fakeWriteTool], 10)).toBe(all)

    // keepRecent = 2 -> indices 0..3 are stripped, indices 4..5 preserved
    const stripped = stripOldToolUseResultsForStorage(all, [fakeWriteTool], 2)
    expect(stripped).not.toBe(all)
    expect((stripped[1] as UserMessage).toolUseResult).toEqual({
      type: 'update',
      content: '',
      originalFile: null,
    })
    const strippedProgData = (stripped[2] as unknown as { data: any }).data
    expect(strippedProgData.message.message.content[0].content).toBe('')
    expect(strippedProgData.message.toolUseResult).toBeUndefined()
    expect(strippedProgData.message.mcpMeta).toBeUndefined()

    const strippedPollAtt = (stripped[3] as { attachment: any }).attachment
    expect(strippedPollAtt.replEvals[0].calls[0].result).toEqual({
      type: 'update',
      content: '',
      originalFile: null,
    })
    expect(strippedPollAtt.replEvals[0].calls[1]).toEqual({
      kind: 'err',
      toolName: 'Write',
      error: 'boom',
    })

    // Recent entry untouched
    expect(stripped[5]).toBe(recentUserResult)
  })

  test('insertMessageChain applies capOriginalFileForStorage on write', async () => {
    const cfgDir = makeTempDir('cf4-oln-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    const sid = makeUuid(100)
    switchSession(asSessionId(sid))
    await resetSessionFilePointer()

    const msg = makeUserMsg(101, 'edit result', {
      toolUseResult: {
        type: 'update',
        filePath: '/tmp/big.ts',
        originalFile: 'x'.repeat(MAX_ORIGINAL_FILE_STORAGE_CHARS + 50),
      },
    })
    await recordTranscript([msg])
    await flushSessionStorage()

    const raw = readFileSync(getTranscriptPathForSession(sid), 'utf8')
    const parsed = raw
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as Record<string, any>)
      .find(e => e.uuid === makeUuid(101))
    expect(parsed).toBeDefined()
    expect(parsed!.toolUseResult.originalFile).toBeNull()
    expect(parsed!.toolUseResult.filePath).toBe('/tmp/big.ts')
  })
})

describe('CF-4 Group 2 [P1-16]: /clear state resets (H1r, activeGoal, planDoc, viewingAgentTaskId)', () => {
  test('pruneAgentNameRegistry keeps surviving non-terminal tasks and non-idle keepalive local agents, drops killed/terminal tasks', () => {
    const survivingTasks = {
      'bg-running': {
        id: 'bg-running',
        type: 'local_agent',
        status: 'running',
        agentId: 'bg-running',
      },
      'bg-done-no-keepalive': {
        id: 'bg-done-no-keepalive',
        type: 'local_agent',
        status: 'completed',
        agentId: 'bg-done-no-keepalive',
        keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
      },
      'bg-done-workflow-keepalive': {
        id: 'bg-done-workflow-keepalive',
        type: 'local_agent',
        status: 'completed',
        agentId: 'bg-done-workflow-keepalive',
        keepaliveReasons: new Set(['workflow:wf-1']),
      },
      'tm-task': {
        id: 'tm-task',
        type: 'in_process_teammate',
        status: 'running',
        identity: { agentId: 'tm-task', resumableAgentId: 'resumable-tm' },
      },
    } as unknown as AppState['tasks']

    const registry = new Map([
      ['runner', asAgentId('bg-running')],
      ['killed', asAgentId('fg-killed')],
      ['idleDone', asAgentId('bg-done-no-keepalive')],
      ['wfAlive', asAgentId('bg-done-workflow-keepalive')],
      ['teammate', asAgentId('resumable-tm')],
    ])

    const pruned = pruneAgentNameRegistry(registry, survivingTasks)
    expect([...pruned.keys()]).toEqual(['runner', 'wfAlive', 'teammate'])
  })

  test('clearConversation clears activeGoal, planDoc, killed viewingAgentTaskId, frameUrls, and prunes agentNameRegistry', async () => {
    let state: AppState = {
      ...getDefaultAppState(),
      activeGoal: {
        condition: 'all tests green',
        setAt: Date.now() - 5000,
        origin: 'slash_command',
        iterations: 2,
      } as NonNullable<AppState['activeGoal']>,
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        planDoc: { path: '/tmp/plan.md' },
      } as AppState['toolPermissionContext'],
      tasks: {
        'fg-1': {
          id: 'fg-1',
          type: 'local_agent',
          status: 'running',
          agentId: 'fg-1',
          isBackgrounded: false,
          description: 'fg task',
        } as unknown as AppState['tasks'][string],
        'bg-1': {
          id: 'bg-1',
          type: 'local_agent',
          status: 'running',
          agentId: 'bg-1',
          isBackgrounded: true,
          description: 'bg task',
        } as unknown as AppState['tasks'][string],
      },
      agentNameRegistry: new Map([
        ['fg-name', asAgentId('fg-1')],
        ['bg-name', asAgentId('bg-1')],
      ]),
      viewingAgentTaskId: 'fg-1',
      viewSelectionMode: 'viewing-agent',
      frameUrls: {
        slug1: { url: 'https://example.test/1' },
      } as AppState['frameUrls'],
    }

    await clearConversation({
      setMessages: () => {},
      readFileState: createFileStateCacheWithSizeLimit(10),
      getAppState: () => state,
      setAppState: updater => {
        state = updater(state)
      },
    })

    expect(state.activeGoal).toBeUndefined()
    expect(
      (state.toolPermissionContext as Record<string, unknown>).planDoc,
    ).toBeUndefined()
    expect(state.viewingAgentTaskId).toBeUndefined()
    expect(state.viewSelectionMode).toBe('none')
    expect(state.agentNameRegistry.has('fg-name')).toBe(false)
    expect(state.agentNameRegistry.get('bg-name')).toBe(asAgentId('bg-1'))
    expect(state.frameUrls).toEqual({})
  })
})

describe('CF-4 Group 3 [P1-18]: autoCompact circuit breaker, serverCleared, put-off/prefix-overflow, hook bypass & compactMetadata', () => {
  test('recordAutoCompactFailure (KQn) never increments consecutiveFailures on uncounted user aborts', () => {
    let tracking: AutoCompactTrackingState = {
      compacted: false,
      turnCounter: 0,
      turnId: 't1',
    }
    for (let i = 1; i <= 3; i++) {
      const res = recordAutoCompactFailure(tracking, { uncounted: true })
      expect(res.consecutiveFailures).toBe(0)
      expect(res.consecutiveUncountedFailures).toBe(i)
      expect(res.uncountedStopReached).toBe(i === 3)
      tracking = {
        ...tracking,
        consecutiveFailures: res.consecutiveFailures,
        consecutiveUncountedFailures: res.consecutiveUncountedFailures,
      }
    }
    // Real failures still increment consecutiveFailures and trip at 3
    let realTrack: AutoCompactTrackingState = {
      compacted: false,
      turnCounter: 0,
      turnId: 't2',
    }
    for (let i = 1; i <= 3; i++) {
      const res = recordAutoCompactFailure(realTrack, { uncounted: false })
      expect(res.consecutiveFailures).toBe(i)
      expect(res.consecutiveUncountedFailures).toBe(0)
      realTrack = { ...realTrack, consecutiveFailures: res.consecutiveFailures }
    }
  })

  test('getServerClearedTokens (N6/Dtn) extracts cleared tokens from context_management and stops at compact_boundary', () => {
    const preCompactAsst = makeAssistantMsg(
      200,
      [{ type: 'text', text: 'pre' }],
      {},
      {
        usage: { input_tokens: 1000, output_tokens: 100 },
        context_management: {
          applied_edits: [
            { type: 'clear_tool_uses_20250919', cleared_input_tokens: 45_000 },
          ],
        },
      },
    )
    expect(getServerClearedTokens([preCompactAsst])).toBe(45_000)

    // Compact boundary stops lookback
    const boundary = makeBoundary(201, { postTokens: 12_000 })
    expect(getServerClearedTokens([preCompactAsst, boundary])).toBe(0)

    // Post-compact assistant with client_cut_tool_uses
    const postAsst = makeAssistantMsg(
      202,
      [{ type: 'text', text: 'post' }],
      {},
      {
        usage: { input_tokens: 20_000, output_tokens: 500 },
        context_management: {
          client_cut_tool_uses: 4,
          client_estimated_cleared_input_tokens: 30_000,
        },
      },
    )
    expect(getServerClearedTokens([preCompactAsst, boundary, postAsst])).toBe(
      30_000,
    )
  })

  test('getMinPromptTokensSinceLastCompact (fqt), shouldPutOffAutoCompact (sBe), and detectAutoCompactPrefixOverflow (MRs)', () => {
    const boundaryWithPost = makeBoundary(210, { postTokens: 10_000 })
    const a1 = makeAssistantMsg(
      211,
      [{ type: 'text', text: 'a1' }],
      {},
      { usage: { input_tokens: 120_000, output_tokens: 100 } },
    )
    const a2 = makeAssistantMsg(
      212,
      [{ type: 'text', text: 'a2' }],
      {},
      { usage: { input_tokens: 140_000, output_tokens: 100 } },
    )
    expect(getMinPromptTokensSinceLastCompact([boundaryWithPost, a1, a2])).toBe(
      120_000,
    )

    // Without postTokens on boundary, returns undefined
    const boundaryNoPost = makeBoundary(213)
    expect(
      getMinPromptTokensSinceLastCompact([boundaryNoPost, a1]),
    ).toBeUndefined()

    // sBe put-off predicate: threshold 150K, leftBySummary 140K -> 10K room < 30K minRoom -> put off
    expect(shouldPutOffAutoCompact(140_000, 150_000, 30_000)).toBe(true)
    expect(shouldPutOffAutoCompact(100_000, 150_000, 30_000)).toBe(false)
    expect(shouldPutOffAutoCompact(140_000, 150_000, 0)).toBe(false)

    // MRs prefix overflow: huge input_tokens vs tiny messages -> prefixTokens > threshold
    const hugePrefixAsst = makeAssistantMsg(
      214,
      [{ type: 'text', text: 'hi' }],
      {},
      {
        usage: {
          input_tokens: 500_000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 10,
        },
      },
    )
    const userWithImage = makeUserMsg(215, [
      {
        type: 'tool_result',
        tool_use_id: 'tu_img',
        content: [
          { type: 'image', source: { type: 'base64', data: '' } },
          { type: 'document', source: { type: 'base64', data: '' } },
        ],
      },
    ])
    const overflow = detectAutoCompactPrefixOverflow(
      [userWithImage, hugePrefixAsst],
      'claude-sonnet-4-5',
    )
    expect(overflow).not.toBeNull()
    expect(overflow!.prefixTokens).toBeGreaterThan(overflow!.thresholdTokens)
    expect(overflow!.imageBlockCount).toBe(1)
    expect(overflow!.documentBlockCount).toBe(1)
  })

  test('throwIfCompactBlockedByHook respects requestCannotGoOut + CLAUDE_CODE_REMOTE gate', () => {
    const ctx = { addNotification: () => {} }
    delete process.env.CLAUDE_CODE_REMOTE
    expect(isCompactDespiteHookBlockEnabled()).toBe(false)
    expect(() =>
      throwIfCompactBlockedByHook({ blockedBy: 'my-hook' }, ctx, {
        suppressNotification: true,
        requestCannotGoOut: true,
      }),
    ).toThrow(CompactionBlockedByHookError)

    // Verify compact.ts and reactiveCompact.ts wire requestCannotGoOut
    const compactSrc = readFileSync(
      join(import.meta.dir, '../compact.ts'),
      'utf8',
    )
    const reactiveSrc = readFileSync(
      join(import.meta.dir, '../reactiveCompact.ts'),
      'utf8',
    )
    expect(compactSrc).toContain('tengu_typed_snail')
    expect(compactSrc).toContain('requestCannotGoOut')
    expect(reactiveSrc).toContain('requestCannotGoOut ?? true')
  })

  test('stampCompactBoundaryMetadata & stampSummarizedTurnPromptUuids stamp postTokens, durationMs, cumulativeDroppedTokens, and prompt UUIDs', () => {
    const prevBoundary = makeBoundary(220, {
      preTokens: 100_000,
      postTokens: 20_000,
      cumulativeDroppedTokens: 80_000,
    })
    const promptMsg = makeUserMsg(221, 'Fix the bug', {
      sentAsUuid: 'sent-uuid-221',
    })
    const asstMsg = makeAssistantMsg(222, [
      { type: 'text', text: 'Working...' },
    ])
    const preMsgs: Message[] = [prevBoundary, promptMsg, asstMsg]

    const newBoundary = makeBoundary(223, { preTokens: 150_000 })
    stampCompactBoundaryMetadata(newBoundary, preMsgs, 18_000, 1234)
    expect(newBoundary.compactMetadata.postTokens).toBe(18_000)
    expect(newBoundary.compactMetadata.durationMs).toBe(1234)
    // 80_000 + (150_000 - 18_000) = 212_000
    expect(newBoundary.compactMetadata.cumulativeDroppedTokens).toBe(212_000)

    expect(collectSummarizedTurnPromptUuids(preMsgs)).toEqual([
      makeUuid(221),
      'sent-uuid-221',
    ])

    const summaryMsg = makeUserMsg(224, 'Summary body', {
      isCompactSummary: true,
    })
    const stamped = stampSummarizedTurnPromptUuids([summaryMsg], preMsgs)
    expect(
      (stamped[0] as unknown as { summarizedTurnPromptUuids?: string[] })
        .summarizedTurnPromptUuids,
    ).toEqual([makeUuid(221), 'sent-uuid-221'])

    // Chained compaction carries forward summarizedTurnPromptUuids
    const chained = stampSummarizedTurnPromptUuids(
      [makeUserMsg(225, 'Summary 2', { isCompactSummary: true })],
      [...stamped, makeAssistantMsg(226, [{ type: 'text', text: 'More...' }])],
    )
    expect(
      (chained[0] as unknown as { summarizedTurnPromptUuids?: string[] })
        .summarizedTurnPromptUuids,
    ).toEqual([makeUuid(221), 'sent-uuid-221'])
  })

  test('shouldAutoCompact accounts for serverCleared tokens', async () => {
    // Model claude-sonnet-4-5 has 200K window -> effective 180K -> threshold 167K.
    // A message with 150K input_tokens + 25K serverCleared = 175K >= 167K -> triggers!
    const msg = makeAssistantMsg(
      230,
      [{ type: 'text', text: 'short' }],
      {},
      {
        usage: { input_tokens: 150_000, output_tokens: 100 },
        context_management: {
          applied_edits: [
            { type: 'clear_tool_uses_20250919', cleared_input_tokens: 25_000 },
          ],
        },
      },
    )
    const withoutCleared = makeAssistantMsg(
      231,
      [{ type: 'text', text: 'short' }],
      {},
      {
        usage: { input_tokens: 150_000, output_tokens: 100 },
      },
    )
    expect(await shouldAutoCompact([withoutCleared], 'claude-sonnet-4-5')).toBe(
      false,
    )
    expect(await shouldAutoCompact([msg], 'claude-sonnet-4-5')).toBe(true)
  })
})

describe('CF-4 Group 4 [P1-19]: Subagent & Forked Agent isolation (forkedAgent.ts, runAgent.ts)', () => {
  function makeParentContext(overrides: Partial<ToolUseContext> = {}): {
    parent: ToolUseContext
    getState: () => AppState
  } {
    let state: AppState = getDefaultAppState()
    const cache = createFileStateCacheWithSizeLimit(20)
    cache.set('/tmp/seeded.ts', {
      content: 'seed',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
      seededFromContext: true,
    } as Parameters<typeof cache.set>[1])
    const parentRefreshTools = () => []
    const parentRefreshMcp = () => []
    const parent = {
      options: {
        tools: [{ name: 'ParentTool' } as unknown as Tool],
        commands: [],
        mcpClients: [],
        mcpResources: {},
        mainLoopModel: 'claude-sonnet-4-6',
        thinkingConfig: { type: 'disabled' as const },
        isNonInteractiveSession: true,
        debug: false,
        verbose: false,
        refreshTools: parentRefreshTools,
        refreshMcpClients: parentRefreshMcp,
        agentDefinitions: {
          activeAgents: [],
          allAgents: [],
          allowedAgentTypes: [],
        },
      },
      abortController: new AbortController(),
      messages: [],
      readFileState: cache,
      getAppState: () => state,
      setAppState: (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      },
      setToolPermissionContext: () => {},
      setSessionToolPermissionContext: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      ...overrides,
    } as unknown as ToolUseContext
    return { parent, getState: () => state }
  }

  test('createSubagentContext strips seededFromContext, sets avoidsPromptsByNature + avoid_prompts layer, strips stale refresh callbacks, and forwards frameUrls', () => {
    const { parent, getState } = makeParentContext()
    const customTools = [{ name: 'ChildOnlyTool' } as unknown as Tool]
    const child = createSubagentContext(parent, {
      options: {
        ...parent.options,
        tools: customTools,
      },
    })

    // 1. readFileState cloned with seededFromContext stripped (parent untouched)
    const parentEntry = parent.readFileState.get('/tmp/seeded.ts') as
      | { seededFromContext?: boolean }
      | undefined
    const childEntry = child.readFileState.get('/tmp/seeded.ts') as
      | { seededFromContext?: boolean }
      | undefined
    expect(parentEntry?.seededFromContext).toBe(true)
    expect(childEntry?.seededFromContext).toBe(false)

    // 2. avoidsPromptsByNature + { kind: 'avoid_prompts' } layer
    const childPerm = child.getAppState().toolPermissionContext
    expect(childPerm.shouldAvoidPermissionPrompts).toBe(true)
    expect(childPerm.avoidsPromptsByNature).toBe(true)
    expect(child.permissionLayers).toContainEqual({ kind: 'avoid_prompts' })

    // Interactive child with shareAbortController does NOT add avoid_prompts
    const interactiveChild = createSubagentContext(parent, {
      shareAbortController: true,
    })
    expect(interactiveChild.permissionLayers).toBeUndefined()

    // 3. Stale refreshTools/refreshMcpClients stripped when tools overridden
    expect(child.options.refreshTools).toBeUndefined()
    expect(child.options.refreshMcpClients).toBeUndefined()

    // Custom refreshTools kept when explicitly provided
    const childRefresh = () => customTools
    const childCustomRefresh = createSubagentContext(parent, {
      options: {
        ...parent.options,
        tools: customTools,
        refreshTools: childRefresh,
      },
    })
    expect(childCustomRefresh.options.refreshTools).toBe(childRefresh)

    // 4. setAppState forwards frameUrls while isolating other fields
    child.setAppState(prev => ({
      ...prev,
      endedByModel: true,
      frameUrls: {
        slugA: { url: 'https://frames.test/a' },
      } as AppState['frameUrls'],
    }))
    expect(getState().endedByModel).toBe(false)
    expect(getState().frameUrls).toEqual({
      slugA: { url: 'https://frames.test/a' },
    } as AppState['frameUrls'])
  })

  test('runForkedAgent records ONLY promptMessages via recordSidechainTranscript (no forkContextMessages duplication)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../utils/forkedAgent.ts'),
      'utf8',
    )
    expect(src).toContain('recordSidechainTranscript(promptMessages, agentId)')
    expect(src).not.toContain(
      'recordSidechainTranscript(initialMessages, agentId)',
    )
  })

  test('applyAgentDisallowedToolsDenyRules (tDo) projects Artifact family disallowedTools into alwaysDenyRules.session', () => {
    const base = getEmptyToolPermissionContext()
    const updated = applyAgentDisallowedToolsDenyRules(base, {
      disallowedTools: [
        'ArtifactComments',
        'ArtifactData(action:write_db)',
        'Write',
        'ArtifactCheck',
      ],
    })
    expect(updated.alwaysDenyRules.session).toEqual([
      'ArtifactComments',
      'ArtifactData',
      'ArtifactCheck',
    ])

    // No artifact-family entries -> returns same reference
    const unchanged = applyAgentDisallowedToolsDenyRules(base, {
      disallowedTools: ['Bash', 'Write'],
    })
    expect(unchanged).toBe(base)
  })

  test('runAgent.ts guards worktreePath addition on !blockWritesOutsideWorkingDirectories', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
      ),
      'utf8',
    )
    expect(src).toContain(
      'worktreePath &&\n      !toolPermissionContext.blockWritesOutsideWorkingDirectories &&',
    )
  })

  test('sanitizeToolUseContextForResumeWake (T0o) strips alwaysAllowRules.command (keeping denies) and filters disabled MCP tools/clients', () => {
    const activeClient = {
      name: 'srv-active',
      type: 'connected',
      config: { scope: 'user' },
    }
    const disabledClient = {
      name: 'srv-disabled',
      type: 'disabled',
      config: { scope: 'user' },
    }
    const dynamicClient = {
      name: 'srv-dynamic',
      type: 'connected',
      config: { scope: 'dynamic' },
    }
    const builtinTool = { name: 'Read' } as unknown as Tool
    const activeMcpTool = {
      name: 'mcp__srv-active__ping',
      mcpInfo: { serverName: 'srv-active', scope: 'user' },
    } as unknown as Tool
    const disabledMcpTool = {
      name: 'mcp__srv-disabled__secret',
      mcpInfo: { serverName: 'srv-disabled', scope: 'user' },
    } as unknown as Tool
    const dynamicMcpTool = {
      name: 'mcp__srv-dynamic__run',
      mcpInfo: { serverName: 'srv-dynamic', scope: 'dynamic' },
    } as unknown as Tool

    const baseState: AppState = {
      ...getDefaultAppState(),
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        alwaysAllowRules: {
          session: ['Read'],
          command: ['Bash(git:*)'],
        },
        alwaysDenyRules: {
          command: ['Bash(rm:*)'],
        },
      },
      mcp: {
        ...getDefaultAppState().mcp,
        clients: [activeClient, disabledClient] as AppState['mcp']['clients'],
      },
    }

    const baseTools = [
      builtinTool,
      activeMcpTool,
      disabledMcpTool,
      dynamicMcpTool,
    ]
    const baseClients = [
      activeClient,
      disabledClient,
      dynamicClient,
    ] as unknown as ToolUseContext['options']['mcpClients']

    const rawCtx = {
      getAppState: () => baseState,
      permissionLayers: [
        { kind: 'allowed_tools' as const, allowedTools: ['Bash'] },
        { kind: 'model' as const, mainLoopModel: 'claude-opus-4-6' },
      ],
      options: {
        tools: baseTools,
        refreshTools: () => baseTools,
        mcpClients: baseClients,
        refreshMcpClients: () => baseClients,
      },
    } as unknown as ToolUseContext

    const sanitized = sanitizeToolUseContextForResumeWake(rawCtx)
    const perm = sanitized.getAppState().toolPermissionContext
    expect(perm.alwaysAllowRules.command).toBeUndefined()
    expect(perm.alwaysAllowRules.session).toEqual(['Read'])
    expect(perm.alwaysDenyRules.command).toEqual(['Bash(rm:*)'])

    expect(sanitized.permissionLayers).toEqual([
      { kind: 'model', mainLoopModel: 'claude-opus-4-6' },
    ])

    expect(sanitized.options.tools.map(t => t.name)).toEqual([
      'Read',
      'mcp__srv-active__ping',
      'mcp__srv-dynamic__run',
    ])
    expect(sanitized.options.refreshTools!().map(t => t.name)).toEqual([
      'Read',
      'mcp__srv-active__ping',
      'mcp__srv-dynamic__run',
    ])
    expect(sanitized.options.mcpClients.map(c => c.name)).toEqual([
      'srv-active',
      'srv-dynamic',
    ])
    expect(sanitized.options.refreshMcpClients!().map(c => c.name)).toEqual([
      'srv-active',
      'srv-dynamic',
    ])

    // Direct helper coverage
    expect(
      filterDisabledMcpTools(baseTools, rawCtx).map(t => t.name),
    ).not.toContain('mcp__srv-disabled__secret')
    expect(
      filterDisabledMcpClients(baseClients, rawCtx).map(c => c.name),
    ).not.toContain('srv-disabled')
  })
})

describe('CF-4 Group 5 [P2]: storage guards, microCompact floor/persisted-output, velvet_ibis, applyPollEventDeliveryGuard & coordinatorMode', () => {
  test('insertMessageChain guards against phantom sourceToolAssistantUUID and self-reference parentUuid', async () => {
    const cfgDir = makeTempDir('cf4-storage-guards-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    const sid = makeUuid(500)
    switchSession(asSessionId(sid))
    await resetSessionFilePointer()

    const u1 = makeUserMsg(501, 'first')
    const u2Phantom = makeUserMsg(502, 'second', {
      sourceToolAssistantUUID: makeUuid(999), // never written -> phantom!
    })
    const u3Self = makeUserMsg(503, 'third', {
      sourceToolAssistantUUID: makeUuid(503), // self-reference!
    })

    await recordTranscript([u1, u2Phantom, u3Self])
    await flushSessionStorage()

    const rows = readFileSync(getTranscriptPathForSession(sid), 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as Record<string, unknown>)
    const r2 = rows.find(r => r.uuid === makeUuid(502))
    const r3 = rows.find(r => r.uuid === makeUuid(503))

    // Phantom parent ignored -> falls back to sequential parent u1
    expect(r2?.parentUuid).toBe(makeUuid(501))
    // Self-reference prevented -> falls back to sequential parent u2 (never self!)
    expect(r3?.parentUuid).toBe(makeUuid(502))
    expect(r3?.parentUuid).not.toBe(makeUuid(503))
  })

  test('loadFullLog and getAgentTranscript invoke dropMalformedAttachments (nxe) during transcript load', async () => {
    const cfgDir = makeTempDir('cf4-nxe-load-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    const sid = makeUuid(510)
    switchSession(asSessionId(sid))

    const mainPath = getTranscriptPathForSession(sid)
    mkdirSync(join(mainPath, '..'), { recursive: true })
    const u1 = makeUuid(511)
    const badAtt = makeUuid(512)
    const a1 = makeUuid(513)
    writeFileSync(
      mainPath,
      [
        JSON.stringify({
          type: 'user',
          uuid: u1,
          parentUuid: null,
          sessionId: sid,
          timestamp: '2026-11-24T00:00:01.000Z',
          message: { role: 'user', content: 'hello' },
        }),
        JSON.stringify({
          type: 'attachment',
          uuid: badAtt,
          parentUuid: u1,
          sessionId: sid,
          timestamp: '2026-11-24T00:00:02.000Z',
          attachment: null, // malformed attachment!
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: a1,
          parentUuid: badAtt,
          sessionId: sid,
          timestamp: '2026-11-24T00:00:03.000Z',
          message: {
            id: 'msg_513',
            role: 'assistant',
            content: [{ type: 'text', text: 'world' }],
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const loaded = await loadFullLog({
      date: '2026-11-24T00:00:03.000Z',
      messages: [],
      fullPath: mainPath,
      sessionId: sid,
      value: 0,
      created: new Date(),
      modified: new Date(),
      firstPrompt: 'hello',
      messageCount: 2,
      isSidechain: false,
    })
    expect(loaded.messages.map(m => m.uuid)).toEqual([u1, a1])

    // Sidechain getAgentTranscript also drops malformed attachments
    const aid = asAgentId('agent-nxe-510')
    const agentPath = getAgentTranscriptPath(aid)
    mkdirSync(join(agentPath, '..'), { recursive: true })
    writeFileSync(
      agentPath,
      [
        JSON.stringify({
          type: 'user',
          uuid: u1,
          parentUuid: null,
          isSidechain: true,
          agentId: aid,
          sessionId: sid,
          timestamp: '2026-11-24T00:00:01.000Z',
          message: { role: 'user', content: 'sub prompt' },
        }),
        JSON.stringify({
          type: 'attachment',
          uuid: badAtt,
          parentUuid: u1,
          isSidechain: true,
          agentId: aid,
          sessionId: sid,
          timestamp: '2026-11-24T00:00:02.000Z',
          attachment: { type: 'hook_success' }, // missing string `content`
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: a1,
          parentUuid: badAtt,
          isSidechain: true,
          agentId: aid,
          sessionId: sid,
          timestamp: '2026-11-24T00:00:03.000Z',
          message: {
            id: 'msg_513',
            role: 'assistant',
            content: [{ type: 'text', text: 'sub reply' }],
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    const agentLoaded = await getAgentTranscript(aid)
    expect(agentLoaded).not.toBeNull()
    expect(agentLoaded!.messages.map(m => m.uuid)).toEqual([u1, a1])
  })

  test('microCompact enforces MIN_TIME_BASED_TOKEN_SAVINGS = 20_000 (fGr) and skips <persisted-output> pointers (wis)', () => {
    expect(MIN_TIME_BASED_TOKEN_SAVINGS).toBe(20_000)
    expect(
      isAlreadyClearedOrPersistedToolResult(TIME_BASED_MC_CLEARED_MESSAGE),
    ).toBe(true)
    expect(
      isAlreadyClearedOrPersistedToolResult(
        '<persisted-output>\nOutput too large...\nFull output saved to: /tmp/foo.txt\n</persisted-output>',
      ),
    ).toBe(true)
    expect(
      isAlreadyClearedOrPersistedToolResult(
        '<remote-control-device-report/>\n<persisted-output>\nsaved\n</persisted-output>',
      ),
    ).toBe(true)
    expect(isAlreadyClearedOrPersistedToolResult('normal tool output')).toBe(
      false,
    )
    expect(
      isAlreadyClearedOrPersistedToolResult([
        { type: 'text', text: '<persisted-output>array</persisted-output>' },
      ]),
    ).toBe(false)
  })

  test('toolResultStorage checks tengu_velvet_ibis GrowthBook flag', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../utils/toolResultStorage.ts'),
      'utf8',
    )
    expect(src).toContain(
      "PERSIST_THRESHOLD_OVERRIDE_FLAG = 'tengu_velvet_ibis'",
    )
    expect(src).not.toContain('tengu_satin_quoll')
  })

  test('applyPollEventDeliveryGuard (AZt) clears alwaysAllowRules.command, preserves alwaysDenyRules.command, and sets pollEventDeliveryGuard: true', () => {
    const base: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        session: ['Read'],
        command: ['Bash(ls:*)'],
      },
      alwaysDenyRules: {
        command: ['Bash(rm:*)'],
      },
    }
    const guarded = applyPollEventDeliveryGuard(base)
    expect(guarded.pollEventDeliveryGuard).toBe(true)
    expect(guarded.alwaysAllowRules.command).toBeUndefined()
    expect(guarded.alwaysAllowRules.session).toEqual(['Read'])
    expect(guarded.alwaysDenyRules.command).toEqual(['Bash(rm:*)'])
    // Idempotent when already guarded and clean
    expect(applyPollEventDeliveryGuard(guarded)).toBe(guarded)
  })

  test('isCoordinatorMode aligns with official remote gate (ud() && !xn() && !CLAUDE_CODE_REMOTE -> false)', () => {
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    delete process.env.CLAUDE_CODE_REMOTE
    setIsRemoteMode(false)

    // Interactive local session without remote workspace/env -> false (official qa)
    setIsInteractive(true)
    expect(isCoordinatorMode()).toBe(false)

    // Interactive session with CLAUDE_CODE_REMOTE=1 -> allowed when feature ON
    process.env.CLAUDE_CODE_REMOTE = '1'
    const withRemoteEnv = isCoordinatorMode()
    delete process.env.CLAUDE_CODE_REMOTE
    // Interactive session with remote workspace (xn()) -> allowed when feature ON
    setIsRemoteMode(true)
    const withRemoteMode = isCoordinatorMode()
    // Non-interactive local session (!ud()) -> allowed when feature ON
    setIsRemoteMode(false)
    setIsInteractive(false)
    const nonInteractive = isCoordinatorMode()

    // In default bun test (without -d FEATURE_COORDINATOR_MODE), feature() is false;
    // when feature('COORDINATOR_MODE') is ON, all three remote/non-interactive arms are true.
    expect(withRemoteEnv).toBe(withRemoteMode)
    expect(withRemoteMode).toBe(nonInteractive)
  })
})
