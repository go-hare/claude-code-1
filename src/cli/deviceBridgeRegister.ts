/**
 * densable 2.1.283 leftover unique wrap — gold `xgt` @200247956 skip chain
 * remaining BODY MAIN skip-wrap is still missing.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `xgt` @200247956 skip: Wd / Moe / bridge+tMr / zbe+org
 * - `i("tengu_device_bridge_started", {account_source, transport, redial:!1, readiness_wait_ms})`
 * - `m("device_bridge_register","trusted_devices_required_or_unknown")`
 * - `e.onNotice?.(Fe, Di["serving_off.bridge_trusted_devices"])` Fe=`served-bridge-trusted-devices`
 * - `mn` @202413064 `(w.startRegistration??xgt)({... onNotice remote-tools})`
 *
 * No WebSocket fleet. Do not emit a connected event (no socket).
 * Do not import cloudSession.ts (cycle / isolation has no thinner overwrite).
 * Callers inject `isCloudEgressAllowed` (Moe) and `resolveBindAccountFromHost` (zbe).
 */

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isViolinWoodEnabled, isViolinWoodEnabledSync } from './violinWood.js'

type AnalyticsString =
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

function c(value: string): AnalyticsString {
  return value as AnalyticsString
}

/** gold `xgt` Moe skip @200247956 */
export const DEVICE_BRIDGE_SKIPPED_EGRESS =
  '[deviceBridge] skipped: non-essential egress disabled, non-first-party provider, or remote sessions policy-denied'

/** gold `xgt` tMr skip @200247956 */
export const DEVICE_BRIDGE_SKIPPED_TRUSTED =
  '[deviceBridge] skipped: the bridge cannot check a device proof and trusted devices are required or unknown'

/** gold `xgt` gate_off @200247956 */
export const DEVICE_BRIDGE_GATE_OFF =
  '[deviceBridge] stopping: the gate turned off'

/**
 * gold Di `serving_off.bridge_trusted_devices` @181891599
 * gold `e.onNotice?.(Fe, Di["serving_off.bridge_trusted_devices"])`
 */
export const SERVING_OFF_BRIDGE_TRUSTED_DEVICES =
  "This computer's tools are not offered to your cloud session over the device bridge. The bridge cannot check a device's proof, and trusted devices may be required for your organization or could not be checked. Remove the off switch for the session channel from your environment to serve over it instead."

/** gold `Fe` @200246265 — first onNotice arg. */
export const SERVED_BRIDGE_TRUSTED_DEVICES_NOTICE =
  'served-bridge-trusted-devices'

export type DeviceBridgeBindAccount =
  | { status: 'missing' }
  | { status: 'mismatch' }
  | { status: 'resolved'; accountUuid: string; source: 'stored' | 'env' }

export type DeviceBridgeNotice = (code: string, message: string) => void

export type DeviceBridgeStartedMeta = {
  account_source: string
  transport: string
  redial: boolean
  readiness_wait_ms: number
}

export type DeviceBridgeRegistrationOpts = {
  sessionId: string
  orgUuid?: string
  transport?: 'bridge' | 'auto'
  isEnabled?: () => Promise<boolean>
  isEgressAllowed?: () => boolean
  isBridgeRefused?: () => boolean
  getAccount?: () => Promise<DeviceBridgeBindAccount>
  isMuted?: () => boolean
  isStillEnabled?: () => boolean
  onNotice?: DeviceBridgeNotice
  readiness?: { whenReady: () => Promise<void> }
}

/** gold `i("tengu_device_bridge_started", …)` fields MAIN skip-wrap still omits. */
export function logDeviceBridgeStarted(meta: DeviceBridgeStartedMeta): void {
  logEvent('tengu_device_bridge_started', {
    account_source: c(meta.account_source),
    transport: c(meta.transport),
    redial: meta.redial as never,
    readiness_wait_ms: meta.readiness_wait_ms as never,
  })
}

/**
 * gold `m("device_bridge_register","trusted_devices_required_or_unknown")`
 * + onNotice Di copy. No socket.
 */
export function noteBridgeTrustedDevicesRequired(
  onNotice?: DeviceBridgeNotice,
): void {
  logEvent('tengu_feature_bad', {
    feature_name: c('device_bridge_register'),
    error_code: c('trusted_devices_required_or_unknown'),
  })
  onNotice?.(
    SERVED_BRIDGE_TRUSTED_DEVICES_NOTICE,
    SERVING_OFF_BRIDGE_TRUSTED_DEVICES,
  )
}

function defaultRemoteToolsNotice(code: string, message: string): void {
  logForDebugging(`[remote-tools] ${code}: ${message}`, { level: 'warn' })
}

async function defaultMissingAccount(): Promise<DeviceBridgeBindAccount> {
  return { status: 'missing' }
}

/**
 * gold `xgt` @200247956 skip-path wrap — no laptop compositor / device-key.
 * Seams: inject `isCloudEgressAllowed` and `resolveBindAccountFromHost`.
 */
export function startDeviceBridgeRegistration(
  opts: DeviceBridgeRegistrationOpts,
): { started: Promise<boolean>; stop: (reason?: string) => Promise<void> } {
  let r = false
  let E = false
  const n = opts.transport ?? 'auto'
  const onNotice = opts.onNotice
  const started = (async () => {
    const readiness = opts.readiness ?? { whenReady: async () => {} }
    const waitStarted = performance.now()
    await readiness.whenReady()
    const U = Math.round(performance.now() - waitStarted)
    const V = await (opts.isEnabled ?? isViolinWoodEnabled)().catch(() => false)
    if (!V) return false
    const T = opts.isEgressAllowed ?? (() => true)
    if (!T()) {
      logForDebugging(DEVICE_BRIDGE_SKIPPED_EGRESS)
      return false
    }
    if (r) return false
    if (n === 'bridge' && (opts.isBridgeRefused ?? (() => false))()) {
      logForDebugging(DEVICE_BRIDGE_SKIPPED_TRUSTED)
      noteBridgeTrustedDevicesRequired(onNotice)
      return false
    }
    const A = await (opts.getAccount ?? defaultMissingAccount)()
    const I = opts.orgUuid
    if (!I || A.status !== 'resolved') {
      logEvent('tengu_device_bridge_skipped', {
        missing_org: (I === undefined) as never,
        missing_account: (A.status === 'missing') as never,
        account_mismatch: (A.status === 'mismatch') as never,
      })
      logForDebugging(
        `[deviceBridge] skipped: ${I ? `account ${A.status}` : 'no org'}`,
      )
      return false
    }
    let re = false
    const L = (opts.isMuted ?? (() => false))()
    if (L !== re) {
      re = L
      logForDebugging(
        `[deviceBridge] serving ${L ? 'muted' : 'unmuted'} by the emergency switch`,
      )
      logEvent('tengu_device_bridge_muted', { muted: L as never })
    }
    const be = opts.isStillEnabled ?? (() => isViolinWoodEnabledSync())
    if (!be()) {
      logForDebugging(DEVICE_BRIDGE_GATE_OFF)
      return false
    }
    if (r) return false
    E = true
    logDeviceBridgeStarted({
      account_source: A.source,
      transport: n,
      redial: false,
      readiness_wait_ms: U,
    })
    return true
  })()
  return {
    started,
    stop: async (reason?: string) => {
      r = true
      if (E) {
        logEvent('tengu_device_bridge_stopped', {
          reason: c(reason ?? 'stop'),
        })
      }
    },
  }
}

/**
 * gold `mn` @202413064 — `(w.startRegistration??xgt)({... onNotice remote-tools})`.
 * Optional onNotice passthrough; default is gold remote-tools warn.
 */
export function startMnDeviceBridgeRegistration(
  opts: Omit<DeviceBridgeRegistrationOpts, 'onNotice'> & {
    onNotice?: DeviceBridgeNotice
    startRegistration?: typeof startDeviceBridgeRegistration
  },
): { started: Promise<boolean>; stop: (reason?: string) => Promise<void> } {
  const start = opts.startRegistration ?? startDeviceBridgeRegistration
  return start({
    ...opts,
    onNotice: opts.onNotice ?? defaultRemoteToolsNotice,
  })
}
