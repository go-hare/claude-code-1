/**
 * densable RO / Me / ke / AO / AE — strip parent provider/auth env from
 * background worker and warm-spare children.
 *
 * RO(_) =
 *   !!ANTHROPIC_UNIX_SOCKET
 *   || truthy CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
 *   || !!CLAUDE_CODE_HOST_AUTH_ENV_VAR
 *
 * Three upstream call sites, all child-env builders (not settings-env):
 *   ci()  buildWorkerEnv — Ve(parent) || ne(dispatch)
 *   os()  buildSpareHostEnv — Ve(env)
 *   tl()  inherit BASE_URL trio into dispatch.env — skipped when RO
 *
 * Adjacent ci()/os() strips (We/pe/Ge + wt + VERTEX_REGION_CLAUDE_*):
 * unless-dispatch on the worker, unconditional on the spare.
 */

import { isEnvTruthy } from '../utils/envUtils.js'
import { getConfiguredHostAuthEnvVarName } from '../utils/hostCredsFile.js'

/** densable R_ / Me — auth tokens dropped on a host-managed / ssh child. */
export const BG_CHILD_AUTH_TOKEN_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
] as const

/** densable OO / ke — endpoint + header keys dropped with the tokens. */
export const BG_CHILD_ENDPOINT_KEYS = [
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
] as const

/** densable o — always deleted by AO, even if dispatch.env sets them. */
export const BG_CHILD_AWS_SECRET_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const

/**
 * densable n = [...o, profile/config, GCP]. Deleted by AO unless dispatch.env
 * carries the same key (the three AWS secrets are already gone from o).
 */
export const BG_CHILD_CLOUD_CRED_KEYS = [
  ...BG_CHILD_AWS_SECRET_KEYS,
  'AWS_PROFILE',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
] as const

/** densable RO */
export function isExternallyManagedProviderEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  return Boolean(
    env.ANTHROPIC_UNIX_SOCKET ||
      isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) ||
      env.CLAUDE_CODE_HOST_AUTH_ENV_VAR,
  )
}

function isDispatchHostManaged(
  dispatchEnv: Record<string, string> | undefined,
): boolean {
  return isEnvTruthy(dispatchEnv?.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
}

function stripCloudCreds(
  env: Record<string, string | undefined>,
  dispatchEnv?: Record<string, string>,
): void {
  for (const key of BG_CHILD_AWS_SECRET_KEYS) delete env[key]
  for (const key of BG_CHILD_CLOUD_CRED_KEYS) {
    if (!dispatchEnv?.[key]) delete env[key]
  }
}

/**
 * densable ci() RO/ne block + the BASE_URL-override else-if.
 * `parentEnv` is `o` (copy of process.env before dispatch merge).
 */
export function applyHostManagedWorkerEnv(
  env: Record<string, string | undefined>,
  parentEnv: NodeJS.ProcessEnv,
  dispatchEnv?: Record<string, string>,
): void {
  const dispatchManaged = isDispatchHostManaged(dispatchEnv)
  if (isExternallyManagedProviderEnv(parentEnv) || dispatchManaged) {
    for (const key of BG_CHILD_AUTH_TOKEN_KEYS) delete env[key]
    if (
      dispatchManaged ||
      isEnvTruthy(parentEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
    ) {
      stripCloudCreds(env, dispatchEnv)
    }
    const hostAuth = getConfiguredHostAuthEnvVarName(parentEnv)
    if (hostAuth) delete env[hostAuth]
    const creds =
      dispatchEnv?.CLAUDE_CODE_HOST_CREDS_FILE ??
      (dispatchManaged ? parentEnv.CLAUDE_CODE_HOST_CREDS_FILE : undefined)
    if (creds) env.CLAUDE_CODE_HOST_CREDS_FILE = creds
    for (const key of BG_CHILD_ENDPOINT_KEYS) delete env[key]
    return
  }
  if (env.ANTHROPIC_BASE_URL !== parentEnv.ANTHROPIC_BASE_URL) {
    for (const key of BG_CHILD_ENDPOINT_KEYS) delete env[key]
    if (parentEnv.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_AUTH_TOKEN
  }
}

/**
 * densable os() Ve block + the BASE_URL else-if.
 * Spare has no dispatch; AO runs only when the managed-by-host flag is set.
 */
export function applyHostManagedSpareEnv(
  env: Record<string, string | undefined>,
): void {
  if (isExternallyManagedProviderEnv(env)) {
    const hostAuth = getConfiguredHostAuthEnvVarName(env)
    if (hostAuth) delete env[hostAuth]
    for (const key of BG_CHILD_AUTH_TOKEN_KEYS) delete env[key]
    if (isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
      stripCloudCreds(env)
    }
    return
  }
  if (env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_AUTH_TOKEN
}

/** densable exec tail: if BASE_URL, drop AUTH_TOKEN; always drop ke. */
export function applyExecEndpointStrip(
  env: Record<string, string | undefined>,
): void {
  if (env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_AUTH_TOKEN
  for (const key of BG_CHILD_ENDPOINT_KEYS) delete env[key]
}

/** densable J_ — model-id env. */
const BG_MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT',
  'CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT',
] as const

/** densable Z_ */
const BG_CUSTOM_MODEL_OPTION_KEYS = [
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES',
] as const

/** densable D_ */
const BG_PROVIDER_SELECTION_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_GOOGLE_CLOUD_PROJECT',
  'ANTHROPIC_GOOGLE_CLOUD_LOCATION',
  'ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID',
  'CLOUD_ML_REGION',
] as const

/** densable w_ + L_ */
const BG_ENDPOINT_AND_ARTIFACT_KEYS = [
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_GOOGLE_CLOUD_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'CLAUDE_CODE_ARTIFACTS_API_BASE_URL',
  'CLAUDE_CODE_ARTIFACTS_API_TOKEN',
  'CLAUDE_CODE_ARTIFACT_ASSET_BASE_URL',
  'CLAUDE_CODE_ARTIFACT_LIVE_BASE_URL',
  'CLAUDE_CODE_ARTIFACT_SYNC_BASE_URL',
  'CLAUDE_CODE_ARTIFACT_VIEWER_BASE_URL',
  'CLAUDE_CODE_MEMORY_API_BASE_URL',
  'CLAUDE_CODE_MEMORY_API_TOKEN',
] as const

/** densable b_ */
const BG_SKIP_AUTH_KEYS = [
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
] as const

/** densable OE / Ti */
const BG_HOST_CONTROL_KEYS = [
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
] as const

/**
 * densable wt — dropped from the child unless dispatch.env sets the same key.
 * Bi=J_+Z_, yi=D_, EXTRA_BODY, Ri=w_, bi=b_, CUSTOM_HEADERS, Ti=OE, HOST_CREDS.
 */
export const BG_CHILD_UNLESS_DISPATCH_KEYS = [
  ...BG_MODEL_ENV_KEYS,
  ...BG_CUSTOM_MODEL_OPTION_KEYS,
  ...BG_PROVIDER_SELECTION_KEYS,
  'CLAUDE_CODE_EXTRA_BODY',
  ...BG_ENDPOINT_AND_ARTIFACT_KEYS,
  ...BG_SKIP_AUTH_KEYS,
  'ANTHROPIC_CUSTOM_HEADERS',
  ...BG_HOST_CONTROL_KEYS,
  'CLAUDE_CODE_HOST_CREDS_FILE',
] as const

/** densable $_ / Be */
export const BG_CHILD_PREFIX_STRIP = ['VERTEX_REGION_CLAUDE_'] as const

/**
 * densable D / JG / We — session + terminal identity. Worker: unless dispatch.
 * Spare: unconditional. Local extras (ITERM_PROFILE etc.) are worker-only.
 */
export const BG_SESSION_INHERIT_STRIP_KEYS = [
  'CLAUDE_CODE_SAFE_MODE',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_BG_POST_CLEAR_RESPAWN',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS',
  'CLAUDE_CODE_RESUME_PROMPT',
  'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'GITHUB_ACTIONS',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDE_CODE_SKILL_PROPOSALS',
  'CLAUDE_CODE_EVAL_INTERVIEW_SESSION',
  'CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR',
  'CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH',
  'CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES',
  'CLAUDE_BG_RV_AUTH',
  'CLAUDE_BG_PTY_AUTH',
  'CLAUDE_BG_SOCKET_TOKENS_PATH',
  'CLAUDE_BG_ISOLATION',
  'CLAUDE_CODE_RESUME_SOURCE_ALIVE',
  'CLAUDE_CODE_COORDINATOR_MODE',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_AX_SCREEN_READER',
  'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
  'ANTHROPIC_MODEL',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  '__CFBundleIdentifier',
  'KITTY_WINDOW_ID',
  'WT_SESSION',
  'KONSOLE_VERSION',
  'VTE_VERSION',
  'ZED_TERM',
  'ZELLIJ',
  'TMUX',
  'TMUX_PANE',
  'CLAUDE_CODE_TMUX_SESSION',
  'CLAUDE_CODE_TMUX_PREFIX',
  'CLAUDE_CODE_TMUX_PREFIX_CONFLICTS',
  'STY',
  'CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE',
  'LC_TERMINAL',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
  'COLORFGBG',
  'CURSOR_TRACE_ID',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'VSCODE_GIT_ASKPASS_MAIN',
  'VSCODE_GIT_ASKPASS_NODE',
  'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
  'VSCODE_GIT_IPC_HANDLE',
  'TERMINAL_EMULATOR',
  'ITERM_SESSION_ID',
  'GNOME_TERMINAL_SERVICE',
  'XTERM_VERSION',
  'ALACRITTY_LOG',
  'TILIX_ID',
  'TERMINATOR_UUID',
  'ConEmuANSI',
  'ConEmuPID',
  'ConEmuTask',
  'MSYSTEM',
  'CLAUDE_CODE_SSE_PORT',
  'FORCE_CODE_TERMINAL',
] as const

/** Worker-only extras we already stripped before this pass. */
const BG_WORKER_LOCAL_TERMINAL_KEYS = [
  'ITERM_PROFILE',
  'WT_PROFILE_ID',
  'KONSOLE_DBUS_SESSION',
  'KONSOLE_DBUS_WINDOW',
  'ALACRITTY_WINDOW_ID',
  'KITTY_PID',
] as const

/** densable S / pe — case-insensitive delete. */
const BG_CASEFOLD_DELETE_KEYS = [
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR',
  'CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH',
  'CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES',
] as const

/** densable C / Ge */
const BG_STRIP_ENTRYPOINTS = [
  'claude-vscode',
  'claude-desktop',
  'claude-desktop-3p',
] as const

/**
 * densable ee / bs — Ht() snapshot allowlist. Empty values are skipped
 * except CLAUDE_SECURESTORAGE_CONFIG_DIR.
 */
export const BG_PROVIDER_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_INTERNAL_FC_OVERRIDES',
  ...BG_MODEL_ENV_KEYS,
  ...BG_CUSTOM_MODEL_OPTION_KEYS,
  ...BG_PROVIDER_SELECTION_KEYS,
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'ANTHROPIC_BEDROCK_REGION_PREFIX',
  'AWS_PROFILE',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
] as const

function deleteUnlessDispatch(
  env: Record<string, string | undefined>,
  keys: readonly string[],
  dispatchEnv?: Record<string, string>,
): void {
  for (const key of keys) {
    if (!dispatchEnv?.[key]) delete env[key]
  }
}

function deletePrefixesUnlessDispatch(
  env: Record<string, string | undefined>,
  prefixes: readonly string[],
  dispatchEnv?: Record<string, string>,
): void {
  for (const key of Object.keys(env)) {
    if (
      prefixes.some(prefix => key.startsWith(prefix)) &&
      !dispatchEnv?.[key]
    ) {
      delete env[key]
    }
  }
}

/** densable I / KG / pe */
export function stripCasefoldArtifactKeys(
  env: Record<string, string | undefined>,
): void {
  const upper = new Set(BG_CASEFOLD_DELETE_KEYS.map(k => k.toUpperCase()))
  for (const key of Object.keys(env)) {
    if (upper.has(key.toUpperCase())) delete env[key]
  }
}

/** densable O / IG / Ge */
export function stripHostEntrypoint(
  env: Record<string, string | undefined>,
): void {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  if (
    entry !== undefined &&
    (BG_STRIP_ENTRYPOINTS as readonly string[]).includes(entry)
  ) {
    delete env.CLAUDE_CODE_ENTRYPOINT
  }
}

/** densable Ht */
export function snapshotProviderEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of BG_PROVIDER_ENV_KEYS) {
    const value = env[key]
    if (value === undefined) continue
    if (value === '' && key !== 'CLAUDE_SECURESTORAGE_CONFIG_DIR') continue
    out[key] = value
  }
  return out
}

/** densable tl */
export function inheritParentEndpointEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (isExternallyManagedProviderEnv(env)) return {}
  const out: Record<string, string> = {}
  for (const key of BG_CHILD_ENDPOINT_KEYS) {
    const value = env[key]
    if (value) out[key] = value
  }
  return out.ANTHROPIC_BASE_URL ? out : {}
}

export function shouldInheritParentEndpointEnv(opts: {
  exec?: string
  source?: string
  cwd?: string
  currentCwd: string
}): boolean {
  if (opts.exec?.trim()) return false
  return opts.source === 'repl' || !opts.cwd || opts.cwd === opts.currentCwd
}

/**
 * densable dispatch.env prefix: Ht() + HOST_CREDS/EXTRA_BODY/PATH + tl().
 *
 * UNIX_SOCKET is not in official Ht/tl. Official wt would drop it from the
 * child; we copy it when set so `claude ssh` background jobs keep the tunnel.
 */
export function buildDispatchProviderEnv(opts: {
  exec?: string
  source?: string
  cwd?: string
  currentCwd: string
  parentEnv?: NodeJS.ProcessEnv
}): Record<string, string> {
  const parent = opts.parentEnv ?? process.env
  const out = snapshotProviderEnv(parent)
  if (
    isEnvTruthy(parent.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) &&
    parent.CLAUDE_CODE_HOST_CREDS_FILE
  ) {
    out.CLAUDE_CODE_HOST_CREDS_FILE = parent.CLAUDE_CODE_HOST_CREDS_FILE
  }
  if (parent.CLAUDE_CODE_EXTRA_BODY) {
    out.CLAUDE_CODE_EXTRA_BODY = parent.CLAUDE_CODE_EXTRA_BODY
  }
  if (parent.PATH) out.PATH = parent.PATH
  if (parent.ANTHROPIC_UNIX_SOCKET) {
    out.ANTHROPIC_UNIX_SOCKET = parent.ANTHROPIC_UNIX_SOCKET
  }
  if (shouldInheritParentEndpointEnv(opts)) {
    Object.assign(out, inheritParentEndpointEnv(parent))
  }
  return out
}

/** densable ci() We + pe + Ge. Isolation is assigned after this. */
export function applyWorkerSessionStrips(
  env: Record<string, string | undefined>,
  dispatchEnv?: Record<string, string>,
): void {
  deleteUnlessDispatch(env, BG_SESSION_INHERIT_STRIP_KEYS, dispatchEnv)
  deleteUnlessDispatch(env, BG_WORKER_LOCAL_TERMINAL_KEYS, dispatchEnv)
  stripCasefoldArtifactKeys(env)
  if (!dispatchEnv?.CLAUDE_CODE_ENTRYPOINT) stripHostEntrypoint(env)
}

/** densable ci() wt + VERTEX_REGION_CLAUDE_*. Isolation is already assigned. */
export function applyWorkerProviderStrips(
  env: Record<string, string | undefined>,
  dispatchEnv?: Record<string, string>,
): void {
  deleteUnlessDispatch(env, BG_CHILD_UNLESS_DISPATCH_KEYS, dispatchEnv)
  deletePrefixesUnlessDispatch(env, BG_CHILD_PREFIX_STRIP, dispatchEnv)
}

/** densable os() We + pe + Ge. RO runs after this so BASE_URL is still visible. */
export function applySpareSessionStrips(
  env: Record<string, string | undefined>,
): void {
  for (const key of BG_SESSION_INHERIT_STRIP_KEYS) delete env[key]
  stripCasefoldArtifactKeys(env)
  stripHostEntrypoint(env)
}

/** densable os() wt + prefix. Unconditional; drops BASE_URL after the RO else-if. */
export function applySpareProviderStrips(
  env: Record<string, string | undefined>,
): void {
  for (const key of BG_CHILD_UNLESS_DISPATCH_KEYS) delete env[key]
  deletePrefixesUnlessDispatch(env, BG_CHILD_PREFIX_STRIP)
}
