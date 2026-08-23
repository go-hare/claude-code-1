/**
 * densable 2.1.238 r1f + q$t/NQa/XLf + t1f extras gold-hard.
 * Persist only when cowork OR CLAUDE_CODE_ENTRYPOINT==="claude-desktop".
 * Zxv extras: anyDeferLoading / is1hCacheTTL / cacheDiagnosis / messageHashes /
 * perBlockHashes. cachedMCEnabled stays in-memory only.
 * Does not invent q$t-on-CLI / fKn(undefined) / extra PKo members.
 * No process-global log/debug mock (same-dir api.test pollution).
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import { getSessionId, switchSession } from 'src/bootstrap/state.js'
import { asAgentId, asSessionId } from 'src/types/ids.js'

// Bun mock.module is process-global last-write-wins. Sibling suites stub
// analytics/index to `{ logEvent: () => {} }` without attachAnalyticsSink.
// Capture logEvent via mock.module (scrollTelemetry pattern) BEFORE importing
// promptCacheBreakDetection so its logEvent binding is interceptable.
const analyticsSnap = snapshotModuleExports(
  await import('../../analytics/index.js'),
)
const analyticsEvents: Array<{
  name: string
  meta: Record<string, unknown>
}> = []
const analyticsMock = () => ({
  ...analyticsSnap,
  logEvent(
    name: string,
    metadata: Record<string, boolean | number | undefined>,
  ) {
    analyticsEvents.push({
      name,
      meta: metadata as Record<string, unknown>,
    })
  },
  async logEventAsync(
    name: string,
    metadata: Record<string, boolean | number | undefined>,
  ) {
    analyticsEvents.push({
      name,
      meta: metadata as Record<string, unknown>,
    })
  },
})
mock.module('../../analytics/index.ts', analyticsMock)
mock.module('../../analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.ts', analyticsMock)
mock.module('src/services/analytics/index.js', analyticsMock)

import {
  CACHE_TTL_1HOUR_MS,
  checkResponseForCacheBreak,
  flushPromptCacheBreakPersistForTesting,
  getPromptCacheBreakStatePathForTesting,
  isClaudeDesktopEntrypoint,
  isPromptCacheBreakPersistEnabled,
  notifyCompaction,
  recordPromptState,
  resetPromptCacheBreakDetection,
  type PromptStateSnapshot,
} from '../promptCacheBreakDetection.js'

afterAll(() => {
  const restore = () => ({ ...analyticsSnap })
  mock.module('../../analytics/index.ts', restore)
  mock.module('../../analytics/index.js', restore)
  mock.module('src/services/analytics/index.ts', restore)
  mock.module('src/services/analytics/index.js', restore)
})

const SRC = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../promptCacheBreakDetection.ts',
  ),
  'utf8',
)

function snap(
  overrides: Partial<PromptStateSnapshot> = {},
): PromptStateSnapshot {
  return {
    system: [{ type: 'text', text: 'sys' }],
    toolSchemas: [],
    querySource: 'repl_main_thread',
    model: 'claude-opus-4-7',
    ...overrides,
  }
}

describe('r1f gold strings (238)', () => {
  test('first-call clears pendingChanges; overage copy is SEA', () => {
    expect(SRC).toContain('if (prevCacheRead === null) {')
    expect(SRC).toContain('state.pendingChanges = null')
    expect(SRC).toContain('overage state changed (TTL flip expected)')
    expect(SRC).not.toContain('TTL latched, no flip')
    expect(SRC).toContain('possible 1h TTL expiry (prompt unchanged)')
    expect(SRC).toContain('possible 5min TTL expiry (prompt unchanged)')
    expect(SRC).toContain('likely server-side (prompt unchanged, <5min gap)')
    expect(SRC).toContain("env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'")
    expect(SRC).toContain('cache-break-state-')
    expect(SRC).toContain('hydrationAttempted')
    expect(SRC).toContain('baselineFromDisk')
    expect(SRC).toContain('hydrated baseline')
  })
})

describe('r1f checkResponseForCacheBreak (238)', () => {
  beforeEach(() => {
    mock.module('../../analytics/index.ts', analyticsMock)
    mock.module('../../analytics/index.js', analyticsMock)
    mock.module('src/services/analytics/index.ts', analyticsMock)
    mock.module('src/services/analytics/index.js', analyticsMock)
    analyticsEvents.length = 0
    resetPromptCacheBreakDetection()
  })

  afterEach(() => {
    resetPromptCacheBreakDetection()
    analyticsEvents.length = 0
  })

  test('first call (prevCacheRead null) clears pendingChanges and does not fire', async () => {
    recordPromptState(snap({ model: 'claude-opus-4-7' }))
    recordPromptState(snap({ model: 'claude-sonnet-4-6' }))
    await checkResponseForCacheBreak('repl_main_thread', 10_000, 0, [])
    expect(
      analyticsEvents.some(e => e.name === 'tengu_prompt_cache_break'),
    ).toBe(false)

    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.filter(
      e => e.name === 'tengu_prompt_cache_break',
    )
    expect(brk).toHaveLength(1)
    expect(brk[0]?.meta.modelChanged).toBe(false)
  })

  test('notifyCompaction then first post-compact call also clears pending', async () => {
    recordPromptState(snap({ model: 'claude-opus-4-7' }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    recordPromptState(snap({ model: 'claude-sonnet-4-6' }))
    notifyCompaction('repl_main_thread')
    analyticsEvents.length = 0
    await checkResponseForCacheBreak('repl_main_thread', 5_000, 0, [])
    expect(
      analyticsEvents.some(e => e.name === 'tengu_prompt_cache_break'),
    ).toBe(false)
  })

  test('overage flip still fires with overageChanged', async () => {
    recordPromptState(snap({ isUsingOverage: false }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    recordPromptState(snap({ isUsingOverage: true }))
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.overageChanged).toBe(true)
  })

  test('TTL ladder iff no client pendingChanges', async () => {
    recordPromptState(snap())
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    const hourAgo = Date.now() - CACHE_TTL_1HOUR_MS - 1
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [
      {
        type: 'assistant',
        timestamp: new Date(hourAgo).toISOString(),
      } as never,
    ])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.lastAssistantMsgOver1hAgo).toBe(true)
    expect(brk?.meta.modelChanged).toBe(false)
    expect(brk?.meta.effortChanged).toBe(false)
  })
})

describe('q$t/NQa/XLf persist (238)', () => {
  const origCowork = process.env.CLAUDE_CODE_IS_COWORK
  const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

  beforeEach(() => {
    mock.module('../../analytics/index.ts', analyticsMock)
    mock.module('../../analytics/index.js', analyticsMock)
    mock.module('src/services/analytics/index.ts', analyticsMock)
    mock.module('src/services/analytics/index.js', analyticsMock)
    analyticsEvents.length = 0
    resetPromptCacheBreakDetection()
  })

  async function restorePersistEnv(): Promise<void> {
    if (origCowork === undefined) delete process.env.CLAUDE_CODE_IS_COWORK
    else process.env.CLAUDE_CODE_IS_COWORK = origCowork
    if (origEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
    resetPromptCacheBreakDetection()
    await flushPromptCacheBreakPersistForTesting()
    const path = getPromptCacheBreakStatePathForTesting()
    if (path && existsSync(path)) unlinkSync(path)
  }

  afterEach(async () => {
    await restorePersistEnv()
  })

  test('HQa is exact claude-desktop; vscode is not persist', () => {
    expect(
      isClaudeDesktopEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }),
    ).toBe(true)
    expect(
      isClaudeDesktopEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'vscode' }),
    ).toBe(false)
    expect(isClaudeDesktopEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(
      false,
    )
    expect(
      isPromptCacheBreakPersistEnabled({ CLAUDE_CODE_ENTRYPOINT: 'vscode' }),
    ).toBe(false)
    expect(
      isPromptCacheBreakPersistEnabled({ CLAUDE_CODE_IS_COWORK: '1' }),
    ).toBe(true)
    expect(
      isPromptCacheBreakPersistEnabled({
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      }),
    ).toBe(true)
  })

  test('CLI does not write cache-break-state-*.json', async () => {
    delete process.env.CLAUDE_CODE_IS_COWORK
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    const path = getPromptCacheBreakStatePathForTesting()
    expect(path).not.toBeNull()
    if (path && existsSync(path)) unlinkSync(path)
    recordPromptState(snap())
    await flushPromptCacheBreakPersistForTesting()
    expect(path && existsSync(path)).toBe(false)
  })

  test('cowork writes persistable keys only; strips baselineFromDisk', async () => {
    process.env.CLAUDE_CODE_IS_COWORK = '1'
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    recordPromptState(snap())
    recordPromptState(
      snap({
        querySource: 'agent:builtin',
        agentId: asAgentId(`a${'0'.repeat(16)}`),
      }),
    )
    await flushPromptCacheBreakPersistForTesting()
    const path = getPromptCacheBreakStatePathForTesting()
    expect(path).not.toBeNull()
    expect(path && existsSync(path)).toBe(true)
    const parsed = JSON.parse(readFileSync(path!, 'utf8')) as Record<
      string,
      Record<string, unknown>
    >
    expect(Object.keys(parsed)).toEqual(['repl_main_thread'])
    expect(parsed.repl_main_thread.baselineFromDisk).toBeUndefined()
    expect(parsed.repl_main_thread.pendingChanges).toBeUndefined()
    expect(parsed.repl_main_thread.buildDiffableContent).toBeUndefined()
    expect(parsed.repl_main_thread.cachedMCEnabled).toBeUndefined()
    expect(typeof parsed.repl_main_thread.systemHash).toBe('number')
    expect(parsed.repl_main_thread.callCount).toBe(1)
  })

  test('desktop entrypoint writes cache-break-state uuid json', async () => {
    delete process.env.CLAUDE_CODE_IS_COWORK
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
    recordPromptState(snap())
    await flushPromptCacheBreakPersistForTesting()
    const path = getPromptCacheBreakStatePathForTesting()
    expect(path).toContain(`cache-break-state-${getSessionId()}.json`)
    expect(path && existsSync(path)).toBe(true)
  })

  test('invalid session id → ZLf null, no write', async () => {
    const prev = getSessionId()
    switchSession(asSessionId('not-a-uuid'))
    try {
      process.env.CLAUDE_CODE_IS_COWORK = '1'
      expect(getPromptCacheBreakStatePathForTesting()).toBeNull()
      recordPromptState(snap())
      await flushPromptCacheBreakPersistForTesting()
    } finally {
      switchSession(prev)
    }
  })

  test('hydrate sets baselineFromDisk; r1f telemetry uses hydrated baseline', async () => {
    process.env.CLAUDE_CODE_IS_COWORK = '1'
    recordPromptState(snap({ model: 'claude-opus-4-7' }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    await flushPromptCacheBreakPersistForTesting()
    const path = getPromptCacheBreakStatePathForTesting()
    expect(path).not.toBeNull()
    const body = readFileSync(path!, 'utf8')

    resetPromptCacheBreakDetection()
    await flushPromptCacheBreakPersistForTesting()
    writeFileSync(path!, body)

    recordPromptState(snap({ model: 'claude-sonnet-4-6' }))
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.baselineFromDisk).toBe(true)
    expect(brk?.meta.isCowork).toBe(true)
    expect(brk?.meta.modelChanged).toBe(true)
  })
})

describe('t1f extras (238)', () => {
  const origCowork = process.env.CLAUDE_CODE_IS_COWORK
  const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

  beforeEach(() => {
    mock.module('../../analytics/index.ts', analyticsMock)
    mock.module('../../analytics/index.js', analyticsMock)
    mock.module('src/services/analytics/index.ts', analyticsMock)
    mock.module('src/services/analytics/index.js', analyticsMock)
    analyticsEvents.length = 0
    resetPromptCacheBreakDetection()
  })

  afterEach(async () => {
    if (origCowork === undefined) delete process.env.CLAUDE_CODE_IS_COWORK
    else process.env.CLAUDE_CODE_IS_COWORK = origCowork
    if (origEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
    resetPromptCacheBreakDetection()
    await flushPromptCacheBreakPersistForTesting()
    const path = getPromptCacheBreakStatePathForTesting()
    if (path && existsSync(path)) unlinkSync(path)
  })

  test('gold strings: YLf / e1f / MQa / Opt / DWT / CLs', () => {
    expect(SRC).toContain('x-anthropic-billing-header:')
    expect(SRC).toContain('EPHEMERAL_API_SYSTEM_HASH = -1')
    expect(SRC).toContain("CLAUDE_CODE_ENTRYPOINT === 'local-agent'")
    expect(SRC).toContain("new Set(['computer-use'])")
    expect(SRC).toContain('cache diagnosis toggled')
    expect(SRC).toContain(
      'defer_loading presence flipped (deferred-tool hint section, inc-5316)',
    )
    expect(SRC).toContain('message history mutated at index')
    expect(SRC).toContain('previousMessageId')
    expect(SRC).toContain('anyDeferLoading')
    expect(SRC).toContain('is1hCacheTTL')
    expect(SRC).toContain('perBlockHashes')
    expect(SRC).toContain('messageHashes')
    expect(SRC).not.toContain('vd(')
    const claudeSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../claude.ts'),
      'utf8',
    )
    expect(claudeSrc).toContain('tengu_prompt_cache_diagnostics')
    expect(claudeSrc).toContain('CACHE_DIAGNOSIS_BETA_HEADER')
    expect(claudeSrc).toContain('lastAssistantMessageId(messages)')
    // MWT latch is independent of YNe / tracking feature.
    const latchIdx = claudeSrc.indexOf('if (isPromptCacheDiagnosticsEnabled())')
    const trackingIdx = claudeSrc.indexOf(
      "if (feature('PROMPT_CACHE_BREAK_DETECTION')) {",
    )
    expect(latchIdx).toBeGreaterThan(-1)
    expect(trackingIdx).toBeGreaterThan(-1)
    expect(latchIdx).toBeLessThan(trackingIdx)
  })

  test('defer_loading flip fires deferLoadingPresenceChanged', async () => {
    recordPromptState(snap({ anyDeferLoading: false }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    recordPromptState(snap({ anyDeferLoading: true }))
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.deferLoadingPresenceChanged).toBe(true)
  })

  test('cacheDiagnosis flip fires cacheDiagnosisChanged', async () => {
    recordPromptState(snap({ cacheDiagnosis: false }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    recordPromptState(snap({ cacheDiagnosis: true }))
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.cacheDiagnosisChanged).toBe(true)
  })

  test('message history mutation skips e1f sentinel slots', async () => {
    const user = {
      type: 'user' as const,
      message: { role: 'user', content: 'hello' },
    }
    const ephemeralA = {
      type: 'api_system' as const,
      ephemeral: true,
      message: { role: 'system', content: 'ephemeral-a' },
    }
    const ephemeralB = {
      type: 'api_system' as const,
      ephemeral: true,
      message: { role: 'system', content: 'ephemeral-b' },
    }

    recordPromptState(snap({ messagesForAPI: [user, ephemeralA] }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    analyticsEvents.length = 0
    recordPromptState(snap({ messagesForAPI: [user, ephemeralB] }))
    // Keep cache-read above the 5%/2k drop so r1f does not fire a
    // server-side break; e1f skip means pendingChanges stays null.
    await checkResponseForCacheBreak('repl_main_thread', 19_500, 0, [])
    expect(
      analyticsEvents.some(e => e.name === 'tengu_prompt_cache_break'),
    ).toBe(false)

    recordPromptState(
      snap({
        messagesForAPI: [
          { type: 'user', message: { role: 'user', content: 'mutated' } },
          ephemeralB,
        ],
      }),
    )
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.messagesHistoryChanged).toBe(true)
    expect(brk?.meta.firstChangedMessageIndex).toBe(0)
  })

  test('cowork persist includes Zxv extras and still omits cachedMCEnabled', async () => {
    process.env.CLAUDE_CODE_IS_COWORK = '1'
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    recordPromptState(
      snap({
        anyDeferLoading: true,
        is1hCacheTTL: true,
        cacheDiagnosis: true,
        queryDepth: 2,
        cachedMCEnabled: true,
        messagesForAPI: [
          { type: 'user', message: { role: 'user', content: 'hi' } },
        ],
      }),
    )
    await flushPromptCacheBreakPersistForTesting()
    const path = getPromptCacheBreakStatePathForTesting()
    expect(path && existsSync(path)).toBe(true)
    const parsed = JSON.parse(readFileSync(path!, 'utf8')) as Record<
      string,
      Record<string, unknown>
    >
    const row = parsed.repl_main_thread
    expect(row.anyDeferLoading).toBe(true)
    expect(row.is1hCacheTTL).toBe(true)
    expect(row.cacheDiagnosis).toBe(true)
    expect(row.queryDepth).toBe(2)
    expect(Array.isArray(row.messageHashes)).toBe(true)
    expect((row.messageHashes as number[]).length).toBe(1)
    expect(Array.isArray(row.perBlockHashes)).toBe(true)
    expect(Array.isArray(row.perBlockLengths)).toBe(true)
    expect(row.cachedMCEnabled).toBeUndefined()
    expect(row.pendingChanges).toBeUndefined()
    expect(row.baselineFromDisk).toBeUndefined()
  })

  test('hydrate rejects persist JSON missing Zxv arrays (no .default([]))', async () => {
    process.env.CLAUDE_CODE_IS_COWORK = '1'
    const path = getPromptCacheBreakStatePathForTesting()
    expect(path).not.toBeNull()
    const legacy = {
      repl_main_thread: {
        systemHash: 1,
        toolsHash: 2,
        cacheControlHash: 3,
        toolNames: [],
        perToolHashes: {},
        // SEA Zxv has no .default([]) on perBlockHashes / perBlockLengths /
        // messageHashes — truncated persist must fail NQa, not hydrate empty.
        systemCharCount: 3,
        model: 'claude-opus-4-7',
        fastMode: false,
        globalCacheStrategy: '',
        betas: [],
        autoModeActive: false,
        isUsingOverage: false,
        effortValue: '',
        extraBodyHash: 0,
        callCount: 1,
        prevCacheReadTokens: 20_000,
        cacheDeletionsPending: false,
      },
    }
    writeFileSync(path!, JSON.stringify(legacy))
    recordPromptState(snap({ model: 'claude-sonnet-4-6' }))
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    // Rejected hydrate → first-call (prevCacheRead null) clears pending.
    expect(
      analyticsEvents.some(e => e.name === 'tengu_prompt_cache_break'),
    ).toBe(false)
    expect(analyticsEvents.some(e => e.meta.baselineFromDisk === true)).toBe(
      false,
    )
  })

  test('CLI still does not write cache-break-state after extras snapshot', async () => {
    delete process.env.CLAUDE_CODE_IS_COWORK
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    const path = getPromptCacheBreakStatePathForTesting()
    if (path && existsSync(path)) unlinkSync(path)
    recordPromptState(
      snap({
        anyDeferLoading: true,
        is1hCacheTTL: true,
        cacheDiagnosis: true,
        messagesForAPI: [
          { type: 'user', message: { role: 'user', content: 'cli' } },
        ],
      }),
    )
    await flushPromptCacheBreakPersistForTesting()
    expect(path && existsSync(path)).toBe(false)
  })

  test('previousMessageId is forwarded on tengu_prompt_cache_break', async () => {
    recordPromptState(snap({ model: 'claude-opus-4-7' }))
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    recordPromptState(snap({ model: 'claude-sonnet-4-6' }))
    await checkResponseForCacheBreak(
      'repl_main_thread',
      1_000,
      0,
      [],
      undefined,
      'req_current',
      'msg_prev',
    )
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.previousMessageId).toBe('msg_prev')
    expect(brk?.meta.requestId).toBe('req_current')
    expect(brk?.meta.is1hCacheTTL).toBe(false)
  })

  test('YLf billing header is stripped from system hashes', async () => {
    recordPromptState(
      snap({
        system: [
          { type: 'text', text: 'sys' },
          { type: 'text', text: 'x-anthropic-billing-header:acct' },
        ],
      }),
    )
    await checkResponseForCacheBreak('repl_main_thread', 20_000, 0, [])
    recordPromptState(
      snap({
        system: [
          { type: 'text', text: 'sys' },
          { type: 'text', text: 'x-anthropic-billing-header:other' },
        ],
      }),
    )
    await checkResponseForCacheBreak('repl_main_thread', 19_500, 0, [])
    expect(
      analyticsEvents.some(e => e.name === 'tengu_prompt_cache_break'),
    ).toBe(false)

    recordPromptState(
      snap({
        system: [
          { type: 'text', text: 'sys-changed' },
          { type: 'text', text: 'x-anthropic-billing-header:other' },
        ],
      }),
    )
    await checkResponseForCacheBreak('repl_main_thread', 1_000, 0, [])
    const brk = analyticsEvents.find(e => e.name === 'tengu_prompt_cache_break')
    expect(brk?.meta.systemPromptChanged).toBe(true)
  })
})
