/**
 * Official 2.1.323 #1993, #1994, #1995, #1998, #1999, #2000:
 * Background session credential anchoring (`CLAUDE_BG_SESSION_CREDENTIAL`,
 * `Qwi`, `KZr`, `bXo`, `wXo`, `Cve`, `tot`, `tZ`, `Gqe`, `Rfa`, `xfa`, `Pfa`,
 * `Ofa`, `PUe`, `Afa`, `Zre`).
 *
 * Ensures sessions on a named Anthropic profile or shell API key / auth token /
 * workload identity never silently move to another sign-in when continued in
 * the background (`/fork`, Left arrow, `--bg`), restarted across updates, or
 * handed to an older background daemon.
 */

import { createHash } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getErrnoCode } from '../utils/errors.js'

/** Official `d0o`. */
export const BG_AUTH_CONFIG_KEYS = ['ANTHROPIC_CONFIG_DIR'] as const

/** Official `Zre`. */
export const BG_PROFILE_ENV_KEYS = [
  'ANTHROPIC_PROFILE',
  ...BG_AUTH_CONFIG_KEYS,
] as const

/** Official `Afa` — credential env keys cleared on background sign-in switch/refusal (#1999). */
export const BG_CREDENTIAL_ENV_KEYS: ReadonlySet<string> = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'CLAUDE_CODE_OAUTH_TOKEN',
  ...BG_PROFILE_ENV_KEYS,
])

/** Official `_h`. */
export const BG_SESSION_CREDENTIAL_ENV = 'CLAUDE_BG_SESSION_CREDENTIAL'

/** Official `$1r` — minimum daemon capability level supporting profile anchoring (#1998). */
export const BG_PROFILE_MIN_DAEMON_CAP = 1

/** Official `PUe`. */
export const BG_ENV_LOGIN_SENTINEL = 'env-login'

/** Official `Gqe` (#1994). */
export const BG_PROFILE_MISMATCH_MESSAGE =
  "Nothing was sent: this session's profile isn't here, changed organization, or is overruled by this folder's settings. Reopen it as you started it: same launcher, or same ANTHROPIC_PROFILE."

/** Official `Rfa` (#1994). */
export const BG_PROFILE_MISMATCH_RESUME_MESSAGE =
  "Nothing was sent: this session's profile isn't here, changed organization, or is overruled by settings. Sign in to that profile again, or stop this session first and reopen it as you started it."

/** Official `xfa` (#1995). */
export const BG_OAUTH_TOKEN_BLOCKED_MESSAGE =
  "CLAUDE_CODE_OAUTH_TOKEN wouldn't reach a background session, which would use another sign-in, such as your saved login. Keep working in this terminal, or start Claude Code without that variable: it then uses the profile that ANTHROPIC_PROFILE names, or your saved login if you unset that too"

/** Official `Pfa` (#1998). */
export const BG_OLD_DAEMON_PROFILE_MESSAGE =
  "the background service that is running is an older version, which can't keep this session's profile. Run claude daemon stop --any, which stops background sessions, and try again. If it runs as a service, run claude daemon install instead. Continue a session that was stopped with claude --resume, as you started it"

/** Official `Ofa` (#1995 & 2.1.325 #2351 — no longer suggests adding the key to settings). */
export const BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE =
  "the background service doesn't have this session's API key, token or workload identity, so run it in this terminal. Or, unless the service was set up with claude daemon install, run claude daemon stop --any, which stops every project's background sessions, and try again from here; other background sessions may then use this key, token or identity instead of their own sign-in"

/** Official 2.1.325 #2291: refusal when a session's sign-in would be hijacked in the background. */
export const BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE =
  'the background service has another API key, token, or profile in its environment that would change which sign-in this session uses. Keep working in this terminal, or run claude daemon stop --any (which stops background sessions) and try again from here'

/**
 * Official 2.1.325 #2290 (`N` + `Tfa`): conflicting daemon-shell credential env
 * keys that MUST be stripped from a spawned worker so a background session
 * started on a claude.ai login (`env-login`) or another specific credential
 * never inherits (or bills) an unrelated API key / token from the shell that
 * started the background daemon.
 */
const CONFLICTING_DAEMON_CREDENTIAL_ENV_KEYS = new Map<
  string,
  readonly string[]
>([
  [
    'env-key',
    [
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ],
  ],
  [
    'env-apikey',
    [
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ],
  ],
  [
    'env-authtoken',
    [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ],
  ],
  [
    'env-federation',
    [
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ],
  ],
  [
    'env-workload',
    [
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ],
  ],
  [
    BG_ENV_LOGIN_SENTINEL,
    [
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_FEDERATION_RULE_ID',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'ANTHROPIC_CONFIG_DIR',
    ],
  ],
])

/** Official `Tfa(credential)` — env keys to strip from daemon-inherited worker env. */
export function getConflictingDaemonCredentialEnvKeys(
  credential: string | undefined,
): readonly string[] {
  if (!credential) return []
  if (credential === BG_ENV_LOGIN_SENTINEL) {
    return (
      CONFLICTING_DAEMON_CREDENTIAL_ENV_KEYS.get(BG_ENV_LOGIN_SENTINEL) ?? []
    )
  }
  if (isStampedEnvCredential(credential)) {
    return (
      CONFLICTING_DAEMON_CREDENTIAL_ENV_KEYS.get(
        stripEnvCredentialFingerprint(credential),
      ) ?? []
    )
  }
  return []
}

/** Official `zt` / `mn` / `gn` / `hn` (#1994, #2000). */
export const BG_ANCHOR_UNREADABLE_MESSAGE =
  "couldn't read which sign-in this session was on; to go on, run claude --resume as you started it"
export const BG_ANCHOR_UPDATE_FAILED_MESSAGE =
  "couldn't update which profile this session is on, so it stays where it is"
export const BG_SIGNIN_DRIFT_MESSAGE =
  'this session was on another sign-in than the one it would be started with; to go on, run claude --resume as you started it'
export const BG_ENV_CRED_SAVE_FAILED_MESSAGE =
  "couldn't save which API key, token or workload identity this session is on; check that your Claude config folder is writable, then try again"

/** Official `t` — valid `CLAUDE_BG_SESSION_CREDENTIAL` anchor format. */
const BG_SESSION_CREDENTIAL_RE =
  /^(?:none|env-[a-z]{1,16}(?::[0-9a-f]{16}:[0-9a-f]{32})?|profile:[A-Za-z0-9_-]{0,64}:[0-9a-f]{16})$/

const VALID_PROFILE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isValidAnthropicProfileName(name: string | undefined): boolean {
  return typeof name === 'string' && VALID_PROFILE_NAME_RE.test(name.trim())
}

/** Official `tot`. */
export function stripEnvCredentialFingerprint(val: string): string {
  return val.replace(/^(env-[a-z]+):.*$/, '$1')
}

/** Official `tZ`. */
export function isStampedEnvCredential(val: string): boolean {
  return val.startsWith('env-') && val.includes(':')
}

/** Official `Cve`. */
export function isValidBgSessionCredential(val: string | undefined): boolean {
  return typeof val === 'string' && BG_SESSION_CREDENTIAL_RE.test(val)
}

function sha256Hex(input: string, len: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, len)
}

/**
 * Compute a `CLAUDE_BG_SESSION_CREDENTIAL` anchor string from a shell/process
 * env (and optional organization UUID for named profiles).
 */
export function computeBgSessionCredentialAnchor(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  orgUuid?: string,
): {
  credential: string
  profile?: string
  configDir?: string
  usesShellSecret: boolean
  isOauthTokenEnv: boolean
} {
  const oauthToken = env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (oauthToken) {
    // Setup tokens (`sk-ant-oat01-...` vs general OAuth env token): non-setup
    // tokens cannot be safely forwarded to the background daemon (#1995).
    const isSetupToken = env.CLAUDE_CODE_SETUP_TOKEN === '1'
    if (!isSetupToken) {
      return {
        credential: `env-oauth:${sha256Hex(oauthToken, 16)}:${sha256Hex(`oauth:${oauthToken}`, 32)}`,
        usesShellSecret: true,
        isOauthTokenEnv: true,
      }
    }
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim()
  if (apiKey) {
    return {
      credential: `env-apikey:${sha256Hex(apiKey, 16)}:${sha256Hex(`apikey:${apiKey}`, 32)}`,
      usesShellSecret: true,
      isOauthTokenEnv: false,
    }
  }
  const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim()
  if (authToken) {
    return {
      credential: `env-authtoken:${sha256Hex(authToken, 16)}:${sha256Hex(`authtoken:${authToken}`, 32)}`,
      usesShellSecret: true,
      isOauthTokenEnv: false,
    }
  }
  const fedRule = env.ANTHROPIC_FEDERATION_RULE_ID?.trim()
  if (fedRule) {
    const orgId = env.ANTHROPIC_ORGANIZATION_ID?.trim() ?? ''
    return {
      credential: `env-workload:${sha256Hex(fedRule, 16)}:${sha256Hex(`workload:${orgId}:${fedRule}`, 32)}`,
      usesShellSecret: true,
      isOauthTokenEnv: false,
    }
  }
  const profile = env.ANTHROPIC_PROFILE?.trim()
  const configDir = env.ANTHROPIC_CONFIG_DIR?.trim()
  if (profile && isValidAnthropicProfileName(profile)) {
    const orgHash = sha256Hex(orgUuid || `${profile}:${configDir ?? ''}`, 16)
    return {
      credential: `profile:${profile}:${orgHash}`,
      profile,
      ...(configDir ? { configDir } : {}),
      usesShellSecret: false,
      isOauthTokenEnv: false,
    }
  }
  return {
    credential: 'none',
    usesShellSecret: false,
    isOauthTokenEnv: false,
  }
}

/**
 * Official 2.1.323 #1995 & #1998 + 2.1.325 #2290, #2291, #2351:
 * Pre-dispatch check when handing a session to the background daemon
 * (via `/fork`, Left arrow, or `--bg`).
 * Returns an actionable error message when handoff must be refused (never
 * suggesting adding the key to settings), or `null` if OK.
 */
export function checkBgSpawnCredentialCompatibility(opts: {
  callerEnv: NodeJS.ProcessEnv | Record<string, string | undefined>
  daemonEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>
  daemonProfileAnchorCap?: number
  existingSessionAnchor?: string
  isExec?: boolean
}): string | null {
  if (opts.isExec) return null
  const caller = computeBgSessionCredentialAnchor(opts.callerEnv)

  // #1995: CLAUDE_CODE_OAUTH_TOKEN (non-setup token) would not reach the bg daemon
  if (caller.isOauthTokenEnv) {
    return BG_OAUTH_TOKEN_BLOCKED_MESSAGE
  }

  // #1998: named Anthropic profile requires daemon profileAnchorCap >= 1
  if (
    caller.profile &&
    (opts.daemonProfileAnchorCap === undefined ||
      opts.daemonProfileAnchorCap < BG_PROFILE_MIN_DAEMON_CAP)
  ) {
    return BG_OLD_DAEMON_PROFILE_MESSAGE
  }

  // #2291: refuse moving a session onto a different sign-in than its existing anchor
  if (
    opts.existingSessionAnchor &&
    opts.existingSessionAnchor !== 'none' &&
    isValidBgSessionCredential(opts.existingSessionAnchor)
  ) {
    const normalizedExisting =
      opts.existingSessionAnchor === BG_ENV_LOGIN_SENTINEL
        ? 'none'
        : stripEnvCredentialFingerprint(opts.existingSessionAnchor)
    const normalizedCaller =
      caller.credential === BG_ENV_LOGIN_SENTINEL
        ? 'none'
        : stripEnvCredentialFingerprint(caller.credential)
    if (normalizedExisting !== normalizedCaller) {
      return BG_SIGNIN_DRIFT_MESSAGE
    }
    if (
      opts.existingSessionAnchor.startsWith('profile:') &&
      caller.credential !== opts.existingSessionAnchor
    ) {
      return BG_SIGNIN_DRIFT_MESSAGE
    }
  }

  // #1995 & #2291: shell API key, auth token, or workload identity must match daemon env
  if (caller.usesShellSecret && opts.daemonEnv !== undefined) {
    const daemon = computeBgSessionCredentialAnchor(opts.daemonEnv)
    if (daemon.credential !== caller.credential) {
      return BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE
    }
    // #2291: if daemon has a different named profile or conflicting higher-precedence
    // auth key that would override the caller's shell secret, refuse the move.
    if (daemon.profile && daemon.profile !== caller.profile) {
      return BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE
    }
  }

  // #2291: caller using a claude.ai saved login (`none`) targeting an older
  // daemon that carries a shell API key / token / profile without isolation cap
  if (
    caller.credential === 'none' &&
    opts.daemonEnv !== undefined &&
    (opts.daemonProfileAnchorCap === undefined ||
      opts.daemonProfileAnchorCap < BG_PROFILE_MIN_DAEMON_CAP)
  ) {
    const daemon = computeBgSessionCredentialAnchor(opts.daemonEnv)
    if (daemon.usesShellSecret || daemon.profile) {
      return BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE
    }
  }

  return null
}

/**
 * Official 2.1.323 #1999: clear previous account login/credential env keys so
 * a background session switch or refused sign-in never leaves the previous
 * account's credentials in place.
 */
export function clearPreviousAccountCredentialsFromEnv(
  env: Record<string, string | undefined>,
  preserveKeys?: ReadonlySet<string>,
): void {
  for (const key of BG_CREDENTIAL_ENV_KEYS) {
    if (preserveKeys?.has(key)) continue
    delete env[key]
  }
  // Also clear case-insensitive matches on case-insensitive platforms
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (BG_CREDENTIAL_ENV_KEYS.has(upper) && !preserveKeys?.has(key)) {
      delete env[key]
    }
  }
}

export type BgJobCredentialAnchorRecord = {
  [BG_SESSION_CREDENTIAL_ENV]: string
  ANTHROPIC_PROFILE?: string
  ANTHROPIC_CONFIG_DIR?: string
}

function anchorDirPath(baseDir?: string): string {
  return join(baseDir ?? getClaudeConfigHomeDir(), 'jobs', '.anchors')
}

function anchorFilePath(short: string, baseDir?: string): string {
  return join(anchorDirPath(baseDir), `${short}.json`)
}

/** Official `KZr` — whether an env map carries a persisted credential anchor. */
export function envNeedsPersistedCredentialAnchor(
  env: Record<string, string | undefined>,
): boolean {
  const cred = env[BG_SESSION_CREDENTIAL_ENV]
  return (
    cred?.startsWith('profile:') === true ||
    (cred !== undefined && isStampedEnvCredential(cred)) ||
    (cred === 'none' &&
      env.ANTHROPIC_PROFILE !== undefined &&
      isValidAnthropicProfileName(env.ANTHROPIC_PROFILE))
  )
}

export async function readBgJobCredentialAnchor(
  short: string,
  baseDir?: string,
): Promise<BgJobCredentialAnchorRecord | undefined> {
  let raw: string
  try {
    raw = await readFile(anchorFilePath(short, baseDir), 'utf8')
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') return undefined
    throw err
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const cred = parsed[BG_SESSION_CREDENTIAL_ENV]
  const profile = parsed.ANTHROPIC_PROFILE
  const configDir = parsed.ANTHROPIC_CONFIG_DIR
  if (typeof cred !== 'string' || !isValidBgSessionCredential(cred)) {
    throw new Error('invalid credential anchor')
  }
  if (
    cred.startsWith('profile:') &&
    (typeof profile !== 'string' || !isValidAnthropicProfileName(profile))
  ) {
    throw new Error('profile anchor missing ANTHROPIC_PROFILE')
  }
  return {
    [BG_SESSION_CREDENTIAL_ENV]: cred,
    ...(typeof profile === 'string' && isValidAnthropicProfileName(profile)
      ? { ANTHROPIC_PROFILE: profile }
      : {}),
    ...(typeof configDir === 'string' && configDir
      ? { ANTHROPIC_CONFIG_DIR: configDir }
      : {}),
  }
}

export async function writeBgJobCredentialAnchor(
  short: string,
  env: Record<string, string | undefined>,
  baseDir?: string,
): Promise<void> {
  if (!envNeedsPersistedCredentialAnchor(env)) {
    await deleteBgJobCredentialAnchor(short, baseDir)
    return
  }
  const cred = env[BG_SESSION_CREDENTIAL_ENV]
  if (!isValidBgSessionCredential(cred)) {
    throw new Error('invalid credential anchor')
  }
  const record: BgJobCredentialAnchorRecord = {
    [BG_SESSION_CREDENTIAL_ENV]: cred!,
    ...(env.ANTHROPIC_PROFILE &&
    isValidAnthropicProfileName(env.ANTHROPIC_PROFILE)
      ? { ANTHROPIC_PROFILE: env.ANTHROPIC_PROFILE.trim() }
      : {}),
    ...(env.ANTHROPIC_CONFIG_DIR
      ? { ANTHROPIC_CONFIG_DIR: env.ANTHROPIC_CONFIG_DIR }
      : {}),
  }
  await mkdir(anchorDirPath(baseDir), { recursive: true, mode: 0o700 })
  await writeFile(anchorFilePath(short, baseDir), JSON.stringify(record), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export async function deleteBgJobCredentialAnchor(
  short: string,
  baseDir?: string,
): Promise<void> {
  try {
    await unlink(anchorFilePath(short, baseDir))
  } catch (err) {
    if (getErrnoCode(err) !== 'ENOENT') throw err
  }
}

/**
 * Official 2.1.323 #1993, #1994, #1995, #2000 (`Qwi`): reconcile a dispatch
 * request's env with its persisted per-job credential anchor so background
 * sessions never drift between a named profile and the stored login across
 * updates, respawns, or resumes.
 */
export async function reconcileBgJobCredentialAnchor(
  req: {
    short: string
    source?: string
    launch?: { mode?: string }
    env: Record<string, string>
    wakes?: boolean
    fromRoster?: boolean
  },
  isUpdateRestart = false,
  baseDir?: string,
): Promise<{ changed: boolean; refusal?: string }> {
  const incomingCred = req.env[BG_SESSION_CREDENTIAL_ENV]
  const canEstablishNewAnchor =
    !isUpdateRestart &&
    req.fromRoster !== true &&
    (req.source === 'slash' ||
      req.source === 'repl' ||
      req.source === 'left_arrow' ||
      (req.source === 'shell' && req.launch?.mode !== 'resume'))

  let stored: BgJobCredentialAnchorRecord | undefined
  try {
    stored = await readBgJobCredentialAnchor(req.short, baseDir)
  } catch {
    return { changed: false, refusal: BG_ANCHOR_UNREADABLE_MESSAGE }
  }

  if (stored !== undefined && !canEstablishNewAnchor) {
    if (
      incomingCred !== undefined &&
      (incomingCred === BG_ENV_LOGIN_SENTINEL
        ? 'none'
        : stripEnvCredentialFingerprint(incomingCred)) !==
        stripEnvCredentialFingerprint(stored[BG_SESSION_CREDENTIAL_ENV] ?? '')
    ) {
      return { changed: false, refusal: BG_SIGNIN_DRIFT_MESSAGE }
    }
    const {
      ANTHROPIC_PROFILE: _dropProfile,
      ANTHROPIC_CONFIG_DIR: _dropCfg,
      ...rest
    } = req.env
    req.env = {
      ...rest,
      [BG_SESSION_CREDENTIAL_ENV]: stored[BG_SESSION_CREDENTIAL_ENV],
      ...(stored.ANTHROPIC_PROFILE
        ? { ANTHROPIC_PROFILE: stored.ANTHROPIC_PROFILE }
        : {}),
      ...(stored.ANTHROPIC_CONFIG_DIR
        ? { ANTHROPIC_CONFIG_DIR: stored.ANTHROPIC_CONFIG_DIR }
        : {}),
    }
    return { changed: false }
  }

  const isResumeOrWake =
    !canEstablishNewAnchor &&
    (req.wakes === true ||
      req.fromRoster === true ||
      isUpdateRestart ||
      (req.source !== 'shell' && req.launch?.mode === 'resume'))

  if (isResumeOrWake && incomingCred?.startsWith('profile:')) {
    return { changed: false, refusal: BG_ANCHOR_UNREADABLE_MESSAGE }
  }

  if (
    isResumeOrWake ||
    (stored === undefined && !envNeedsPersistedCredentialAnchor(req.env))
  ) {
    if (isResumeOrWake) {
      delete req.env.ANTHROPIC_PROFILE
      delete req.env.ANTHROPIC_CONFIG_DIR
    }
    return { changed: false }
  }

  try {
    await writeBgJobCredentialAnchor(req.short, req.env, baseDir)
  } catch {
    return {
      changed: false,
      refusal:
        incomingCred !== undefined && isStampedEnvCredential(incomingCred)
          ? BG_ENV_CRED_SAVE_FAILED_MESSAGE
          : BG_ANCHOR_UPDATE_FAILED_MESSAGE,
    }
  }
  return { changed: true }
}

/**
 * Official 2.1.323 #1994 & #1995: runtime check inside a background worker
 * before sending a turn — verifies that the anchored `CLAUDE_BG_SESSION_CREDENTIAL`
 * still matches the active environment (named profile or shell credential).
 * Returns refusal text when mismatched, or `null` when valid.
 */
export function verifyRuntimeBgCredentialAnchor(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  currentOrgUuid?: string,
  isResumed = false,
): string | null {
  const expected = env[BG_SESSION_CREDENTIAL_ENV]
  if (!expected || expected === 'none') return null
  if (expected === BG_ENV_LOGIN_SENTINEL) {
    // Official 2.1.325 #2290: a background session anchored to a claude.ai
    // login must never run with a daemon-inherited shell API key / token /
    // named profile (`ANTHROPIC_PROFILE` / `ANTHROPIC_CONFIG_DIR`).
    const conflicting = getConflictingDaemonCredentialEnvKeys(expected)
    if (
      conflicting.some(k => Boolean(env[k]?.trim())) ||
      Boolean(env.ANTHROPIC_PROFILE?.trim())
    ) {
      return BG_DAEMON_CREDENTIAL_CONFLICT_MESSAGE
    }
    return null
  }
  if (!isValidBgSessionCredential(expected)) {
    return isResumed
      ? BG_PROFILE_MISMATCH_RESUME_MESSAGE
      : BG_PROFILE_MISMATCH_MESSAGE
  }
  const actual = computeBgSessionCredentialAnchor(env, currentOrgUuid)
  if (expected.startsWith('profile:')) {
    if (!actual.profile || actual.credential !== expected) {
      return isResumed
        ? BG_PROFILE_MISMATCH_RESUME_MESSAGE
        : BG_PROFILE_MISMATCH_MESSAGE
    }
    return null
  }
  if (isStampedEnvCredential(expected)) {
    if (actual.credential !== expected) {
      return BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE
    }
  }
  return null
}
