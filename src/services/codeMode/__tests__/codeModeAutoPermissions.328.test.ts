import { afterAll, describe, expect, mock, test } from 'bun:test'
import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import type {
  PermissionResult,
  ToolPermissionContext,
} from '../../../types/permissions.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { REPLTool } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import { wrapReplToolForCodeMode } from '../executor.js'
import {
  resetCodeModeOptInStateForTests,
  setEngineCheckResultForTests,
  settleCodeModeOptIn,
} from '../optIn.js'

const hasTranscriptClassifier = feature('TRANSCRIPT_CLASSIFIER') ? true : false
const classifierTest = test.skipIf(!hasTranscriptClassifier)

const classifyYoloActionMock = mock(async () => ({
  shouldBlock: false,
  reason: 'Classifier approved script',
  model: 'claude-sonnet-4-6',
  durationMs: 12,
  classifierRan: true,
}))

if (hasTranscriptClassifier) {
  const actualYoloClassifier = await import(
    '../../../utils/permissions/yoloClassifier.js'
  )
  mock.module('../../../utils/permissions/yoloClassifier.js', () => ({
    ...actualYoloClassifier,
    classifyYoloAction: classifyYoloActionMock,
  }))
  afterAll(() => {
    mock.module('../../../utils/permissions/yoloClassifier.js', () => ({
      ...actualYoloClassifier,
    }))
  })
}

const { hasPermissionsToUseTool } = await import(
  '../../../utils/permissions/permissions.js'
)
const { runToolUse } = await import('../../tools/toolExecution.js')

function makePermissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    mode: 'auto',
    ...overrides,
  }
}

function makeToolUseContext(
  permOverrides: Partial<ToolPermissionContext> = {},
  ctxOverrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const permCtx = makePermissionContext(permOverrides)
  const appState = {
    ...getDefaultAppState(),
    toolPermissionContext: permCtx,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map() as any,
    getAppState: () => appState as any,
    setAppState: () => {},
    messages: [],
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    ...ctxOverrides,
  } as unknown as ToolUseContext
}

function makeAssistantMessage(id = 'msg_test_1'): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'uuid-1',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  } as unknown as AssistantMessage
}

function makeFakeTool(
  name: string,
  checkPermissionsImpl: (
    input: unknown,
    ctx: ToolUseContext,
  ) => Promise<PermissionResult>,
  callImpl?: (
    input: unknown,
    ctx: ToolUseContext,
  ) => Promise<{ data: unknown }>,
): Tool {
  return {
    name,
    inputSchema: z.object({}).passthrough(),
    description: async () => `fake ${name}`,
    prompt: async () => `fake ${name}`,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    isReadOnly: () => false,
    userFacingName: () => name,
    checkPermissions: checkPermissionsImpl as any,
    call: (callImpl ?? (async () => ({ data: 'ok' }))) as any,
    mapToolResultToToolResultBlockParam: (content: unknown, id: string) => ({
      tool_use_id: id,
      type: 'tool_result' as const,
      content: String(content),
    }),
  } as unknown as Tool
}

describe('Code Mode auto-mode permissions (2.1.328)', () => {
  classifierTest(
    'outer REPL and Eval in auto mode defer classification and never skip via acceptEdits',
    async () => {
      classifyYoloActionMock.mockClear()

      for (const toolName of [REPL_TOOL_NAME, 'Eval']) {
        let acceptEditsModeChecked = false
        const tool = makeFakeTool(toolName, async (_input, ctx) => {
          if (ctx.getAppState().toolPermissionContext.mode === 'acceptEdits') {
            acceptEditsModeChecked = true
            return { behavior: 'allow', updatedInput: { code: '1+1' } }
          }
          return {
            behavior: 'ask',
            message: `Allow ${toolName}?`,
            decisionReason: { type: 'other', reason: 'repl_requires_check' },
          }
        })

        const ctx = makeToolUseContext({ mode: 'auto' })
        const decision = await hasPermissionsToUseTool(
          tool,
          { code: '1+1' },
          ctx,
          makeAssistantMessage(),
          `toolu_${toolName}_1`,
        )

        expect(acceptEditsModeChecked).toBe(false)
        expect(classifyYoloActionMock).not.toHaveBeenCalled()
        expect(decision.behavior).toBe('allow')
        expect(decision.decisionReason).toEqual({
          type: 'other',
          reason: 'deferred_repl_script_check',
        })
      }
    },
  )

  classifierTest(
    'outer REPL with replScriptCheckNow: true runs the classifier immediately',
    async () => {
      classifyYoloActionMock.mockClear()

      const tool = makeFakeTool(REPL_TOOL_NAME, async () => ({
        behavior: 'ask',
        message: 'Allow REPL?',
        decisionReason: { type: 'other', reason: 'repl_requires_check' },
      }))

      const ctx = makeToolUseContext(
        { mode: 'auto' },
        { replScriptCheckNow: true },
      )
      const decision = await hasPermissionsToUseTool(
        tool,
        { code: 'await Bash({ command: "ls" })' },
        ctx,
        makeAssistantMessage(),
        'toolu_repl_now_1',
      )

      expect(classifyYoloActionMock).toHaveBeenCalledTimes(1)
      expect(decision.behavior).toBe('allow')
      expect(decision.decisionReason).toEqual({
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'Classifier approved script',
      })
    },
  )

  classifierTest(
    'inner tool call with replScriptInner: true rides verdict without hitting classifier',
    async () => {
      classifyYoloActionMock.mockClear()

      const bashTool = makeFakeTool('Bash', async () => ({
        behavior: 'ask',
        message: 'Allow Bash?',
        decisionReason: { type: 'other', reason: 'needs_permission' },
      }))

      const ctx = makeToolUseContext(
        { mode: 'auto' },
        { replScriptInner: true },
      )
      const decision = await hasPermissionsToUseTool(
        bashTool,
        { command: 'echo hello' },
        ctx,
        makeAssistantMessage(),
        'toolu_inner_1',
      )

      expect(classifyYoloActionMock).not.toHaveBeenCalled()
      expect(decision.behavior).toBe('allow')
      expect(decision.decisionReason).toEqual({
        type: 'mode',
        mode: 'auto',
      })
    },
  )

  classifierTest(
    'inner tool call with replScriptInner: true still enforces explicit deny rules, ask rules, and hookAskFloor',
    async () => {
      classifyYoloActionMock.mockClear()

      const bashTool = makeFakeTool('Bash', async () => ({
        behavior: 'ask',
        message: 'Allow Bash?',
        decisionReason: { type: 'other', reason: 'needs_permission' },
      }))

      // 1. Explicit deny rule
      const denyCtx = makeToolUseContext(
        {
          mode: 'auto',
          alwaysDenyRules: { userSettings: ['Bash'] },
        },
        { replScriptInner: true },
      )
      const denyDecision = await hasPermissionsToUseTool(
        bashTool,
        { command: 'rm -rf /' },
        denyCtx,
        makeAssistantMessage(),
        'toolu_inner_deny',
      )
      expect(denyDecision.behavior).toBe('deny')
      expect(classifyYoloActionMock).not.toHaveBeenCalled()

      // 2. Explicit ask rule
      const askCtx = makeToolUseContext(
        {
          mode: 'auto',
          alwaysAskRules: { userSettings: ['Bash'] },
        },
        { replScriptInner: true },
      )
      const askDecision = await hasPermissionsToUseTool(
        bashTool,
        { command: 'echo ask' },
        askCtx,
        makeAssistantMessage(),
        'toolu_inner_ask',
      )
      expect(askDecision.behavior).toBe('ask')
      expect(classifyYoloActionMock).not.toHaveBeenCalled()

      // 3. hookAskFloor: true must NOT ride the outer verdict
      const hookFloorCtx = makeToolUseContext(
        { mode: 'auto' },
        { replScriptInner: true, hookAskFloor: true },
      )
      const hookFloorDecision = await hasPermissionsToUseTool(
        bashTool,
        { command: 'echo hook' },
        hookFloorCtx,
        makeAssistantMessage(),
        'toolu_inner_hook_floor',
      )
      expect(hookFloorDecision.behavior).toBe('ask')
    },
  )

  classifierTest(
    'inner tool call with replScriptAtLimit: true does NOT ride verdict and falls back to ask',
    async () => {
      classifyYoloActionMock.mockClear()

      const bashTool = makeFakeTool('Bash', async () => ({
        behavior: 'ask',
        message: 'Allow Bash?',
        decisionReason: { type: 'other', reason: 'needs_permission' },
      }))

      const ctx = makeToolUseContext(
        { mode: 'auto' },
        { replScriptInner: true, replScriptAtLimit: true },
      )
      const decision = await hasPermissionsToUseTool(
        bashTool,
        { command: 'echo limit' },
        ctx,
        makeAssistantMessage(),
        'toolu_inner_limit',
      )

      expect(classifyYoloActionMock).not.toHaveBeenCalled()
      expect(decision.behavior).toBe('ask')
    },
  )

  test('toolExecution propagates autoModeClassified and autoModeScriptCheckDeferred into tool.call context', async () => {
    const seenContexts: Array<{
      autoModeClassified?: boolean
      autoModeScriptCheckDeferred?: boolean
    }> = []

    const replTool = makeFakeTool(
      REPL_TOOL_NAME,
      async () => ({ behavior: 'allow', updatedInput: { code: '1+1' } }),
      async (_input, ctx) => {
        seenContexts.push({
          autoModeClassified: ctx.autoModeClassified,
          autoModeScriptCheckDeferred: ctx.autoModeScriptCheckDeferred,
        })
        return { data: 'done' }
      },
    )

    const ctx = makeToolUseContext({ mode: 'auto' })
    ctx.options.tools = [replTool]
    const msg = makeAssistantMessage('msg_exec_1')

    // Case 1: classifier allow -> autoModeClassified: true
    for await (const _ of runToolUse(
      {
        type: 'tool_use',
        id: 'toolu_exec_classified',
        name: REPL_TOOL_NAME,
        input: { code: '1+1' },
        caller: { type: 'direct' },
      },
      msg,
      async () => ({
        behavior: 'allow',
        updatedInput: { code: '1+1' },
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: 'safe',
        },
      }),
      ctx,
    )) {
      // consume generator
    }

    // Case 2: deferred script check -> autoModeScriptCheckDeferred: true
    for await (const _ of runToolUse(
      {
        type: 'tool_use',
        id: 'toolu_exec_deferred',
        name: REPL_TOOL_NAME,
        input: { code: '2+2' },
        caller: { type: 'direct' },
      },
      msg,
      async () => ({
        behavior: 'allow',
        updatedInput: { code: '2+2' },
        decisionReason: {
          type: 'other',
          reason: 'deferred_repl_script_check',
        },
      }),
      ctx,
    )) {
      // consume generator
    }

    // Case 3: regular allow -> both undefined
    for await (const _ of runToolUse(
      {
        type: 'tool_use',
        id: 'toolu_exec_regular',
        name: REPL_TOOL_NAME,
        input: { code: '3+3' },
        caller: { type: 'direct' },
      },
      msg,
      async () => ({
        behavior: 'allow',
        updatedInput: { code: '3+3' },
        decisionReason: {
          type: 'mode',
          mode: 'acceptEdits',
        },
      }),
      ctx,
    )) {
      // consume generator
    }

    expect(seenContexts).toEqual([
      { autoModeClassified: true, autoModeScriptCheckDeferred: undefined },
      { autoModeClassified: undefined, autoModeScriptCheckDeferred: true },
      { autoModeClassified: undefined, autoModeScriptCheckDeferred: undefined },
    ])
  })

  classifierTest(
    'P0-11: real REPLTool and wrapReplToolForCodeMode invoke auto-mode classifier via passthrough -> deferred -> replScriptCheckNow',
    async () => {
      classifyYoloActionMock.mockClear()
      setEngineCheckResultForTests('passed')
      settleCodeModeOptIn({ state: 'on', source: 'shell' })

      try {
        const input = { code: 'await Bash({ command: "echo hi" })' }
        const wrapped = wrapReplToolForCodeMode(REPLTool, () => [])

        for (const tool of [REPLTool, wrapped]) {
          // Outer call defers script check (does NOT bypass classifier via allow)
          const outerRes = await hasPermissionsToUseTool(
            tool,
            input,
            makeToolUseContext({ mode: 'auto' }),
            makeAssistantMessage(`msg_real_outer_${tool.name}`),
            `toolu_real_outer_${tool.name}`,
          )
          expect(outerRes.behavior).toBe('allow')
          expect(outerRes.decisionReason).toEqual({
            type: 'other',
            reason: 'deferred_repl_script_check',
          })

          // Deferred re-entry (`replScriptCheckNow: true`) invokes classifyYoloAction!
          const beforeCalls = classifyYoloActionMock.mock.calls.length
          const checkNowRes = await hasPermissionsToUseTool(
            tool,
            input,
            makeToolUseContext({ mode: 'auto' }, { replScriptCheckNow: true }),
            makeAssistantMessage(`msg_real_check_${tool.name}`),
            `toolu_real_check_${tool.name}`,
          )
          expect(classifyYoloActionMock.mock.calls.length).toBe(beforeCalls + 1)
          expect(checkNowRes.behavior).toBe('allow')
          expect(checkNowRes.decisionReason?.type).toBe('classifier')
        }
      } finally {
        resetCodeModeOptInStateForTests()
      }
    },
  )
})
