/**
 * densable 2.1.283 leftover local-serve identity wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `We` @202316964 local serve-link identity
 * - `ee` @202322678 refuse `{ok:false, refusal, message}`
 * - `cs` @202322797 copy
 * - `ps` serving_off lines
 * - `Ht` @202312761 refused subReason
 * - `bge`/`hQ`/`NI` @182143888 local/register reasons
 * - `ze` @202317545 / `xt` @202320372 / `Ut` @202321059
 *
 * Semantic English exports; minify names stay in comments.
 * No device-key store. No invented env for missing device proof. No amati.
 */

import { getOauthAccountInfo } from 'src/utils/auth.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import {
  DeviceRegistrationRevokedError,
  DeviceRegistrationUnavailableError,
  Qwt,
  tTn,
} from './deviceBind.js'
import { servingOffReason } from './servingOff.js'

const CLOUD_SESSION_ID_RE = /^(?:session|cse)_[A-Za-z0-9_]+$/
const ATTACH_SERVE_WORK_ID_RE = /^cse_[A-Za-z0-9_]{1,124}$/
const ATTACH_SERVE_ENV_ID_RE = /^env_[A-Za-z0-9_-]{1,124}$/

/** gold `NI` @182143888 — bind-create skip / local Jwt reasons. */
const BIND_CREATE_REASON_COPY: Record<string, string> = {
  project: 'a --project session cannot be bound yet',
  not_attached: 'this process does not stay attached to the session',
  launched_from_home:
    'launched from your home directory (or above it, or inside a checkout rooted there) — start claude --cloud in a project folder of its own',
  endpoint: 'the new session-create endpoint is off for this client',
  pool: 'self-hosted pool sessions are never bound',
  environment:
    "only sessions in an Anthropic cloud environment can be bound, and this session's environment is not one",
  correlation: 'a session with a correlation id is never bound',
  gate: 'the device feature flag was off or unreadable at create time',
  egress: 'device traffic is disallowed here, or that check failed',
  account: 'no stored claude.ai login on this machine (run /login)',
  account_mismatch:
    "the host's token is for a different account than this machine's (claude /logout)",
  no_device_proof:
    'no trusted-device token here, and this machine was not given one (an organization that does not require trusted devices gives none; otherwise try again, and --debug logs why)',
  trusted_devices_off:
    'trusted devices are not switched on for this account, so this machine has no device token to bind with',
  enrollment_paused:
    'no trusted-device token here, and enrolling new trusted devices is temporarily disabled; try again later',
  register: 'registering this machine as a device failed',
  no_keychain: 'this Mac account has no login keychain to keep a device key in',
  limit_reached: 'this account has reached its device limit',
  registration_unavailable:
    'device registration is unavailable to this account',
  device_revoked:
    "this machine was removed from your account's devices on claude.ai (to register it again, run claude --cloud without -p from a project folder here and choose Yes when asked)",
  sign: 'signing the bind attestation failed',
  create_refused: 'the server refused it (server-side bind flag likely off)',
  target_device_unsupported:
    "the server refused the binding (not turned on for your organization, or not possible in this session's environment)",
  target_device_requires_account:
    'binding needs a claude.ai account login, and this session was created without one',
  invalid_target_device_id:
    "this machine's stored device id is malformed, so the server rejected it",
  bind_attestation_stale: "this machine's clock is too far off",
  untrusted_device: "the server does not trust this machine's device token",
  bound_session_unattested_write:
    'the server refused an initial event or field sent with the bind',
  device_unknown:
    'the server did not recognize this device, even after registering it again',
  silent_drop: 'the server accepted the create but ignored the bind',
}

/** gold `gQ` — attach-binding local reasons. */
const ATTACH_BIND_REASON_COPY: Record<string, string> = {
  session_unreadable:
    'the session could not be read to check its binding (re-attach to retry)',
  other_device:
    'this session is bound to another device (a different machine or config directory)',
  no_device_here: 'this machine holds no device registration for this account',
  local_device_unreadable:
    "this machine's device registration could not be read",
  session_unbound: 'this session was created without a device binding',
  device_tools_off: 'device tools are switched off for this client',
}

/** gold `hQ` = `{...NI, ...gQ}` via `bge`. */
const BIND_REASON_COPY: Record<string, string> = {
  ...BIND_CREATE_REASON_COPY,
  ...ATTACH_BIND_REASON_COPY,
}

/** gold `ps` @202323800 — serving_off lines. */
const SERVING_OFF_COPY: Record<string, string> = {
  external_build: 'this Claude Code cannot serve tools to cloud sessions.',
  windows: 'serving tools from a Windows computer is not available yet.',
  muted:
    'serving tools from this computer is paused right now; try again in a few minutes.',
  switch_off: 'serving tools is switched off on this computer.',
  flag_off:
    'using this computer from cloud sessions is switched off for your account right now.',
  profile_dirs_unread:
    'this computer is still reading where its shell profile lives; try again in a moment.',
  profile_dirs_unreadable:
    'Windows did not say where this computer keeps its profile folders (Documents, AppData, the Start Menu), so its tools are not served; restarting Claude Code tries again.',
  mount_table_unreadable:
    'this computer could not read which Windows drives WSL has mounted (/proc/self/mounts), so it cannot tell where your Windows profile is; try again.',
  launched_from_home:
    'this helper was started from your home directory, which is never served.',
  egress: `${BIND_REASON_COPY.egress}.`,
  policy_org:
    "your organization's policy does not allow using this computer from cloud sessions.",
  channel_off: "this computer's session channel is switched off.",
}

/** gold `Ht` @202312761 — refused subReason (cs appends a period). */
const REFUSED_SUBREASON_COPY: Record<string, string> = {
  tool_host_no_live_grant:
    'that session has no live request to use this computer — it was never made, it expired, it was disconnected, or its feature is off for your organization',
  tool_host_rebind: 'the session is already linked to a different computer',
  remote_control_disabled: 'Remote Control is turned off for your organization',
  not_cowork_remote:
    "that session cannot use a computer (it is not a cloud Claude Code session on Anthropic's cloud, or the feature is off for your organization)",
  trigger_session: 'a scheduled (routine) session cannot use a computer',
  terminal: 'the session has ended',
  grouped: 'a session inside a project cannot be linked to a computer',
  project_session: 'a project session cannot be connected to a computer',
  project_session_not_own_cloud_environment:
    "a project session can use a computer only when its project runs on one of the project owner's own cloud environments",
  project_session_trusted_device_org:
    'a project session cannot use a computer in an organization that requires trusted devices',
  routine_pinned:
    'that session owns a scheduled routine or a pending reminder, and such a session cannot be linked to a computer',
  rc_child: 'that kind of session has no cloud worker to link',
  monorepo_session:
    'that session has a repository checked out that cannot be used from a personal computer',
  trusted_device_required:
    'your organization requires a trusted device and that session was not started from one — start a new session',
  session_unattended: 'a scheduled (routine) session cannot use a computer',
  tool_host_proof_needs_request:
    "this version of the Claude app can't connect to this session again. Update the Claude app on this computer, then ask the session to use this computer again. If there's no update yet, start a new session",
  tool_host_proof_invalid:
    "the service couldn't confirm that this request came from this computer. Ask the session to use this computer again",
  tool_host_proof_missing:
    'the request to connect this computer arrived incomplete. Ask the session to use this computer again',
  machine_credential:
    "a cloud session can't connect itself to a computer. Only the Claude app on your own computer, signed in to your account, can do that",
  config_denied:
    "that session was created with settings that don't allow connecting it to a computer",
  session_config_unreadable:
    "that session's saved settings couldn't be read, so it can't be connected to a computer. Start a new session",
  not_in_plan:
    "your organization's plan doesn't include connecting a computer to that kind of session",
  tool_host_stream_close_off:
    "your organization requires trusted devices, and using a computer from a cloud session isn't available yet for organizations that do. Try again later",
  cowork_session:
    "that's a Cowork task. Cowork connects a task to your computer in its own way, so it can't use a folder on this computer",
  agent_owned_session:
    "that session belongs to an agent rather than to a person's account, and such a session can't use a computer",
  child_session:
    "that session isn't running in the cloud, and only a cloud session can use a folder on this computer",
  session_kind_refused: "that kind of session can't use a folder on a computer",
}

export type ServingOffReason = keyof typeof SERVING_OFF_COPY

export type ServeIdentityRefusal =
  | { kind: 'bad_session_id' }
  | { kind: 'serving_off'; reason: string }
  | { kind: 'local'; reason: string }
  | { kind: 'register'; reason: string }
  | { kind: 'refused'; subReason: string }
  | { kind: 'bound_elsewhere' }
  | { kind: 'busy' }
  | { kind: 'clock' }
  | { kind: 'device_unknown' }
  | { kind: 'dispatch_disabled' }
  | { kind: 'not_found' }
  | { kind: 'auth' }
  | { kind: 'unavailable'; status?: number }

export type ServeIdentityFail = {
  ok: false
  refusal: ServeIdentityRefusal
  message: string
}

export type ServeIdentityOk = {
  ok: true
  sessionUuid: string
  accountUuid?: string
}

/** gold `bge` @182146003 */
export function bindReasonCopy(reason: string): string {
  return BIND_REASON_COPY[reason] ?? reason
}

/** gold `cs` @202322797 */
export function describeServeIdentityRefusal(
  refusal: ServeIdentityRefusal,
): string {
  switch (refusal.kind) {
    case 'local':
    case 'register':
      return `${bindReasonCopy(refusal.reason)}.`
    case 'serving_off':
      return SERVING_OFF_COPY[refusal.reason] ?? refusal.reason
    case 'bad_session_id':
      return 'that is not a cloud session id.'
    case 'refused':
      return refusal.subReason === 'other'
        ? 'the server refused to link the session to this computer.'
        : `${REFUSED_SUBREASON_COPY[refusal.subReason] ?? refusal.subReason}.`
    case 'bound_elsewhere':
      return 'the session is already linked to a different computer.'
    case 'busy':
      return 'the session stayed busy; wait for its current turn to finish (or stop it) and allow again.'
    case 'clock':
      return "this computer's clock is too far off; correct the date and time and allow again."
    case 'device_unknown':
      return "the server does not recognize this computer's device registration, even after registering again."
    case 'dispatch_disabled':
      return 'using your own computer from cloud sessions is switched off for your organization right now.'
    case 'not_found':
      return 'no such session for this account (or the feature is off for your organization).'
    case 'auth':
      return 'this computer is not signed in to claude.ai (run claude /login), or its login expired.'
    case 'unavailable':
      return `the service could not be reached or answered unexpectedly${
        refusal.status !== undefined ? ` (HTTP ${refusal.status})` : ''
      }; try again shortly.`
  }
}

/** gold `ee` @202322678 */
export function cannotServeCloudSession(
  refusal: ServeIdentityRefusal,
  sessionId: string,
): ServeIdentityFail {
  return {
    ok: false,
    refusal,
    message: `Error: cannot serve cloud session ${sessionId} from this computer: ${describeServeIdentityRefusal(refusal)}`,
  }
}

/**
 * gold Yo `U=H.ok||(local&&no_device_proof)` — allow unsigned local wrap.
 * Gold SEA has no env that skips device proof.
 */
export function isLocalServeLinkAllowed(
  ident: ServeIdentityOk | ServeIdentityFail,
): ident is ServeIdentityOk {
  if (ident.ok) return true
  return (
    ident.refusal.kind === 'local' && ident.refusal.reason === 'no_device_proof'
  )
}

/** gold `IL(e)` wrap — session id parse. */
export function parseServeSessionUuid(sessionId: string): string | undefined {
  const r = sessionId.trim()
  return CLOUD_SESSION_ID_RE.test(r) ? r : undefined
}

/** gold `Ut` @202321059 */
export function parseAttachServeRequest(e?: {
  attachServeRequest?: { workId?: string; environmentId?: string }
}): { workId: string; environmentId: string } | undefined {
  const n = e?.attachServeRequest
  if (n === undefined) return
  if (
    typeof n.workId !== 'string' ||
    typeof n.environmentId !== 'string' ||
    !ATTACH_SERVE_WORK_ID_RE.test(n.workId) ||
    !ATTACH_SERVE_ENV_ID_RE.test(n.environmentId)
  ) {
    logForDebugging(
      '[attach-serve] the host named a request for this link but not in a usable form; signing without it',
    )
    return
  }
  return { workId: n.workId, environmentId: n.environmentId }
}

/** gold `Ae` @202321338 */
export function nonEmptyServeString(e: unknown): string | undefined {
  return typeof e === 'string' && e.length > 0 ? e : undefined
}

/**
 * gold `We` @202316964 — local identity. Default identity is stored OAuth
 * accountUuid; cloudSession injects Jwt/`bindPreflight`.
 */
export async function checkLocalServeIdentity(opts: {
  sessionId: string
  credentials?: unknown
  seams?: {
    servingOff?: () => Promise<string | undefined>
    identity?: () => Promise<
      { ok: true; accountUuid?: string } | { ok: false; error: string }
    >
  }
}): Promise<ServeIdentityOk | ServeIdentityFail> {
  const e = opts.sessionId
  try {
    const r = parseServeSessionUuid(e)
    if (r === undefined)
      return cannotServeCloudSession({ kind: 'bad_session_id' }, e)
    const h = await (opts.seams?.servingOff ?? servingOffReason)()
    if (h !== undefined) {
      return cannotServeCloudSession({ kind: 'serving_off', reason: h }, e)
    }
    const v = await (
      opts.seams?.identity ??
      (async () => {
        const accountUuid = getOauthAccountInfo()?.accountUuid
        return accountUuid === undefined
          ? { ok: false as const, error: 'account' }
          : { ok: true as const, accountUuid }
      })
    )()
    if (!v.ok) {
      return cannotServeCloudSession({ kind: 'local', reason: v.error }, e)
    }
    void opts.credentials
    return { ok: true, sessionUuid: r, accountUuid: v.accountUuid }
  } catch (err) {
    logForDebugging(
      `[attach-serve] local check could not examine this computer: ${errorMessage(err)}`,
    )
    return cannotServeCloudSession({ kind: 'unavailable' }, e)
  }
}

/**
 * gold `xt` @202320372 — register wrap. No store → Qwt `no_device_key`.
 * Does not invent a key.
 */
export async function registerDeviceForServe(opts: {
  accountUuid: string
  credentials?: unknown
  readBack?: boolean
  seams?: {
    register?: (
      accountUuid: string,
      name: string,
      credentials: unknown,
    ) => Promise<{ deviceUUID: string; key: unknown }>
    readCachedRow?: (accountUuid: string) => Promise<string | undefined>
  }
}): Promise<
  { ok: true; deviceUUID: string; key: unknown } | { ok: false; reason: string }
> {
  try {
    const register =
      opts.seams?.register ??
      (async (accountUuid: string) =>
        Qwt(accountUuid, undefined, opts.credentials))
    const h = await register(opts.accountUuid, '', opts.credentials)
    const g = opts.readBack
      ? await opts.seams?.readCachedRow?.(opts.accountUuid)
      : h.deviceUUID.toLowerCase()
    if (g !== h.deviceUUID.toLowerCase()) {
      logForDebugging(
        `[attach-serve] registered device row=${h.deviceUUID} ${
          opts.readBack
            ? `but the local store reads ${g ?? 'nothing'}`
            : 'is not a device row id'
        }; not linking`,
      )
      return { ok: false, reason: 'register' }
    }
    return { ok: true, ...h }
  } catch (h) {
    logForDebugging(
      `[attach-serve] device registration failed: ${errorMessage(h)}`,
    )
    const errorClass =
      h instanceof DeviceRegistrationUnavailableError
        ? 'registration_unavailable'
        : h instanceof DeviceRegistrationRevokedError
          ? 'device_revoked'
          : typeof h === 'object' &&
              h !== null &&
              'errorClass' in h &&
              (h as { errorClass?: unknown }).errorClass === 'limit_reached'
            ? 'limit_reached'
            : 'register'
    const reason = errorClass
    return { ok: false, reason }
  }
}

/**
 * gold `ze` @202317545 — We then xt. No key store: xt fails `no_device_key`
 * mapped to register.
 */
export async function prepareLocalServeRegistration(opts: {
  sessionId: string
  credentials?: unknown
  localIdentity?: ServeIdentityOk | ServeIdentityFail
  handsKeyToLaterReaders?: boolean
  seams?: {
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
}): Promise<
  | {
      ok: true
      local: ServeIdentityOk
      registered: { deviceUUID: string; key: unknown }
    }
  | ServeIdentityFail
> {
  const g =
    opts.localIdentity ??
    (await checkLocalServeIdentity({
      sessionId: opts.sessionId,
      credentials: opts.credentials,
      seams: opts.seams,
    }))
  if (!g.ok) return g
  if (g.accountUuid === undefined) {
    return cannotServeCloudSession(
      { kind: 'local', reason: 'account' },
      opts.sessionId,
    )
  }
  const v = await registerDeviceForServe({
    accountUuid: g.accountUuid,
    credentials: opts.credentials,
    readBack: !opts.handsKeyToLaterReaders,
    seams: opts.seams,
  })
  if (!v.ok) {
    return cannotServeCloudSession(
      { kind: 'register', reason: v.reason },
      opts.sessionId,
    )
  }
  return { ok: true, local: g, registered: v }
}

/** gold `hs` @202325161 — link capabilities; no engine → undefined. */
export async function readLinkCapabilities(): Promise<string[] | undefined> {
  return undefined
}

/** gold `tTn` wrap for declared capabilities. */
export function declaredLinkCapabilities(
  capabilities: string[] | undefined,
): string[] | undefined {
  if (capabilities === undefined) return
  return tTn(capabilities)
}
