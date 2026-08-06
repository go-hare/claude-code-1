/**
 * densable 2.1.214 EndConversationTool — extract 1:1 (oty / Nqu).
 *
 * Two-step reflection on main thread; fork no-op; abort reason `end_conversation`;
 * transcript marker `ended-by-model`; AppState.endedByModel for interactive.
 */

import { z } from 'zod/v4'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getMainLoopModel } from 'src/utils/model/model.js'
import { isEndConversationToolEnabled } from './endConversationGate.js'
import { lastAssistantTurnCalledEndConversation } from './lastAssistantTurnCalledEndConversation.js'
import {
  DESCRIPTION,
  END_CONVERSATION_FINAL_MESSAGE,
  END_CONVERSATION_FORK_REFLECTION_PROMPT,
  END_CONVERSATION_TOOL_NAME,
  END_CONVERSATION_TOOL_RESULT,
  getEndConversationDescription,
  getEndConversationReflectionPrompt,
} from './prompt.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>
type EndConversationInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    ended: z.boolean(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type EndConversationOutput = z.infer<OutputSchema>

function endConversationSurface(
  isNonInteractive: boolean,
  isFork: boolean,
): 'fork' | 'print' | 'repl' {
  if (isFork) return 'fork'
  if (isNonInteractive) return 'print'
  return 'repl'
}

export const EndConversationTool = buildTool({
  name: END_CONVERSATION_TOOL_NAME,
  // densable: shouldDefer:!0
  shouldDefer: true,
  searchHint:
    'end the conversation — only for sustained user abuse, or when the user explicitly asks to see it demonstrated',
  maxResultSizeChars: 10_000,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getEndConversationDescription()
  },

  userFacingName() {
    return END_CONVERSATION_TOOL_NAME
  },

  isEnabled() {
    // densable: let e=aWn(); return e!==void 0&&_fo(e)
    // aWn is getMainLoopModel — always a string here; gate handles the rest.
    const model = getMainLoopModel()
    return model !== undefined && isEndConversationToolEnabled(model)
  },

  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return false
  },

  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },

  toAutoClassifierInput() {
    return ''
  },

  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam(
    content: EndConversationOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.message,
    }
  },

  async call(_input: EndConversationInput, context) {
    const isNonInteractive = context.options.isNonInteractiveSession
    const isFork = Boolean(context.agentId)
    const surface = endConversationSurface(isNonInteractive, isFork)

    // densable fork path: agentId set → no-op reflection
    if (isFork) {
      logEvent('tengu_end_conversation_tool_call', {
        surface:
          surface as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_non_interactive: isNonInteractive,
        phase:
          'reflect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        data: {
          ended: false,
          message: END_CONVERSATION_FORK_REFLECTION_PROMPT,
        },
      }
    }

    // densable first call: reflection, require second EndConversation in same turn
    if (!lastAssistantTurnCalledEndConversation(context.messages)) {
      logEvent('tengu_end_conversation_tool_call', {
        surface:
          surface as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_non_interactive: isNonInteractive,
        phase:
          'reflect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        data: {
          ended: false,
          message: getEndConversationReflectionPrompt(),
        },
      }
    }

    logEvent('tengu_end_conversation_tool_call', {
      surface:
        surface as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      is_non_interactive: isNonInteractive,
      phase:
        'end' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    try {
      const { markSessionEndedByModel } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/sessionStorage.js') as typeof import('src/utils/sessionStorage.js')
      await markSessionEndedByModel(getSessionId())
    } catch (err) {
      logForDebugging(
        `[EndConversation] marker write failed: ${errorMessage(err)}`,
      )
    }

    // densable: t.abortController.abort("end_conversation")
    context.abortController.abort('end_conversation')

    if (isNonInteractive) {
      const { gracefulShutdown } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/gracefulShutdown.js') as typeof import('src/utils/gracefulShutdown.js')
      // densable: o(1,"other",{finalMessage:Sms}) — fire-and-forget exit path
      void gracefulShutdown(1, 'other', {
        finalMessage: END_CONVERSATION_FINAL_MESSAGE,
      })
      return {
        data: {
          ended: true,
          message: END_CONVERSATION_TOOL_RESULT,
        },
      }
    }

    context.setAppState(prev =>
      prev.endedByModel ? prev : { ...prev, endedByModel: true },
    )
    return {
      data: {
        ended: true,
        message: END_CONVERSATION_TOOL_RESULT,
      },
    }
  },
})
