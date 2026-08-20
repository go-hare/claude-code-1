import { getGlobalConfig } from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import type { ConnectedMCPServer, MCPServerConnection } from './types.js'
import {
  type AutoDefaultNudgePhase,
  isClaudeVscodeHostSession,
} from './vscodeIdeBridgeCallbacks.js'

/**
 * densable 2.1.235 `uSm` options bag (`t` in SEA).
 * Wired from print.ts call-site.
 */
export type SetupVscodeSdkMcpOptions = {
  onFeedbackSurveyEvent?: (eventData: Record<string, unknown>) => void
  onAutoDefaultNudgeEvent?: (
    phase: AutoDefaultNudgePhase,
    eventData: Record<string, unknown>,
  ) => void
  refusalFallbackLaneEnabled?: boolean
  refusalFallbackSettingToggleVisible?: boolean
  fable5LaunchShow?: boolean
  /** false or JSON string from densable vNh */
  startupAnnouncement?: boolean | string
  autoDefaultLaunchEnabled?: boolean
}

type AutoModeEnabledState = 'enabled' | 'disabled' | 'opt-in'

/**
 * densable `RnT`: read tengu_auto_mode_config.enabled;
 * valid enabled|disabled|opt-in else 'enabled'.
 */
function readAutoModeStateRnT(): AutoModeEnabledState {
  const v = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: string }>(
    'tengu_auto_mode_config',
    {},
  )?.enabled
  return v === 'enabled' || v === 'disabled' || v === 'opt-in' ? v : 'enabled'
}

/**
 * densable write mapping: opt-in → enabled; else passthrough.
 * ALWAYS written onto experiment_gates (no omit-unknown).
 */
function autoModeStateForVscodeGates(): 'enabled' | 'disabled' {
  const o = readAutoModeStateRnT()
  return o === 'opt-in' ? 'enabled' : o
}

/**
 * densable `et(gate, default)` for experiment_gates push.
 * Prefer disk cache; on miss use SEA default (not live GrowthBook false).
 */
function readStatsigGate(gate: string, defaultValue: boolean): boolean {
  try {
    const config = getGlobalConfig()
    const gb = config.cachedGrowthBookFeatures?.[gate]
    if (gb !== undefined) return Boolean(gb)
    const sg = config.cachedStatsigGates?.[gate]
    if (sg !== undefined) return Boolean(sg)
  } catch {
    // config not ready
  }
  // Touch exposure path when GB is live, but keep densable default on miss.
  void checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate)
  try {
    const config = getGlobalConfig()
    const gb = config.cachedGrowthBookFeatures?.[gate]
    if (gb !== undefined) return Boolean(gb)
    const sg = config.cachedStatsigGates?.[gate]
    if (sg !== undefined) return Boolean(sg)
  } catch {
    // ignore
  }
  return defaultValue
}

const LOG_EVENT_METHOD = 'log_event'

/** Params-only schema for v2 setNotificationHandler(method, {params}, …). */
export const LogEventParamsSchema = lazySchema(() =>
  z.object({
    eventName: z.string(),
    eventData: z.object({}).passthrough(),
  }),
)

export const LogEventNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal(LOG_EVENT_METHOD),
    params: LogEventParamsSchema(),
  }),
)

/** densable SEA experiment_gates key set (14). */
export const VSCODE_EXPERIMENT_GATE_KEYS = [
  'tengu_vscode_review_upsell',
  'tengu_cobalt_harbor_notice',
  'tengu_vscode_onboarding',
  'tengu_quiet_fern',
  'tengu_vscode_cc_auth',
  'tengu_slate_ribbon',
  'tengu_brick_follow',
  'tengu_vellum_siding',
  'tengu_loggia_carousel',
  'tengu_loggia_carousel_config',
  'fable5_launch_show',
  'startup_announcement',
  'tengu_harbor_willow',
  'tengu_auto_mode_state',
] as const

// Store the VSCode MCP client reference for sending notifications
let vscodeMcpClient: ConnectedMCPServer | null = null

/** densable j2i once-per-session channel error warn. */
let vscodeChannelErrorLogged = false

/**
 * Sends a file_updated notification to the VSCode MCP server. This is used to
 * notify VSCode when files are edited or written by Claude.
 *
 * densable SEA external binary deadstrips this path (ABSENT). Keep ant-only;
 * not an external product GAP.
 */
export function notifyVscodeFileUpdated(
  filePath: string,
  oldContent: string | null,
  newContent: string | null,
): void {
  if (process.env.USER_TYPE !== 'ant' || !vscodeMcpClient) {
    return
  }

  void vscodeMcpClient.client
    .notification({
      method: 'file_updated',
      params: { filePath, oldContent, newContent },
    })
    .catch((error: Error) => {
      // Do not throw if the notification failed
      logForDebugging(
        `[VSCode] Failed to send file_updated notification: ${error.message}`,
      )
    })
}

function attachVscodeChannelOnError(
  client: ConnectedMCPServer['client'],
): void {
  const previous = client.onerror
  client.onerror = (error: Error) => {
    if (!vscodeChannelErrorLogged) {
      vscodeChannelErrorLogged = true
      try {
        const msg =
          typeof error?.message === 'string' ? error.message : String(error)
        logForDebugging(
          `claude-vscode notification channel error: ${msg}; further channel errors are not logged this session`,
        )
        logEvent('vscode_notification_channel_error', {})
      } catch {
        // ignore
      }
    }
    if (typeof previous === 'function') {
      previous(error)
    }
  }
}

/**
 * densable `uSm` — special internal VSCode MCP for bidirectional notifications.
 */
export function setupVscodeSdkMcp(
  sdkClients: MCPServerConnection[],
  options?: SetupVscodeSdkMcpOptions,
): void {
  const client = sdkClients.find(c => c.name === 'claude-vscode')

  if (client && client.type === 'connected') {
    vscodeMcpClient = client

    // densable/v2: setNotificationHandler(method, {params}, handler)
    client.client.setNotificationHandler(
      LOG_EVENT_METHOD,
      { params: LogEventParamsSchema() },
      async params => {
        const { eventName, eventData } = params
        const data = (eventData ?? {}) as Record<string, unknown>
        const hostOk =
          client.config?.type === 'sdk' && isClaudeVscodeHostSession()

        if (eventName === 'tengu_feedback_survey_event') {
          if (hostOk) {
            options?.onFeedbackSurveyEvent?.(data)
          }
          return
        }
        if (
          eventName === 'auto_default_nudge_shown' ||
          eventName === 'auto_default_nudge_resolved'
        ) {
          if (hostOk) {
            const phase: AutoDefaultNudgePhase =
              eventName === 'auto_default_nudge_shown' ? 'shown' : 'resolved'
            options?.onAutoDefaultNudgeEvent?.(phase, data)
          }
          return
        }

        logEvent(
          `tengu_vscode_${eventName}`,
          data as { [key: string]: boolean | number | undefined },
        )
      },
    )

    attachVscodeChannelOnError(client.client)

    // densable experiment_gates payload (14 keys) — push immediately.
    const gates: Record<string, boolean | string> = {
      tengu_vscode_review_upsell: readStatsigGate(
        'tengu_vscode_review_upsell',
        false,
      ),
      tengu_cobalt_harbor_notice: readStatsigGate(
        'tengu_cobalt_harbor_notice',
        true,
      ),
      tengu_vscode_onboarding: readStatsigGate(
        'tengu_vscode_onboarding',
        false,
      ),
      // SEA hardcodes these three to true on the push path (not GB-read).
      tengu_quiet_fern: true,
      tengu_vscode_cc_auth: true,
      tengu_slate_ribbon: true,
      tengu_brick_follow: readStatsigGate('tengu_brick_follow', false),
      tengu_vellum_siding: readStatsigGate('tengu_vellum_siding', false),
      tengu_loggia_carousel: options?.refusalFallbackLaneEnabled ?? false,
      tengu_loggia_carousel_config:
        options?.refusalFallbackSettingToggleVisible ?? false,
      fable5_launch_show: options?.fable5LaunchShow ?? false,
      startup_announcement: options?.startupAnnouncement ?? false,
      tengu_harbor_willow: options?.autoDefaultLaunchEnabled ?? false,
      tengu_auto_mode_state: autoModeStateForVscodeGates(),
    }

    void client.client
      .notification({
        method: 'experiment_gates',
        params: { gates },
      })
      .catch((error: unknown) => {
        let message = 'unreadable error value'
        try {
          const m =
            error &&
            typeof error === 'object' &&
            'message' in error &&
            typeof (error as { message: unknown }).message === 'string'
              ? (error as { message: string }).message
              : String(error)
          message = m
        } catch {
          // keep default
        }
        logForDebugging(
          `[VSCode] Failed to send experiment_gates notification: ${message}`,
        )
      })
  }
}

/** Test-only: reset module singletons between cases. */
export function resetVscodeSdkMcpForTests(): void {
  vscodeMcpClient = null
  vscodeChannelErrorLogged = false
}
