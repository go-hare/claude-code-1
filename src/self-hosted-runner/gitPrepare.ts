/**
 * densable 2.1.224 built-in BYOC git prepare pipeline (no checkout hook).
 *
 * aWd → $jy → Fjy + helpers (Ujy/Bjy/U7s/rR/lWd/…/pWd) + sanitize (Sjv/_jv/hjv)
 * + outcome helpers (Jjy/Ojv/Pjv/Djv/V2h) + prep events (sBh/Ujv).
 *
 * 1:1 from SEA `/tmp/shr-extract-224/fn-{aWd,Fjy,$jy,Ujy,…}-full.js`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isSafeGitRevision, isSafeGitUrl } from './orchestrator.js'
import { withTimeoutMs } from './rootRunner.js'
import {
  isCheckoutHookSourceType,
  sourceCanonicalPath,
} from './sessionHooks.js'

// ── constants (densable Fbn / session region) ─────────────────────────────────

/** densable `q7s` — default fetch depth */
export const DEFAULT_FETCH_DEPTH = 50
/** densable `vjy` — silence budget before progress */
export const GIT_SILENCE_BUDGET_MS = 120_000
/** densable `$e` — default server-progress pre-transfer cap */
export const GIT_SERVER_PROGRESS_CAP_DEFAULT_MS = 600_000
/** densable `Q5d` — silence budget after resolving-deltas 100% */
export const GIT_SILENCE_BUDGET_AFTER_DELTAS_MS = 300_000
/** densable `j7s` — hard cap for single git invoke / fetch wall-clock */
export const GIT_HARD_CAP_MS = 1_800_000
/** densable `F7s` — SIGTERM→SIGKILL grace */
export const GIT_SIGTERM_GRACE_MS = 5_000
/** densable `wjy` / `Cjy` — progress log throttle */
export const GIT_PROGRESS_LOG_MIN_MS = 5_000
export const GIT_PROGRESS_LOG_MIN_BUCKET_MS = 500
/** densable `T4o` — long rm / worktree timeout */
export const GIT_LONG_FS_TIMEOUT_MS = 600_000
/** densable `Ojy` — mkdir stuck timeout */
export const GIT_MKDIR_TIMEOUT_MS = 10_000
/** densable `B7s` — validateAccess attempts */
export const GIT_VALIDATE_ATTEMPTS = 3
/** densable `Hbn` — fetch retry attempts */
export const GIT_FETCH_ATTEMPTS = 5
/** densable `Z5d` / `eWd` — error sample head/tail */
export const GIT_ERR_SAMPLE_MAX = 300
export const GIT_ERR_SAMPLE_HEAD = 150
/** densable `Djy` / `Hjy` / `Mjy` — lowSpeed on early fetch attempts */
export const GIT_LOWSPEED_ATTEMPTS = 2
export const GIT_LOWSPEED_LIMIT = 1000
export const GIT_LOWSPEED_TIME = 15
/** densable `N2h` — outcome branch fetch timeout */
export const OUTCOME_FETCH_TIMEOUT_MS = 60_000
/** densable `_Gr` — push-on-release resume fetch timeout */
export const PUSH_ON_RELEASE_RESUME_FETCH_MS = 30_000
/** densable `Jrr` — short git op timeout (checkout -B etc.) */
export const GIT_SHORT_OP_TIMEOUT_MS = 30_000
/** densable `Lbn` */
export const SHR_GIT_PROXY_TOKEN_ENV = 'SHR_GIT_PROXY_TOKEN'

/** densable `aye` */
export const GIT_SAFE_CONFIG_ARGS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=',
  '-c',
  'core.askPass=',
] as const

/** densable `iqe` scrub env keys for git children */
export const GIT_SCRUB_ENV: NodeJS.ProcessEnv = {
  SELF_HOSTED_RUNNER_POOL_SECRET: undefined,
  SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: undefined,
  GIT_ALLOW_PROTOCOL: 'https:http:ssh',
}

/**
 * densable `h0t` — non-interactive git credential fail-fast env.
 * SHR `rR` injects `GCM_INTERACTIVE:h0t.GCM_INTERACTIVE` (2.1.229 #23);
 * plugin `Ole` spreads the full bag.
 */
export const GIT_H0T_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GCM_INTERACTIVE: 'never',
} as const

/** densable `V7s` */
export const GIT_LFS_LOCKS_FALSE = ['-c', 'lfs.locksverify=false'] as const

/** densable `Gjy` — commands that accept auth helper injection */
const AUTH_GIT_COMMANDS = new Set(['fetch', 'ls-remote'])

/** densable `Ajy` — commands that skip auth helper (worktree) */
const NO_AUTH_GIT_COMMANDS = new Set(['worktree'])

/** densable `Njy` — permanent fetch error markers */
const PERMANENT_REF_MARKERS = ["couldn't find remote ref"]

/** densable `Jt` — case-insensitive (incl. Turkish İ) matcher for permanent ref wording */
const PERMANENT_REF_WORDING_RE = new RegExp(
  PERMANENT_REF_MARKERS[0]!.replaceAll('i', '[i\\u0130]'),
  'gi',
)

/**
 * densable `zDn` — sanitize git's missing-ref wording in unrelated setup/session errors
 * so downstream permanent-ref checks never misclassify them as a deleted source branch.
 */
export function sanitizePermanentRefWording(message: string): string {
  return message.replace(
    PERMANENT_REF_WORDING_RE,
    match => `could not${match.slice(8)}`,
  )
}

/** densable `VDn` — permanent git fetch failure when ref is missing on remote */
export class FetchRefNotFoundError extends Error {
  constructor(message: string) {
    super(`git fetch failed (permanent): ${message}`)
    this.name = 'FetchRefNotFoundError'
  }
}

export type RepositoryDenial =
  | 'repo_not_found_or_no_permission'
  | 'no_credentials'
  | 'authentication_failed'
  | 'blocked_by_git_proxy'

export const REPOSITORY_DENIAL_LABELS: Record<RepositoryDenial, string> = {
  repo_not_found_or_no_permission: 'repository not found or no permission',
  no_credentials: "no credentials for the repository's git host",
  authentication_failed: 'authentication failed',
  blocked_by_git_proxy: 'blocked by the git proxy',
}

const REPO_DENIAL_PATTERNS: Array<[RegExp, RepositoryDenial]> = [
  [/^fatal: repository '.*' not found$/, 'repo_not_found_or_no_permission'],
  [
    /^fatal: unable to access '.*': the requested url returned error: 404$/,
    'repo_not_found_or_no_permission',
  ],
  [/^error: repository not found\.?$/, 'repo_not_found_or_no_permission'],
  [/^fatal: could not read (username|password) for /, 'no_credentials'],
  [/^fatal: authentication failed for /, 'authentication_failed'],
  [
    /^fatal: unable to access '.*': the requested url returned error: 401$/,
    'authentication_failed',
  ],
  [
    /^\S+@\S+: permission denied \(publickey(,[a-z0-9,-]+)?\)\.?$/,
    'authentication_failed',
  ],
]

const OTHER_HTTP_ERROR_RE =
  /^fatal: unable to access '.*': the requested url returned error: (?!40[14]$)\d+$/

export function classifyRepositoryDenial(
  message: string,
  viaGitProxy: boolean,
): RepositoryDenial | undefined {
  if (/^git \S+ failed \(watchdog:/.test(message)) return undefined
  const body = message.replace(/^git \S+ failed: /, '')
  if (body.length >= 2000) return undefined
  const lines = body
    .toLowerCase()
    .split('\n')
    .map(s => s.trim())
  if (viaGitProxy) {
    return lines.some(s =>
      s.startsWith('remote: access denied by the git proxy'),
    )
      ? 'blocked_by_git_proxy'
      : undefined
  }
  if (lines.some(s => OTHER_HTTP_ERROR_RE.test(s))) return undefined
  for (const [re, denial] of REPO_DENIAL_PATTERNS) {
    if (lines.some(line => re.test(line))) return denial
  }
  return undefined
}

export type RepositoryThrottle = 'refused_by_git_wrapper' | 'http_429'

/** densable `N$i` — human-readable label for repository throttle reasons */
export const REPOSITORY_THROTTLE_LABELS: Record<RepositoryThrottle, string> = {
  refused_by_git_wrapper: 'a wrapper installed as git exited with 75',
  http_429: 'the host answered HTTP 429',
}

/** densable `mfo` — git fetch failed due to throttling on its last attempt */
export class FetchThrottledError extends Error {
  readonly throttle: RepositoryThrottle

  constructor(message: string, throttle: RepositoryThrottle) {
    super(message)
    this.name = 'FetchThrottledError'
    this.throttle = throttle
  }
}

const HTTP_429_RE =
  /^fatal: unable to access '.*': the requested url returned error: 429$/

export function classifyRepositoryThrottle(
  message: string,
  exitCode: number | null | undefined,
  gitURL: string,
): RepositoryThrottle | undefined {
  if (/^git \S+ failed \(watchdog:/.test(message)) return undefined
  if (exitCode === 75) return 'refused_by_git_wrapper'
  if (!/^https?:/i.test(gitURL)) return undefined
  const body = message.replace(/^git \S+ failed: /, '')
  if (body.length >= 2000) return undefined
  const lines = body
    .toLowerCase()
    .split(/\r|\n/)
    .map(s => s.trim())
    .filter(s => s !== '' && !s.startsWith('remote:'))
  return lines.length > 0 && lines.every(s => HTTP_429_RE.test(s))
    ? 'http_429'
    : undefined
}

export type RepositoryAddress = {
  scheme: string
  host: string
  port?: string
}

export type RepositoryAccessInfo = {
  repo: string
  address?: RepositoryAddress
}

/** densable `ten` — repository access validation failure with structured denial & repo */
export class RepositoryAccessError extends Error {
  readonly denial: RepositoryDenial | undefined
  readonly throttle: RepositoryThrottle | undefined
  readonly repository: RepositoryAccessInfo

  constructor(
    err: unknown,
    viaGitProxy: boolean,
    info: { repo: string; gitURL: string; lastAttemptExitCode?: number | null },
  ) {
    const msg = errText(err)
    super(
      `Repository access validation failed after ${GIT_VALIDATE_ATTEMPTS} attempts: ${msg}`,
    )
    this.name = 'RepositoryAccessError'
    const parsed = URL.canParse(info.gitURL) ? new URL(info.gitURL) : undefined
    this.repository = {
      repo: info.repo,
      address:
        parsed !== undefined &&
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        parsed.hostname !== ''
          ? {
              scheme: parsed.protocol.slice(0, -1),
              host: parsed.hostname,
              port: parsed.port || undefined,
            }
          : undefined,
    }
    this.denial = classifyRepositoryDenial(msg, viaGitProxy)
    this.throttle =
      this.denial === undefined
        ? classifyRepositoryThrottle(msg, info.lastAttemptExitCode, info.gitURL)
        : undefined
  }
}

/** densable `fo` — permanent setup failure when source branch/ref is missing on remote */
export class SourceRefNotFoundError extends Error {
  readonly repo: string
  readonly ref: string | undefined
  constructor(repo: string, ref?: string) {
    const label = ref ? `The branch '${ref}'` : "The session's branch"
    super(
      `${label} couldn't be found in the remote repository ${repo}. If it was never pushed, push it. If it was deleted after a merge, restore it from its pull request. Then send a new message, or start a new session from a branch that has been pushed. (couldn't find remote ref)`,
    )
    this.name = 'SourceRefNotFoundError'
    this.repo = repo
    this.ref = ref
  }
}

/** densable `iWd` progress regex */
const GIT_PROGRESS_RE =
  /^(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|Checking out files|Filtering content):\s+(\d+)%(?:\s+\((\d+)\/(\d+)\))?(?:, ([\d.]+) (KiB|MiB|GiB))?/

/** densable `rt` — server-side enumerating objects regex */
const GIT_ENUMERATING_OBJECTS_RE = /^(Enumerating objects): (\d{1,15})\b/

const BYTE_UNITS: Record<string, number> = {
  KiB: 1024,
  MiB: 1_048_576,
  GiB: 1_073_741_824,
}

/** densable `mWd` */
const GIT_FATAL_LINE_RE = /^(remote:\s+)?(fatal|error):/i

/** densable `gjv` — keep entries when sanitizing canonical .git */
const CANONICAL_KEEP = new Map<string, 'dir' | 'file'>([
  ['objects', 'dir'],
  ['refs', 'dir'],
  ['packed-refs', 'file'],
  ['HEAD', 'file'],
  ['shallow', 'file'],
])

// ── types ────────────────────────────────────────────────────────────────────

export type GitPrepareSource = {
  type: string
  repo: string
  ref?: string
  url?: string
  token?: string
  getAuthToken?: () => string
  governedMount?: boolean
  upstreamUrl?: string
  sanitized?: { onIndexFromHead?: () => void }
}

export type GitProgress = {
  sideband?: boolean
  label: string
  pct: number
  done?: number
  total?: number
  bytes?: number
  raw: string
}

export type GitRepoCtx = {
  repoPath: string
  gitURL: string
  authURL: string
  token?: string
  getAuthToken?: () => string
  governedMount?: boolean
  sanitized?: { onIndexFromHead?: () => void }
  gitEnvironment?: {
    envOverrides?: Record<string, string | undefined>
    commandScopeEntries?: Array<[string, string]>
  }
  onDebug: (msg: string) => void
  onPhase?: (phase: string, ms: number, extra?: Record<string, string>) => void
  onProgress?: (cmd: string, progress: GitProgress) => void
  signal?: AbortSignal
}

export type OutcomeTarget = { repo: string; branches?: string[] }

export type PrepStepEvent = {
  type: 'env_manager_log'
  uuid: string
  data: {
    level: 'error' | 'info'
    category: 'init'
    content: string
    timestamp: string
    extra: Record<string, string>
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

/** densable `fjt` */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * densable `TE` (byoc redactor) — broader than rootRunner.redactLogText.
 * Distinct from sessionText.truncateSessionErrorText (also densable TE name).
 */
export function redactSecretsInText(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^@/\s]+@/gi, '$1***:***@')
    .replace(
      /((?:secret|key|token|password|credential)[^=:\s]*\s*[=:]\s*)\S+/gi,
      '$1[REDACTED]',
    )
    .replace(/sk-ant-[A-Za-z0-9_.-]+/g, '[REDACTED]')
    .replace(/(Bearer )\S+/gi, '$1[REDACTED]')
    .replace(
      /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
      '[REDACTED-JWT]',
    )
    .replace(
      /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{82,}|gl(?:pat|dt|rt|ft|soat|oas|agent|ptt|cbt|imt|ffct)-[A-Za-z0-9_-]{20,}|xox[a-z]-[A-Za-z0-9+/=%_-]{10,}|xapp-[A-Za-z0-9_-]{10,}|sq0(?:atp|csp)-[A-Za-z0-9_-]{22,}|EAAA[A-Za-z0-9+/=%_-]{56,})/g,
      '[REDACTED-PAT]',
    )
    .replace(/(Authorization:\s*Basic\s+)\S+/gi, '$1[REDACTED]')
}

/** densable `$bn` */
export function redactGitOutput(
  text: string,
  authURL?: string,
  token?: string,
): string {
  let e = text
  if (authURL && /:\/\/[^/]*@/.test(authURL)) {
    e = e.split(authURL).join(maskUrlCredentials(authURL))
  }
  if (token) e = e.split(token).join('<token>')
  return e
    .replace(/sk-ant-ccsr-[A-Za-z0-9_.-]+/g, '<token>')
    .replace(/sk-ant-[A-Za-z0-9_.-]+/g, '<token>')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '<token>')
    .replace(/gh[psou]_[A-Za-z0-9]+/g, '<token>')
}

/** densable `W7s` */
export function maskUrlCredentials(url: string): string {
  try {
    const t = new URL(url)
    if (t.username || t.password) {
      return `${t.protocol}//<token>@${t.host}${t.pathname}${t.search || ''}${t.hash || ''}`
    }
    return url
  } catch {
    const at = url.indexOf('@')
    const scheme = url.indexOf('://')
    if (scheme >= 0 && at > scheme) {
      return `${url.slice(0, scheme + 3)}<token>${url.slice(at)}`
    }
    return url
  }
}

/** densable `Xjy` — redact arg for debug log line */
export function redactGitArg(
  arg: string,
  authURL: string,
  gitURL: string,
  token?: string,
): string {
  if (arg === authURL && arg !== gitURL) return maskUrlCredentials(arg)
  if (arg.includes('://') && arg.includes('@')) return maskUrlCredentials(arg)
  if (token && arg.includes(token)) return arg.split(token).join('<token>')
  return arg
}

/** densable `oWd` */
export function resolveFetchDepth(env: NodeJS.ProcessEnv = process.env): {
  depth: number | undefined
  invalid: string | undefined
} {
  const e = env.CLAUDE_RUNNER_FETCH_DEPTH
  if (e === undefined) return { depth: DEFAULT_FETCH_DEPTH, invalid: undefined }
  if (e === 'full' || e === '0') return { depth: undefined, invalid: undefined }
  const t = Number(e)
  if (Number.isInteger(t) && t > 0) return { depth: t, invalid: undefined }
  return { depth: DEFAULT_FETCH_DEPTH, invalid: e }
}

/** densable `tt` — resolve CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS */
export function resolveFetchServerProgressCapMs(
  env: NodeJS.ProcessEnv = process.env,
): {
  capMs: number
  invalid: string | undefined
  clamped: string | undefined
} {
  const e = env.CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS
  if (e === undefined) {
    return {
      capMs: GIT_SERVER_PROGRESS_CAP_DEFAULT_MS,
      invalid: undefined,
      clamped: undefined,
    }
  }
  if (e === '0' || e.toLowerCase() === 'off') {
    return { capMs: 0, invalid: undefined, clamped: undefined }
  }
  const t = Number(e)
  if (Number.isInteger(t) && t > 0) {
    const capMs = Math.min(Math.max(t, GIT_SILENCE_BUDGET_MS), GIT_HARD_CAP_MS)
    return {
      capMs,
      invalid: undefined,
      clamped: capMs === t ? undefined : e,
    }
  }
  return {
    capMs: GIT_SERVER_PROGRESS_CAP_DEFAULT_MS,
    invalid: e,
    clamped: undefined,
  }
}

/** densable `nWd` */
export function fetchDepthArgs(repoExisted: boolean): string[] {
  if (repoExisted) return []
  const { depth } = resolveFetchDepth()
  return depth === undefined ? [] : ['--depth', String(depth)]
}

/** densable `sWd` */
export function failFastFetchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CLAUDE_RUNNER_FAIL_FAST_FETCH)
}

/** densable `Ljy` */
export function deltaResetEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CCR_DELTA_RESET)
}

/** densable `Yjy` */
export function resolveSourceGitUrl(source: GitPrepareSource): string {
  if (source.url) {
    if (!isSafeGitUrl(source.url)) {
      throw new Error(
        `Unsupported git URL protocol (only https/http/ssh/user@host:path allowed): ${source.url}`,
      )
    }
    return source.url
  }
  switch (source.type) {
    case 'github':
      return `https://github.com/${source.repo}`
    case 'github-ssh':
      throw new Error(
        `github-ssh source for '${source.repo}' is missing url — SSH URLs are not synthesizable from slug alone`,
      )
    case 'test-file':
      return `file://${source.repo}`
    default:
      throw new Error(`Unsupported git source type: ${source.type}`)
  }
}

/** densable `Y7s` — embed token into https URL */
export function embedTokenInGitUrl(url: string, token?: string): string {
  if (!token) return url
  if (url.startsWith('git@') || url.startsWith('ssh://')) return url
  let r: URL
  try {
    r = new URL(url)
  } catch {
    return url
  }
  if (r.protocol !== 'https:') return url
  if (token.startsWith('sk-ant-ccsr-')) {
    r.username = 'unused'
    r.password = token
  } else {
    r.username = token
  }
  return r.toString()
}

/** densable `Jjy` — map repo → single outcome branch */
export function mapOutcomeBranches(
  outcomes: OutcomeTarget[],
): Map<string, string> {
  const t = new Map<string, string>()
  for (const r of outcomes) {
    const n = r.branches ?? []
    const [o, ...i] = n
    if (i.length > 0) {
      throw new Error(
        `Outcome for ${r.repo} has ${n.length} branches, expected 0 or 1`,
      )
    }
    if (o) t.set(r.repo, o)
  }
  return t
}

/** densable `Vjy` — first non-option git verb */
export function gitVerb(args: string[]): string | undefined {
  for (let t = 0; t < args.length; t++) {
    if (args[t] === '-c' || args[t] === '--git-dir' || args[t] === '-C') {
      t++
      continue
    }
    return args[t]
  }
  return undefined
}

/** densable `K7s` — credential helper shell snippet reading env var */
export function proxyTokenCredHelperSnippet(envName: string): string {
  return `!f() { if test "$1" = get; then printf 'username=unused\\npassword=%s\\n' "$${envName}"; fi; }; f`
}

/** densable `E4o` */
export function proxyCredHelperArgs(gitURL: string): string[] {
  const origin = new URL(gitURL).origin
  return [
    '-c',
    'credential.helper=',
    '-c',
    `credential.${origin}.helper=`,
    '-c',
    `credential.${origin}.helper=${proxyTokenCredHelperSnippet(SHR_GIT_PROXY_TOKEN_ENV)}`,
  ]
}

/** densable `w4o` */
export function proxySslArgs(gitURL: string): string[] {
  const origins = ['', `${new URL(gitURL).origin}.`, `${gitURL}.`]
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    ''
  const o: string[] = proxy ? ['-c', `remote.origin.proxy=${proxy}`] : []
  for (const i of origins) {
    if (proxy) o.push('-c', `http.${i}proxy=${proxy}`)
    o.push('-c', `http.${i}sslVerify=true`)
  }
  return o
}

/** densable `qjy` */
export function fetchAttemptExtraConfig(
  attempt: number,
  failFast: boolean,
): string[] {
  const r: string[] = []
  if (failFast && attempt < GIT_LOWSPEED_ATTEMPTS) {
    r.push(
      '-c',
      `http.lowSpeedLimit=${GIT_LOWSPEED_LIMIT}`,
      '-c',
      `http.lowSpeedTime=${GIT_LOWSPEED_TIME}`,
    )
  }
  if (attempt >= 3) r.push('-c', 'http.version=HTTP/1.1')
  return r
}

/** densable `v4o` (byoc permanent ref) */
export function isPermanentFetchRefError(msg: string): boolean {
  const t = msg.toLowerCase()
  return PERMANENT_REF_MARKERS.some(r => t.includes(r))
}

/** densable `Ijy` */
export function isProgressLine(line: string): boolean {
  const sideband = line.startsWith('remote: ')
  const t = sideband ? line.slice(8) : line
  return (
    GIT_PROGRESS_RE.test(t) || (sideband && GIT_ENUMERATING_OBJECTS_RE.test(t))
  )
}

/** densable `Rjy` */
export function parseGitProgressChunk(
  chunk: string,
  midLine = false,
): {
  display?: GitProgress
  client?: GitProgress
  server?: GitProgress
  remoteLines: number
} {
  let display: GitProgress | undefined
  let client: GitProgress | undefined
  let server: GitProgress | undefined
  let remoteLines = 0
  let lines = chunk.split(/\r|\n/)
  if (midLine) lines = lines.slice(1)
  for (const i of lines) {
    if (i.length === 0) continue
    const sideband = i.startsWith('remote: ')
    if (sideband) remoteLines++
    const a = sideband ? i.slice(8) : i
    const l = GIT_PROGRESS_RE.exec(a)
    if (l === null) {
      if (sideband) {
        const enumMatch = GIT_ENUMERATING_OBJECTS_RE.exec(a)
        if (enumMatch !== null) {
          const done = Number(enumMatch[2])
          server = {
            sideband,
            label: enumMatch[1]!,
            pct: 0,
            done,
            raw: `remote: ${enumMatch[1]}: ${done}`,
          }
        }
      }
      continue
    }
    const [, c, u, d, p, f, m] = l
    const h: GitProgress = {
      sideband,
      label: c!,
      pct: Math.min(100, Number(u)),
      done: d !== undefined ? Number(d) : undefined,
      total: p !== undefined ? Number(p) : undefined,
      bytes:
        f !== undefined && m !== undefined
          ? Math.round(Number(f) * (BYTE_UNITS[m] ?? 0))
          : undefined,
      raw: `${sideband ? 'remote: ' : ''}${c}: ${u}%${d !== undefined ? ` (${d}/${p})` : ''}`,
    }
    display = h
    if (sideband) server = h
    else client = h
  }
  return { display, client, server, remoteLines }
}

/** densable `Mt` — server-side progress advance check */
export function isServerForwardProgress(
  prev: GitProgress | undefined,
  seenLabels: Set<string>,
  next: GitProgress,
): boolean {
  if (prev === undefined || next.label !== prev.label) {
    return !seenLabels.has(next.label)
  }
  if (next.done !== undefined && prev.done !== undefined) {
    return next.done > prev.done
  }
  if ((next.done === undefined) !== (prev.done === undefined)) return false
  return next.pct > prev.pct
}

/** densable `xjy` */
export function isResolvingDeltasComplete(p: GitProgress): boolean {
  return p.label === 'Resolving deltas' && p.pct === 100
}

/** densable `kjy` */
export function isForwardProgress(
  prev: GitProgress | undefined,
  next: GitProgress,
): boolean {
  if (prev === undefined) return true
  if (next.label !== prev.label) return true
  if (next.done !== undefined && prev.done !== undefined) {
    return next.done > prev.done || (next.bytes ?? 0) > (prev.bytes ?? 0)
  }
  return next.pct > prev.pct
}

/** densable `hWd` — prefer fatal/error lines first */
export function preferFatalLines(text: string): string {
  if (!text) return ''
  const fatals: string[] = []
  for (const n of text.split('\n')) {
    if (GIT_FATAL_LINE_RE.test(n)) fatals.push(n)
  }
  if (fatals.length === 0) return text
  const r = fatals.join('\n')
  if (text.startsWith(r)) return text
  return `${r}\n${text}`
}

/** densable `Pjy` */
export function formatGitStderr(
  stderr: string,
  truncated: boolean,
  authURL: string,
  token?: string,
): string {
  const o = truncated ? stderr.replace(/^[^\r\n]*[\r\n]?/, '') : stderr
  const i = redactGitOutput(o, authURL, token)
    .split(/\r|\n/)
    .filter(a => a.length > 0 && !isProgressLine(a))
    .join('\n')
  const s = preferFatalLines(i)
  return GIT_FATAL_LINE_RE.test(s) ? s.slice(0, 2000) : s.slice(-2000)
}

/** densable `sBh` */
export function prepStepEvent(
  stepId: string,
  status: 'started' | 'completed' | 'failed',
  content: string,
  extra?: Record<string, string>,
): PrepStepEvent {
  return {
    type: 'env_manager_log',
    uuid: randomUUID(),
    data: {
      level: status === 'failed' ? 'error' : 'info',
      category: 'init',
      content,
      timestamp: new Date().toISOString(),
      extra: {
        step_id: stepId,
        step_status: status,
        ...extra,
      },
    },
  }
}

/** densable `Ujv` */
export function prepClonePhaseEvent(
  repo: string,
  phase: string,
  ms: number,
  extra?: Record<string, string>,
): PrepStepEvent {
  return prepStepEvent('clone', 'completed', `${repo} ${phase} (${ms}ms)`, {
    ...extra,
    step_detail: repo,
    clone_phase: phase,
    duration_ms: String(ms),
  })
}

// ── process helpers ──────────────────────────────────────────────────────────

/** densable `Sr` (abortable sleep) */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
  opts?: { throwOnAbort?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      if (opts?.throwOnAbort)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      else resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      if (opts?.throwOnAbort) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      } else resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** densable `Kjy` — hard-cap abort controller linked to parent signal */
export function hardCapSignal(
  parent: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; dispose: () => void } {
  const r = new AbortController()
  const n = setTimeout(() => r.abort(), ms)
  if (typeof n === 'object' && 'unref' in n) {
    ;(n as NodeJS.Timeout).unref()
  }
  let o: (() => void) | undefined
  if (parent) {
    if (parent.aborted) {
      clearTimeout(n)
      r.abort()
      const s = (): void => {}
      return { signal: r.signal, dispose: s }
    }
    o = () => {
      clearTimeout(n)
      r.abort()
    }
    parent.addEventListener('abort', o, { once: true })
  }
  r.signal.addEventListener('abort', () => clearTimeout(n))
  const dispose = (): void => {
    clearTimeout(n)
    if (parent && o) parent.removeEventListener('abort', o)
  }
  return { signal: r.signal, dispose }
}

/** densable `WE_` — ps enumeration race timeout (ms) */
export const KILL_PROCESS_TREE_ENUM_TIMEOUT_MS = 500

/**
 * Official 2.1.323 #1991 (`HB`) — spawn `ps` with timeout + SIGKILL so slow
 * process listings do not pile up, and drop any truncated trailing line when
 * terminated by a signal.
 */
export function spawnPsPidPpid(
  timeoutMs: number = KILL_PROCESS_TREE_ENUM_TIMEOUT_MS,
  spawnImpl: typeof spawn = spawn,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnImpl('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
        cwd: '/',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      })
    } catch (err) {
      reject(err)
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      out += typeof chunk === 'string' ? chunk : chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (_code, signal) =>
      resolve(signal ? out.slice(0, out.lastIndexOf('\n') + 1) : out),
    )
  })
}

/**
 * densable `VE_` — BFS descendants of `rootPid` via ps pid/ppid map.
 * Empty set on spawn failure or timeout (best-effort).
 */
export async function listProcessDescendants(
  rootPid: number,
): Promise<Set<number>> {
  let table: string
  try {
    table = await Promise.race([
      spawnPsPidPpid(),
      new Promise<string>(resolve => {
        const t = setTimeout(
          () => resolve(''),
          KILL_PROCESS_TREE_ENUM_TIMEOUT_MS,
        )
        if (typeof t === 'object' && 'unref' in t) t.unref()
      }),
    ])
  } catch {
    return new Set()
  }
  const byParent = new Map<number, number[]>()
  for (const line of table.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s*$/)
    if (!m) continue
    const pid = Number(m[1])
    const ppid = Number(m[2])
    const list = byParent.get(ppid)
    if (list) list.push(pid)
    else byParent.set(ppid, [pid])
  }
  const descendants = new Set<number>()
  const queue = [rootPid]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const child of byParent.get(cur) ?? []) {
      if (child > 1 && child !== rootPid && !descendants.has(child)) {
        descendants.add(child)
        queue.push(child)
      }
    }
  }
  return descendants
}

/**
 * densable `Ane` / `GE_` / `VE_` / `KE_` — kill process tree 1:1.
 * Enumerate descendants via ps, kill process group, then each descendant.
 * Errors swallowed (Ane catches GE_ rejection).
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGKILL',
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) return
  try {
    const descendants = await listProcessDescendants(pid)
    try {
      process.kill(-pid, signal)
    } catch (err) {
      try {
        process.kill(pid, signal)
      } catch {
        /* ignore */
      }
      // densable: log group_kill when not ESRCH — best-effort only
      const code =
        err !== null && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : undefined
      if (code !== 'ESRCH') {
        /* swallow — no tengu analytics in SHR path */
      }
    }
    for (const child of descendants) {
      try {
        process.kill(child, signal)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* densable Ane: GE_.catch(()=>{}) */
  }
}

/** densable `Mbn` / phase wrapper `z7s` */
export async function withGitPhase<T>(
  ctx: GitRepoCtx,
  phase: string,
  fn: () => Promise<T>,
  extra?: Record<string, string>,
): Promise<T> {
  const n = Date.now()
  const o = await fn()
  const ms = Date.now() - n
  ctx.onDebug(
    `[byoc:git] phase ${phase} ${ms}ms${extra ? ` ${JSON.stringify(extra)}` : ''}`,
  )
  try {
    ctx.onPhase?.(phase, ms, extra)
  } catch (err) {
    ctx.onDebug(`[byoc:git] onPhase callback threw: ${errText(err)}`)
  }
  return o
}

// ── rR: git spawn with progress + watchdog ───────────────────────────────────

/**
 * densable `rR` — spawn git with progress parse, silence/hard-cap watchdog,
 * auth helper for fetch/ls-remote when getAuthToken present.
 */
export async function runGitPrepare(
  ctx: GitRepoCtx,
  cwd: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
  hardCapMs: number = GIT_HARD_CAP_MS,
  exitInfo?: { exitCode?: number | null },
): Promise<string> {
  const hasProxyAuth = ctx.getAuthToken !== undefined
  const verb = gitVerb(args)
  const authCmd = verb !== undefined && AUTH_GIT_COMMANDS.has(verb)
  const token = hasProxyAuth && authCmd ? ctx.getAuthToken!() : undefined
  const cmdArgs = [
    ...GIT_SAFE_CONFIG_ARGS,
    '-c',
    'http.proxyAuthMethod=basic',
    ...(hasProxyAuth && authCmd ? proxySslArgs(ctx.gitURL) : []),
    ...(token ? proxyCredHelperArgs(ctx.gitURL) : []),
    ...(ctx.governedMount && authCmd ? GIT_LFS_LOCKS_FALSE : []),
    ...args,
  ]
  const secret = token ?? ctx.token
  const debugArgs = cmdArgs.map(w =>
    redactGitArg(w, ctx.authURL, ctx.gitURL, secret),
  )
  ctx.onDebug(`[byoc:git] git ${debugArgs.join(' ')} (dir=${cwd || '.'})`)
  const clearGitConfig = !authCmd || hasProxyAuth || Boolean(ctx.token)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    ...ctx.gitEnvironment?.envOverrides,
    ...(token ? { [SHR_GIT_PROXY_TOKEN_ENV]: token } : undefined),
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: undefined,
    ...(hasProxyAuth ? { GIT_CONFIG_GLOBAL: '/dev/null' } : undefined),
    ...(clearGitConfig ? { GIT_CONFIG: undefined } : undefined),
    GIT_TERMINAL_PROMPT: '0',
    // densable 2.1.229 #23 — rR: GCM_INTERACTIVE:h0t.GCM_INTERACTIVE (fail-fast GCM)
    GCM_INTERACTIVE: GIT_H0T_ENV.GCM_INTERACTIVE,
    LC_ALL: 'C',
    GIT_PROGRESS_DELAY: '0',
    ...GIT_SCRUB_ENV,
    ...(ctx.authURL.startsWith('file://')
      ? {
          GIT_ALLOW_PROTOCOL: `file:${GIT_SCRUB_ENV.GIT_ALLOW_PROTOCOL}`,
        }
      : undefined),
    GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes -o ConnectTimeout=30`,
  }
  if (clearGitConfig) {
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === 'GIT_CONFIG') env[key] = undefined
    }
  }
  const { signal: f, dispose: m } = hardCapSignal(ctx.signal, hardCapMs)
  const noAuthVerb = verb !== undefined && NO_AUTH_GIT_COMMANDS.has(verb)
  let silenceBudget = noAuthVerb
    ? GIT_LONG_FS_TIMEOUT_MS
    : GIT_SILENCE_BUDGET_MS
  const initialSilenceBudget = silenceBudget
  let effectiveBudget = initialSilenceBudget
  let lastProgress: GitProgress | undefined
  let lastForwardAt = Date.now()
  const preTransferCapMs = resolveFetchServerProgressCapMs().capMs
  let lastServerProgress: GitProgress | undefined
  const seenServerLabels = new Set<string>()
  let lastServerProgressAt: number | undefined
  let killReason: 'silence' | 'hard-cap' | 'escalated' | undefined
  let truncated = false
  const startedAt = Date.now()
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('git', cmdArgs, {
        cwd: cwd || undefined,
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const chunks: Buffer[] = []
      let outLen = 0
      let stderrTail = ''
      let midLine = false
      let lastLogAt = 0
      let lastLoggedPct = -1
      let lastLabel: string | undefined
      let settled = false
      let escalated = false
      let escalateTimer: ReturnType<typeof setTimeout> | undefined
      let silenceTimer: ReturnType<typeof setTimeout> | undefined

      const unref = (t: ReturnType<typeof setTimeout>): void => {
        if (typeof t === 'object' && t && 'unref' in t) {
          ;(t as NodeJS.Timeout).unref()
        }
      }

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(silenceTimer)
        clearTimeout(escalateTimer)
        f.removeEventListener('abort', onAbort)
        reject(err)
      }
      const ok = (stdout: string): void => {
        if (settled) return
        settled = true
        clearTimeout(silenceTimer)
        clearTimeout(escalateTimer)
        f.removeEventListener('abort', onAbort)
        resolve(stdout)
      }

      const armSilence = (budget: number = silenceBudget): void => {
        clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          killReason = 'silence'
          child.kill('SIGTERM')
          escalateTimer = setTimeout(() => {
            if (escalated) return
            child.kill('SIGKILL')
            killReason = 'escalated'
            escalated = true
            fail(
              Object.assign(new Error('git did not exit after SIGTERM'), {
                stdout: Buffer.concat(chunks).toString('utf8'),
                stderr: stderrTail,
              }),
            )
          }, GIT_SIGTERM_GRACE_MS)
          unref(escalateTimer)
        }, budget)
        unref(silenceTimer!)
      }
      armSilence(initialSilenceBudget)

      child.stdout?.on('data', (re: Buffer) => {
        if (outLen < 10_485_760) {
          chunks.push(re)
          outLen += re.length
        }
      })
      child.stderr?.on('data', (re: Buffer) => {
        const ie = re.toString('utf8')
        const oe = stderrTail + ie
        if (oe.length > 8192) truncated = true
        stderrTail = oe.slice(-8192)
        const { display, client, server } = parseGitProgressChunk(ie, midLine)
        if (ie.length > 0) midLine = !/[\r\n]$/.test(ie)
        if (client) {
          if (
            silenceBudget < GIT_SILENCE_BUDGET_AFTER_DELTAS_MS &&
            isResolvingDeltasComplete(client)
          ) {
            silenceBudget = GIT_SILENCE_BUDGET_AFTER_DELTAS_MS
            effectiveBudget = silenceBudget
            armSilence()
          }
          if (isForwardProgress(lastProgress, client)) {
            lastForwardAt = Date.now()
            effectiveBudget = silenceBudget
            armSilence()
          }
          lastProgress = client
        } else if (server !== undefined && lastProgress === undefined) {
          if (
            isServerForwardProgress(
              lastServerProgress,
              seenServerLabels,
              server,
            )
          ) {
            lastServerProgress = server
            const capRemaining = startedAt + preTransferCapMs - Date.now()
            if (preTransferCapMs > 0 && capRemaining > 0) {
              lastServerProgressAt = Date.now()
              const nextSlice = Math.min(silenceBudget, capRemaining)
              const initialRemaining =
                startedAt + initialSilenceBudget - Date.now()
              effectiveBudget =
                nextSlice > initialRemaining
                  ? silenceBudget
                  : initialSilenceBudget
              armSilence(Math.max(nextSlice, initialRemaining))
            }
          }
          seenServerLabels.add(server.label)
        }
        if (display) {
          if (display.label !== lastLabel) {
            lastLabel = display.label
            lastLoggedPct = -1
          }
          const bucket = Math.floor(display.pct / 10)
          const elapsed = Date.now() - lastLogAt
          if (
            elapsed >= GIT_PROGRESS_LOG_MIN_BUCKET_MS &&
            (elapsed >= GIT_PROGRESS_LOG_MIN_MS ||
              bucket > Math.floor(lastLoggedPct / 10))
          ) {
            lastLogAt = Date.now()
            lastLoggedPct = display.pct
            try {
              ctx.onDebug(`[byoc:git] ${verb ?? 'git'}: ${display.raw}`)
              ctx.onProgress?.(verb ?? 'git', display)
            } catch {
              /* ignore callback errors */
            }
          }
        }
      })

      const onAbort = (): void => {
        if (ctx.signal?.aborted) {
          child.kill('SIGTERM')
          escalateTimer ??= setTimeout(() => {
            if (escalated) return
            child.kill('SIGKILL')
            escalated = true
            const re = Object.assign(new Error('The operation was aborted'), {
              name: 'AbortError',
              stderr: stderrTail,
            })
            fail(re)
          }, GIT_SIGTERM_GRACE_MS)
          unref(escalateTimer)
        } else {
          killReason = 'hard-cap'
          child.kill('SIGTERM')
          escalateTimer ??= setTimeout(() => {
            if (escalated) return
            child.kill('SIGKILL')
            killReason = 'escalated'
            escalated = true
            fail(
              Object.assign(new Error('git did not exit after SIGTERM'), {
                stdout: Buffer.concat(chunks).toString('utf8'),
                stderr: stderrTail,
              }),
            )
          }, GIT_SIGTERM_GRACE_MS)
          unref(escalateTimer)
        }
      }
      if (f.aborted) onAbort()
      else f.addEventListener('abort', onAbort, { once: true })

      let spawnErr: Error | undefined
      child.on('error', re => {
        spawnErr = re
      })
      child.on('close', (code, sig) => {
        if (exitInfo) exitInfo.exitCode = code
        if (escalated) return
        escalated = true
        clearTimeout(silenceTimer)
        clearTimeout(escalateTimer)
        f.removeEventListener('abort', onAbort)
        const stdout = Buffer.concat(chunks).toString('utf8')
        if (ctx.signal?.aborted && killReason === undefined) {
          const de = Object.assign(new Error('The operation was aborted'), {
            name: 'AbortError',
            stdout,
            stderr: stderrTail,
            code,
            signal: sig,
          })
          fail(de)
          return
        }
        if (spawnErr) {
          fail(
            Object.assign(spawnErr, {
              stdout,
              stderr: stderrTail,
            }),
          )
          return
        }
        if (code === 0) {
          ok(stdout)
          return
        }
        const se = Object.assign(
          new Error(
            sig !== null
              ? `git exited on signal ${sig}`
              : `git exited with code ${code}`,
          ),
          { stdout, stderr: stderrTail, code, signal: sig },
        )
        fail(se)
      })
    })
  } catch (w) {
    const C = w as {
      message?: string
      stderr?: string
      stdout?: string
    }
    if (killReason !== undefined) {
      const R = lastProgress
        ? ` at ${lastProgress.label} ${lastProgress.pct}%${lastProgress.total ? ` (${lastProgress.done}/${lastProgress.total})` : ''}`
        : ''
      const now = Date.now()
      const P = now - lastForwardAt
      let silenceMsg = `no forward progress for ${P}ms (budget ${effectiveBudget}ms)${R}`
      if (
        lastProgress === undefined &&
        lastServerProgress !== undefined &&
        lastServerProgressAt !== undefined
      ) {
        const srv = lastServerProgress
        const srvDetail =
          srv.done !== undefined
            ? srv.pct > 0
              ? ` ${srv.pct}% (${srv.done}${srv.total !== undefined ? `/${srv.total}` : ''})`
              : ` ${srv.done}`
            : ` ${srv.pct}%`
        const srvSuffix = ` — no pack data received; server-side progress last advanced ${now - lastServerProgressAt}ms ago at ${srv.label}${srvDetail}`
        silenceMsg =
          preTransferCapMs >= initialSilenceBudget &&
          now - startedAt >= preTransferCapMs
            ? `pre-transfer cap ${preTransferCapMs}ms reached with no client-side progress${srvSuffix}`
            : `no client-side progress for ${now - startedAt}ms and server-side progress stopped advancing (budget ${effectiveBudget}ms)${srvSuffix}`
      }
      const O =
        killReason === 'silence'
          ? silenceMsg
          : killReason === 'hard-cap'
            ? `hard cap ${hardCapMs}ms after ${now - startedAt}ms${R}`
            : `did not exit within ${GIT_SIGTERM_GRACE_MS}ms of SIGTERM (D-state? — last forward ${P}ms ago)${R}`
      ctx.onDebug(
        `[runner:stuck] git ${debugArgs.join(' ')} (dir=${cwd || '.'}) — ${O} — killing subprocess`,
      )
    }
    const A =
      C.stderr !== undefined && C.stderr.length > 0
        ? formatGitStderr(C.stderr, truncated, ctx.authURL, secret)
        : preferFatalLines(
            redactGitOutput(C.stdout || C.message || '', ctx.authURL, secret),
          ).slice(0, 2000)
    const k = killReason !== undefined ? ` (watchdog: ${killReason})` : ''
    throw new Error(`git ${verb ?? '?'} failed${k}: ${A}`)
  } finally {
    m()
  }
}

// ── pipeline stages ──────────────────────────────────────────────────────────

/** densable `tWd` */
async function normalizeOriginFetch(ctx: GitRepoCtx): Promise<void> {
  await runGitPrepare(ctx, ctx.repoPath, [
    '--git-dir',
    join(ctx.repoPath, '.git'),
    'config',
    '--replace-all',
    'remote.origin.fetch',
    '+refs/heads/*:refs/remotes/origin/*',
    '^\\+?refs/heads/',
  ]).catch(t =>
    ctx.onDebug(
      `[byoc:git] Could not normalize remote.origin.fetch: ${errText(t)}`,
    ),
  )
}

/** densable `Bjy` */
export async function validateRepoAccess(
  ctx: GitRepoCtx,
  repo = '',
  throttleBackoff = false,
): Promise<void> {
  const backoff = 2000 + Math.random() * 2000
  let last: unknown
  let exitInfo: { exitCode?: number | null } = {}
  for (let n = 0; n < GIT_VALIDATE_ATTEMPTS; n++) {
    if (n > 0) {
      const throttled =
        throttleBackoff &&
        classifyRepositoryThrottle(
          errText(last),
          exitInfo.exitCode,
          ctx.gitURL,
        ) !== undefined
      const o = backoff * 2 ** (n - 1) * (throttled ? 6 : 1)
      ctx.onDebug(
        `[byoc:git] Validation retry ${n + 1}/${GIT_VALIDATE_ATTEMPTS}, backing off ${Math.round(o)}ms`,
      )
      await abortableSleep(o, ctx.signal, { throwOnAbort: true })
    }
    exitInfo = {}
    try {
      await runGitPrepare(
        ctx,
        '',
        ['ls-remote', '--heads', ctx.authURL, 'HEAD'],
        undefined,
        undefined,
        exitInfo,
      )
      if (n > 0) {
        ctx.onDebug(`[byoc:git] Validation succeeded on attempt ${n + 1}`)
      }
      return
    } catch (o) {
      last = o
    }
  }
  throw new RepositoryAccessError(last, ctx.getAuthToken !== undefined, {
    repo,
    gitURL: ctx.gitURL,
    lastAttemptExitCode: exitInfo.exitCode,
  })
}

/** densable `Ujy` — ensure local repo (prefetched or fresh init) */
export async function ensureRepository(
  ctx: GitRepoCtx,
  baseDir: string,
): Promise<boolean> {
  try {
    await runGitPrepare(ctx, ctx.repoPath, [
      '--git-dir',
      join(ctx.repoPath, '.git'),
      'remote',
      'set-url',
      'origin',
      ctx.authURL,
    ])
    await runGitPrepare(ctx, ctx.repoPath, [
      '--git-dir',
      join(ctx.repoPath, '.git'),
      'config',
      '--unset-all',
      'remote.origin.pushurl',
    ]).catch(() => {})
    await normalizeOriginFetch(ctx)
    ctx.onDebug(`[byoc:git] Prefetched repo found at ${ctx.repoPath}`)
    return true
  } catch {
    /* fall through to init */
  }
  ctx.onDebug(`[byoc:git] No prefetched repo, fresh init at ${ctx.repoPath}`)
  await withTimeoutMs(
    mkdir(baseDir, { recursive: true }),
    GIT_MKDIR_TIMEOUT_MS,
    `[runner:stuck] mkdir ${baseDir} (check NFS/CSI mount health)`,
  )
  const repoParentDir = dirname(ctx.repoPath)
  if (repoParentDir !== baseDir) {
    await withTimeoutMs(
      mkdir(repoParentDir, { recursive: true }),
      GIT_MKDIR_TIMEOUT_MS,
      `[runner:stuck] mkdir ${repoParentDir} (check NFS/CSI mount health)`,
    )
  }
  await runGitPrepare(ctx, '', ['init', ctx.repoPath])
  await runGitPrepare(ctx, ctx.repoPath, ['config', 'gc.auto', '0']).catch(
    () => {},
  )
  await runGitPrepare(ctx, ctx.repoPath, [
    'remote',
    'add',
    'origin',
    ctx.authURL,
  ]).catch(() =>
    runGitPrepare(ctx, ctx.repoPath, [
      'remote',
      'set-url',
      'origin',
      ctx.authURL,
    ]),
  )
  await normalizeOriginFetch(ctx)
  return false
}

/** densable `Wjy` — empty remote? */
async function isEmptyRemote(ctx: GitRepoCtx): Promise<boolean> {
  try {
    return (
      (
        await runGitPrepare(ctx, ctx.repoPath, [
          'ls-remote',
          '--symref',
          ctx.authURL,
          'HEAD',
        ])
      ).trim() === ''
    )
  } catch {
    return false
  }
}

/** densable `lWd` — fetch with retries */
export async function fetchWithRetry(
  ctx: GitRepoCtx,
  args: string[],
  onFirstFail?: () => Promise<boolean>,
  failFast = false,
): Promise<boolean> {
  const wallStart = Date.now()
  let backoff = 4000 + Math.random() * 4000
  let last: unknown
  let lastExitCode: number | null | undefined
  const samples: string[] = []
  const sample = (u: string): string =>
    u.length <= GIT_ERR_SAMPLE_MAX
      ? u
      : `${u.slice(0, GIT_ERR_SAMPLE_HEAD)}…${u.slice(-(GIT_ERR_SAMPLE_MAX - GIT_ERR_SAMPLE_HEAD - 1))}`
  const extra = (): Record<string, string> =>
    samples.length > 0 ? { attempt_errors: JSON.stringify(samples) } : {}

  for (let u = 0; u < GIT_FETCH_ATTEMPTS; u++) {
    if (u > 0) {
      const f = backoff * 2 ** (u - 1)
      ctx.onDebug(
        `[byoc:git] Fetch retry ${u + 1}/${GIT_FETCH_ATTEMPTS}, backing off ${Math.round(f)}ms`,
      )
      await abortableSleep(f, ctx.signal, { throwOnAbort: true })
    }
    const d = [
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
      ...fetchAttemptExtraConfig(u, failFast),
      ...args,
    ]
    const p =
      u === GIT_FETCH_ATTEMPTS - 1
        ? { ...process.env, GIT_TRACE_PACKET: '1' }
        : undefined
    try {
      const remaining = GIT_HARD_CAP_MS - (Date.now() - wallStart)
      await runGitPrepare(ctx, ctx.repoPath, d, p, Math.max(1, remaining))
      if (u > 0) {
        ctx.onDebug(`[byoc:git] Fetch succeeded on attempt ${u + 1}`)
      }
      await withGitPhase(ctx, 'fetch', async () => {}, {
        attempts: String(u + 1),
        ...extra(),
      })
      return true
    } catch (f) {
      last = f
      lastExitCode =
        f !== null && typeof f === 'object' && 'exitCode' in f
          ? (f as { exitCode?: number | null }).exitCode
          : undefined
      const m = errText(f)
      ctx.onDebug(`[byoc:git] Fetch attempt ${u + 1} failed: ${m}`)
      samples.push(sample(redactSecretsInText(m)))
      if (Date.now() - wallStart >= GIT_HARD_CAP_MS) {
        ctx.onDebug(
          `[byoc:git] Fetch cumulative wall-clock ${Date.now() - wallStart}ms ≥ hard cap — not retrying`,
        )
        if (isPermanentFetchRefError(m)) {
          throw new FetchRefNotFoundError(m)
        }
        throw new Error(
          `git fetch failed (cumulative hard cap after ${u + 1} attempts): ${m}`,
        )
      }
      if (u === 0 && onFirstFail && !(await onFirstFail())) return false
      if (isPermanentFetchRefError(m)) {
        ctx.onDebug(
          '[byoc:git] Fetch error is permanent (ref not found on a non-empty remote) — skipping remaining retries',
        )
        throw new FetchRefNotFoundError(m)
      }
    }
  }
  const finalMsg = `git fetch failed after ${GIT_FETCH_ATTEMPTS} attempts: ${errText(last)}`
  const throttle = classifyRepositoryThrottle(
    errText(last),
    lastExitCode,
    ctx.gitURL,
  )
  if (throttle !== undefined) {
    throw new FetchThrottledError(finalMsg, throttle)
  }
  throw new Error(finalMsg)
}

/** densable `U7s` — fetch + reset/checkout */
export async function fetchAndCheckout(
  ctx: GitRepoCtx,
  ref: string | undefined,
  skipReset: boolean,
  repoExisted: boolean,
): Promise<void> {
  const o = ref || 'HEAD'
  const i = ['fetch', ...fetchDepthArgs(repoExisted), '--progress']
  if (!ref) i.push('--no-tags')
  i.push('origin', o)
  let s = ''
  if (!skipReset && deltaResetEnabled()) {
    s = await runGitPrepare(ctx, ctx.repoPath, ['rev-parse', 'HEAD^{commit}'])
      .then(c => c.trim())
      .catch(() => '')
    if (!/^[0-9a-f]{40,64}$/.test(s)) s = ''
  }
  let empty = false
  const l = await fetchWithRetry(
    ctx,
    i,
    async () => {
      empty = await isEmptyRemote(ctx)
      return !empty
    },
    repoExisted && failFastFetchEnabled(),
  )
  if (empty) {
    ctx.onDebug('[byoc:git] Repository is empty, skipping checkout')
    if (ctx.sanitized) {
      const gitDir = join(ctx.repoPath, '.git')
      const exitInfo: { exitCode?: number | null } = {}
      await runGitPrepare(
        ctx,
        ctx.repoPath,
        ['--git-dir', gitDir, 'read-tree', 'HEAD'],
        undefined,
        GIT_HARD_CAP_MS,
        exitInfo,
      ).then(
        () => {
          ctx.sanitized?.onIndexFromHead?.()
        },
        async err => {
          ctx.signal?.throwIfAborted()
          ctx.onDebug(
            `[byoc:git] Could not read HEAD into the index: ${errText(err)}`,
          )
          if (
            typeof exitInfo.exitCode !== 'number' ||
            exitInfo.exitCode > 128
          ) {
            await unlink(join(gitDir, 'index.lock')).catch(() => {})
          }
        },
      )
    }
    return
  }
  if (!l) throw new Error(`git fetch failed for ${ctx.gitURL}`)
  await runGitPrepare(ctx, ctx.repoPath, [
    'update-ref',
    'refs/remotes/origin/HEAD',
    'FETCH_HEAD^{commit}',
  ]).catch(c =>
    ctx.onDebug(`[byoc:git] Could not set origin/HEAD: ${errText(c)}`),
  )
  if (skipReset) {
    ctx.onDebug(
      '[byoc:git] Fetched to FETCH_HEAD, skipping reset-hard (worktree mode)',
    )
    return
  }
  await runGitPrepare(ctx, ctx.repoPath, [
    'update-ref',
    '--no-deref',
    'HEAD',
    'HEAD',
  ]).catch(() => {})
  await withGitPhase(ctx, 'reset', async () => {
    if (s !== '') {
      try {
        await runGitPrepare(ctx, ctx.repoPath, [
          '-c',
          'core.checkStat=minimal',
          '-c',
          'core.trustctime=false',
          'read-tree',
          '-m',
          '-u',
          '-v',
          s,
          'FETCH_HEAD^{commit}',
        ])
        await runGitPrepare(ctx, ctx.repoPath, [
          'update-ref',
          'HEAD',
          'FETCH_HEAD^{commit}',
        ])
        return
      } catch (c) {
        ctx.onDebug(
          `[byoc:git] Delta reset failed, falling back to reset --hard: ${errText(c)}`,
        )
      }
    }
    await runGitPrepare(ctx, ctx.repoPath, [
      '-c',
      'core.checkStat=minimal',
      '-c',
      'core.trustctime=false',
      'reset',
      '--hard',
      'FETCH_HEAD^{commit}',
    ])
  })
}

/** densable `zjy` */
export async function refResolvesLocally(
  ctx: GitRepoCtx,
  ref: string,
): Promise<boolean> {
  try {
    await runGitPrepare(ctx, ctx.repoPath, [
      'rev-parse',
      '--verify',
      '--quiet',
      ref,
    ])
    return true
  } catch {
    return false
  }
}

/** densable `uWd` */
export async function remoteBranchExists(
  ctx: GitRepoCtx,
  branch: string,
): Promise<boolean> {
  try {
    return (
      (
        await runGitPrepare(ctx, ctx.repoPath, [
          'ls-remote',
          '--heads',
          ctx.authURL,
          `refs/heads/${branch}`,
        ])
      ).trim().length > 0
    )
  } catch {
    return false
  }
}

/** densable `cWd` */
export async function fetchAndCheckoutBranch(
  ctx: GitRepoCtx,
  branch: string,
  repoExisted: boolean,
): Promise<void> {
  await fetchWithRetry(
    ctx,
    ['fetch', ...fetchDepthArgs(repoExisted), '--progress', 'origin', branch],
    undefined,
    repoExisted && failFastFetchEnabled(),
  )
  await runGitPrepare(ctx, ctx.repoPath, [
    'checkout',
    '--progress',
    '--force',
    '-B',
    branch,
    'FETCH_HEAD',
  ])
}

/** densable `jjy` */
export async function ensureTargetBranch(
  ctx: GitRepoCtx,
  branch: string,
  repoExisted: boolean,
): Promise<void> {
  const cur = await runGitPrepare(ctx, ctx.repoPath, [
    'branch',
    '--show-current',
  ])
    .then(s => s.trim())
    .catch(() => '')
  if (cur === branch) {
    ctx.onDebug(`[byoc:git] Already on target branch ${branch}`)
    return
  }
  if (await remoteBranchExists(ctx, branch)) {
    ctx.onDebug('[byoc:git] Target branch exists on remote, fetching')
    await fetchAndCheckoutBranch(ctx, branch, repoExisted)
  } else {
    ctx.onDebug(`[byoc:git] Creating local branch ${branch} from HEAD`)
    await runGitPrepare(ctx, ctx.repoPath, ['checkout', '-B', branch])
    await runGitPrepare(ctx, ctx.repoPath, [
      'update-ref',
      `refs/remotes/origin/${branch}`,
      'HEAD',
    ]).catch(() => {})
  }
}

/**
 * densable `Fjy` — prepare one source repo at baseDir.
 */
export async function prepareOneRepo(opts: {
  baseDir: string
  /** Official 2.1.328 (#548): explicit target directory from `--repository-folder`. */
  repoPath?: string
  source: GitPrepareSource
  targetBranch?: string
  skipValidation?: boolean
  alwaysFetch?: boolean
  skipReset?: boolean
  onDebug: (msg: string) => void
  onPhase?: (phase: string, ms: number, extra?: Record<string, string>) => void
  onProgress?: (cmd: string, progress: GitProgress) => void
  signal?: AbortSignal
}): Promise<{ repoExisted: boolean }> {
  const {
    baseDir: t,
    repoPath: explicitRepoPath,
    source: r,
    targetBranch: n,
    skipValidation: o,
    alwaysFetch: i,
    skipReset: s,
    onDebug: a,
    onPhase: l,
    onProgress: c,
    signal: u,
  } = opts
  const d = resolveSourceGitUrl(r)
  const p = r.getAuthToken ? d : embedTokenInGitUrl(d, r.token)
  const f =
    explicitRepoPath ??
    sourceCanonicalPath(t, {
      type: r.type,
      repo: r.repo,
    })
  if (!f) {
    throw new Error(`Could not determine repository directory for: ${r.repo}`)
  }
  if (r.ref && !isSafeGitRevision(r.ref)) {
    throw new Error(`Invalid ref: ${r.ref}`)
  }
  if (n && !isSafeGitRevision(n)) {
    throw new Error(`Invalid target branch: ${n}`)
  }
  const m = Date.now()
  a(
    `[byoc:git] Preparing ${r.repo} at ${f} (ref=${r.ref ?? 'HEAD'}, auth=${r.getAuthToken ? 'git-proxy' : p !== d})`,
  )
  const { invalid: h } = resolveFetchDepth()
  if (h !== undefined) {
    a(
      `[byoc:git] Ignoring CLAUDE_RUNNER_FETCH_DEPTH='${h}' — expected 'full', '0', or a positive integer; using default ${DEFAULT_FETCH_DEPTH}`,
    )
  }
  const serverCap = resolveFetchServerProgressCapMs()
  if (serverCap.invalid !== undefined) {
    a(
      `[byoc:git] Ignoring CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS='${serverCap.invalid}' — expected a positive integer (milliseconds), '0' or 'off'; using default ${GIT_SERVER_PROGRESS_CAP_DEFAULT_MS}`,
    )
  } else if (serverCap.clamped !== undefined) {
    a(
      `[byoc:git] CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS='${serverCap.clamped}' is ${serverCap.capMs === GIT_HARD_CAP_MS ? 'above the thirty-minute ceiling' : 'below the two-minute floor'}; using ${serverCap.capMs} ms`,
    )
  }
  const g: GitRepoCtx = {
    repoPath: f,
    gitURL: d,
    authURL: p,
    token: r.token,
    getAuthToken: r.getAuthToken,
    governedMount: r.governedMount,
    sanitized: r.sanitized,
    onDebug: a,
    onPhase: l,
    onProgress: c,
    signal: u,
  }
  if (!o) {
    await withGitPhase(g, 'validateAccess', () => validateRepoAccess(g, r.repo))
  }
  const _ = await withGitPhase(g, 'ensureRepository', () =>
    ensureRepository(g, t),
  )
  if (i) {
    await fetchAndCheckout(g, r.ref, s ?? false, _)
  } else if (_ && !r.ref) {
    a('[byoc:git] Using prefetched repo as-is (no ref requested)')
  } else if (_ && r.ref) {
    if (n && (await remoteBranchExists(g, n))) {
      a(`[byoc:git] Task branch ${n} exists on remote, fetching it`)
      await fetchAndCheckoutBranch(g, n, _)
      a(`[byoc:git] Ready: ${r.repo} (${Date.now() - m}ms)`)
      return { repoExisted: _ }
    }
    if (await refResolvesLocally(g, r.ref)) {
      a(`[byoc:git] Ref ${r.ref} resolves locally, skipping fetch`)
      await runGitPrepare(g, g.repoPath, [
        'checkout',
        '--progress',
        '--force',
        r.ref,
      ])
    } else {
      await fetchAndCheckout(g, r.ref, false, _)
    }
  } else {
    await fetchAndCheckout(g, r.ref, false, _)
  }
  if (n) await ensureTargetBranch(g, n, _)
  a(`[byoc:git] Ready: ${r.repo} (${Date.now() - m}ms)`)
  return { repoExisted: _ }
}

/** densable `$jy` — timed prepareOneRepo with telemetry hooks (no-op Se/me) */
export async function prepareOneRepoTimed(
  opts: Parameters<typeof prepareOneRepo>[0],
): Promise<{ repoExisted: boolean }> {
  const t = Date.now()
  try {
    const { repoExisted: r } = await prepareOneRepo(opts)
    opts.onDebug(
      `[byoc:git] byoc_git_prepare_repo ok repo_existed=${r} duration_ms=${Date.now() - t}`,
    )
    return { repoExisted: r }
  } catch (r) {
    opts.onDebug(
      `[byoc:git] byoc_git_prepare_repo error duration_ms=${Date.now() - t}`,
    )
    throw r
  }
}

/**
 * densable `aWd` — prepare all sources under baseDir (built-in clone path).
 */
export async function prepareSources(opts: {
  baseDir: string
  /** Official 2.1.328 (#548): explicit target path override (single-source call from sessionHandler). */
  repoPath?: string
  /** Official 2.1.328 (#548): `--repository-folder` mappings resolved per source. */
  repositoryFolders?: readonly RepositoryFolderMapping[]
  sources: GitPrepareSource[]
  outcomes?: OutcomeTarget[]
  skipValidation?: boolean
  alwaysFetch?: boolean
  skipReset?: boolean
  onDebug: (msg: string) => void
  onPhase?: (phase: string, ms: number, extra?: Record<string, string>) => void
  onProgress?: (cmd: string, progress: GitProgress) => void
  signal?: AbortSignal
}): Promise<void> {
  const {
    baseDir: t,
    repoPath: explicitRepoPath,
    repositoryFolders,
    sources: r,
    outcomes: n,
    skipValidation: o,
    alwaysFetch: i,
    skipReset: s,
    onDebug: a,
    onPhase: l,
    onProgress: c,
    signal: u,
  } = opts
  const d = mapOutcomeBranches(n ?? [])
  for (const p of r) {
    if (!isCheckoutHookSourceType(p.type)) {
      a(`[byoc:git] Skipping unsupported source type: ${p.type}`)
      continue
    }
    const resolvedRepoPath =
      explicitRepoPath ??
      (repositoryFolders && repositoryFolders.length > 0
        ? (() => {
            const fallback = sourceCanonicalPath(t, {
              type: p.type,
              repo: p.repo,
            })
            return fallback
              ? resolveRepositoryFolderPath(p.repo, repositoryFolders, fallback)
              : undefined
          })()
        : undefined)
    await prepareOneRepoTimed({
      baseDir: t,
      repoPath: resolvedRepoPath,
      source: p,
      targetBranch: d.get(p.repo),
      skipValidation: o ?? false,
      alwaysFetch: i ?? false,
      skipReset: s ?? true,
      onDebug: a,
      onPhase: l,
      onProgress: c,
      signal: u,
    })
  }
}

// ── sanitize / locks ─────────────────────────────────────────────────────────

/** densable `Sjv` — unset credential.helper in local repo */
export async function resetStaleGitProxyCredHelper(
  repoPath: string,
  onDebug: (msg: string) => void,
  forceUnlock: boolean,
): Promise<void> {
  if (forceUnlock) {
    await rm(join(repoPath, '.git', 'config.lock'), { force: true }).catch(
      () => {},
    )
  }
  await new Promise<void>(resolve => {
    const o = spawn(
      'git',
      [
        '-C',
        repoPath,
        'config',
        '--local',
        '--unset-all',
        'credential.helper',
        '^$',
      ],
      { cwd: undefined, stdio: 'ignore', windowsHide: true },
    )
    const i = setTimeout(() => {
      try {
        o.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, GIT_SHORT_OP_TIMEOUT_MS)
    const s = (a: number | null): void => {
      clearTimeout(i)
      if (a !== 0 && a !== 5 && a !== null) {
        onDebug(
          `[runner:session] stale git-proxy reset sweep in ${repoPath} exited ${a}`,
        )
      }
      resolve()
    }
    o.on('close', s)
    o.on('error', () => s(null))
  })
}

/** densable `JJl` — recursive unlink of symlinks (and dirs if recurse) */
async function purgeSymlinks(
  path: string,
  recurseDirs: boolean,
): Promise<void> {
  let r: string[]
  try {
    r = await readdir(path)
  } catch (n) {
    const o = (n as NodeJS.ErrnoException).code
    if (o === 'ENOENT' || o === 'ENOTDIR') return
    throw n
  }
  for (const n of r) {
    const o = join(path, n)
    let i
    try {
      i = await lstat(o)
    } catch (s) {
      const a = (s as NodeJS.ErrnoException).code
      if (a === 'ENOENT' || a === 'ENOTDIR') continue
      throw s
    }
    if (i.isSymbolicLink()) {
      await rm(o, { force: true })
      continue
    }
    if (recurseDirs && i.isDirectory()) await purgeSymlinks(o, true)
  }
}

/**
 * densable `_jv` — sanitize canonical .git for git-proxy cross-session isolation.
 */
export async function sanitizeCanonicalGitState(
  repoPath: string,
  onDebug: (msg: string) => void,
  originUrl?: string,
): Promise<void> {
  const n = join(repoPath, '.git')
  let o
  try {
    o = await lstat(n)
  } catch (a) {
    const l = (a as NodeJS.ErrnoException).code
    if (l === 'ENOENT' || l === 'ENOTDIR') return
    throw new Error(
      `git-proxy: could not sanitize canonical ${repoPath} before prep — ${errText(a)}`,
    )
  }
  if (!o.isDirectory()) {
    await rm(n, { force: true })
    onDebug(
      `[runner:session] sanitized canonical at ${repoPath}: .git was not a directory (gitlink/symlink) — removed, will fresh-init`,
    )
    return
  }
  const i = originUrl?.replace(/^(https?:\/\/)[^/@]*@/, '$1')
  // densable: refuse C0 control chars in origin URL after credential strip
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional C0 range check
  if (i && /[\x00-\x1f]/.test(i)) {
    throw new Error('git-proxy: sanitize refused — control char in origin URL')
  }
  const s =
    `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n\tcheckStat = minimal\n\ttrustctime = false\n` +
    (i
      ? `[remote "origin"]\n\turl = ${i}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
      : '')
  try {
    const a = await readdir(n)
    for (const f of a) {
      const m = CANONICAL_KEEP.get(f)
      if (m) {
        // Official 2.1.328 (#630): only treat ENOENT/ENOTDIR as missing; a
        // temporary disk error (EIO/ESTALE/etc.) must fail the start instead of
        // falling through to `rm` and deleting a kept clone's objects or refs!
        const h = await lstat(join(n, f)).catch((err: unknown) => {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
          throw err
        })
        if (!h) continue
        if (
          !h.isSymbolicLink() &&
          (m === 'dir' ? h.isDirectory() : h.isFile())
        ) {
          continue
        }
        onDebug(
          `[runner:session] sanitize: kept entry .git/${f} has unexpected type — removing`,
        )
      }
      await rm(join(n, f), { recursive: true, force: true })
    }
    try {
      await rm(join(n, 'refs', 'heads'))
      onDebug(
        '[runner:session] sanitize: .git/refs/heads was not a directory — removed (a reftable repository leaves a placeholder file there)',
      )
    } catch (b) {
      const code = (b as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ERR_FS_EISDIR') throw b
    }
    await purgeSymlinks(join(n, 'refs'), true)
    await purgeSymlinks(join(n, 'objects'), false)
    await rm(join(n, 'objects', 'info'), { recursive: true, force: true })
    await rm(join(n, 'objects', 'pack', 'multi-pack-index'), {
      recursive: true,
      force: true,
    })
    const l = join(n, 'HEAD')
    const c = await lstat(l).catch(() => undefined)
    const u =
      c && c.size <= 1024 ? await readFile(l, 'utf-8').catch(() => '') : ''
    const d = /^ref: (refs\/[A-Za-z0-9._/-]+)\n?$/.exec(u)
    const validRef =
      d &&
      d[1]!
        .split('/')
        .every(
          f =>
            f.length > 0 &&
            !f.startsWith('.') &&
            !f.endsWith('.') &&
            !f.endsWith('.lock') &&
            !f.includes('..'),
        )
    if (/^ref: refs\/heads\/\.invalid\n?$/.test(u)) {
      await rm(l, { force: true })
      await writeFile(l, 'ref: refs/heads/main\n', {
        flag: 'wx',
        mode: 0o644,
      })
    } else if (!validRef && !/^[0-9a-f]{40}([0-9a-f]{24})?\n?$/.test(u)) {
      await rm(l, { force: true })
    }
    await writeFile(join(n, 'config'), s, { mode: 0o644 })
    onDebug(
      `[runner:session] sanitized canonical .git/ at ${repoPath} (git-proxy cross-session isolation)`,
    )
  } catch (a) {
    throw new Error(
      `git-proxy: could not sanitize canonical ${repoPath} before prep — ${errText(a)}`,
    )
  }
}

/**
 * densable `hjv` — whether to sanitize canonical (false = trust prewarm skip).
 */
export function shouldSanitizeCanonical(
  onStatus: (msg: string) => void,
  canonicalPath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!env.CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM) return true
  const r = Number(env.SELF_HOSTED_RUNNER_DRAIN_GRACE_MS ?? 0)
  if (Number.isFinite(r) && r > 0) {
    onStatus(
      `[runner:warn] CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM ignored: drain-grace is ${r}ms (> 0), so a prior session could have written to the canonical — sanitizing anyway`,
    )
    return true
  }
  onStatus(
    `[runner:session] CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM — skipping sanitizeCanonicalGitState for ${canonicalPath} (trusted one-shot prewarm)`,
  )
  return false
}

/**
 * densable `ijv` + Official 2.1.328 (#635) — per-key serial lock map.
 * When `signal` is supplied and aborts while waiting for another session's
 * repo preparation on the same key (`--capacity > 1`), stop waiting immediately
 * so archiving or requeueing takes effect without blocking on the peer session.
 */
export async function withCanonicalLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>(resolve => {
    release = resolve
  })
  locks.set(key, mine)
  let acquired = false
  try {
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
          return
        }
        const onAbort = () => {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        prev
          .catch(() => {})
          .then(() => {
            signal.removeEventListener('abort', onAbort)
            if (signal.aborted) {
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            } else {
              resolve()
            }
          })
      })
    } else {
      await prev.catch(() => {})
    }
    acquired = true
    return await fn()
  } finally {
    // Release our slot in the chain (wait for prev only if we didn't acquire yet
    // so downstream waiters don't overlap with prev's still-running prep).
    if (acquired) {
      release()
      if (locks.get(key) === mine) locks.delete(key)
    } else {
      void prev
        .catch(() => {})
        .finally(() => {
          release()
          if (locks.get(key) === mine) locks.delete(key)
        })
    }
  }
}

export type RepositoryFolderMapping = {
  /** Exact `owner/repo` or wildcard `owner/*`. */
  repository: string
  /** Absolute target folder path (cannot be a symbolic link). */
  dir: string
}

const REPO_FOLDER_SPEC_RE = /^([a-zA-Z0-9._-]+\/(?:[a-zA-Z0-9._-]+|\*))=(.+)$/

/**
 * Official 2.1.328 (#548) — parse `--repository-folder <owner/repo=path>` or
 * `<owner/*=dir>` for `--capacity 1`.
 */
export function parseRepositoryFolderSpec(
  raw: string,
): RepositoryFolderMapping {
  const match = REPO_FOLDER_SPEC_RE.exec(raw.trim())
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `--repository-folder cannot read "${raw}". Use <owner/repo>=<absolute-path> or <owner/*>=<absolute-dir>.`,
    )
  }
  const repository = match[1]
  let dir = match[2].trim()
  if (repository.endsWith('/*') && dir.endsWith('/*')) {
    dir = dir.slice(0, -2)
  }
  if (!dir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dir)) {
    throw new Error(
      `--repository-folder path for ${repository} must be an absolute path: "${dir}"`,
    )
  }
  return { repository, dir }
}

const HOME_SETTINGS_SEGMENT_RE = /^(\.|Library$|AppData$)/i

async function resolveBestRealpath(p: string): Promise<string> {
  const abs = resolve(p)
  try {
    return await realpath(abs)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if ((code === 'ENOENT' || code === 'ENOTDIR') && dirname(abs) !== abs) {
      return join(await resolveBestRealpath(dirname(abs)), basename(abs))
    }
    return abs
  }
}

/**
 * Official 2.1.328 `Dc` (#548) — validate `--repository-folder` mappings:
 * requires `--capacity 1`, validates existence/directory/no-symlink via
 * `realpath` + `stat().isDirectory()`, rejects overlap with baseDir/tempDirs,
 * rejects `$HOME` itself, parents of `$HOME`, and home settings dirs
 * (`.*`, `Library`, `AppData`), while allowing normal subdirectories of `$HOME`.
 */
export async function validateRepositoryFolderSpecs(
  specs: readonly RepositoryFolderMapping[],
  opts: {
    capacity: number
    baseDir: string
    homeDir?: string
    temporaryDirs?: readonly string[]
  },
): Promise<void> {
  if (specs.length === 0) return
  if (opts.capacity !== 1) {
    throw new Error(
      '--repository-folder requires --capacity 1 (sessions share the named folder directly).',
    )
  }
  const seenRepos = new Set<string>()
  const seenDirs: Array<{ repository: string; dir: string }> = []
  const rawForbiddenRoots = [
    opts.baseDir,
    ...(opts.temporaryDirs ?? ['/tmp', '/var/tmp', '/dev/shm']),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const forbiddenRoots = await Promise.all(
    rawForbiddenRoots.map(p => resolveBestRealpath(p)),
  )
  const normHome =
    typeof opts.homeDir === 'string' && opts.homeDir.length > 0
      ? await resolveBestRealpath(opts.homeDir)
      : undefined
  const homePrefix =
    normHome !== undefined
      ? normHome.endsWith(sep)
        ? normHome
        : normHome + sep
      : undefined

  for (const spec of specs) {
    const key = spec.repository.toLowerCase()
    if (seenRepos.has(key)) {
      throw new Error(
        `--repository-folder lists "${spec.repository}" more than once.`,
      )
    }
    seenRepos.add(key)

    const normalizedDir = resolve(spec.dir)
    let realDir: string
    try {
      realDir = await realpath(normalizedDir)
    } catch (err) {
      throw new Error(
        `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: ${errText(err)}. It has to be there when the runner starts.`,
      )
    }
    let dirStat: Awaited<ReturnType<typeof stat>>
    try {
      dirStat = await stat(realDir)
    } catch (err) {
      throw new Error(
        `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: ${errText(err)}`,
      )
    }
    if (!dirStat.isDirectory()) {
      throw new Error(
        `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: it is no folder.`,
      )
    }
    if (realDir !== normalizedDir) {
      throw new Error(
        `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: path cannot be a symbolic link (real path: ${realDir}).`,
      )
    }

    const dirPrefix = normalizedDir.endsWith(sep)
      ? normalizedDir
      : normalizedDir + sep
    for (const normRoot of forbiddenRoots) {
      const rootPrefix = normRoot.endsWith(sep) ? normRoot : normRoot + sep
      if (
        normalizedDir === normRoot ||
        normalizedDir.startsWith(rootPrefix) ||
        normRoot.startsWith(dirPrefix)
      ) {
        throw new Error(
          `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: overlaps with ${normRoot}.`,
        )
      }
    }

    if (normHome !== undefined && homePrefix !== undefined) {
      if (normalizedDir === normHome || normHome.startsWith(dirPrefix)) {
        throw new Error(
          `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: it is or holds the home directory (${normHome}).`,
        )
      }
      if (normalizedDir.startsWith(homePrefix)) {
        const firstSeg = relative(normHome, normalizedDir).split(sep)[0] ?? ''
        if (HOME_SETTINGS_SEGMENT_RE.test(firstSeg)) {
          throw new Error(
            `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: it lies in the home directory where the settings of the user's programs stand.`,
          )
        }
      }
    }

    for (const prev of seenDirs) {
      const prevPrefix = prev.dir.endsWith(sep) ? prev.dir : prev.dir + sep
      if (
        normalizedDir === prev.dir ||
        normalizedDir.startsWith(prevPrefix) ||
        prev.dir.startsWith(dirPrefix)
      ) {
        throw new Error(
          `--repository-folder cannot use "${spec.dir}" for ${spec.repository}: overlaps with ${prev.repository} (${prev.dir}).`,
        )
      }
    }
    seenDirs.push({ repository: spec.repository, dir: normalizedDir })
  }
}

/**
 * Official 2.1.328 (#548) — resolve the folder path for a repository using
 * `--repository-folder` mappings (exact `owner/repo` wins over `owner/*`),
 * falling back to `fallbackPath` under `--base-dir`.
 */
export function resolveRepositoryFolderPath(
  repo: string,
  specs: readonly RepositoryFolderMapping[] | undefined,
  fallbackPath: string,
): string {
  if (!specs || specs.length === 0) return fallbackPath
  const lower = repo.toLowerCase()
  const exact = specs.find(s => s.repository.toLowerCase() === lower)
  if (exact) return exact.dir
  const slashIdx = repo.indexOf('/')
  if (slashIdx > 0) {
    const owner = repo.slice(0, slashIdx)
    const name = repo.slice(slashIdx + 1)
    const wild = specs.find(
      s => s.repository.toLowerCase() === `${owner.toLowerCase()}/*`,
    )
    if (wild && name && !name.includes('/') && name !== '.' && name !== '..') {
      return join(wild.dir, name)
    }
  }
  return fallbackPath
}

/**
 * Official 2.1.328 (#681) — at `--capacity 1`, refuse a session early (before
 * cloning/fetching) when the path of a repository it pushes to is a symbolic link.
 */
export async function assertPushTargetRepoPathNotSymlink(
  repoPath: string,
  baseDir?: string,
): Promise<void> {
  const st = await lstat(repoPath).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw err
  })
  if (st?.isSymbolicLink()) {
    throw new Error(
      `Refusing session at --capacity 1: repository path "${repoPath}" is a symbolic link.`,
    )
  }
  // Also check intermediate segments between baseDir and repoPath if under baseDir
  if (baseDir) {
    const normBase = baseDir.replace(/[/\\]+$/, '')
    const normRepo = repoPath.replace(/[/\\]+$/, '')
    if (normRepo.startsWith(normBase + '/')) {
      const relParts = normRepo.slice(normBase.length + 1).split('/')
      let cur = normBase
      for (const seg of relParts) {
        cur = join(cur, seg)
        const segSt = await lstat(cur).catch((err: unknown) => {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
          throw err
        })
        if (segSt?.isSymbolicLink()) {
          throw new Error(
            `Refusing session at --capacity 1: repository path "${repoPath}" traverses a symbolic link at "${cur}".`,
          )
        }
      }
    }
  }
}

/**
 * densable `pWd` — add detached worktree at FETCH_HEAD.
 */
export async function addSessionWorktree(opts: {
  canonicalRepoPath: string
  worktreePath: string
  ref?: string
  onDebug: (msg: string) => void
  signal?: AbortSignal
}): Promise<void> {
  const { canonicalRepoPath: t, worktreePath: r, onDebug: o, signal: i } = opts
  if (r === t) {
    throw new Error(
      'addSessionWorktree: worktreePath must not equal canonicalRepoPath',
    )
  }
  const s: GitRepoCtx = {
    repoPath: t,
    gitURL: '',
    authURL: '',
    onDebug: o,
    signal: i,
  }
  const a = (
    await runGitPrepare(s, t, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  ).trim()
  let l: string | undefined
  try {
    l = (
      await runGitPrepare(s, r, [
        '--git-dir',
        join(r, '.git'),
        'rev-parse',
        'HEAD',
      ])
    ).trim()
  } catch (u) {
    if (i?.aborted) throw u
  }
  if (l === a) {
    const u = (
      await runGitPrepare(s, r, ['rev-parse', '--absolute-git-dir'])
    ).trim()
    await writeFile(join(u, 'FETCH_HEAD'), `${a}\n`).catch(() => {})
    o(`[byoc:git] Worktree ${r} already at ${a.slice(0, 12)} — keeping`)
    return
  }
  o(
    l
      ? `[byoc:git] Worktree ${r} at wrong commit ${l.slice(0, 12)}, clearing before re-add`
      : `[byoc:git] Clearing ${r} before worktree add`,
  )
  await withTimeoutMs(
    rm(r, { recursive: true, force: true }),
    GIT_LONG_FS_TIMEOUT_MS,
    `[runner:stuck] rm ${r} (check NFS/CSI mount health)`,
  ).catch(u => {
    o(`[byoc:git] rm ${r} failed (continuing): ${u}`)
  })
  await runGitPrepare(s, t, ['worktree', 'prune']).catch(u => {
    o(`[byoc:git] worktree prune failed (continuing): ${u}`)
  })
  try {
    await runGitPrepare(s, t, ['worktree', 'add', '--detach', r, a])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('is a missing but already registered worktree')) {
      throw err
    }
    o(
      `[byoc:git] git still registers ${r} with its folder gone; pruning and retrying worktree add`,
    )
    await runGitPrepare(s, t, ['worktree', 'prune']).catch(() => {})
    await runGitPrepare(s, t, ['worktree', 'add', '--detach', r, a])
  }
  const c = (
    await runGitPrepare(s, r, ['rev-parse', '--absolute-git-dir'])
  ).trim()
  await writeFile(join(c, 'FETCH_HEAD'), `${a}\n`)
  o(`[byoc:git] Added worktree ${r} at ${a.slice(0, 12)} (detached)`)
}

// ── push-outcome helpers ─────────────────────────────────────────────────────

/** densable `V2h` */
export function revParseVerify(
  repoPath: string,
  rev: string,
  timeoutMs = GIT_SHORT_OP_TIMEOUT_MS,
): Promise<string | undefined> {
  return new Promise(n => {
    let o = false
    const i = (c: string | undefined): void => {
      if (o) return
      o = true
      clearTimeout(l)
      n(c)
    }
    const s = spawn(
      'git',
      [...GIT_SAFE_CONFIG_ARGS, '-C', repoPath, 'rev-parse', '--verify', rev],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        cwd: undefined,
        env: { ...process.env, ...GIT_SCRUB_ENV },
        windowsHide: true,
      },
    )
    let a = ''
    s.stdout?.on('data', c => {
      a += String(c)
    })
    const l = setTimeout(() => {
      try {
        s.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      i(undefined)
    }, timeoutMs)
    s.on('close', c => i(c === 0 ? a.trim() : undefined))
    s.on('error', () => i(undefined))
  })
}

/** densable `Pjv` — checkout -B outcome branch (best-effort) */
export function createOutcomeBranch(
  repoPath: string,
  branch: string,
  onDebug: (msg: string) => void,
  signal?: AbortSignal,
  scrubEnv = false,
  startPoint?: string,
  spawnImpl: typeof spawn = spawn,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise(a => {
    let l = false
    const c = (): void => {
      if (l) return
      l = true
      clearTimeout(m)
      signal?.removeEventListener('abort', p)
      a()
    }
    const u = spawnImpl(
      'git',
      [
        ...GIT_SAFE_CONFIG_ARGS,
        '-C',
        repoPath,
        'checkout',
        '-B',
        branch,
        ...(startPoint ? [startPoint] : []),
      ],
      {
        cwd: undefined,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          ...GIT_SCRUB_ENV,
          ...(scrubEnv
            ? {
                GIT_CONFIG_GLOBAL: '/dev/null',
                CLAUDE_CODE_SESSION_ACCESS_TOKEN: undefined,
              }
            : undefined),
        },
      },
    )
    let d = ''
    u.stderr?.on('data', h => {
      d += String(h)
    })
    const p = (): void => {
      try {
        u.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      c()
    }
    signal?.addEventListener('abort', p, { once: true })
    const f = startPoint ? GIT_LONG_FS_TIMEOUT_MS : GIT_SHORT_OP_TIMEOUT_MS
    const m = setTimeout(() => {
      onDebug(
        `[runner:session] checkout -B '${branch}' in ${repoPath} timed out after ${f}ms — continuing on current HEAD`,
      )
      try {
        u.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      c()
    }, f)
    u.on('close', h => {
      if (h === 0) {
        onDebug(
          `[runner:session] created outcome branch '${branch}' in ${repoPath}`,
        )
      } else {
        onDebug(
          `[runner:session] checkout -B '${branch}' in ${repoPath} exited ${h}: ${d.trim()} — continuing on current HEAD`,
        )
      }
      c()
    })
    u.on('error', h => {
      onDebug(
        `[runner:session] checkout -B '${branch}' spawn failed: ${h} — continuing on current HEAD`,
      )
      c()
    })
  })
}

/** densable `iBh` — hardened git args for push-on-release resume */
export function hardenedGitAuth(source: GitPrepareSource): {
  args: string[]
  authURL: string
  token?: string
  env: NodeJS.ProcessEnv
} {
  const t = source.url ?? ''
  const r = source.getAuthToken ? source.getAuthToken() : source.token
  const n = source.getAuthToken ? t : embedTokenInGitUrl(t, source.token)
  let o: string | undefined
  try {
    const a = new URL(t)
    if (a.protocol === 'https:' || a.protocol === 'http:') o = a.origin
  } catch {
    /* ignore */
  }
  const i =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    ''
  const s: string[] = [...GIT_SAFE_CONFIG_ARGS]
  if (o) {
    s.push('-c', 'http.sslVerify=true')
    s.push('-c', `http.${o}.sslVerify=true`)
    s.push('-c', `http.${t}.sslVerify=true`)
    if (i) {
      s.push('-c', `http.proxy=${i}`)
      s.push('-c', `http.${o}.proxy=${i}`)
      s.push('-c', `http.${t}.proxy=${i}`)
    }
    if (r) {
      if (source.getAuthToken) s.push(...proxyCredHelperArgs(t))
      else {
        s.push('-c', 'credential.helper=')
        s.push('-c', `credential.${o}.helper=`)
      }
    }
  }
  return {
    args: s,
    authURL: n,
    token: r,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      ...GIT_SCRUB_ENV,
      ...(t.startsWith('file://')
        ? {
            GIT_ALLOW_PROTOCOL: `file:${GIT_SCRUB_ENV.GIT_ALLOW_PROTOCOL}`,
          }
        : undefined),
      GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes -o ConnectTimeout=30`,
      SELF_HOSTED_RUNNER_HOST_CONFIG_DIR: undefined,
      ...(r
        ? {
            GIT_CONFIG_GLOBAL: '/dev/null',
            [SHR_GIT_PROXY_TOKEN_ENV]: source.getAuthToken ? r : undefined,
          }
        : undefined),
    },
  }
}

/**
 * densable `Djv` — fetch prior outcome branch for push-on-release resume.
 */
export function fetchPriorOutcomeBranch(
  repoPath: string,
  branch: string,
  source: GitPrepareSource,
  timeoutMs: number,
  onDebug: (msg: string) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  if (!isSafeGitRevision(branch)) {
    onDebug(
      `[runner:session] push-on-release resume: branch '${branch}' rejected by isSafeRefName (refspec metachar guard); skipping fetch`,
    )
    return Promise.resolve(false)
  }
  const s = hardenedGitAuth(source)
  return new Promise(a => {
    let l = false
    const c = (m: boolean): void => {
      if (l) return
      l = true
      clearTimeout(f)
      signal?.removeEventListener('abort', u)
      a(m)
    }
    const u = (): void => {
      try {
        d.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      c(false)
    }
    const d = spawn(
      'git',
      [
        ...s.args,
        '-C',
        repoPath,
        'fetch',
        '--no-write-fetch-head',
        s.authURL,
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        cwd: undefined,
        env: s.env,
        windowsHide: true,
      },
    )
    let p = ''
    d.stderr?.on('data', m => {
      p += String(m)
    })
    signal?.addEventListener('abort', u, { once: true })
    const f = setTimeout(() => {
      onDebug(
        `[runner:session] push-on-release resume: fetch '${branch}' timed out after ${timeoutMs}ms; starting from source HEAD (best-effort)`,
      )
      try {
        d.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      c(false)
    }, timeoutMs)
    d.on('close', m => {
      if (m === 0) {
        onDebug(
          `[runner:session] push-on-release resume: fetched prior '${branch}' from source remote; starting from preserved work`,
        )
        c(true)
      } else {
        onDebug(
          `[runner:session] push-on-release resume: no prior '${branch}' on source remote (${redactGitOutput(p, s.authURL, s.token).trim() || `exit ${m}`}); starting from source HEAD`,
        )
        c(false)
      }
    })
    d.on('error', () => c(false))
  })
}

/**
 * densable `Ojv` — fetch extra outcome branches into remotes (best-effort).
 */
export async function fetchOutcomeBranches(
  repoPath: string,
  branches: string[],
  onDebug: (msg: string) => void,
  signal?: AbortSignal,
  spawnImpl: typeof spawn = spawn,
  allowFileProtocol = false,
  hardenedGitUrl?: string,
  governedAuth?: { url: string; getToken: () => string },
): Promise<void> {
  if (hardenedGitUrl && governedAuth) {
    throw new Error(
      'fetchOutcomeBranches: hardenedGitUrl and governedAuth are mutually exclusive',
    )
  }
  let l = 0
  const c = governedAuth?.url
  for (const u of branches) {
    if (signal?.aborted) return
    const d = `+refs/heads/${u}:refs/remotes/origin/${u}`
    const code = await new Promise<number | null>(f => {
      let m = false
      const h = (T: number | null): void => {
        if (m) return
        m = true
        clearTimeout(S)
        signal?.removeEventListener('abort', b)
        f(T)
      }
      const g: ChildProcess = spawnImpl(
        'git',
        [
          '-C',
          repoPath,
          ...GIT_SAFE_CONFIG_ARGS,
          ...(hardenedGitUrl ? proxySslArgs(hardenedGitUrl) : []),
          ...(c
            ? [
                ...proxySslArgs(c),
                ...proxyCredHelperArgs(c),
                ...GIT_LFS_LOCKS_FALSE,
              ]
            : []),
          '-c',
          'http.proxyAuthMethod=basic',
          'fetch',
          '--no-progress',
          '--no-tags',
          '--end-of-options',
          c ?? 'origin',
          d,
        ],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...process.env,
            ...GIT_SCRUB_ENV,
            ...(hardenedGitUrl || c
              ? { GIT_CONFIG_GLOBAL: '/dev/null' }
              : undefined),
            ...(governedAuth
              ? {
                  [SHR_GIT_PROXY_TOKEN_ENV]: governedAuth.getToken(),
                  CLAUDE_CODE_SESSION_ACCESS_TOKEN: undefined,
                }
              : undefined),
            ...(allowFileProtocol
              ? {
                  GIT_ALLOW_PROTOCOL: `file:${GIT_SCRUB_ENV.GIT_ALLOW_PROTOCOL}`,
                }
              : undefined),
            GIT_TERMINAL_PROMPT: '0',
            GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes -o ConnectTimeout=30`,
          },
        },
      )
      let _ = ''
      g.stderr?.on('data', T => {
        _ += String(T)
      })
      const b = (): void => {
        if (g.pid) void killProcessTree(g.pid)
        h(null)
      }
      signal?.addEventListener('abort', b, { once: true })
      const S = setTimeout(() => {
        onDebug(
          `[runner:session] fetch outcome branch in ${repoPath} timed out after ${OUTCOME_FETCH_TIMEOUT_MS}ms — continuing`,
        )
        if (g.pid) void killProcessTree(g.pid)
        h(null)
      }, OUTCOME_FETCH_TIMEOUT_MS)
      g.on('close', T => {
        if (T !== 0) {
          onDebug(
            `[runner:session] fetch outcome branch in ${repoPath} exited ${T}: ${_.trim()} — continuing`,
          )
        }
        h(T)
      })
      g.on('error', T => {
        onDebug(
          `[runner:session] fetch outcome branch spawn failed: ${T} — continuing`,
        )
        h(null)
      })
    })
    if (code === 0) l++
  }
  if (branches.length > 0) {
    onDebug(
      `[runner:session] fetched ${l}/${branches.length} outcome branch(es) in ${repoPath}`,
    )
  }
}

// ── push_targets + residual session helpers (Ajv/Rjv/Tjv/vjv/Hjv/fWd/Mjv) ───

/** densable `Ajv` — extract outcome targets from remote push_targets */
export function mapPushTargetsFromRemote(
  pushTargets: unknown[],
): OutcomeTarget[] {
  const t: OutcomeTarget[] = []
  for (const r of pushTargets) {
    if (r === null || typeof r !== 'object') continue
    const o = r as {
      type?: unknown
      git_info?: { repo?: unknown; branches?: unknown }
    }
    if (o.type !== 'git_repository' || !o.git_info?.repo) continue
    const repo = String(o.git_info.repo)
    const branches = Array.isArray(o.git_info.branches)
      ? o.git_info.branches.map(String)
      : []
    t.push({ repo, branches })
  }
  return t
}

/**
 * densable `Rjv` — filter safe branch names; Map<repo, branches[]>.
 * Unlike mapOutcomeBranches (Jjy, first-only), keeps full multi-branch lists.
 */
export function mapOutcomeBranchLists(
  outcomes: OutcomeTarget[],
): Map<string, string[]> {
  const t = new Map<string, string[]>()
  for (const r of outcomes) {
    const n: string[] = []
    for (const o of r.branches ?? []) {
      if (o && isSafeGitRevision(o) && !n.includes(o)) n.push(o)
    }
    if (n.length > 0) t.set(r.repo, n)
  }
  return t
}

/**
 * densable finally Be cleanup — unset repo-local proxy credential.helper entries
 * written by Tjv:
 *   git config --local --unset-all credential.helper '^$'
 *   git config --local --unset-all credential.<origin>.helper
 */
export async function unsetGitProxyRepoLocalCredHelper(
  repoPath: string,
  proxyApiBaseUrl: string,
  onDebug?: (msg: string) => void,
): Promise<void> {
  let origin: string
  try {
    origin = new URL(proxyApiBaseUrl).origin
  } catch {
    return
  }
  const ops: string[][] = [
    [
      '-C',
      repoPath,
      'config',
      '--local',
      '--unset-all',
      'credential.helper',
      '^$',
    ],
    [
      '-C',
      repoPath,
      'config',
      '--local',
      '--unset-all',
      `credential.${origin}.helper`,
    ],
  ]
  for (const args of ops) {
    await new Promise<void>(resolve => {
      const child = spawn('git', args, {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ...GIT_SCRUB_ENV },
      })
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 10_000)
      const done = (): void => {
        clearTimeout(t)
        resolve()
      }
      child.on('close', done)
      child.on('error', done)
    })
  }
  onDebug?.(
    `[runner:session] unset git-proxy local credential.helper for ${repoPath}`,
  )
}

/**
 * densable `Tjv` — wire repo-local credential.helper for git-proxy origin.
 * Uses CLAUDE_CODE_SESSION_ACCESS_TOKEN (not SHR_GIT_PROXY_TOKEN).
 */
export async function wireGitProxyRepoLocalCredHelper(
  repoPath: string,
  proxyApiBaseUrl: string,
  onDebug: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const origin = new URL(proxyApiBaseUrl).origin
  const helper = proxyTokenCredHelperSnippet('CLAUDE_CODE_SESSION_ACCESS_TOKEN')
  const pairs: Array<{ args: string[]; label: string }> = [
    {
      args: [
        '-C',
        repoPath,
        'config',
        '--local',
        '--replace-all',
        'credential.helper',
        '',
      ],
      label: 'credential.helper',
    },
    {
      args: [
        '-C',
        repoPath,
        'config',
        '--local',
        '--replace-all',
        `credential.${origin}.helper`,
        '',
      ],
      label: `credential.${origin}.helper`,
    },
    {
      args: [
        '-C',
        repoPath,
        'config',
        '--local',
        '--add',
        `credential.${origin}.helper`,
        helper,
      ],
      label: `credential.${origin}.helper(add)`,
    },
  ]
  for (const p of pairs) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(
          Object.assign(new Error('The operation was aborted'), {
            name: 'AbortError',
          }),
        )
        return
      }
      const child = spawn('git', p.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...GIT_SCRUB_ENV },
      })
      let stderr = ''
      child.stderr?.on('data', d => {
        stderr += String(d)
      })
      const onAbort = (): void => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      child.on('close', code => {
        signal?.removeEventListener('abort', onAbort)
        if (code !== 0) {
          reject(
            new Error(
              `git proxy: 'git config ${p.label}' in ${repoPath} exited ${code}: ${stderr}`,
            ),
          )
          return
        }
        resolve()
      })
      child.on('error', err => {
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
    })
  }
  onDebug(
    `[runner:session] git proxy: wired repo-local credential helper for ${origin} in ${repoPath}`,
  )
}

/** densable `vjv` — reset origin to plain upstream after governed prep */
export async function resetGovernedOriginToUpstream(
  repoPath: string,
  upstreamUrl: string,
  onDebug: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
        }),
      )
      return
    }
    const child = spawn(
      'git',
      [
        '-C',
        repoPath,
        ...GIT_SAFE_CONFIG_ARGS,
        'remote',
        'set-url',
        'origin',
        '--',
        upstreamUrl,
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...GIT_SCRUB_ENV },
      },
    )
    let stderr = ''
    child.stderr?.on('data', d => {
      stderr += String(d)
    })
    const onAbort = (): void => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort)
      if (code !== 0) {
        reject(
          new Error(
            `governed git: 'git remote set-url origin' in ${repoPath} exited ${code}: ${stderr}`,
          ),
        )
        return
      }
      resolve()
    })
    child.on('error', err => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
  })
  onDebug(
    `[runner:session] governed git: remote.origin.url reset to upstream in ${repoPath}`,
  )
}

/** densable `Hjv` — push outcome branch to source remote (best-effort) */
export async function pushOutcomeBranch(
  repoPath: string,
  branch: string,
  source: GitPrepareSource,
  timeoutMs: number,
  onDebug: (msg: string) => void,
): Promise<void> {
  if (!isSafeGitRevision(branch)) {
    onDebug(
      `[runner:session] push-on-release '${branch}' rejected by isSafeRefName (refspec metachar guard); skipping (best-effort)`,
    )
    return
  }
  const governed = Boolean(source.governedMount && source.upstreamUrl)
  const pushSource: GitPrepareSource = governed
    ? {
        ...source,
        url: source.upstreamUrl,
        getAuthToken: undefined,
        governedMount: false,
      }
    : source
  const auth = hardenedGitAuth(pushSource)
  await new Promise<void>(resolve => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const child = spawn(
      'git',
      [
        ...auth.args,
        '-C',
        repoPath,
        'push',
        auth.authURL,
        `refs/heads/${branch}:refs/heads/${branch}`,
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        cwd: undefined,
        env: auth.env,
        windowsHide: true,
      },
    )
    let stderr = ''
    child.stderr?.on('data', d => {
      stderr += String(d)
    })
    const timer = setTimeout(() => {
      onDebug(
        `[runner:session] push-on-release '${branch}' from ${repoPath} timed out after ${timeoutMs}ms (best-effort)`,
      )
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish()
    }, timeoutMs)
    child.on('close', code => {
      if (code === 0) {
        onDebug(
          `[runner:session] push-on-release pushed '${branch}' to source remote from ${repoPath}`,
        )
      } else {
        onDebug(
          `[runner:session] push-on-release '${branch}' from ${repoPath} exited ${code}: ${redactGitOutput(stderr, auth.authURL, auth.token).trim()} (best-effort)` +
            (governed
              ? ' — governed git pushes --push-outcome-on-release branches to the plain upstream with customer-managed credentials (the governed mount is read-only); if this failed with an auth error, provide a git credential for the push target on the runner host or use the post-session hook'
              : ''),
        )
      }
      finish()
    })
    child.on('error', err => {
      onDebug(
        `[runner:session] push-on-release '${branch}' spawn failed: ${err} (best-effort)`,
      )
      finish()
    })
  })
}

export type SessionWorktree = {
  canonicalRepoPath: string
  worktreePath: string
}

/** densable `fWd` — remove session worktrees + prune */
export async function cleanupSessionWorktrees(opts: {
  worktrees: SessionWorktree[]
  onDebug: (msg: string) => void
  signal?: AbortSignal
}): Promise<void> {
  const canons = new Set<string>()
  for (const { canonicalRepoPath, worktreePath } of opts.worktrees) {
    canons.add(canonicalRepoPath)
    const ctx: GitRepoCtx = {
      repoPath: canonicalRepoPath,
      gitURL: '',
      authURL: '',
      onDebug: opts.onDebug,
      signal: opts.signal,
    }
    try {
      await runGitPrepare(ctx, canonicalRepoPath, [
        'worktree',
        'remove',
        '--force',
        worktreePath,
      ])
      opts.onDebug(`[byoc:git] Removed worktree ${worktreePath}`)
    } catch (err) {
      opts.onDebug(`[byoc:git] worktree remove ${worktreePath} failed: ${err}`)
    }
  }
  for (const canon of canons) {
    await runGitPrepare(
      {
        repoPath: canon,
        gitURL: '',
        authURL: '',
        onDebug: opts.onDebug,
        signal: opts.signal,
      },
      canon,
      ['worktree', 'prune'],
    ).catch(err => {
      opts.onDebug(`[byoc:git] worktree prune ${canon} failed: ${err}`)
    })
  }
}

/**
 * densable `Mjv` — best-effort delete outcome branch after session
 * (optional detach first when needsDetach).
 */
export async function cleanupOutcomeBranch(
  repoPath: string,
  branch: string,
  needsDetach: boolean,
  onDebug: (msg: string) => void,
  scrubEnv = false,
  spawnImpl: typeof spawn = spawn,
  timeoutMs = GIT_SHORT_OP_TIMEOUT_MS,
): Promise<void> {
  const run = (args: string[], label: string): Promise<number | null> =>
    new Promise(resolve => {
      let done = false
      const finish = (code: number | null): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(code)
      }
      const child = spawnImpl(
        'git',
        [...GIT_SAFE_CONFIG_ARGS, '-C', repoPath, ...args],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
          cwd: undefined,
          windowsHide: true,
          env: {
            ...process.env,
            ...GIT_SCRUB_ENV,
            ...(scrubEnv
              ? {
                  GIT_CONFIG_GLOBAL: '/dev/null',
                  CLAUDE_CODE_SESSION_ACCESS_TOKEN: undefined,
                }
              : undefined),
          },
        },
      )
      let stderr = ''
      child.stderr?.on('data', d => {
        stderr += String(d)
      })
      const timer = setTimeout(() => {
        onDebug(
          `[runner:session] ${label} in ${repoPath} timed out after ${timeoutMs}ms (best-effort cleanup)`,
        )
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        finish(null)
      }, timeoutMs)
      child.on('close', code => {
        if (code !== 0) {
          onDebug(
            `[runner:session] ${label} in ${repoPath} exited ${code}: ${stderr.trim()} (best-effort cleanup)`,
          )
        }
        finish(code)
      })
      child.on('error', err => {
        onDebug(
          `[runner:session] ${label} spawn failed: ${err} (best-effort cleanup)`,
        )
        finish(null)
      })
    })
  if (needsDetach) await run(['checkout', '--detach'], 'checkout --detach')
  if (
    (await run(
      ['branch', '-D', '--end-of-options', branch],
      `branch -D '${branch}'`,
    )) === 0
  ) {
    onDebug(
      `[runner:session] deleted outcome branch '${branch}' from ${repoPath}`,
    )
  }
}

// re-export basename for tests that mirror densable J7s test-file branch
export { basename }
