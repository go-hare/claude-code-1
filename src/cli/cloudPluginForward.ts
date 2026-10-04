/**
 * densable 2.1.283 leftover wrap — plugin forwarding pack only.
 *
 * Gold minify (`ln` @202406714, `ye` @202409905, `Po` @202410120,
 * `Oo`, `dn` @202409730, `Do` @202409780, `Io` @202409453) in comments.
 * Do not invent a consent store / WBe / device-key.
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'

/** gold `FQn` */
const CLOUD_PLUGIN_CONSENT_PIN_TIMEOUT_MS = 5000

/** gold `Po` kinds */
export type PluginDistrustKind =
  | 'in_launch_dir'
  | 'in_sync_root'
  | 'in_other_root'
  | 'unknown'

export type CloudPluginNoticeLevel = 'warning' | 'notice' | 'debug' | string

export type CloudPluginDialogState = {
  settled: boolean
  answerPending: boolean
}

export type CloudPluginAdmissionOffExtra = {
  /** gold `ye` 5th `h` — report `source` when truthy */
  source?: string
  /** gold `ye` 6th `g` — report `message`, `re(g, 200)` */
  message?: string
}

export type CloudPluginAdmissionOff = {
  feature: 'plugins'
  report: () => {
    state: 'off'
    reason: string
    source?: string
    message?: string
  }
}

export type CloudPluginConsentPinResult =
  | 'accepted'
  | 'declined'
  | 'aborted'
  | 'unreadable'
  | 'unset'

export type CloudPluginConsentClock = {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => () => void
}

export type CloudPluginConsentPinHost = {
  /** Existing pin reader. Not a local settings / device-key store. */
  read: () => Promise<CloudPluginConsentPinResult>
}

/** gold `$Qn` */
const defaultCloudPluginConsentClock: CloudPluginConsentClock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
}

/** gold `re(g, 200)` — length cap on admission copy */
function truncateAdmissionMessage(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max) : text
}

/**
 * gold `ln` optedOut seam:
 * `()=>Boolean(a.CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING)`
 */
export function isCloudPluginForwardingOptedOut(): boolean {
  return Boolean(process.env.CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING)
}

/**
 * leftover `ln` @202406714 unique — keep env optedOut.
 * Gold: `m("ccr_cloud_plugins_forward","read_failed")`.
 */
export function logCcrCloudPluginsForward(errorCode: string): void {
  logEvent('tengu_feature_bad', {
    feature_name:
      'ccr_cloud_plugins_forward' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * gold `ye` @202409905 — `tengu_cloud_plugins_admission`
 * `{admission, source, reattach}`
 */
export function cloudPluginAdmissionOff(
  reason: string,
  admission: string,
  source: string,
  reattach: boolean,
  extra?: CloudPluginAdmissionOffExtra,
): CloudPluginAdmissionOff {
  logEvent('tengu_cloud_plugins_admission', {
    admission:
      admission as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    reattach,
  })
  return {
    feature: 'plugins',
    report: () => ({
      state: 'off',
      reason,
      ...(extra?.source ? { source: extra.source } : {}),
      ...(extra?.message !== undefined
        ? { message: truncateAdmissionMessage(extra.message) }
        : {}),
    }),
  }
}

/**
 * gold `Po` @202410120 — four distrust strings 1:1
 */
export function pluginDistrustCopy(kind: PluginDistrustKind): string {
  switch (kind) {
    case 'in_launch_dir':
      return 'Your plugins are not used in this cloud session: the folder or repository it runs in holds your Claude settings, where that choice is saved, so it could change it. Start it from a folder outside them.'
    case 'in_sync_root':
      return 'Your plugins are not used in this cloud session: the folder it syncs contains your Claude settings, where that choice is saved, so the session could change it. Sync a folder that does not hold them.'
    case 'in_other_root':
      return 'Your plugins are not used in this cloud session: a folder it may write on this machine (an added directory or a settings write grant) holds your Claude settings, so it could change that choice.'
    case 'unknown':
      return 'Your plugins are not used in this cloud session: this machine could not check whether the session is able to change that saved choice from its folder, so the choice is not relied on here.'
  }
}

/**
 * gold `Oo`
 */
export const PLUGIN_FORWARD_UNDECIDED_COPY =
  'Your plugins are not used in cloud sessions from this machine yet: run /cloud-plugins in claude on this machine to decide.'

/** gold `dn` @202409730 — `e.settled&&!e.answerPending` */
export function isDialogSettled(e: CloudPluginDialogState): boolean {
  return e.settled && !e.answerPending
}

/**
 * gold `Do` @202409780
 * warning→warning, notice→info, debug→debug
 */
export function mapCloudNoticeLevel(e: CloudPluginNoticeLevel): string {
  switch (e) {
    case 'warning':
      return 'warning'
    case 'notice':
      return 'info'
    case 'debug':
      return 'debug'
    default:
      return e
  }
}

/**
 * gold `Io` @202409453 — abort / unreadable timeout wrap.
 * Does not invent WBe/Sn/Pn. No pin host → `unreadable`.
 */
export function waitCloudPluginConsentPin(
  pin: CloudPluginConsentPinHost | null | undefined,
  signal: AbortSignal,
  clock: CloudPluginConsentClock = defaultCloudPluginConsentClock,
): Promise<CloudPluginConsentPinResult> {
  if (signal.aborted) return Promise.resolve('aborted')
  const read = pin?.read
  if (read === undefined) return Promise.resolve('unreadable')
  return new Promise(resolve => {
    const onUnreadable = () => resolve('unreadable')
    const onAborted = () => resolve('aborted')
    const cancelTimeout = clock.setTimeout(
      onUnreadable,
      CLOUD_PLUGIN_CONSENT_PIN_TIMEOUT_MS,
    )
    signal.addEventListener('abort', onAborted, { once: true })
    Promise.resolve()
      .then(read)
      .then(resolve, onUnreadable)
      .finally(() => {
        cancelTimeout()
        signal.removeEventListener('abort', onAborted)
      })
  })
}
