import { mock, describe, expect, test } from 'bun:test'
import * as realToolsConstants from 'src/constants/tools.js'
import * as realErrors from 'src/utils/errors.js'
import * as realMessages from 'src/utils/messages.js'
import { debugMock } from '../../../../../../tests/mocks/debug'

// ─── Mocks for agentToolUtils.ts dependencies ───
// Only mock modules that are truly unavailable or cause side effects.
// Shared modules (tools constants, errors) must spread real exports so sibling
// suites (spawnInProcess, etc.) still see CORE_TOOLS / getErrnoCode.

const noop = () => {}

mock.module('bun:bundle', () => ({ feature: () => false }))

mock.module('src/constants/tools.js', () => ({
  ...realToolsConstants,
  ALL_AGENT_DISALLOWED_TOOLS: new Set(),
  ASYNC_AGENT_ALLOWED_TOOLS: new Set(),
  CUSTOM_AGENT_DISALLOWED_TOOLS: new Set(),
  IN_PROCESS_TEAMMATE_ALLOWED_TOOLS: new Set(),
}))

mock.module('src/services/AgentSummary/agentSummary.js', () => ({
  startAgentSummarization: noop,
}))

// Mutable capture for official Cns suppressTelemetry (JXt-after-Jeo).
const analyticsEvents: Array<{ name: string; data?: unknown }> = []
mock.module('src/services/analytics/index.js', () => ({
  logEvent: (name: string, data?: unknown) => {
    analyticsEvents.push({ name, data })
  },
  logEventAsync: async () => {},
  stripProtoFields: (v: any) => v,
  attachAnalyticsSink: noop,
  _resetForTesting: noop,
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS: undefined,
}))

mock.module('src/services/api/dumpPrompts.js', () => ({
  clearDumpState: noop,
}))

mock.module('src/Tool.js', () => ({
  toolMatchesName: () => false,
  findToolByName: noop,
}))

// Spread real messages so sibling suites keep normalizeMessagesForAPI etc.
// getLastAssistantMessage is overridable for finalizeAgentTool (JXt) tests.
let lastAssistantOverride: any = null
mock.module('src/utils/messages.ts', () => ({
  ...realMessages,
  extractTextContent: (content: any[]) =>
    content
      ?.filter?.((b: any) => b.type === 'text')
      ?.map?.((b: any) => b.text)
      ?.join('') ?? '',
  getLastAssistantMessage: (msgs?: any[]) => {
    if (lastAssistantOverride !== null) return lastAssistantOverride
    // Prefer real implementation when available for other callers.
    if (typeof realMessages.getLastAssistantMessage === 'function' && msgs) {
      return realMessages.getLastAssistantMessage(msgs)
    }
    return null
  },
  isEmptyMessageText: () => true,
}))

mock.module('src/tasks/LocalAgentTask/LocalAgentTask.js', () => ({
  completeAgentTask: noop,
  createActivityDescriptionResolver: () => ({}),
  createProgressTracker: () => ({}),
  enqueueAgentNotification: noop,
  failAgentTask: noop,
  getProgressUpdate: () => ({ tokenCount: 0, toolUseCount: 0 }),
  getTokenCountFromTracker: () => 0,
  isLocalAgentTask: () => false,
  killAsyncAgent: noop,
  rebuildProgressFromMessages: noop,
  scheduleDeferredAgentProgressRebuild: noop,
  updateAgentProgress: noop,
  updateProgressFromMessage: noop,
}))

mock.module('src/utils/debug.ts', debugMock)

mock.module('src/utils/errors.js', () => ({
  ...realErrors,
  // Keep real getErrnoCode / isENOENT so EEXIST paths in sibling suites work.
  isAbortError: () => false,
  hasExactErrorMessage: () => false,
  toError: (e: any) => (e instanceof Error ? e : new Error(String(e))),
  errorMessage: (e: any) => String(e),
  shortErrorStack: () => '',
  classifyAxiosError: () => ({ category: 'unknown' }),
}))

mock.module('src/utils/forkedAgent.js', () => ({}))

mock.module('src/utils/permissions/yoloClassifier.js', () => ({
  buildTranscriptForClassifier: () => '',
  classifyYoloAction: () => null,
}))

mock.module('src/utils/task/sdkProgress.js', () => ({
  emitTaskProgress: noop,
}))

mock.module('src/utils/tokens.js', () => ({
  getTokenCountFromUsage: () => 0,
}))

mock.module('src/tools/ExitPlanModeTool/constants.js', () => ({
  EXIT_PLAN_MODE_V2_TOOL_NAME: 'exit_plan_mode',
}))

mock.module('src/tools/AgentTool/constants.js', () => ({
  AGENT_TOOL_NAME: 'agent',
  LEGACY_AGENT_TOOL_NAME: 'task',
}))

mock.module('src/tools/AgentTool/loadAgentsDir.js', () => ({}))

mock.module('src/state/AppState.js', () => ({}))

mock.module('src/types/ids.js', () => ({
  asAgentId: (id: string) => id,
}))

// Break circular dep
mock.module('src/tools/AgentTool/AgentTool.tsx', () => ({
  AgentTool: {},
  inputSchema: {},
  outputSchema: {},
  default: {},
}))

const { countToolUses, getLastToolUseName, finalizeAgentTool } = await import(
  '../agentToolUtils'
)

function makeAssistantMessage(content: any[]): any {
  return { type: 'assistant', message: { content } }
}

function makeUserMessage(text: string): any {
  return { type: 'user', message: { content: text } }
}

describe('countToolUses', () => {
  test('counts tool_use blocks in messages', () => {
    const messages = [
      makeAssistantMessage([
        { type: 'tool_use', name: 'Read' },
        { type: 'text', text: 'hello' },
      ]),
    ]
    expect(countToolUses(messages)).toBe(1)
  })

  test('returns 0 for messages without tool_use', () => {
    const messages = [makeAssistantMessage([{ type: 'text', text: 'hello' }])]
    expect(countToolUses(messages)).toBe(0)
  })

  test('returns 0 for empty array', () => {
    expect(countToolUses([])).toBe(0)
  })

  test('counts multiple tool_use blocks across messages', () => {
    const messages = [
      makeAssistantMessage([{ type: 'tool_use', name: 'Read' }]),
      makeUserMessage('ok'),
      makeAssistantMessage([{ type: 'tool_use', name: 'Write' }]),
    ]
    expect(countToolUses(messages)).toBe(2)
  })

  test('counts tool_use in single message with multiple blocks', () => {
    const messages = [
      makeAssistantMessage([
        { type: 'tool_use', name: 'Read' },
        { type: 'tool_use', name: 'Grep' },
        { type: 'tool_use', name: 'Write' },
      ]),
    ]
    expect(countToolUses(messages)).toBe(3)
  })
})

describe('getLastToolUseName', () => {
  test('returns last tool name from assistant message', () => {
    const msg = makeAssistantMessage([
      { type: 'tool_use', name: 'Read' },
      { type: 'tool_use', name: 'Write' },
    ])
    expect(getLastToolUseName(msg)).toBe('Write')
  })

  test('returns undefined for message without tool_use', () => {
    const msg = makeAssistantMessage([{ type: 'text', text: 'hello' }])
    expect(getLastToolUseName(msg)).toBeUndefined()
  })

  test('returns the last tool when multiple tool_uses present', () => {
    const msg = makeAssistantMessage([
      { type: 'tool_use', name: 'Read' },
      { type: 'tool_use', name: 'Grep' },
      { type: 'tool_use', name: 'Edit' },
    ])
    expect(getLastToolUseName(msg)).toBe('Edit')
  })

  test('returns undefined for non-assistant message', () => {
    const msg = makeUserMessage('hello')
    expect(getLastToolUseName(msg)).toBeUndefined()
  })

  test('handles message with null content', () => {
    const msg = { type: 'assistant', message: { content: null } } as any
    expect(getLastToolUseName(msg)).toBeUndefined()
  })
})

describe('finalizeAgentTool suppressTelemetry (official JXt after Jeo)', () => {
  const meta = {
    prompt: 'p',
    resolvedAgentModel: 'm',
    isBuiltInAgent: true,
    startTime: Date.now() - 10,
    agentType: 'general-purpose',
    isAsync: true,
  }

  test('emits tengu_agent_tool_completed when not suppressed', () => {
    analyticsEvents.length = 0
    lastAssistantOverride = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      requestId: 'req-1',
    }
    const result = finalizeAgentTool(
      [lastAssistantOverride],
      'agent-1',
      meta,
    )
    expect(result.agentId).toBe('agent-1')
    expect(
      analyticsEvents.some(e => e.name === 'tengu_agent_tool_completed'),
    ).toBe(true)
    expect(
      analyticsEvents.some(e => e.name === 'tengu_cache_eviction_hint'),
    ).toBe(true)
    lastAssistantOverride = null
  })

  test('skips telemetry when suppressTelemetry (JXt true)', () => {
    analyticsEvents.length = 0
    lastAssistantOverride = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'parked parent' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      requestId: 'req-2',
    }
    finalizeAgentTool([lastAssistantOverride], 'agent-2', meta, {
      suppressTelemetry: true,
    })
    expect(
      analyticsEvents.some(e => e.name === 'tengu_agent_tool_completed'),
    ).toBe(false)
    expect(
      analyticsEvents.some(e => e.name === 'tengu_cache_eviction_hint'),
    ).toBe(false)
    lastAssistantOverride = null
  })

  test('source-scan: Jeo then JXt then finalize with suppressTelemetry', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const utils = fs.readFileSync(
      path.join(import.meta.dir, '../agentToolUtils.ts'),
      'utf8',
    )
    const tool = fs.readFileSync(
      path.join(import.meta.dir, '../AgentTool.tsx'),
      'utf8',
    )
    for (const [label, src] of [
      ['agentToolUtils', utils],
      ['AgentTool', tool],
    ] as const) {
      // Call-site marker (not JSDoc {suppressTelemetry:Z} comments).
      const suppressIdx = src.indexOf('suppressTelemetry: stillHasAgentChildren')
      expect(suppressIdx).toBeGreaterThanOrEqual(0)
      const before = src.slice(0, suppressIdx)
      const sweepIdx = before.lastIndexOf('sweepStaleKeepaliveReasons(')
      const jxtIdx = before.lastIndexOf('hasLiveAgentKeepaliveChildren(')
      const finalizeIdx = before.lastIndexOf('finalizeAgentTool(')
      expect(sweepIdx).toBeGreaterThanOrEqual(0)
      expect(jxtIdx).toBeGreaterThan(sweepIdx)
      expect(finalizeIdx).toBeGreaterThan(jxtIdx)
    }
    // JXt must read root registry (set-snapshot), not forked getAppState alone.
    expect(utils).toContain('readAppStateViaSet')
    expect(tool).toMatch(/rootSetAppState\(prev\s*=>/)
  })
})
