/**
 * Official 2.1.331 ReadNotificationsTool (`Lt` / `rS`).
 *
 * Reads queued session notifications (webhooks, scheduled triggers, peer
 * session messages) oldest-first, marks them delivered, and reports how many
 * remain queued.
 */

import { z } from 'zod/v4'
import {
  getIsNonInteractiveSession,
  isReplBridgeActive,
} from 'src/bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  buildTool,
  resolveToolUseContext,
  type ToolDef,
  type ToolDeps,
  type ToolResultBlockParam,
  type ToolUseContext,
} from 'src/Tool.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  READ_NOTIFICATIONS_GB_FLAG,
  READ_NOTIFICATIONS_MAX_RESULT_CHARS,
  READ_NOTIFICATIONS_TOOL_NAME,
} from './constants.js'
import {
  formatReadNotificationsResult,
  getDefaultQueuedNotificationsRegistry,
  type QueuedNotificationsRegistry,
} from './notificationQueue.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>
export type ReadNotificationsInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    notifications: z.array(
      z.object({
        notification_id: z
          .string()
          .describe(
            'Server-assigned stable id — the dedup key across redeliveries.',
          ),
        origin: z
          .string()
          .describe(
            'Server-attested source token: "github_webhook" | "trigger_fire" | "mcp_send_message" (open set; unknown well-formed tokens pass through verbatim, off-grammar values coerce to "unknown").',
          ),
        queued_at: z
          .string()
          .describe('RFC3339 timestamp of when the backend queued it.'),
        content: z.string().describe('Verbatim notification body.'),
        arrived_at: z
          .string()
          .optional()
          .describe(
            "RFC3339 timestamp, by this machine's clock, of when the notification reached this session's queue. Missing from results saved before this field existed.",
          ),
      }),
    ),
    remaining: z
      .number()
      .describe(
        'Notifications still queued after this drain (drains are size-budgeted); call the tool again to read them.',
      ),
    read_at: z
      .string()
      .optional()
      .describe(
        "RFC3339 timestamp, by this machine's clock, of when this call read the queue. Missing from results saved before this field existed.",
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ReadNotificationsOutput = z.infer<OutputSchema>

type ContextWithNotificationRegistry = ToolUseContext & {
  queuedNotificationsRegistry?: QueuedNotificationsRegistry
}

/**
 * Official `_Ft()` gate:
 * enabled in non-interactive remote sessions (`CLAUDE_CODE_REMOTE` && nonInteractive),
 * or when REPL bridge is active and GB `tengu_saffron_kite` (default true) is on.
 */
export function isReadNotificationsEnabled(opts?: {
  env?: NodeJS.ProcessEnv
  isNonInteractive?: boolean
  replBridgeActive?: boolean
  readFeature?: (key: string, fallback: boolean) => boolean
}): boolean {
  const env = opts?.env ?? process.env
  const isRemote = isEnvTruthy(env.CLAUDE_CODE_REMOTE)
  const isNonInteractive =
    opts?.isNonInteractive ?? getIsNonInteractiveSession()
  if (isRemote && isNonInteractive) {
    return true
  }
  const bridgeActive = opts?.replBridgeActive ?? isReplBridgeActive()
  if (!bridgeActive) {
    return false
  }
  const readFeature =
    opts?.readFeature ??
    ((key: string, fallback: boolean) =>
      getFeatureValue_CACHED_MAY_BE_STALE(key, fallback))
  return readFeature(READ_NOTIFICATIONS_GB_FLAG, true) === true
}

export const ReadNotificationsTool = buildTool({
  name: READ_NOTIFICATIONS_TOOL_NAME,
  searchHint: 'read queued external notifications (webhooks, triggers)',
  backgrounding: 'never',
  shouldDefer: false,
  maxResultSizeChars: READ_NOTIFICATIONS_MAX_RESULT_CHARS,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    return isReadNotificationsEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  toAutoClassifierInput() {
    return 'read queued notifications'
  },

  renderToolUseMessage() {
    return ''
  },

  extractSearchText(output: ReadNotificationsOutput) {
    return output.notifications.map(n => n.content).join('\n')
  },

  create(deps: ToolDeps) {
    return {
      async call(_input: ReadNotificationsInput, callCtx) {
        if (deps.agentId !== undefined) {
          throw new Error(
            'ReadNotifications can only be called from the main conversation — subagents must not drain the session notification buffer.',
          )
        }

        const readAt = new Date().toISOString()
        const ctx = resolveToolUseContext(deps, callCtx)
        const registry =
          (ctx as ContextWithNotificationRegistry)
            .queuedNotificationsRegistry ??
          getDefaultQueuedNotificationsRegistry()

        const { notifications, remaining } = registry.drain()

        return {
          data: {
            notifications: notifications.map(n => ({
              notification_id: n.notificationId,
              origin: n.origin,
              queued_at: n.queuedAt,
              content: n.content,
              ...(n.arrivedAt !== undefined ? { arrived_at: n.arrivedAt } : {}),
            })),
            remaining,
            read_at: readAt,
          },
        }
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    output: ReadNotificationsOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formatReadNotificationsResult(
        output.notifications,
        output.remaining,
        output.read_at,
      ),
    }
  },
} satisfies ToolDef<InputSchema, ReadNotificationsOutput>)
