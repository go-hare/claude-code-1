/**
 * densable 2.1.283 `handleClaimSessionRequest` (`ne`) @210326103 ~6933 chars.
 *
 * GOLD SEA /tmp/official-283/package/claude
 *   ofn schema @177714320
 *   env allow-list O/T @chunk-4gtdkap5
 *   project-settings gate R() after ne
 *   $7e relocate is local /cd (not cloud)
 *
 * Callees LAND: DNt / qhe / Mcn (this file + sessionHost).
 * Skip (quoted): Ur/uf/dN Statsig timings.
 * Path screen: gold g1/h1 via trustedNetworkDirectories.ts.
 * lFt @178496569: local twin `registerSession` after workspace trust.
 */

import { realpath, stat } from 'fs/promises'
import { isAbsolute, join, resolve } from 'path'
import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'
import { AgentDefinitionSchema } from '../entrypoints/sdk/coreSchemas.js'
import type { ToolPermissionContext } from '../Tool.js'
import type { PermissionMode } from '../types/permissions.js'
import { expandPath } from '../utils/path.js'
import { logForDebugging } from '../utils/debug.js'
import { logEvent } from '../services/analytics/index.js'
import { isSettingSourceEnabled } from '../utils/settings/constants.js'
import { parseSettingsFile } from '../utils/settings/settings.js'
import { findCanonicalGitRootUncached } from '../utils/git.js'
import { applyPermissionUpdate } from '../utils/permissions/PermissionUpdate.js'
import type { TrustedNetworkDirectories } from '../utils/permissions/trustedNetworkDirectories.js'
import {
  resolvedClaimPathScreenReason,
  screenClaimPath as screenClaimPathCtx,
} from './claimNetworkPath.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getSessionId,
  setAdditionalDirectoriesForClaudeMd,
} from '../bootstrap/state.js'
import { registerSession } from '../utils/concurrentSessions.js'
import {
  emitProcessEnvChange,
  getBootstrapSession,
  markWarmSpareClaimed,
} from '../utils/sessionHost.js'
import {
  clearApiKeyHelperCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
  clearOAuthTokenCache,
  resetAwsAuthRefreshCooldown,
} from '../utils/auth.js'
import { Ip } from '../utils/toolSchemaCache.js'
import {
  assignStartupContext,
  profileCheckpointOnce,
} from '../utils/startupProfiler.js'
import { headlessProfilerCheckpoint } from '../utils/headlessProfiler.js'
import { hasUnsafePathChars } from '../commands/cd/cdPermission.js'
import {
  acceptTrustForDirectory,
  isDirectoryTrusted,
  projectTrustConfigKey,
  relocateSessionCwd,
} from '../commands/cd/cdCommand.js'
import {
  isSpareParked,
  isSubprocessEnvScrubEnabled,
  markSpareClaimed,
  markSpareClaimFailed,
  markSpareClaiming,
} from './spareClaim.js'

/** densable O @chunk-4gtdkap5 — keys accepted on claim env. */
export const CLAIM_ENV_ALLOWLIST = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_HOST_SESSION_ID',
])

/** densable T — claim env keys that require credential-cache reset (DNt). */
const CLAIM_ENV_CREDENTIAL_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
])

/**
 * densable DNt @178685272
 * `if(bTe(),Ko().clear(),w5e(),c7(),E5e(),C5e(),AB(),wce(),N())g_e()`
 *
 * Local twins: OAuth memo+keychain, apiKeyHelper epoch, AWS/GCP cred caches,
 * tool-schema/beta invalidate. Ko managed-key host bag is the OAuth/API-key
 * memo (no separate JWT-format helper). g_e storageV5 copy cache: skip (N()).
 */
export function resetCredentialCachesAfterClaimEnv(): void {
  clearOAuthTokenCache()
  clearApiKeyHelperCache()
  clearAwsCredentialsCache()
  resetAwsAuthRefreshCooldown()
  clearGcpCredentialsCache()
  Ip()
}

function refuse(message: string): { kind: 'error'; message: string } {
  return { kind: 'error', message }
}

function sanitizeIssuePath(path: string): string {
  return hasUnsafePathChars(path) ? '(root)' : path
}

function sanitizeIssueMessage(message: string): string {
  return hasUnsafePathChars(message)
    ? 'malformed claim_session request'
    : message
}

/**
 * densable ofn @177714320 — claim_session request schema.
 * system_prompt is k(o()) = string[]; permission_mode is o() string then
 * checkPermissionMode (not the enum at parse time).
 */
export const claimSessionRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('claim_session'),
      cwd: z
        .string()
        .describe(
          "The session's working directory. Tilde-expanded and realpath-canonicalized; treated exactly like the cwd a process is spawned in (no trust prompt, no Cd(...) rule check) — the host chose it, as it chooses a spawn cwd.",
        ),
      env: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Per-session environment additions. Only keys on the claim allow-list are accepted (keys the process has already consumed — config dir, base URL, proxy/TLS, provider, telemetry, entrypoint — must be part of the spare's spawn env); any other key rejects the claim and leaves the spare parked.",
        ),
      additional_directories: z
        .array(z.string())
        .optional()
        .describe('Extra directories the session may access, as --add-dir.'),
      permission_mode: z
        .string()
        .optional()
        .describe(
          "Session permission mode, as --permission-mode. Part of the claim (not a follow-up set_permission_mode) so that a mode the process cannot take — bypassPermissions on a spare spawned without --allow-dangerously-skip-permissions, a mode this build does not know, one the claimed directory's settings disable — refuses or fails the claim instead of letting the first turn run under the spare's mode.",
        ),
      system_prompt: z
        .array(z.string())
        .optional()
        .describe('As initialize.systemPrompt.'),
      append_system_prompt: z
        .string()
        .optional()
        .describe('As initialize.appendSystemPrompt.'),
      agents: z
        .record(z.string(), AgentDefinitionSchema())
        .optional()
        .describe('As initialize.agents.'),
      title: z.string().optional().describe('As initialize.title.'),
      sdk_mcp_servers: z
        .array(z.string())
        .optional()
        .describe(
          "The session's final set of in-process SDK MCP server names. Diffed against the set registered while parked: new names are connected, missing ones disconnected. Omitted: the parked set stays.",
        ),
      include_initialize: z
        .boolean()
        .optional()
        .describe(
          'When true the ok response also carries the payload an initialize response would (commands, agents, models, account …) computed for the claimed directory, for hosts that render them.',
        ),
      workspace_trust: z
        .object({
          accepted: z.boolean(),
          directory: z.string(),
        })
        .optional()
        .describe(
          "As initialize.workspaceTrust, for a claimed spare: the host's attestation that the user accepted a trust dialog for the session's folder, judged against the claimed cwd once the spare has moved there, by the same rule (honored only from the process that owns the CLI's stdin, and only when `directory` resolves to that folder's trust key). A spare's own initialize arrives in its parking directory and records nothing, so a host that attests sends it here. workspace_trust_recorded in the response (and in the returned initialize payload) reports the outcome.",
        ),
    })
    .describe(
      '@internal Binds a parked spare (a process started with --await-claim in a neutral directory with the host-level options) to its session: relocates it to cwd as if it had been spawned there, applies the per-session prompt options and in-process MCP server set, starts the SessionStart hooks, and registers the session. Model, thinking budget and flag-settings overlays are not claim fields: send set_model / set_max_thinking_tokens / apply_flag_settings right behind the claim; the control loop applies them in order before it reads the first message. A set_model that arrives before the first message is applied the way --model is at start-up: it writes no /model entries to the transcript and makes no extra API call to confirm a model id the local checks accept. Accepted once, only on a parked spare, only before any turn. A request that fails validation is refused before anything is touched and leaves the spare parked; a failure after that point leaves the spare unusable (discard it).',
    ),
)

export type ClaimSessionRequest = z.infer<
  ReturnType<typeof claimSessionRequestSchema>
>

export type ClaimSessionOkResponse = {
  status: 'ok'
  cwd?: string
  session_id: string
  parked_ms?: number
  sdk_mcp_settled: boolean
  initialize?: unknown
  workspace_trust_recorded?: boolean
}

export type ClaimSessionResult =
  | { kind: 'ok'; response: ClaimSessionOkResponse }
  | { kind: 'error'; message: string }

export type ClaimSessionPromptOptions = {
  systemPrompt?: string | string[]
  appendSystemPrompt?: string
  title?: string
  agents?: Record<string, unknown>
}

export type ClaimSessionHost = {
  isBusy: () => boolean
  isFreshSession: () => boolean
  permissionModeSuppliedOnInvocation: boolean
  getToolPermissionContext: () => ToolPermissionContext
  setToolPermissionContext: (ctx: ToolPermissionContext) => void
  retireDepartedAdditionalDirectories?: (directories: string[]) => void
  startDeferredMcpServers?: () => Promise<void>
  rehomePluginsAndMcp?: () => Promise<void>
  applyPromptOptions: (opts: ClaimSessionPromptOptions) => void
  currentPermissionMode: () => PermissionMode
  checkPermissionMode: (mode: string) => string | undefined
  applyPermissionMode: (mode: string) => string | undefined
  recheckAutoModeGate: () => void
  setSdkMcpServers?: (names: string[]) => void
  sdkMcpSettled: () => boolean
  startSessionStartHooks: () => void
  applyWorkspaceTrust?: (
    trust: { accepted: boolean; directory: string } | undefined,
  ) => Promise<boolean | undefined>
  announceStartingChange?: () => void
  buildInitializePayload?: (
    workspaceTrustRecorded: boolean | undefined,
  ) => Promise<unknown>
  storageV5?: unknown
}

/**
 * densable g1/h1 @190551319 — gold zh/phe/ict/act via claimNetworkPath.
 */
export function screenClaimPath(
  raw: string,
  expanded: string,
  trusted?: TrustedNetworkDirectories,
): { ok: true } | { ok: false } {
  return screenClaimPathCtx(raw, expanded, {
    trustedNetworkDirectories: trusted,
  })
}

function resolvedPathScreenReason(
  path: string,
  trusted?: TrustedNetworkDirectories,
): string | undefined {
  const reason = resolvedClaimPathScreenReason(path, {
    trustedNetworkDirectories: trusted,
  })
  return reason === undefined ? undefined : String(reason)
}

/**
 * densable R() after ne — claimed directory project/local settings that a
 * cold start would have applied cannot be applied by claim.
 */
export function checkClaimProjectSettings(
  claimedCwd: string,
  opts: {
    permissionModeSupplied: boolean
    modesInPlay: Set<string>
  },
): string | undefined {
  const files: { label: string; path: string }[] = []
  if (isSettingSourceEnabled('projectSettings')) {
    files.push({
      label: 'settings.json',
      path: join(claimedCwd, '.claude', 'settings.json'),
    })
  }
  if (isSettingSourceEnabled('localSettings')) {
    // gold n2(m, qH) — project config dir of claimed cwd
    const project = findCanonicalGitRootUncached(claimedCwd) ?? claimedCwd
    for (const root of new Set([claimedCwd, project])) {
      files.push({
        label: 'settings.local.json',
        path: join(root, '.claude', 'settings.local.json'),
      })
    }
  }
  for (const { label, path } of files) {
    const parsed = parseSettingsFile(path)
    const c = parsed.settings
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>
    const n = (h: string): string =>
      `project_settings_not_claimable: ${label} in the claimed directory sets ${h}, which a cold start applies during start-up and a claim cannot; start this session cold`
    if (
      r.env &&
      typeof r.env === 'object' &&
      Object.keys(r.env as object).length > 0
    ) {
      return n('env')
    }
    if (typeof r.agent === 'string' && r.agent !== '') return n('agent')
    if (typeof r.model === 'string' && r.model !== '') return n('model')
    if (Array.isArray(r.fallbackModel) && r.fallbackModel.length > 0) {
      return n('fallbackModel')
    }
    const d =
      r.permissions && typeof r.permissions === 'object'
        ? (r.permissions as Record<string, unknown>)
        : undefined
    if (!opts.permissionModeSupplied && typeof d?.defaultMode === 'string') {
      return n(
        'permissions.defaultMode (no permission mode was given: neither --permission-mode on the spare nor permission_mode in the claim)',
      )
    }
    if (
      d?.disableBypassPermissionsMode === 'disable' &&
      opts.modesInPlay.has('bypassPermissions')
    ) {
      return n(
        'permissions.disableBypassPermissionsMode while the session would run in, or could return to, bypassPermissions mode',
      )
    }
    if (
      (d?.disableAutoMode === 'disable' || r.disableAutoMode === 'disable') &&
      opts.modesInPlay.has('auto')
    ) {
      return n(
        'disableAutoMode while the session would run in, or could return to, auto mode',
      )
    }
  }
  return undefined
}

/**
 * densable Lc @198998804 — workspace_trust on claim, after cwd bind.
 * Honored only when the host owns stdin (caller passes undefined otherwise).
 */
export async function applyClaimWorkspaceTrust(
  attestation: { accepted: boolean; directory: string } | undefined,
  opts: { cwd: string },
): Promise<boolean | undefined> {
  if (attestation === undefined) return undefined
  const { accepted, directory } = attestation
  if (accepted !== true) return undefined
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    logForDebugging(
      'workspaceTrust ignored — accepted requires an absolute directory',
      { level: 'warn' },
    )
    return undefined
  }
  const outcome = (j: string, A: boolean): boolean => {
    logEvent('tengu_sdk_workspace_trust', {
      outcome: j as never,
    })
    if (!A) {
      logForDebugging(`workspaceTrust recorded nothing (${j})`, {
        level: 'warn',
      })
    }
    return A
  }
  const wantKey = projectTrustConfigKey(opts.cwd)
  let resolved = directory
  if (directory !== opts.cwd) {
    let expanded: string | undefined
    try {
      expanded = expandPath(directory)
      if (!screenClaimPath(directory, expanded).ok) expanded = undefined
    } catch {
      expanded = undefined
    }
    if (expanded === undefined) return outcome('screened', false)
    try {
      if (!(await stat(expanded)).isDirectory()) {
        return outcome('not_a_directory', false)
      }
      resolved = await realpath(expanded)
    } catch {
      return outcome('not_a_directory', false)
    }
    if (resolvedPathScreenReason(resolved) !== undefined) {
      return outcome('screened', false)
    }
  }
  if ([resolved, opts.cwd, wantKey].some(hasUnsafePathChars)) {
    return outcome('unsafe_path', false)
  }
  if (projectTrustConfigKey(resolved) !== wantKey) {
    return outcome('mismatch', false)
  }
  if (isDirectoryTrusted(wantKey) || isDirectoryTrusted(opts.cwd)) {
    return outcome('already_trusted', true)
  }
  acceptTrustForDirectory(opts.cwd)
  if (!(isDirectoryTrusted(wantKey) || isDirectoryTrusted(opts.cwd))) {
    return outcome('session_only', false)
  }
  return outcome('recorded', true)
}

/**
 * densable `ne` @210326103.
 */
export async function handleClaimSessionRequest(
  request: unknown,
  host: ClaimSessionHost,
): Promise<ClaimSessionResult> {
  const started = performance.now()
  profileCheckpointOnce('claim_received')
  headlessProfilerCheckpoint('claim_received')
  if (!isSpareParked()) {
    return refuse(
      'not_a_spare: claim_session is only accepted by a process started with --await-claim that has not been claimed yet',
    )
  }
  if (host.isBusy()) {
    return refuse('busy: a turn is in progress')
  }
  if (!host.isFreshSession()) {
    return refuse(
      'turn_started: the spare already ran a turn and cannot be claimed',
    )
  }
  if (isSubprocessEnvScrubEnabled()) {
    return refuse(
      'scrub_mode: a spare cannot be claimed while CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is on — its sandbox paths are pinned to the launch directory',
    )
  }

  const parsed = claimSessionRequestSchema().safeParse(request)
  if (!parsed.success) {
    const e = parsed.error.issues[0]
    return refuse(
      `invalid_request: ${
        e
          ? `${sanitizeIssuePath(e.path.join('.') || '(root)')} — ${sanitizeIssueMessage(e.message)}`
          : 'malformed claim_session request'
      }`,
    )
  }
  const o = parsed.data
  const trusted = host.getToolPermissionContext().trustedNetworkDirectories
  const c = o.env ?? {}
  for (const e of Object.keys(c)) {
    if (!CLAIM_ENV_ALLOWLIST.has(e)) {
      const key = hasUnsafePathChars(e) ? '(key withheld)' : e
      return refuse(
        `env_key_not_claimable: ${key} is read during start-up; pass it in the spare's spawn env instead`,
      )
    }
  }
  if (o.cwd.trim() === '') {
    return refuse('invalid_request: cwd — must be a non-empty string')
  }

  let r: string
  try {
    r = expandPath(o.cwd)
    if (!screenClaimPath(o.cwd, r, trusted).ok) {
      return refuse(
        'unsafe_path: the claim cwd is a network path or an obfuscated spelling',
      )
    }
  } catch {
    return refuse('unsafe_path: the claim cwd could not be screened')
  }
  if (!isAbsolute(r)) {
    return refuse('invalid_request: cwd — must be an absolute path (or ~/…)')
  }
  try {
    if (!(await stat(r)).isDirectory()) {
      return refuse('cwd_not_a_directory: the claim cwd is not a directory')
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') {
      logForDebugging(
        `claim_session: unexpected stat errno for the claim cwd: ${String(e)}`,
        { level: 'error' },
      )
    }
    return refuse(
      'cwd_not_found: the claim cwd does not exist or is not accessible',
    )
  }

  let n = r
  try {
    n = await realpath(r)
  } catch {
    n = r
  }
  if (resolvedPathScreenReason(n, trusted) !== undefined) {
    return refuse(
      'unsafe_path: the claim cwd resolved to a network path or an obfuscated spelling',
    )
  }

  const d: string[] = []
  for (const e of o.additional_directories ?? []) {
    let l: string
    try {
      l = resolve(n, expandPath(e, n))
      if (!screenClaimPath(e, l, trusted).ok) {
        return refuse(
          'unsafe_path: an additional directory is a network path or an obfuscated spelling',
        )
      }
    } catch {
      return refuse(
        'unsafe_path: an additional directory could not be screened',
      )
    }
    try {
      if ((await stat(l)).isDirectory()) d.push(l)
      else {
        logForDebugging(
          `claim_session: additional directory ${l} is not a directory — skipped`,
          { level: 'warn' },
        )
      }
    } catch {
      // gold: skip missing additional directories
    }
  }

  const h = o.permission_mode ?? host.currentPermissionMode()
  const S = host.getToolPermissionContext()
  const M = new Set(
    [h, S.mode, S.prePlanMode].filter((e): e is string => e !== undefined),
  )
  const b = checkClaimProjectSettings(n, {
    permissionModeSupplied:
      host.permissionModeSuppliedOnInvocation ||
      o.permission_mode !== undefined,
    modesInPlay: M,
  })
  if (b !== undefined) return refuse(b)
  if (o.permission_mode !== undefined) {
    const e = host.checkPermissionMode(o.permission_mode)
    if (e !== undefined) return refuse(`permission_mode_not_claimable: ${e}`)
  }
  profileCheckpointOnce('claim_validated')
  headlessProfilerCheckpoint('claim_validated')

  const parkedMs = markSpareClaiming()
  const sdkMcpSettled = host.sdkMcpSettled()
  try {
    let credentialEnv = false
    for (const [e, l] of Object.entries(c)) {
      process.env[e] = l
      if (CLAIM_ENV_CREDENTIAL_KEYS.has(e)) credentialEnv = true
    }
    if (credentialEnv) resetCredentialCachesAfterClaimEnv()
    if (Object.keys(c).length > 0) emitProcessEnvChange()
    try {
      getBootstrapSession().costLedger.restartClock()
    } catch {
      // gold JBt
    }
    markWarmSpareClaimed()

    if (d.length > 0) {
      host.setToolPermissionContext(
        applyPermissionUpdate(host.getToolPermissionContext(), {
          type: 'addDirectories',
          directories: d,
          destination: 'cliArg',
        }),
      )
      setAdditionalDirectoriesForClaudeMd([
        ...getAdditionalDirectoriesForClaudeMd(),
        ...d,
      ])
    }

    const { departedAdditionalDirectories } = await relocateSessionCwd(
      n,
      'claim_session',
      { freshSession: true },
    )
    headlessProfilerCheckpoint('claim_relocated')
    try {
      host.retireDepartedAdditionalDirectories?.(departedAdditionalDirectories)
    } catch (e) {
      logForDebugging(
        `claim_session: retiring the spare directory's additional directories failed (continuing): ${String(e)}`,
        { level: 'error' },
      )
    }
    try {
      await host.startDeferredMcpServers?.()
    } catch (e) {
      logForDebugging(
        `claim_session: starting the held-back MCP servers failed (continuing): ${String(e)}`,
        { level: 'error' },
      )
    }
    headlessProfilerCheckpoint('claim_deferred_mcp')
    try {
      await host.rehomePluginsAndMcp?.()
    } catch (e) {
      logForDebugging(
        `claim_session: re-homing plugins/MCP for the claimed directory failed (continuing): ${String(e)}`,
        { level: 'error' },
      )
    }
    headlessProfilerCheckpoint('claim_plugins_mcp')

    if (o.permission_mode !== undefined) {
      const e = host.applyPermissionMode(o.permission_mode)
      if (e !== undefined) {
        throw new Error(`permission mode not applied after relocation: ${e}`)
      }
    }
    host.recheckAutoModeGate()

    let workspaceTrustRecorded: boolean | undefined
    try {
      workspaceTrustRecorded = await host.applyWorkspaceTrust?.(
        o.workspace_trust,
      )
    } catch (e) {
      logForDebugging(
        `claim_session: recording the host's workspace trust failed (continuing): ${String(e)}`,
        { level: 'error' },
      )
    }

    void registerSession(host.storageV5).catch(() => {})
    host.applyPromptOptions({
      systemPrompt: o.system_prompt,
      appendSystemPrompt: o.append_system_prompt,
      title: o.title,
      agents: o.agents,
    })
    if (o.sdk_mcp_servers !== undefined) {
      host.setSdkMcpServers?.(o.sdk_mcp_servers)
    }
    host.startSessionStartHooks()
    host.announceStartingChange?.()
    markSpareClaimed()
    profileCheckpointOnce('spare_claimed')
    headlessProfilerCheckpoint('spare_claimed')

    let initialize: unknown
    let initializeMs: number | undefined
    if (o.include_initialize) {
      const e = performance.now()
      try {
        initialize = await host.buildInitializePayload?.(workspaceTrustRecorded)
      } catch (l) {
        logForDebugging(
          `claim_session: building the initialize payload failed (continuing without it): ${String(l)}`,
          { level: 'error' },
        )
      }
      initializeMs = Math.round(performance.now() - e)
      headlessProfilerCheckpoint('spare_claim_initialize')
    }
    const claimMs = Math.round(performance.now() - started)
    assignStartupContext({
      spare_claimed: 1,
      ...(parkedMs !== undefined && { spare_parked_ms: parkedMs }),
      spare_claim_ms: claimMs,
      ...(initializeMs !== undefined && {
        spare_claim_initialize_ms: initializeMs,
      }),
    })
    logEvent('tengu_spare_claimed', {
      parked_ms: parkedMs as never,
      claim_ms: claimMs as never,
      initialize_ms: initializeMs as never,
      sdk_mcp_settled: sdkMcpSettled as never,
      env_keys: Object.keys(c).length as never,
      additional_directories: d.length as never,
      sdk_mcp_servers: o.sdk_mcp_servers?.length as never,
    })
    return {
      kind: 'ok',
      response: {
        status: 'ok',
        ...(hasUnsafePathChars(n) ? {} : { cwd: n }),
        session_id: getSessionId(),
        ...(parkedMs !== undefined ? { parked_ms: parkedMs } : {}),
        sdk_mcp_settled: sdkMcpSettled,
        ...(initialize !== undefined ? { initialize } : {}),
        ...(workspaceTrustRecorded !== undefined
          ? { workspace_trust_recorded: workspaceTrustRecorded }
          : {}),
      },
    }
  } catch (err) {
    markSpareClaimFailed()
    throw err
  }
}
