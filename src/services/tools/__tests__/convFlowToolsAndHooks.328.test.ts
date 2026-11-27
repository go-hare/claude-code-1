import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { UserMessage } from '../../../types/message.js'
import type { PermissionDecision } from '../../../types/permissions.js'
import {
  createAbortErrorReason,
  getAbortReasonMessage,
} from '../../../utils/abortController.js'
import { runWithAgentContext } from '../../../utils/agentContext.js'
import { createAttachmentMessage } from '../../../utils/attachments.js'
import {
  AbortError,
  ControlStreamClosedError,
  ShellError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../utils/errors.js'
import {
  executeStopHooks,
  executeTeammateIdleHooks,
  processHookJSONOutput,
} from '../../../utils/hooks.js'
import {
  createAssistantMessage,
  createUserMessage,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
} from '../../../utils/messages.js'
import { AUTO_MODE_UNAVAILABLE_STOP_REASON } from '../../../utils/permissions/autoModeUnavailable.js'
import { StreamingToolExecutor } from '../StreamingToolExecutor.js'
import {
  decisionHoldsPersonsWords,
  deriveToolDenialKind,
  deriveToolDenialUnanswered,
  deriveToolErrorDenialKind,
  isToolBridgeEvent,
  runToolUse,
} from '../toolExecution.js'

function makeContext(
  tools: Tool[] = [],
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const abortController = overrides.abortController ?? new AbortController()
  const appState = {
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
    sessionHooks: new Map(),
    mcp: { clients: [] },
    tasks: {},
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      settingsHooksOff: true,
      agentDefinitions: {
        builtinAgents: [],
        customAgents: [],
        activeAgents: [],
        allAgents: [],
      },
    },
    abortController,
    readFileState: {
      get: () => undefined,
      set: () => {},
      delete: () => false,
      has: () => false,
      clear: () => {},
    } as any,
    getAppState: () => appState as any,
    setAppState: () => {},
    session: { root: {} },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
    ...overrides,
  } as unknown as ToolUseContext
}

function makeTool(opts: {
  name: string
  concurrencySafe?: boolean
  call: (
    input: Record<string, unknown>,
    ctx: ToolUseContext,
    canUseTool: CanUseToolFn,
  ) => Promise<{
    data: string
    newMessages?: UserMessage[]
  }>
}): Tool {
  return {
    name: opts.name,
    inputSchema: z.object({ value: z.string().optional() }).passthrough(),
    isConcurrencySafe: () => opts.concurrencySafe ?? false,
    isReadOnly: () => opts.concurrencySafe ?? false,
    isEnabled: () => true,
    userFacingName: () => opts.name,
    mapToolResultToToolResultBlockParam: (
      data: unknown,
      toolUseID: string,
    ) => ({
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: String(data),
    }),
    call: opts.call,
  } as unknown as Tool
}

const allowAll: CanUseToolFn = async (_tool, input) => ({
  behavior: 'allow',
  updatedInput: input,
})

describe('[P0-7] StreamingToolExecutor.getRemainingResults() avoids microtask busy-spin', () => {
  test('awaits Promise.race when an exclusive executing tool precedes an already-completed unknown tool', async () => {
    let releaseExclusive!: () => void
    const exclusiveDone = new Promise<void>(resolve => {
      releaseExclusive = resolve
    })
    const exclusiveTool = makeTool({
      name: 'ExclusiveTool',
      concurrencySafe: false,
      call: async () => {
        await exclusiveDone
        return { data: 'exclusive-ok' }
      },
    })
    const ctx = makeContext([exclusiveTool])
    const executor = new StreamingToolExecutor([exclusiveTool], allowAll, ctx)
    const assistant = createAssistantMessage({ content: [] })

    let getCompletedCalls = 0
    const origGetCompleted = executor.getCompletedResults.bind(executor)
    executor.getCompletedResults = function* () {
      getCompletedCalls++
      yield* origGetCompleted()
    }

    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-excl',
        name: 'ExclusiveTool',
        input: { value: '1' },
        caller: { type: 'direct' },
      },
      assistant,
    )
    // Unknown tool is marked `completed` immediately behind the executing exclusive tool.
    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-unknown',
        name: 'NoSuchTool328',
        input: {},
        caller: { type: 'direct' },
      },
      assistant,
    )

    // Release the exclusive tool after a real macrotask delay; a microtask spin
    // loop would starve the event loop or invoke getCompletedResults thousands of times.
    setTimeout(() => releaseExclusive(), 30)

    const toolResultIds: string[] = []
    for await (const update of executor.getRemainingResults()) {
      if (
        update.message?.type === 'user' &&
        Array.isArray(update.message.message?.content)
      ) {
        for (const block of update.message.message.content) {
          if (block.type === 'tool_result') {
            toolResultIds.push(block.tool_use_id)
          }
        }
      }
    }

    expect(toolResultIds).toEqual(['tu-excl', 'tu-unknown'])
    expect(getCompletedCalls).toBeLessThan(10)
  })
})

describe('[P0-10] processHookJSONOutput security & l$o parity', () => {
  test('top-level decision: "block" cannot be downgraded by PreToolUse permissionDecision allow/ask/defer', () => {
    for (const weaker of ['allow', 'ask', 'defer'] as const) {
      const res = processHookJSONOutput({
        json: {
          decision: 'block',
          reason: 'Blocked by security policy',
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: weaker,
            permissionDecisionReason: `Attempted downgrade to ${weaker}`,
            additionalContext: 'extra context',
          },
        },
        command: 'policy-hook.sh',
        hookName: 'PreToolUse:Bash',
        toolUseID: 'tu-sec-1',
        hookEvent: 'PreToolUse',
        expectedHookEvent: 'PreToolUse',
      })
      expect(res.permissionBehavior).toBe('deny')
      expect(res.blockingError?.blockingError).toBe(
        'Blocked by security policy',
      )
      expect(res.hookPermissionDecisionReason).toBe(
        'Blocked by security policy',
      )
      expect(res.additionalContext).toBe('extra context')
    }
  })

  test('PreToolUse hookSpecificOutput without permissionDecisionReason does not clobber json.reason', () => {
    const res = processHookJSONOutput({
      json: {
        decision: 'block',
        reason: 'Top-level block reason',
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: 'some note',
        },
      },
      command: 'hook.sh',
      hookName: 'PreToolUse:Bash',
      toolUseID: 'tu-sec-2',
      hookEvent: 'PreToolUse',
      expectedHookEvent: 'PreToolUse',
    })
    expect(res.permissionBehavior).toBe('deny')
    expect(res.hookPermissionDecisionReason).toBe('Top-level block reason')
    expect(res.blockingError?.blockingError).toBe('Top-level block reason')
  })

  test('official l$o: drops mismatched hookSpecificOutput and preserves block + suppressOriginalPrompt', () => {
    const blockedByDecision = processHookJSONOutput({
      json: {
        decision: 'block',
        reason: 'No secrets allowed',
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'wrong event payload',
        },
      },
      command: 'block-hook.sh',
      hookName: 'UserPromptSubmit',
      toolUseID: 'tu-sec-3',
      hookEvent: 'UserPromptSubmit',
      expectedHookEvent: 'UserPromptSubmit',
    })
    expect(blockedByDecision.permissionBehavior).toBe('deny')
    expect(blockedByDecision.blockingError?.blockingError).toBe(
      'No secrets allowed',
    )
    expect(blockedByDecision.suppressOriginalPrompt).toBe(true)
    expect(blockedByDecision.additionalContext).toBeUndefined()

    const blockedByContinue = processHookJSONOutput({
      json: {
        continue: false,
        stopReason: 'Halted by security hook',
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'wrong event payload',
        },
      },
      command: 'halt-hook.sh',
      hookName: 'PreToolUse:Bash',
      toolUseID: 'tu-sec-4',
      hookEvent: 'PreToolUse',
      expectedHookEvent: 'PreToolUse',
    })
    expect(blockedByContinue.preventContinuation).toBe(true)
    expect(blockedByContinue.stopReason).toBe('Halted by security hook')
    expect(blockedByContinue.suppressOriginalPrompt).toBe(true)
    expect(blockedByContinue.additionalContext).toBeUndefined()
  })

  test('still throws on mismatched hookEventName when hook did not block or on PermissionRequest', () => {
    expect(() =>
      processHookJSONOutput({
        json: {
          decision: 'approve',
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: 'wrong',
          },
        },
        command: 'hook.sh',
        hookName: 'PreToolUse:Bash',
        toolUseID: 'tu-sec-5',
        hookEvent: 'PreToolUse',
        expectedHookEvent: 'PreToolUse',
      }),
    ).toThrow(/Hook returned incorrect event name/)

    expect(() =>
      processHookJSONOutput({
        json: {
          decision: 'block',
          reason: 'wrong event',
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
          },
        },
        command: 'hook.sh',
        hookName: 'PermissionRequest',
        toolUseID: 'tu-sec-6',
        hookEvent: 'PermissionRequest',
        expectedHookEvent: 'PermissionRequest',
      }),
    ).toThrow(/Hook returned incorrect event name/)
  })
})

describe('[P1-8] No Bash sibling abort cascade & sameTurnErroredToolUseIds', () => {
  test('parallel Bash error does NOT abort sibling tool and passes sameTurnErroredToolUseIds to later tools', async () => {
    let siblingWasAborted = false
    let capturedErroredIds: Set<string> | undefined

    const bashTool = makeTool({
      name: 'Bash',
      concurrencySafe: true,
      call: async () => {
        throw new Error('bash command exited 1')
      },
    })
    const siblingTool = makeTool({
      name: 'Read',
      concurrencySafe: true,
      call: async (_input, ctx) => {
        await new Promise(resolve => setTimeout(resolve, 25))
        siblingWasAborted = ctx.abortController.signal.aborted
        return { data: 'sibling-succeeded' }
      },
    })
    const followupExclusive = makeTool({
      name: 'Edit',
      concurrencySafe: false,
      call: async (_input, ctx) => {
        capturedErroredIds = (
          ctx as ToolUseContext & { sameTurnErroredToolUseIds?: Set<string> }
        ).sameTurnErroredToolUseIds
        return { data: 'followup-ok' }
      },
    })

    const tools = [bashTool, siblingTool, followupExclusive]
    const ctx = makeContext(tools)
    const executor = new StreamingToolExecutor(tools, allowAll, ctx)
    const assistant = createAssistantMessage({ content: [] })

    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-bash-err',
        name: 'Bash',
        input: { value: 'false' },
        caller: { type: 'direct' },
      },
      assistant,
    )
    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-read-ok',
        name: 'Read',
        input: { value: 'file.ts' },
        caller: { type: 'direct' },
      },
      assistant,
    )
    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-edit-after',
        name: 'Edit',
        input: { value: 'file.ts' },
        caller: { type: 'direct' },
      },
      assistant,
    )

    const resultsById = new Map<
      string,
      { content: unknown; isError?: boolean }
    >()
    for await (const update of executor.getRemainingResults()) {
      if (
        update.message?.type === 'user' &&
        Array.isArray(update.message.message?.content)
      ) {
        for (const block of update.message.message.content) {
          if (block.type === 'tool_result') {
            resultsById.set(block.tool_use_id, {
              content: block.content,
              isError: block.is_error,
            })
          }
        }
      }
    }

    expect(siblingWasAborted).toBe(false)
    expect(ctx.abortController.signal.aborted).toBe(false)
    expect(resultsById.get('tu-bash-err')?.isError).toBe(true)
    expect(resultsById.get('tu-read-ok')).toEqual({
      content: 'sibling-succeeded',
      isError: undefined,
    })
    expect(resultsById.get('tu-edit-after')).toEqual({
      content: 'followup-ok',
      isError: undefined,
    })
    expect(capturedErroredIds).toBeInstanceOf(Set)
    expect(capturedErroredIds?.has('tu-bash-err')).toBe(true)
    expect(capturedErroredIds?.has('tu-read-ok')).toBe(false)
    expect(capturedErroredIds?.has('tu-edit-after')).toBe(false)
  })
})

describe('[P1-14] toolDenialKind stamping & permission-stop abort on endsTurn denials', () => {
  test('deriveToolDenialKind / Gio / qJn / X6r match official Vbe/Gio/qJn/X6r', () => {
    expect(
      deriveToolDenialKind({
        behavior: 'ask',
        message: 'Ask rejected',
      } as PermissionDecision),
    ).toBe('user-rejected')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'Denied by rule',
        decisionReason: {
          type: 'hook',
          hookName: 'PreToolUse:Bash',
        },
      }),
    ).toBe('permission-rule')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'Blocked by auto-mode',
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: 'dangerous action',
        },
      }),
    ).toBe('automode-blocked')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'No verdict',
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: 'parse error',
          noVerdict: true,
        },
      }),
    ).toBe('automode-parsing-error')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'Unavailable',
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: 'Classifier unavailable',
        },
      }),
    ).toBe('automode-unavailable')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'Stopped',
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: AUTO_MODE_UNAVAILABLE_STOP_REASON,
        },
      }),
    ).toBe('automode-unavailable')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'Cancelled',
        decisionReason: {
          type: 'other',
          reason: 'Cancelled at the classifier billing notice',
        },
      }),
    ).toBe('user-rejected')

    expect(
      deriveToolDenialKind({
        behavior: 'deny',
        message: 'Held back',
        decisionReason: {
          type: 'other',
          reason: 'tool permission request held back for a queued message',
        },
      }),
    ).toBe('cancelled')

    expect(
      deriveToolDenialUnanswered({
        behavior: 'deny',
        message: 'Stream closed',
        decisionReason: {
          type: 'other',
          reason: 'tool permission stream closed before response received',
        },
      }),
    ).toBe('stream-closed')

    expect(
      decisionHoldsPersonsWords({
        behavior: 'ask',
        message: 'Rejected',
        userFeedback: 'please use grep',
      } as PermissionDecision),
    ).toBe(true)

    expect(
      decisionHoldsPersonsWords({
        behavior: 'deny',
        message: `${REJECT_MESSAGE_WITH_REASON_PREFIX}don't touch prod`,
        decisionReason: { type: 'other', reason: 'user' },
      }),
    ).toBe(true)

    const bgAc = new AbortController()
    bgAc.abort(createAbortErrorReason('background'))
    expect(deriveToolErrorDenialKind(new AbortError(), bgAc.signal)).toBe(
      'cancelled',
    )
    expect(
      deriveToolErrorDenialKind(
        new ShellError('', '', 130, true),
        new AbortController().signal,
      ),
    ).toBe('interrupted')
    expect(
      deriveToolErrorDenialKind(
        new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
          'denied',
          'ccr_proxy_needs_approval_denied',
        ),
        new AbortController().signal,
      ),
    ).toBe('permission-rule')
    expect(
      deriveToolErrorDenialKind(
        new Error('ordinary failure'),
        new AbortController().signal,
      ),
    ).toBeUndefined()
  })

  test('endsTurn deny stamps denial metadata and aborts turn with permission-stop without clobbering result in StreamingToolExecutor', async () => {
    const tool1 = makeTool({
      name: 'Write',
      concurrencySafe: false,
      call: async () => ({ data: 'should not run' }),
    })
    const tool2 = makeTool({
      name: 'Read',
      concurrencySafe: false,
      call: async () => ({ data: 'should also not run' }),
    })
    const ctx = makeContext([tool1, tool2])
    const canUseTool: CanUseToolFn = async () =>
      ({
        behavior: 'deny',
        message: 'Blocked by safety monitor',
        endsTurn: true,
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: 'dangerous exfiltration',
          monitorBlocked: true,
        },
      }) as PermissionDecision

    const executor = new StreamingToolExecutor([tool1, tool2], canUseTool, ctx)
    const assistant = createAssistantMessage({ content: [] })

    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-deny-1',
        name: 'Write',
        input: { value: 'a' },
        caller: { type: 'direct' },
      },
      assistant,
    )
    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-queued-2',
        name: 'Read',
        input: { value: 'b' },
        caller: { type: 'direct' },
      },
      assistant,
    )

    const userMessages: UserMessage[] = []
    for await (const update of executor.getRemainingResults()) {
      if (update.message?.type === 'user') {
        userMessages.push(update.message as UserMessage)
      }
    }

    expect(ctx.abortController.signal.aborted).toBe(true)
    expect(getAbortReasonMessage(ctx.abortController.signal.reason)).toBe(
      'permission-stop',
    )
    expect(userMessages).toHaveLength(2)

    const first = userMessages[0]!
    expect(first.toolDenialKind).toBe('automode-blocked')
    expect(first.toolDenialEndsTurn).toBe(true)
    expect(first.toolDenialMonitorBlocked).toBe(true)

    const second = userMessages[1]!
    expect(second.toolDenialKind).toBe('cancelled')
  })

  test('ask rejection stamps userFeedback, holdsPersonsWords, and toolDenialKind: user-rejected', async () => {
    const tool = makeTool({
      name: 'Edit',
      concurrencySafe: false,
      call: async () => ({ data: 'unused' }),
    })
    const ctx = makeContext([tool])
    const canUseTool: CanUseToolFn = async () => ({
      behavior: 'ask',
      message: `${REJECT_MESSAGE_WITH_REASON_PREFIX}keep the old signature`,
      userFeedback: 'keep the old signature',
    })

    const messages: UserMessage[] = []
    for await (const update of runToolUse(
      {
        type: 'tool_use',
        id: 'tu-ask-1',
        name: 'Edit',
        input: { value: 'x' },
        caller: { type: 'direct' },
      },
      createAssistantMessage({ content: [] }),
      canUseTool,
      ctx,
    )) {
      if (!isToolBridgeEvent(update) && update.message.type === 'user') {
        messages.push(update.message as UserMessage)
      }
    }

    expect(messages).toHaveLength(1)
    expect(messages[0]?.toolDenialKind).toBe('user-rejected')
    expect(messages[0]?.userFeedback).toBe('keep the old signature')
    expect(messages[0]?.holdsPersonsWords).toBe(true)
  })

  test('AbortError in tool.call stamps toolDenialKind: interrupted', async () => {
    const tool = makeTool({
      name: 'Bash',
      concurrencySafe: false,
      call: async () => {
        throw new AbortError('interrupted')
      },
    })
    const ctx = makeContext([tool])
    const messages: UserMessage[] = []
    for await (const update of runToolUse(
      {
        type: 'tool_use',
        id: 'tu-abort-1',
        name: 'Bash',
        input: { value: 'sleep 10' },
        caller: { type: 'direct' },
      },
      createAssistantMessage({ content: [] }),
      allowAll,
      ctx,
    )) {
      if (!isToolBridgeEvent(update) && update.message.type === 'user') {
        messages.push(update.message as UserMessage)
      }
    }

    expect(messages).toHaveLength(1)
    expect(messages[0]?.toolDenialKind).toBe('interrupted')
  })
})

describe('[P2] Tool execution & hook edge-case fixes', () => {
  test('remote-cancel does NOT suppress synthetic tool_results in StreamingToolExecutor', async () => {
    const tool = makeTool({
      name: 'Bash',
      concurrencySafe: false,
      call: async () => ({ data: 'never' }),
    })
    const ctx = makeContext([tool])
    ctx.abortController.abort(createAbortErrorReason('remote-cancel'))
    const executor = new StreamingToolExecutor([tool], allowAll, ctx)
    executor.addTool(
      {
        type: 'tool_use',
        id: 'tu-rc-1',
        name: 'Bash',
        input: { value: 'echo hi' },
        caller: { type: 'direct' },
      },
      createAssistantMessage({ content: [] }),
    )

    const userMessages: UserMessage[] = []
    for await (const update of executor.getRemainingResults()) {
      if (update.message?.type === 'user') {
        userMessages.push(update.message as UserMessage)
      }
    }
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]?.toolDenialKind).toBe('user-rejected')
    expect(userMessages[0]?.toolDenialBeforeRun).toBe(true)

    // When stopped while running on remote-cancel, uses STOPPED_WHILE_RUNNING_REJECT_MESSAGE
    const runningSynthetic = (
      executor as unknown as {
        createSyntheticErrorMessage: (
          id: string,
          reason: 'user_interrupted',
          msg: ReturnType<typeof createAssistantMessage>,
          wasRunning: boolean,
        ) => UserMessage
      }
    ).createSyntheticErrorMessage(
      'tu-rc-2',
      'user_interrupted',
      createAssistantMessage({ content: [] }),
      true,
    )
    const contentBlocks = runningSynthetic.message.content as Array<{
      content?: string
    }>
    expect(contentBlocks[0]?.content).toContain(
      STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
    )
    expect(runningSynthetic.toolDenialKind).toBe('user-rejected')
  })

  test('PermissionDenied hook consumer catches ControlStreamClosedError and rethrows other errors', async () => {
    const executionSource = readFileSync(
      new URL('../toolExecution.ts', import.meta.url),
      'utf8',
    )
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const start = executionSource.indexOf(
      '    // If a hook returns {retry: true}',
    )
    const end = executionSource.indexOf('\n    return resultingMessages', start)
    const body = executionSource.slice(start, end)
    const debugLogs: string[] = []

    const runWithError = async (errToThrow: Error) => {
      const messages: unknown[] = []
      const run = runInNewContext(
        transpiler.transformSync('async function consume() {' + body + '}') +
          '\nconsume',
        {
          feature: () => true,
          ControlStreamClosedError,
          logForDebugging: (msg: string) => debugLogs.push(msg),
          createAbortErrorReason,
          permissionDecision: {
            behavior: 'deny',
            decisionReason: {
              type: 'classifier',
              classifier: 'auto-mode',
              reason: 'blocked',
            },
          },
          executePermissionDeniedHooks: async function* () {
            if (false) yield { retry: false }
            throw errToThrow
          },
          tool: { name: 'Bash' },
          toolUseID: 'tu-pd-1',
          processedInput: {},
          toolUseContext: makeContext(),
          permissionMode: 'auto',
          resultingMessages: messages,
          createUserMessage,
        },
      )
      await run()
      return messages
    }

    const closedMessages = await runWithError(
      new ControlStreamClosedError('closed'),
    )
    expect(closedMessages).toEqual([])
    expect(
      debugLogs.some(m =>
        m.includes('PermissionDenied hooks cancelled (control stream closed)'),
      ),
    ).toBe(true)

    await expect(runWithError(new Error('unexpected failure'))).rejects.toThrow(
      'unexpected failure',
    )
  })

  test('result.newMessages stamps turnCompanion: true on user messages only', async () => {
    const companionUser = createUserMessage({ content: 'extra context' })
    const attachmentMsg = createAttachmentMessage({
      type: 'hook_success',
      hookName: 'test',
      toolUseID: 'tu-nm-1',
      hookEvent: 'PostToolUse',
      content: '',
    })
    const tool = makeTool({
      name: 'NewMsgTool',
      concurrencySafe: true,
      call: async () => ({
        data: 'ok',
        newMessages: [companionUser, attachmentMsg as unknown as UserMessage],
      }),
    })
    const ctx = makeContext([tool])

    const collected: Array<{ type: string; turnCompanion?: unknown }> = []
    for await (const update of runToolUse(
      {
        type: 'tool_use',
        id: 'tu-nm-1',
        name: 'NewMsgTool',
        input: {},
        caller: { type: 'direct' },
      },
      createAssistantMessage({ content: [] }),
      allowAll,
      ctx,
    )) {
      if ('message' in update) {
        collected.push(
          update.message as { type: string; turnCompanion?: unknown },
        )
      }
    }

    const extraUser = collected.find(
      m =>
        m.type === 'user' &&
        (m as UserMessage).message?.content === 'extra context',
    )
    expect(extraUser?.turnCompanion).toBe(true)
    const extraAttachment = collected.find(m => m.type === 'attachment')
    expect(extraAttachment?.turnCompanion).toBeUndefined()
  })

  test('PreToolUse additionalContext is suppressed inside delegated-observation subagents', async () => {
    const tool = makeTool({
      name: 'ObsTool',
      concurrencySafe: true,
      call: async () => ({ data: 'done' }),
    })

    const runWithHook = async (delegatedObservation: boolean) => {
      const sessionHooks = new Map([
        [
          'subagent-obs',
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: 'ObsTool',
                  hooks: [
                    {
                      hook: {
                        type: 'callback' as const,
                        callback: async () => ({
                          hookSpecificOutput: {
                            hookEventName: 'PreToolUse' as const,
                            additionalContext: 'injected context',
                          },
                        }),
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      ])
      const ctx = makeContext([tool], {
        agentId: 'subagent-obs' as ToolUseContext['agentId'],
        options: {
          ...makeContext([tool]).options,
          settingsHooksOff: false,
        },
        getAppState: () =>
          ({
            toolPermissionContext: {
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            },
            sessionHooks,
            mcp: { clients: [] },
            tasks: {},
          }) as any,
      })

      const additionalContexts: string[] = []
      await runWithAgentContext(
        {
          agentType: 'subagent',
          agentId: 'subagent-obs',
          delegatedObservation,
        },
        async () => {
          for await (const update of runToolUse(
            {
              type: 'tool_use',
              id: `tu-obs-${delegatedObservation}`,
              name: 'ObsTool',
              input: {},
              caller: { type: 'direct' },
            },
            createAssistantMessage({ content: [] }),
            allowAll,
            ctx,
          )) {
            if (
              !isToolBridgeEvent(update) &&
              update.message.type === 'attachment' &&
              update.message.attachment?.type === 'hook_additional_context'
            ) {
              additionalContexts.push(JSON.stringify(update.message.attachment))
            }
          }
        },
      )
      return additionalContexts
    }

    expect(await runWithHook(false)).toHaveLength(1)
    expect(await runWithHook(true)).toHaveLength(0)
  })

  test('executeTeammateIdleHooks accepts optional toolUseContext and includes agent_id/agent_type', async () => {
    const capturedInputs: Array<Record<string, unknown>> = []
    const sessionHooks = new Map([
      [
        'teammate-42',
        {
          hooks: {
            TeammateIdle: [
              {
                matcher: '*',
                hooks: [
                  {
                    hook: {
                      type: 'callback' as const,
                      callback: async (input: Record<string, unknown>) => {
                        capturedInputs.push(input)
                        return {}
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    ])
    const ctx = makeContext([], {
      agentId: 'teammate-42' as ToolUseContext['agentId'],
      agentType: 'researcher',
      getAppState: () =>
        ({
          toolPermissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
          sessionHooks,
          mcp: { clients: [] },
          tasks: {},
        }) as any,
    })

    for await (const _res of executeTeammateIdleHooks(
      'alice',
      'alpha-team',
      'default',
      undefined,
      5000,
      ctx,
    )) {
      // drain
    }

    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0]?.hook_event_name).toBe('TeammateIdle')
    expect(capturedInputs[0]?.teammate_name).toBe('alice')
    expect(capturedInputs[0]?.team_name).toBe('alpha-team')
    expect(capturedInputs[0]?.agent_id).toBe('teammate-42')
    expect(capturedInputs[0]?.agent_type).toBe('researcher')
  })

  test('executeStopHooks sets skipSessionFunctionHooks only when stopPass is neither turn_end nor turn_end_reactions', async () => {
    const hooksSource = [
      '../../../utils/hooks.ts',
      '../../../utils/hooks/hookCore.ts',
      '../../../utils/hooks/hookShellRunner.ts',
      '../../../utils/hooks/hookOutputProcessor.ts',
      '../../../utils/hooks/hookConfigRegistry.ts',
      '../../../utils/hooks/hookModelSlotPool.ts',
      '../../../utils/hooks/hookEngine.ts',
      '../../../utils/hooks/hookEntryExecutor.ts',
      '../../../utils/hooks/hookOutsideReplEngine.ts',
      '../../../utils/hooks/hookToolEvents.ts',
      '../../../utils/hooks/hookSessionAndPromptEvents.ts',
      '../../../utils/hooks/hookLifecycleEvents.ts',
    ]
      .map(rel => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .join('\n')
    const start = hooksSource.indexOf(
      'export async function* executeStopHooks(',
    )
    const end = hooksSource.indexOf(
      'export async function* executeTeammateIdleHooks(',
      start,
    )
    const slice = hooksSource.slice(start, end)
    expect(slice).toContain(
      "skipSessionFunctionHooks:\n      stopPass !== 'turn_end' && stopPass !== 'turn_end_reactions'",
    )

    // Verify live Stop hook invocation with stopPass = 'turn_end' runs session function hooks
    // while 'blockable_turn_end' skips them.
    let fnHookRuns = 0
    const makeStopCtx = () => {
      const sessionHooks = new Map([
        [
          'stop-agent-1',
          {
            hooks: {
              Stop: [
                {
                  matcher: '*',
                  hooks: [
                    {
                      hook: {
                        type: 'function' as const,
                        callback: async () => {
                          fnHookRuns++
                          return true
                        },
                        errorMessage: 'blocked',
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      ])
      return makeContext([], {
        agentId: 'stop-agent-1' as ToolUseContext['agentId'],
        getAppState: () =>
          ({
            toolPermissionContext: {
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            },
            sessionHooks,
            mcp: { clients: [] },
            tasks: {},
          }) as any,
      })
    }

    for await (const _r of executeStopHooks(
      'default',
      undefined,
      5000,
      false,
      undefined,
      makeStopCtx(),
      [],
      undefined,
      undefined,
      'turn_end',
    )) {
      // drain
    }
    expect(fnHookRuns).toBe(1)

    for await (const _r of executeStopHooks(
      'default',
      undefined,
      5000,
      false,
      undefined,
      makeStopCtx(),
      [],
      undefined,
      undefined,
      'blockable_turn_end',
    )) {
      // drain
    }
    expect(fnHookRuns).toBe(1)
  })
})
