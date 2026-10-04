/**
 * densable 2.1.283 leftover POST `/v1/code/sessions/${id}/device` retry wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `as` @202317879 retry compositor
 * - `us` @202321401 classify
 * - `ss` busyRetryDelaysMs / `is` transientRetryDelaysMs / `os` deadline
 * - `ts` `Jn` `Xn` `Zn` `Tt` `Yn` `Ft` resource/detail strings
 *
 * Semantic English exports; minify names stay in comments.
 * Signs only via existing Far/`$ar` when `key.sign` is present.
 * No device-key store — missing key is `register`/`no_device_key`.
 */

import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { sleep } from 'src/utils/sleep.js'
import {
  $ar,
  Far,
  k4t,
  tTn,
  type DeviceBindAttestation,
  type DeviceBindKey,
} from './deviceBind.js'
import {
  cannotServeCloudSession,
  nonEmptyServeString,
  prepareLocalServeRegistration,
  readLinkCapabilities,
  registerDeviceForServe,
  type ServeIdentityFail,
  type ServeIdentityOk,
  type ServeIdentityRefusal,
} from './serveIdentity.js'

/** gold `ss` */
export const busyRetryDelaysMs = [
  2000, 4000, 8000, 12000, 15000, 15000, 15000,
] as const

/** gold `is` */
export const transientRetryDelaysMs = [2000, 4000, 8000] as const

/** gold `os` */
export const LINK_DEVICE_RETRY_DEADLINE_MS = 90_000

/** gold `ts` */
export const SESSION_WORKER_BUSY_DETAIL = 'session_worker_busy'
/** gold `Jn` */
export const SESSION_ALREADY_BOUND_ELSEWHERE_DETAIL =
  'session_already_bound_elsewhere'
/** gold `Xn` */
export const DEVICE_NOT_FOUND_RESOURCE = 'device_not_found'
/** gold `Zn` */
export const BIND_ATTESTATION_STALE_RESOURCE = 'bind_attestation_stale'
/** gold `Tt` */
export const LATE_BIND_REFUSED_RESOURCE = 'late_bind_refused'
/** gold `Yn` */
export const TOOL_HOST_GRANT_REFUSED_RESOURCE = 'tool_host_grant_refused'
/** gold `Ft` */
export const TOOL_HOST_PROOF_INVALID_SUBREASON = 'tool_host_proof_invalid'

/** gold `Ht` keys for `ns` @202316159 */
const LINK_REFUSED_SUBREASONS = {
  tool_host_no_live_grant: true,
  tool_host_rebind: true,
  remote_control_disabled: true,
  not_cowork_remote: true,
  trigger_session: true,
  terminal: true,
  grouped: true,
  project_session: true,
  project_session_not_own_cloud_environment: true,
  project_session_trusted_device_org: true,
  routine_pinned: true,
  rc_child: true,
  monorepo_session: true,
  trusted_device_required: true,
  session_unattended: true,
  tool_host_proof_needs_request: true,
  tool_host_proof_invalid: true,
  tool_host_proof_missing: true,
  machine_credential: true,
  config_denied: true,
  session_config_unreadable: true,
  not_in_plan: true,
  tool_host_stream_close_off: true,
  cowork_session: true,
  agent_owned_session: true,
  child_session: true,
  session_kind_refused: true,
} as const

/** gold `ns` */
export function isKnownLinkRefusedSubReason(e: string): boolean {
  return Object.hasOwn(LINK_REFUSED_SUBREASONS, e)
}

export type LinkDeviceHttpResult =
  | { ok: false; reason: string }
  | {
      ok: true
      status: number
      data?: {
        session?: { bound_device_uuid?: unknown }
        error?: {
          resource?: unknown
          sub_reason?: unknown
          details?: unknown
        }
      }
      response: { headers?: Record<string, unknown> }
    }

export type LinkDeviceClassification =
  | { next: 'linked' }
  | { next: 'final'; refusal: ServeIdentityRefusal }
  | { next: 'proof_invalid' }
  | { next: 'busy' }
  | { next: 'transient'; status?: number }
  | { next: 'device_unknown' }

export type LinkDeviceProofSent = {
  form?: 'session_only' | 'v1' | 'v2'
  retriedAsV1: boolean
}

export type LinkDevicePrepared = {
  ok: true
  local: ServeIdentityOk
  registered: { deviceUUID: string; key: unknown }
}

export type LinkDeviceRetrySeams = {
  busyRetryDelaysMs?: readonly number[]
  transientRetryDelaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  sign?: typeof Far
  signRequest?: typeof $ar
  post?: (
    path: string,
    body: Record<string, unknown>,
    credentials: unknown,
  ) => Promise<LinkDeviceHttpResult>
  linkCapabilities?: () => Promise<string[] | undefined>
  forgetRow?: (accountUuid: string, credentials: unknown) => Promise<void>
  servingOff?: () => Promise<string | undefined>
  identity?: () => Promise<
    { ok: true; accountUuid?: string } | { ok: false; error: string }
  >
  register?: (
    accountUuid: string,
    name: string,
    credentials: unknown,
  ) => Promise<{ deviceUUID: string; key: unknown }>
  readCachedRow?: (accountUuid: string) => Promise<string | undefined>
}

export type LinkDeviceRetryOpts = {
  sessionId: string
  orgUuid: string
  credentials?: unknown
  request?: { workId: string; environmentId: string }
  localIdentity?: ServeIdentityOk | ServeIdentityFail
  prepared?: LinkDevicePrepared | ServeIdentityFail
  handsKeyToLaterReaders?: boolean
  seams?: LinkDeviceRetrySeams
  proofSent?: LinkDeviceProofSent
}

export type LinkDeviceRetryOk = {
  ok: true
  deviceId: string
  heldKey?: { accountUuid: string; rowPk: string; key: unknown }
}

function isDeviceBindKey(key: unknown): key is DeviceBindKey {
  return (
    typeof key === 'object' &&
    key !== null &&
    'sign' in key &&
    typeof (key as DeviceBindKey).sign === 'function'
  )
}

type OneShotBindResult =
  | { ok: true }
  | { ok: false; error?: string; status?: number }

export function asLinkDeviceHttpResult(
  posted: LinkDeviceHttpResult | OneShotBindResult,
): LinkDeviceHttpResult {
  if ('response' in posted || 'data' in posted) {
    return posted as LinkDeviceHttpResult
  }
  if (posted.ok) {
    return { ok: true, status: 200, data: {}, response: { headers: {} } }
  }
  if (posted.status !== undefined) {
    return {
      ok: true,
      status: posted.status,
      data: {},
      response: { headers: {} },
    }
  }
  return {
    ok: false,
    reason: posted.error === 'no-auth' ? 'no-auth' : 'egress',
  }
}

async function defaultPost(
  path: string,
  body: Record<string, unknown>,
  credentials: unknown,
): Promise<LinkDeviceHttpResult> {
  const { postSessionDeviceBind } = await import('./cloudSession.js')
  const sessionId = path.match(/\/sessions\/([^/]+)\/device$/)?.[1] ?? ''
  const attestation = body.bind_attestation as
    | { kid?: unknown; signature?: unknown }
    | undefined
  const posted = await postSessionDeviceBind(
    sessionId,
    {
      deviceUUID: String(body.target_device_id ?? ''),
      kid: String(attestation?.kid ?? ''),
      signature: String(attestation?.signature ?? ''),
      issuedAt: String(body.bind_attestation_issued_at ?? ''),
    } satisfies DeviceBindAttestation,
    credentials as { accessToken?: string } | undefined,
  )
  return asLinkDeviceHttpResult(posted)
}

/** gold `us` @202321401 */
export function classifyLinkDeviceResponse(
  result: LinkDeviceHttpResult,
  deviceUUID: string,
): LinkDeviceClassification {
  if (!result.ok) {
    return {
      next: 'final',
      refusal:
        result.reason === 'no-auth'
          ? { kind: 'auth' }
          : { kind: 'local', reason: 'egress' },
    }
  }
  const { status, data } = result
  logForDebugging(
    `[attach-serve] link status=${status} request_id=${String(result.response.headers?.['request-id'] ?? '')}`,
  )
  if (status === 200) {
    const bound = nonEmptyServeString(
      data?.session?.bound_device_uuid,
    )?.toLowerCase()
    return bound === undefined || bound === deviceUUID.toLowerCase()
      ? { next: 'linked' }
      : { next: 'final', refusal: { kind: 'bound_elsewhere' } }
  }
  const resource = nonEmptyServeString(data?.error?.resource)
  const subReason = nonEmptyServeString(data?.error?.sub_reason)
  const details = nonEmptyServeString(data?.error?.details)
  if (status === 409) {
    if (details === SESSION_WORKER_BUSY_DETAIL) return { next: 'busy' }
    if (details === SESSION_ALREADY_BOUND_ELSEWHERE_DETAIL) {
      return { next: 'final', refusal: { kind: 'bound_elsewhere' } }
    }
    return { next: 'final', refusal: { kind: 'unavailable', status } }
  }
  if (status === 403) {
    if (resource === DEVICE_NOT_FOUND_RESOURCE) {
      return { next: 'device_unknown' }
    }
    if (resource === BIND_ATTESTATION_STALE_RESOURCE) {
      return { next: 'final', refusal: { kind: 'clock' } }
    }
    if (
      resource === LATE_BIND_REFUSED_RESOURCE &&
      subReason === TOOL_HOST_PROOF_INVALID_SUBREASON
    ) {
      return { next: 'proof_invalid' }
    }
    if (
      resource === LATE_BIND_REFUSED_RESOURCE ||
      resource === TOOL_HOST_GRANT_REFUSED_RESOURCE
    ) {
      return {
        next: 'final',
        refusal: {
          kind: 'refused',
          subReason:
            subReason !== undefined && isKnownLinkRefusedSubReason(subReason)
              ? subReason
              : 'other',
        },
      }
    }
    return { next: 'final', refusal: { kind: 'refused', subReason: 'other' } }
  }
  if (status === 412) {
    return { next: 'final', refusal: { kind: 'dispatch_disabled' } }
  }
  if (status === 401) return { next: 'final', refusal: { kind: 'auth' } }
  if (status === 404) {
    return { next: 'final', refusal: { kind: 'not_found' } }
  }
  if (status >= 500 || status === 429 || status === 408) {
    return { next: 'transient', status }
  }
  return { next: 'final', refusal: { kind: 'unavailable', status } }
}

/** gold `as` @202317879 */
export async function linkSessionDeviceWithRetry(
  opts: LinkDeviceRetryOpts,
): Promise<LinkDeviceRetryOk | ServeIdentityFail> {
  const {
    sessionId: e,
    orgUuid: n,
    credentials: s,
    request: r,
    localIdentity: h,
    prepared: g,
    handsKeyToLaterReaders: v = false,
    seams: w = {},
  } = opts
  const b = opts.proofSent ?? { form: undefined, retriedAsV1: false }
  const E = await (g ??
    prepareLocalServeRegistration({
      sessionId: e,
      credentials: s,
      localIdentity: h,
      handsKeyToLaterReaders: v,
      seams: w,
    }))
  if (!E.ok) return E
  if (!isDeviceBindKey(E.registered.key)) {
    return cannotServeCloudSession(
      { kind: 'register', reason: 'no_device_key' },
      e,
    )
  }
  const { sessionUuid: D, accountUuid: A } = E.local
  if (A === undefined) {
    return cannotServeCloudSession({ kind: 'local', reason: 'account' }, e)
  }
  let T: { deviceUUID: string; key: DeviceBindKey } = {
    deviceUUID: E.registered.deviceUUID,
    key: E.registered.key,
  }
  const q = w.busyRetryDelaysMs ?? busyRetryDelaysMs
  const L = w.transientRetryDelaysMs ?? transientRetryDelaysMs
  const I = w.sleep ?? sleep
  const U = Date.now() + LINK_DEVICE_RETRY_DEADLINE_MS
  let x = 0
  let z = 0
  let N = false
  let W: string[] | undefined
  if (r !== undefined) {
    try {
      const j = await (w.linkCapabilities ?? readLinkCapabilities)()
      W = j === undefined ? undefined : tTn(j)
    } catch (j) {
      logForDebugging(
        `[attach-serve] could not read what this computer declares on a link; declaring nothing: ${errorMessage(j)}`,
      )
    }
  }
  for (;;) {
    let j: DeviceBindAttestation
    try {
      const F = {
        orgUuid: n,
        accountUuid: A,
        sessionUuid: D,
        deviceUUID: T.deviceUUID,
        key: T.key,
      }
      j =
        r === undefined
          ? await (w.sign ?? Far)(F)
          : await (w.signRequest ?? $ar)({
              ...F,
              request: r,
              ...(W !== undefined && { capabilities: W }),
            })
      b.form = r === undefined ? 'session_only' : W === undefined ? 'v1' : 'v2'
    } catch (F) {
      logForDebugging(
        `[attach-serve] signing the link proof failed: ${errorMessage(F)}`,
      )
      return cannotServeCloudSession({ kind: 'register', reason: 'sign' }, e)
    }
    const K = await Promise.resolve()
      .then(() =>
        (w.post ?? defaultPost)(
          `/v1/code/sessions/${e}/device`,
          {
            target_device_id: j.deviceUUID,
            bind_attestation: { kid: j.kid, signature: j.signature },
            bind_attestation_issued_at: j.issuedAt,
            ...(W !== undefined && { capabilities: W }),
          },
          s,
        ),
      )
      .then(
        F => ({ result: F }),
        F => ({ error: F }),
      )
    const Z =
      'error' in K
        ? { next: 'transient' as const, status: undefined }
        : classifyLinkDeviceResponse(
            asLinkDeviceHttpResult(K.result),
            T.deviceUUID,
          )
    switch (Z.next) {
      case 'linked':
        return {
          ok: true,
          deviceId: T.deviceUUID,
          ...(v && {
            heldKey: {
              accountUuid: A,
              rowPk: T.deviceUUID.toLowerCase(),
              key: T.key,
            },
          }),
        }
      case 'final':
        return cannotServeCloudSession(Z.refusal, e)
      case 'proof_invalid': {
        if (W === undefined) {
          return cannotServeCloudSession(
            { kind: 'refused', subReason: TOOL_HOST_PROOF_INVALID_SUBREASON },
            e,
          )
        }
        W = undefined
        b.retriedAsV1 = true
        logForDebugging(
          '[attach-serve] the service did not take the v2 link proof; sending the v1 proof without the capability list',
        )
        continue
      }
      case 'busy': {
        const F = q[x]
        if (F === undefined || Date.now() + F > U) {
          return cannotServeCloudSession({ kind: 'busy' }, e)
        }
        x += 1
        logForDebugging(
          `[attach-serve] session busy; retrying the link in ${F} ms (${x}/${q.length})`,
        )
        await I(F)
        continue
      }
      case 'transient': {
        const F = L[z]
        if (F === undefined) {
          return cannotServeCloudSession(
            { kind: 'unavailable', status: Z.status },
            e,
          )
        }
        z += 1
        logForDebugging(
          `[attach-serve] link request failed transiently (status ${Z.status ?? 'none'}: ${'error' in K ? errorMessage(K.error) : 'server error'}); retrying in ${F} ms`,
        )
        await I(F)
        continue
      }
      case 'device_unknown': {
        if (N) return cannotServeCloudSession({ kind: 'device_unknown' }, e)
        N = true
        await (w.forgetRow ?? k4t)(A, s).catch(F => {
          logForDebugging(
            `[attach-serve] could not forget the cached device row: ${errorMessage(F)}`,
          )
        })
        const registered = await registerDeviceForServe({
          accountUuid: A,
          credentials: s,
          readBack: !v,
          seams: w,
        })
        if (!registered.ok) {
          return cannotServeCloudSession(
            { kind: 'register', reason: registered.reason },
            e,
          )
        }
        if (!isDeviceBindKey(registered.key)) {
          return cannotServeCloudSession(
            { kind: 'register', reason: 'no_device_key' },
            e,
          )
        }
        T = { deviceUUID: registered.deviceUUID, key: registered.key }
        continue
      }
    }
  }
}

/**
 * leftover `Lt` @202316159 — wrap `as` and log unexpected classify/link throw.
 * Gold: `as(...).catch((A)=>(t(\`[attach-serve] link failed unexpectedly: ${l(A)}\`),ee({kind:"unavailable"...})))`.
 * Does not change retry delays.
 */
export async function linkSessionDeviceCaught(
  opts: LinkDeviceRetryOpts,
): Promise<LinkDeviceRetryOk | ServeIdentityFail> {
  try {
    return await linkSessionDeviceWithRetry(opts)
  } catch (err) {
    logForDebugging(
      `[attach-serve] link failed unexpectedly: ${errorMessage(err)}`,
    )
    return cannotServeCloudSession(
      { kind: 'unavailable', status: undefined },
      opts.sessionId,
    )
  }
}
