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
    status: z
      .enum(['proactive', 'normal'])
      .optional()
      .describe(
        "Labels intent: 'normal' when replying to what the user just asked; 'proactive' when initiating (scheduled task finished, blocker surfaced, build ready).",
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
  status?: 'proactive' | 'normal'
  deduplicated?: boolean
  disabledReason?: PushDisabledReason
  error?: string
}

const PUSH_DEDUP_WINDOW_MS = 60_000
const recentPushByKey = new Map<string, number>()

const PUSH_SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // PEM private key blocks
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // Anthropic API / OAuth / session keys
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  // Generic sk- keys (OpenAI, Stripe, etc.)
  /\bsk-(?:live|test|proj|svcacct)?-?[A-Za-z0-9_-]{20,}\b/g,
  // GitHub PATs / OAuth tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // AWS access key IDs
  /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // JWTs (header.payload.signature)
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Bearer / Authorization tokens
  /(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  // URL userinfo credentials (scheme://user:pass@host)
  /(\bhttps?:\/\/[^/\s:@]+:)[^/\s@]+(@)/gi,
  // Key/secret/token/password assignments
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd|private[_-]?key)\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
]

/**
 * Official 2.1.326 #237 — mask credentials and secrets in push notification
 * text before delivering over Remote Control / cloud push channels.
 */
export function maskPushNotificationSecrets(text: string): string {
  if (!text) return text
  let masked = text
  for (const pattern of PUSH_SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.source.startsWith('(\\bhttps?')) {
      masked = masked.replace(pattern, '$1[REDACTED]$2')
    } else if (pattern.source.startsWith('(')) {
      masked = masked.replace(pattern, '$1[REDACTED]')
    } else {
      masked = masked.replace(pattern, '[REDACTED]')
    }
  }
  return masked
}

export function _resetPushNotificationDedupForTesting(): void {
  recentPushByKey.clear()
}

export const PushNotificationTool = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  searchHint: 'push notification mobile alert notify user',
  maxResultSizeChars: 1_000,
  shouldDefer: true,
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

    const effectiveStatus = input.status ?? 'normal'
    const dedupKey = `${input.title}\0${input.body}\0${effectiveStatus}`
    const now = Date.now()
    const lastSentAt = recentPushByKey.get(dedupKey)
    if (lastSentAt !== undefined && now - lastSentAt < PUSH_DEDUP_WINDOW_MS) {
      logForDebugging(
        `[PushNotification] suppressed duplicate (${effectiveStatus}): ${input.title}`,
      )
      return {
        data: {
          sent: false,
          pushSent: false,
          localSent: false,
          status: effectiveStatus,
          deduplicated: true,
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
            const maskedTitle = maskPushNotificationSecrets(input.title)
            const maskedBody = maskPushNotificationSecrets(input.body)
            const response = await axios.post(
              `${baseUrl}/v1/sessions/${sessionId}/events`,
              {
                events: [
                  {
                    type: 'push_notification',
                    title: maskedTitle,
                    body: maskedBody,
                    priority: input.priority ?? 'normal',
                    status: effectiveStatus,
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
              recentPushByKey.set(dedupKey, now)
              logForDebugging(
                `[PushNotification] delivered via bridge session=${sessionId}`,
              )
              return {
                data: {
                  sent: true,
                  pushSent: true,
                  localSent,
                  status: effectiveStatus,
                },
              }
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
