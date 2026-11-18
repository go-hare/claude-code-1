import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isBridgeEnabled } from 'src/bridge/bridgeEnabled.js'
import { getGlobalConfig } from 'src/utils/config.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { shouldSuppressPushForUserPresence } from 'src/utils/residualUiEnvGates.js'

const PUSH_NOTIFICATION_TOOL_NAME = 'PushNotification'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().describe('Title of the push notification.'),
    body: z.string().describe('Body text of the push notification.'),
    priority: z
      .enum(['normal', 'high'])
      .optional()
      .describe(
        'Notification priority. Use "high" for blockers or permission prompts.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type PushInput = z.infer<InputSchema>

type PushDisabledReason = 'config_off' | 'user_present' | 'no_transport'

type PushOutput = {
  sent: boolean
  pushSent?: boolean
  localSent?: boolean
  disabledReason?: PushDisabledReason
  error?: string
}

export const PushNotificationTool = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  searchHint: 'push notification mobile alert notify user',
  maxResultSizeChars: 1_000,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  async description() {
    return "Send a push notification to the user's mobile device"
  },
  async prompt() {
    return `Send a push notification to the user's mobile device via Remote Control.

Use this when:
- A long-running task completes and the user may not be watching
- A permission prompt is waiting and you need user input
- Something urgent requires the user's attention

Requires Remote Control to be configured. Respects user notification settings (taskCompleteNotifEnabled, inputNeededNotifEnabled, agentPushNotifEnabled).`
  },

  isEnabled() {
    return isBridgeEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },

  userFacingName() {
    return 'Notify'
  },

  renderToolUseMessage(input: Partial<PushInput>) {
    return `Push: ${input.title ?? '...'}`
  },

  mapToolResultToToolResultBlockParam(
    content: PushOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    let text: string
    if (content.disabledReason === 'config_off') {
      text = 'Push not sent \u2014 mobile push is disabled in /config.'
    } else if (content.disabledReason === 'user_present') {
      text =
        'Not sent \u2014 this terminal is active, so your output here already reaches the user; a separate notification would be redundant.'
    } else if (content.disabledReason === 'no_transport') {
      text = content.localSent
        ? 'Terminal notification sent. Mobile push not sent (Remote Control inactive).'
        : 'Mobile push not sent (Remote Control inactive).'
    } else if (content.sent || content.pushSent) {
      text = content.localSent
        ? 'Terminal notification sent. Mobile push requested.'
        : 'Mobile push requested.'
    } else {
      text = 'Mobile push not sent (Remote Control inactive).'
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },

  async call(input: PushInput, context) {
    const appState = context.getAppState()
    // Official REMOTE densable.
    let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
    try {
      const { isRemoteEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
      isRemote = isRemoteEnvEnabled()
    } catch {
      // keep raw env fallback
    }

    // Official 2.1.325: c = isRemote || isRemoteControlSession; f = c || replBridgeActive
    const isRemoteControl =
      isRemote ||
      appState.replBridgeExplicit ||
      appState.replBridgeSessionActive
    const hasTransport =
      isRemoteControl ||
      appState.replBridgeEnabled ||
      appState.replBridgeConnected
    const localSent = !context.options?.isNonInteractiveSession

    if (
      hasTransport &&
      !isRemoteControl &&
      getGlobalConfig().agentPushNotifEnabled !== true
    ) {
      return {
        data: {
          sent: false,
          pushSent: false,
          localSent: false,
          disabledReason: 'config_off' as const,
        },
      }
    }

    // Official densable: skip push when user is present (last interaction < 60s)
    // unless CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK or remote / remote-control session (#369).
    if (!isRemoteControl) {
      try {
        const { getLastInteractionTime } = await import(
          'src/bootstrap/state.js'
        )
        if (
          shouldSuppressPushForUserPresence({
            isRemote,
            lastInteractionAgeMs: Date.now() - getLastInteractionTime(),
          })
        ) {
          logForDebugging(
            `[PushNotification] suppressed: user_present (${input.title})`,
          )
          return {
            data: {
              sent: false,
              pushSent: false,
              localSent: false,
              disabledReason: 'user_present' as const,
              error: 'Notification suppressed: user is present.',
            },
          }
        }
      } catch (e) {
        logForDebugging(`[PushNotification] presence check failed: ${e}`)
      }
    }

    if (!hasTransport) {
      logForDebugging(
        `[PushNotification] no transport active, not delivered: ${input.title}`,
      )
      return {
        data: {
          sent: false,
          pushSent: false,
          localSent,
          disabledReason: 'no_transport' as const,
          error:
            'No Remote Control bridge configured. Notification not delivered.',
        },
      }
    }

    // Try bridge delivery (for remote / remote-control / mobile viewers)
    if (hasTransport) {
      if (feature('BRIDGE_MODE')) {
        try {
          const { getBridgeAccessToken, getBridgeBaseUrl } = await import(
            'src/bridge/bridgeConfig.js'
          )
          const { getSessionId } = await import('src/bootstrap/state.js')
          const token = getBridgeAccessToken()
          const sessionId = getSessionId()
          if (token && sessionId) {
            const baseUrl = getBridgeBaseUrl()
            const axios = (await import('axios')).default
            const response = await axios.post(
              `${baseUrl}/v1/sessions/${sessionId}/events`,
              {
                events: [
                  {
                    type: 'push_notification',
                    title: input.title,
                    body: input.body,
                    priority: input.priority ?? 'normal',
                  },
                ],
              },
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  'anthropic-version': '2023-06-01',
                },
                timeout: 10_000,
                validateStatus: (s: number) => s < 500,
              },
            )
            if (response.status >= 200 && response.status < 300) {
              logForDebugging(
                `[PushNotification] delivered via bridge session=${sessionId}`,
              )
              return { data: { sent: true, pushSent: true, localSent } }
            }
            logForDebugging(
              `[PushNotification] bridge delivery failed: status=${response.status}`,
            )
          }
        } catch (e) {
          logForDebugging(`[PushNotification] bridge delivery error: ${e}`)
        }
      }
    }

    // Fallback: no bridge available, push was not delivered to a remote device.
    logForDebugging(
      `[PushNotification] no bridge available, not delivered: ${input.title}`,
    )
    return {
      data: {
        sent: false,
        pushSent: false,
        localSent,
        disabledReason: 'no_transport' as const,
        error:
          'No Remote Control bridge configured. Notification not delivered.',
      },
    }
  },
})
