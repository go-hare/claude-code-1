/**
 * densable 2.1.248 gateway post-login relaunch — official le / inr / snr / LNe / BJe.
 *
 * Gold:
 * - LNe @191433708 `hasPolicyDiverged` — snapshot vs live policySettings
 * - BJe export `capturePolicySnapshot`
 * - inr / snr @205713564 — restarting / ending copy
 * - le @205714164 — flush, bg refuse, wU(c,GC()), then `_G`
 *   extraArgs `[...o5(c,wle(o)),...i5(c,AL())]` env `$B()` (not Yk,
 *   not TUI_JUST_SWITCHED)
 *
 * Wired from /login when clientType==="gateway" after managed-settings fetch
 * fails or policy diverged. Not Yk/#l.
 */

import { isSessionPersistenceDisabled } from '../bootstrap/state.js'
import type { RemoteManagedSettingsFailure } from '../services/remoteManagedSettings/loadStatus.js'
import {
  acceptTuiRelaunch,
  flushStreamsBeforeRelaunchExit,
} from './cliRelaunch.js'
import { isBgSession } from './concurrentSessions.js'
import {
  formatGatewayRelaunchUncarriableRefuseMessage,
  getSessionRelaunchUncarriableReasons,
  type RelaunchPermissionCtx,
} from './sessionRelaunchUncarriable.js'
import { getSettingsForSource } from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'
import { getEmptyToolPermissionContext } from '../Tool.js'

/** densable BJe — policy snapshot captured before gateway managed-settings refresh. */
let policySnapshot: SettingsJson | null | undefined

/**
 * official BJe / capturePolicySnapshot.
 * Call before refreshRemoteManagedSettings on gateway login.
 */
export function capturePolicySnapshot(): void {
  try {
    policySnapshot = getSettingsForSource('policySettings') ?? null
  } catch {
    policySnapshot = null
  }
}

/** Test helper — clear BJe snapshot. */
export function resetPolicySnapshotForTests(): void {
  policySnapshot = undefined
}

/**
 * official LNe @191433708 sha export hasPolicyDiverged.
 * undefined snapshot ⇒ true (must relaunch to apply unknown baseline).
 */
export function hasPolicyDiverged(): boolean {
  if (policySnapshot === undefined) return true
  let live: SettingsJson | null = null
  try {
    live = getSettingsForSource('policySettings') ?? null
  } catch {
    live = null
  }
  return !deepEqualsJson(policySnapshot, live)
}

function deepEqualsJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function formatGatewayFailureDetail(
  failure: RemoteManagedSettingsFailure | undefined,
  accountSwitched: boolean,
): string | undefined {
  if (!failure) return undefined
  switch (failure.errorKind) {
    case 'timeout':
      return 'the request timed out'
    case 'network_error':
      return "couldn't connect to the gateway"
    case 'http_401':
    case 'http_403':
      return accountSwitched
        ? 'the gateway did not accept the new credential'
        : "the gateway did not accept this session's credential"
    case 'no_auth_available':
      return 'no credential was on hand for the request'
    case 'http_4xx':
    case 'http_5xx':
      return failure.httpStatus === undefined
        ? 'the gateway answered with an unexpected status'
        : `the gateway answered HTTP ${failure.httpStatus}`
    case 'parse_error':
    case 'invalid_settings':
      return "the gateway's response was not valid managed settings"
    case 'gateway_cert_mismatch':
      return "the gateway's TLS certificate did not match the one you trusted"
    case 'gateway_pin_refused':
      return "the credentials file that keeps the gateway's TLS pin is a symlink, which is not followed"
    case 'gateway_pin_unreadable':
      return "the credentials file that keeps the gateway's TLS pin could not be read (try again)"
    case 'unknown_error':
      return 'something unexpected went wrong (details with --debug)'
  }
}

function formatGatewaySignedInLine(
  hostname: string,
  failure: RemoteManagedSettingsFailure | undefined,
  accountSwitched: boolean,
): string {
  const detail = formatGatewayFailureDetail(failure, accountSwitched)
  if (detail) {
    return accountSwitched
      ? `Signed in to Cloud gateway ${hostname}, but couldn't load your organization's managed settings (${detail})`
      : `Couldn't reload your organization's managed settings from Cloud gateway ${hostname} (${detail})`
  }
  return accountSwitched
    ? `Signed in to Cloud gateway ${hostname}`
    : `Your organization's managed settings on Cloud gateway ${hostname} changed`
}

/**
 * official inr — preSpawn stdout line while relaunching.
 */
export function formatGatewayRestartingMessage(
  hostname: string,
  failure: RemoteManagedSettingsFailure | undefined,
  accountSwitched: boolean,
  sessionPersistenceDisabled: boolean = isSessionPersistenceDisabled(),
): string {
  const body = formatGatewaySignedInLine(hostname, failure, accountSwitched)
  const suffix = sessionPersistenceDisabled
    ? '…'
    : ' (this conversation is not saved, so it starts fresh)…'
  if (failure) {
    return `${body}. Restarting Claude Code to retry${suffix}`
  }
  return `${body}. Restarting Claude Code to apply ${
    accountSwitched ? "your organization's managed settings" : 'them'
  }${suffix}`
}

/**
 * official snr — session ending instead of relaunch (uncarriable / spawn fail).
 */
export function formatGatewayRestartFailedMessage(
  hostname: string,
  failure: RemoteManagedSettingsFailure | undefined,
  reason: string,
  accountSwitched: boolean,
  sessionPersistenceDisabled: boolean = isSessionPersistenceDisabled(),
): string {
  const body = formatGatewaySignedInLine(hostname, failure, accountSwitched)
  const apply = failure
    ? 'Claude Code has to restart to retry'
    : `Claude Code has to restart to apply ${
        accountSwitched ? "your organization's managed settings" : 'them'
      }`
  const continueHint = sessionPersistenceDisabled
    ? ''
    : ' (add --continue to return to this conversation)'
  return `${body}. ${apply}, and ${reason}, so this session is ending instead. Your sign-in is saved: start claude again the same way${continueHint}.`
}

export type GatewayLoginRelaunchInput = {
  hostname: string
  failure?: RemoteManagedSettingsFailure
  accountSwitched: boolean
  /** densable he(o) — defaults to empty permission ctx. */
  toolPermissionContext?: RelaunchPermissionCtx
  /** densable _t() — background session cannot restart itself. */
  isBackgroundSession?: boolean
  /** Test: skip spawn. */
  spawn?: boolean
  /** official o.getProactivityLevel() — leftover AppState.proactivityLevel. */
  proactivityLevel?: unknown
}

export type GatewayLoginRelaunchResult =
  | { kind: 'relaunched' }
  | { kind: 'ended'; message: string }

/**
 * official le @205714164 — GC(#w) gate then self-relaunch.
 */
export async function relaunchAfterGatewayLogin(
  input: GatewayLoginRelaunchInput,
): Promise<GatewayLoginRelaunchResult> {
  const fail = (reason: string): GatewayLoginRelaunchResult => ({
    kind: 'ended',
    message: formatGatewayRestartFailedMessage(
      input.hostname,
      input.failure,
      reason,
      input.accountSwitched,
    ),
  })

  if (input.isBackgroundSession ?? isBgSession()) {
    return fail(
      'a background session cannot restart itself (sign in from a session started directly with `claude`)',
    )
  }

  const ctx = input.toolPermissionContext ?? getEmptyToolPermissionContext()
  const reasons = getSessionRelaunchUncarriableReasons(ctx)
  if (reasons.length > 0) {
    return fail(formatGatewayRelaunchUncarriableRefuseMessage(reasons))
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { flushSessionStorage } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    await flushSessionStorage()
  } catch {
    // densable lR best-effort before _G
  }

  const preSpawnLine = formatGatewayRestartingMessage(
    input.hostname,
    input.failure,
    input.accountSwitched,
  )

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { transcriptHasBytes } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    const hasNonEmptyTranscript = await transcriptHasBytes()
    const result = await acceptTuiRelaunch({
      // official le `_G`: extraArgs [...o5(c,wle(o)),...i5(c,AL())] env $B()
      // leftover Cmt+Rmt via toolPermissionContext; injectTuiSwitch:false
      target: 'default',
      sessionId: getSessionId(),
      hasNonEmptyTranscript,
      toolPermissionContext: ctx as ToolPermissionContextForRelaunch,
      spawn: input.spawn,
      injectTuiSwitch: false,
      proactivity: {
        proactivityLevel: input.proactivityLevel,
        toolPermissionContext: ctx,
      },
      // Print only after the child has started. A miss returns fail() with
      // no "Restarting" line ahead of the error.
      preSpawn: () => {
        process.stdout.write(`\n${preSpawnLine}\n`)
      },
    })
    if (result.mode === 'spawned' && result.spawn.ok) {
      flushStreamsBeforeRelaunchExit()
      process.exit(result.spawn.status ?? 0)
    }
    if (result.mode === 'spawned' && !result.spawn.ok) {
      return fail(`it could not restart itself (${result.spawn.error})`)
    }
    return { kind: 'relaunched' }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return fail(`it could not restart itself (${detail})`)
  }
}

type ToolPermissionContextForRelaunch = NonNullable<
  Parameters<typeof acceptTuiRelaunch>[0]['toolPermissionContext']
>

/**
 * Whether gateway post-login should invoke le (official !fetchSucceeded || LNe()).
 */
export function shouldRelaunchAfterGatewayManagedSettings(status: {
  state: string
}): boolean {
  if (status.state === 'failed' || status.state === 'stale_cache') return true
  return hasPolicyDiverged()
}
