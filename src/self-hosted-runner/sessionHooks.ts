/**
 * densable 2.1.224 session hooks: checkout (H2h), post-session (M2h),
 * env strip (D2h), resolve hook path (vKn), source map helpers
 * (G7s/dWd/J7s/Ljv/K2h/wjv/Ejv/Cjv/pjv-legacy).
 * 1:1 from SEA hook-*.js + rBh source prep.
 */
import { constants as fsConstants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { redactLogText, withTimeoutMs } from './rootRunner.js'
import { remoteSessionUuidFromId } from './sessionChild.js'

/** densable checkout `.git` / path stat timeout (`BUi` / `J2h`) */
const HOOK_STAT_TIMEOUT_MS = 5_000
/** densable `P2h` — post-session SIGTERM→SIGKILL grace (SEA: P2h=2000) */
export const POST_SESSION_SIGKILL_GRACE_MS = 2_000

// ── source map helpers (pjv legacy path; git-proxy/governed invent-ban) ─────

/** densable `G7s` */
export function isCheckoutHookSourceType(type: string): boolean {
  return type === 'github' || type === 'github-ssh' || type === 'test-file'
}

/** densable `K2h` */
export function stripGitSuffix(path: string): string {
  return path.replace(/\.git$/, '').replace(/\/+$/, '')
}

/** densable `Ljv` — extract repo slug path from scp-form or URL pathname */
export function extractRepoSlugFromUrl(url: string): string {
  if (!url.includes('://')) {
    const m = url.match(/^[^@]+@[^:]+:(.+)$/)
    if (m?.[1]) return stripGitSuffix(m[1])
  }
  try {
    const u = new URL(url)
    return stripGitSuffix(u.pathname.replace(/^\/+/, ''))
  } catch {
    return ''
  }
}

/** densable `Cjv` — scp/ssh URL shape */
export function isSshFormGitUrl(url: string): boolean {
  if (url.startsWith('ssh://')) return true
  return !url.includes('://') && /^[^@]+@[^:]+:.+$/.test(url)
}

/** densable `dWd` — checkout dir name under session (segments joined by `-`) */
export function sourceCheckoutSlug(source: { repo: string }): string {
  const parts = source.repo.split('/').filter(r => r.length > 0)
  for (const r of parts) {
    if (r === '.' || r === '..') return ''
  }
  return parts.join('-')
}

/** densable `J7s` — canonical path under baseDir */
export function sourceCanonicalPath(
  baseDir: string,
  source: { type: string; repo: string },
): string {
  if (source.type === 'test-file') {
    const n = basename(source.repo)
    if (!n || n === '.' || n === '..') return ''
    return join(baseDir, n)
  }
  const parts = source.repo.split('/').filter(n => n.length > 0)
  if (parts.length === 0) return ''
  for (const n of parts) {
    if (n === '.' || n === '..') return ''
  }
  return join(baseDir, ...parts)
}

/** densable `wjv` */
export function applyGitHostRewrites(
  url: string,
  rewrites: Map<string, string> | Array<[string, string]>,
  onDebug?: (msg: string) => void,
): string {
  const map =
    rewrites instanceof Map
      ? rewrites
      : new Map(rewrites.map(([a, b]) => [a.toLowerCase(), b]))
  if (map.size === 0) return url
  const m = url.match(/^https:\/\/([^/]+)\/(.+)$/)
  if (!m) return url
  const to = map.get(m[1]!.toLowerCase())
  if (to === undefined) return url
  const next = `https://${to}/${m[2]}`
  onDebug?.(`[runner:git] rewrote ${url} -> ${next} (--git-host-rewrite)`)
  return next
}

/** densable `Ejv` */
export function applyGitSshRewrites(
  url: string,
  hosts: Set<string> | string[],
  onDebug?: (msg: string) => void,
): string {
  const set =
    hosts instanceof Set ? hosts : new Set(hosts.map(h => h.toLowerCase()))
  if (set.size === 0) return url
  const m = url.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/)
  if (!m || !set.has(m[1]!.toLowerCase())) return url
  const host = m[1]!.split(':')[0]!
  const next = `git@${host}:${m[2]}`
  onDebug?.(`[runner:git] rewrote ${url} -> ${next} (--git-ssh-rewrite)`)
  return next
}

export type MappedCheckoutSource = {
  type: 'github' | 'github-ssh' | 'test-file'
  repo: string
  ref?: string
  url: string
  governedMount?: boolean
  upstreamUrl?: string
  /** densable getAuthToken for git-proxy / governed mount sources */
  getAuthToken?: () => string
}

/** densable `WUi` — owner/repo path segment for proxy/mount rewrite */
export const GIT_OWNER_REPO_SEGMENT_RE = /^(?!\.{1,2}$)[a-zA-Z0-9._-]+$/

/**
 * densable `fjv` — rewrite https://host/owner/repo to Anthropic git_proxy URL.
 * Returns undefined when not applicable (falls back to customer git auth).
 */
export function rewriteToAnthropicGitProxy(
  url: string,
  proxy:
    | {
        apiBaseUrl: string
        sessionId: string
      }
    | undefined,
  onDebug?: (msg: string) => void,
): { url: string; owner: string; repo: string } | undefined {
  if (!proxy) return undefined
  const n = url.match(/^https:\/\/[^/@]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!n) {
    if (url.startsWith('https://')) {
      onDebug?.(
        `[runner:git] git proxy: could not parse owner/repo from ${url}; falling back to customer git auth for this source`,
      )
    }
    return undefined
  }
  const owner = n[1]!
  const repo = n[2]!
  if (
    !GIT_OWNER_REPO_SEGMENT_RE.test(owner) ||
    !GIT_OWNER_REPO_SEGMENT_RE.test(repo)
  ) {
    onDebug?.(
      `[runner:git] git proxy: rejecting unsafe owner/repo in ${url}; falling back to customer git auth for this source`,
    )
    return undefined
  }
  const a = `${proxy.apiBaseUrl.replace(/\/+$/, '')}/v1/session_ingress/session/${proxy.sessionId}/git_proxy/${owner}/${repo}.git`
  onDebug?.(
    `[runner:git] rewrote ${url} -> git_proxy/${owner}/${repo}.git (--use-anthropic-git-proxy)`,
  )
  return { url: a, owner, repo }
}

/**
 * densable `mjv` — rewrite https://host/owner/repo to governed git mount path.
 */
export function rewriteToGovernedGitMount(
  url: string,
  mountBaseUrl: string,
  onDebug?: (msg: string) => void,
):
  | { url: string; owner: string; repo: string; upstreamUrl: string }
  | undefined {
  const n = url.match(/^https:\/\/([^/@:]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!n) {
    if (url.startsWith('https://')) {
      onDebug?.(
        `[runner:git] governed git: could not parse host/owner/repo from ${url}`,
      )
    }
    return undefined
  }
  const host = n[1]!.toLowerCase()
  const owner = n[2]!
  const repo = n[3]!
  if (!/^(?!\.{1,2}$)[a-z0-9.-]+$/.test(host) || host.length > 255) {
    onDebug?.(
      `[runner:git] governed git: rejecting unsafe host in ${url}; falling back to legacy handling for this source`,
    )
    return undefined
  }
  if (
    !GIT_OWNER_REPO_SEGMENT_RE.test(owner) ||
    !GIT_OWNER_REPO_SEGMENT_RE.test(repo)
  ) {
    onDebug?.(
      `[runner:git] governed git: rejecting unsafe owner/repo in ${url}; falling back to legacy handling for this source`,
    )
    return undefined
  }
  const a = `${mountBaseUrl}/${host}/${owner}/${repo}`
  onDebug?.(
    `[runner:git] rewrote ${url} -> git mount /${host}/${owner}/${repo} (governed git)`,
  )
  return {
    url: a,
    owner,
    repo,
    upstreamUrl: `https://${host}/${owner}/${repo}`,
  }
}

/**
 * densable `djv` — parse remote `governed_git` into mount config or undefined.
 */
export function parseGovernedGitConfig(
  governed:
    | {
        git_mount_base_url?: string
        tool_config?: { git_config?: boolean; gh_path_shim?: boolean }
      }
    | null
    | undefined,
  getSessionToken: () => string,
  onStatus: (msg: string) => void,
):
  | {
      mountBaseUrl: string
      toolConfig: { gitConfig: boolean; ghPathShim: boolean }
      getSessionToken: () => string
    }
  | undefined {
  if (!governed) return undefined
  const n = governed.git_mount_base_url
  let o: URL | undefined
  try {
    o = n ? new URL(n) : undefined
  } catch {
    o = undefined
  }
  const localHttp =
    o?.protocol === 'http:' &&
    (o.hostname === 'localhost' ||
      o.hostname === '127.0.0.1' ||
      o.hostname === '[::1]')
  if (!o || (o.protocol !== 'https:' && !localHttp)) {
    onStatus(
      "[runner:warn] the work item's governed-git configuration carried an unusable git mount URL, so this session continues with the legacy git flow. No operator action is needed for the session to work; please report this warning to Anthropic support so the server-side delivery can be fixed.",
    )
    return undefined
  }
  return {
    mountBaseUrl: o.href.replace(/\/+$/, ''),
    toolConfig: {
      gitConfig: governed.tool_config?.git_config === true,
      ghPathShim: governed.tool_config?.gh_path_shim === true,
    },
    getSessionToken,
  }
}

/**
 * densable `pjv` — map remote `git_repository` sources with governed mount /
 * anthropic git-proxy / host+ssh rewrite legacy paths.
 */
export function mapSourcesForCheckout(
  sources: Array<Record<string, unknown>>,
  opts: {
    gitSshRewriteHosts?: string[]
    gitHostRewrites?: Array<[string, string]>
    onDebug?: (msg: string) => void
    /** densable `_t` — anthropic git proxy (api base after qqv) */
    anthropicGitProxy?: { apiBaseUrl: string; sessionId: string }
    /** densable `pt` — governed git mount from djv */
    governedGit?: {
      mountBaseUrl: string
      getSessionToken: () => string
    }
  } = {},
): MappedCheckoutSource[] {
  const sshHosts = new Set(
    (opts.gitSshRewriteHosts ?? []).map(h => h.toLowerCase()),
  )
  const hostRewrites = new Map(
    (opts.gitHostRewrites ?? []).map(([a, b]) => [a.toLowerCase(), b]),
  )
  const out: MappedCheckoutSource[] = []
  for (const raw of sources) {
    if (raw.type !== 'git_repository' || typeof raw.url !== 'string') continue
    const revision = typeof raw.revision === 'string' ? raw.revision : undefined

    if (opts.governedGit) {
      const m = rewriteToGovernedGitMount(
        raw.url,
        opts.governedGit.mountBaseUrl,
        opts.onDebug,
      )
      if (m) {
        out.push({
          type: 'github',
          repo: `${m.owner}/${m.repo}`,
          ref: revision,
          url: m.url,
          getAuthToken: opts.governedGit.getSessionToken,
          governedMount: true,
          upstreamUrl: m.upstreamUrl,
        })
        continue
      }
      opts.onDebug?.(
        `[runner:git] governed git: source ${raw.url} is not mount-routable; using legacy handling for this source`,
      )
    }

    const proxy = rewriteToAnthropicGitProxy(
      raw.url,
      opts.anthropicGitProxy,
      opts.onDebug,
    )
    if (proxy) {
      out.push({
        type: 'github',
        repo: `${proxy.owner}/${proxy.repo}`,
        ref: revision,
        url: proxy.url,
        getAuthToken: () => {
          const tok = process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
          if (!tok) {
            throw new Error(
              'git-proxy credential requested but CLAUDE_CODE_SESSION_ACCESS_TOKEN is unset — token issue/refresh failed?',
            )
          }
          return tok
        },
      })
      continue
    }

    let url = applyGitHostRewrites(raw.url, hostRewrites, opts.onDebug)
    url = applyGitSshRewrites(url, sshHosts, opts.onDebug)
    const slug = extractRepoSlugFromUrl(url)
    if (!slug) {
      throw new Error(
        `mapSources: cannot extract repo slug from source URL '${raw.url}' — not scp-form (user@host:path) and not a parseable URL`,
      )
    }
    const type: MappedCheckoutSource['type'] = isSshFormGitUrl(url)
      ? 'github-ssh'
      : 'github'
    out.push({
      type,
      repo: slug,
      ref: revision,
      url,
    })
  }
  return out
}

/** densable `D2h` — strip pool secrets from hook child env */
export function buildHookBaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    SELF_HOSTED_RUNNER_POOL_SECRET: undefined,
    SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: undefined,
  }
}

/** densable `vKn` — resolve executable hook path under hooksDir */
export async function resolveHookPath(
  hooksDir: string | undefined,
  name: string,
): Promise<string | null> {
  if (!hooksDir) return null
  const path = join(hooksDir, name)
  try {
    const st = await withTimeoutMs(
      stat(path),
      HOOK_STAT_TIMEOUT_MS,
      `stat ${path}`,
    )
    if (!st.isFile()) return null
    await withTimeoutMs(
      access(path, fsConstants.X_OK),
      HOOK_STAT_TIMEOUT_MS,
      `access ${path}`,
    )
    return path
  } catch {
    return null
  }
}

export type CheckoutHookOpts = {
  hookPath: string
  sessionId: string
  repoUrl: string
  repoRef?: string
  checkoutPath: string
  apiBaseUrl: string
  gitMountUrl: string
  sessionAccessToken: string
  cwd: string
  onStatus: (msg: string) => void
  onDebug: (msg: string) => void
  signal?: AbortSignal
  /** inject for tests */
  spawnFn?: typeof spawn
  skipGitVerify?: boolean
}

/**
 * densable `H2h` — run checkout hook; require checkoutPath dir (+ .git unless skip).
 */
export async function runCheckoutHook(opts: CheckoutHookOpts): Promise<void> {
  const spawnFn = opts.spawnFn ?? spawn
  const env: NodeJS.ProcessEnv = {
    ...buildHookBaseEnv(),
    CLAUDE_RUNNER_SESSION_ID: opts.sessionId.replace(/^cse_/, 'session_'),
    CLAUDE_RUNNER_SESSION_UUID: remoteSessionUuidFromId(opts.sessionId),
    CLAUDE_RUNNER_REPO_URL: opts.repoUrl,
    CLAUDE_RUNNER_REPO_REF: opts.repoRef ?? '',
    CLAUDE_RUNNER_CHECKOUT_PATH: opts.checkoutPath,
    CLAUDE_RUNNER_API_BASE_URL: opts.apiBaseUrl,
    CLAUDE_RUNNER_GIT_MOUNT_URL: opts.gitMountUrl,
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: opts.sessionAccessToken,
  }
  opts.onStatus(
    `[runner:hook] checkout ${redactLogText(opts.repoUrl)} -> ${opts.checkoutPath} (via ${opts.hookPath})`,
  )
  const stderrTail: string[] = []
  let aborted = false
  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(opts.hookPath, [], {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      aborted = true
      opts.onDebug(
        `[runner:hook:checkout] abort received, sending SIGTERM to pid=${child.pid}`,
      )
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        opts.onDebug(
          `[runner:hook:checkout] still running after SIGTERM, sending SIGKILL to pid=${child.pid}`,
        )
        child.kill('SIGKILL')
      }, 5_000)
    }
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })

    let stdoutBuf = ''
    let stderrBuf = ''
    const onLines = (chunk: string, keepTail: boolean): string => {
      const parts = chunk.split('\n')
      const rest = parts.pop() ?? ''
      for (const line of parts) {
        const cleaned = redactLogText(line)
        opts.onDebug(`[runner:hook:checkout] ${cleaned}`)
        if (keepTail) stderrTail.push(`${cleaned}\n`)
      }
      if (keepTail) {
        let total = stderrTail.reduce((n, s) => n + s.length, 0)
        while (total > 4096 && stderrTail.length > 1) {
          total -= stderrTail.shift()!.length
        }
      }
      return rest
    }
    child.stdout?.on('data', (d: Buffer | string) => {
      stdoutBuf = onLines(stdoutBuf + d.toString(), false)
    })
    child.stderr?.on('data', (d: Buffer | string) => {
      stderrBuf = onLines(stderrBuf + d.toString(), true)
    })
    child.on('error', err => {
      if (killTimer) clearTimeout(killTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', code => {
      if (killTimer) clearTimeout(killTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (stdoutBuf) {
        opts.onDebug(`[runner:hook:checkout] ${redactLogText(stdoutBuf)}`)
      }
      if (stderrBuf) {
        const cleaned = redactLogText(stderrBuf)
        opts.onDebug(`[runner:hook:checkout] ${cleaned}`)
        stderrTail.push(cleaned)
      }
      if (aborted) reject(new Error('checkout hook aborted'))
      else if (code === 0) resolve()
      else {
        reject(
          new Error(
            `checkout hook failed (exit ${code}): ${stderrTail.join('').slice(-4096)}`,
          ),
        )
      }
    })
  })

  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await withTimeoutMs(
      stat(opts.checkoutPath),
      HOOK_STAT_TIMEOUT_MS,
      `stat ${opts.checkoutPath}`,
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(
        `checkout hook exited 0 but ${opts.checkoutPath} does not exist`,
      )
    }
    throw err
  }
  if (!st.isDirectory()) {
    throw new Error(
      `checkout hook exited 0 but ${opts.checkoutPath} is not a directory`,
    )
  }
  const skipGit =
    opts.skipGitVerify === true ||
    process.env.CLAUDE_RUNNER_SKIP_GIT_VERIFY === '1'
  if (!skipGit) {
    try {
      await withTimeoutMs(
        stat(join(opts.checkoutPath, '.git')),
        HOOK_STAT_TIMEOUT_MS,
        `stat ${opts.checkoutPath}/.git`,
      )
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new Error(
          `checkout hook succeeded but ${opts.checkoutPath}/.git is missing (for non-git SCMs, set CLAUDE_RUNNER_SKIP_GIT_VERIFY=1 in the runner's environment)`,
        )
      }
      throw err
    }
  }
}

export type PostSessionHookOpts = {
  hookPath: string
  sessionId: string
  exitReason: string
  debugLogPath: string
  workspacePaths: string[]
  apiBaseUrl: string
  sessionAccessToken: string
  cwd: string
  timeoutMs: number
  onStatus: (msg: string) => void
  onDebug: (msg: string) => void
  /** inject for tests */
  spawnFn?: typeof spawn
}

/**
 * densable `M2h` — post-session hook (best-effort; never throws to caller).
 * detached process group; SIGTERM then SIGKILL; ignore failures.
 */
export async function runPostSessionHook(
  opts: PostSessionHookOpts,
): Promise<void> {
  const spawnFn = opts.spawnFn ?? spawn
  const env: NodeJS.ProcessEnv = {
    ...buildHookBaseEnv(),
    CLAUDE_RUNNER_SESSION_ID: opts.sessionId.replace(/^cse_/, 'session_'),
    CLAUDE_RUNNER_SESSION_UUID: remoteSessionUuidFromId(opts.sessionId),
    CLAUDE_RUNNER_EXIT_REASON: opts.exitReason,
    CLAUDE_RUNNER_DEBUG_LOG_PATH: opts.debugLogPath,
    CLAUDE_RUNNER_WORKSPACE_PATHS: opts.workspacePaths.join(':'),
    CLAUDE_RUNNER_API_BASE_URL: opts.apiBaseUrl,
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: opts.sessionAccessToken,
  }
  opts.onStatus(
    `[runner:hook] post-session hook starting (session exit: ${opts.exitReason}, budget ${opts.timeoutMs}ms, via ${opts.hookPath})`,
  )
  const started = Date.now()
  let settle!: () => void
  const done = new Promise<void>(r => {
    settle = r
  })
  const child = spawnFn(opts.hookPath, [], {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  })
  let finished = false
  let timedOut = false
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const finish = (): void => {
    if (finished) return
    finished = true
    for (const t of timers) clearTimeout(t)
    settle()
  }
  const killGroup = (sig: NodeJS.Signals): void => {
    const pid = child.pid
    if (pid === undefined) {
      child.kill(sig)
      return
    }
    if (pid <= 1) return
    try {
      process.kill(-pid, sig)
    } catch {
      child.kill(sig)
    }
  }
  const budget = opts.timeoutMs > 0 ? opts.timeoutMs : 1
  timers.push(
    setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      timedOut = true
      opts.onDebug(
        `[runner:hook:post-session] timed out after ${budget}ms, sending SIGTERM to the hook's process group (pgid=${child.pid})`,
      )
      killGroup('SIGTERM')
    }, budget),
  )
  timers.push(
    setTimeout(
      () => {
        if (!timedOut) return
        opts.onDebug(
          `[runner:hook:post-session] still running after SIGTERM, sending SIGKILL to the hook's process group (pgid=${child.pid})`,
        )
        killGroup('SIGKILL')
      },
      Math.min(budget + POST_SESSION_SIGKILL_GRACE_MS, 2_147_483_647),
    ),
  )
  timers.push(
    setTimeout(
      () => {
        opts.onStatus(
          `[runner:hook:post-session] resolved without 'close' (${Date.now() - started}ms, grandchild likely holding stdio pipes; ignored)`,
        )
        finish()
      },
      Math.min(budget + POST_SESSION_SIGKILL_GRACE_MS + 1000, 2_147_483_647),
    ),
  )

  let stdoutBuf = ''
  let stderrBuf = ''
  const onLines = (chunk: string): string => {
    const parts = chunk.split('\n')
    const rest = parts.pop() ?? ''
    for (const line of parts) {
      opts.onDebug(`[runner:hook:post-session] ${redactLogText(line)}`)
    }
    return rest
  }
  child.stdout?.on('data', (d: Buffer | string) => {
    stdoutBuf = onLines(stdoutBuf + d.toString())
  })
  child.stderr?.on('data', (d: Buffer | string) => {
    stderrBuf = onLines(stderrBuf + d.toString())
  })
  child.on('error', err => {
    opts.onStatus(
      `[runner:hook:post-session] spawn error (ignored): ${redactLogText(err instanceof Error ? err.message : String(err))}`,
    )
    finish()
  })
  child.on('close', code => {
    if (stdoutBuf) {
      opts.onDebug(`[runner:hook:post-session] ${redactLogText(stdoutBuf)}`)
    }
    if (stderrBuf) {
      opts.onDebug(`[runner:hook:post-session] ${redactLogText(stderrBuf)}`)
    }
    const ms = Date.now() - started
    if (timedOut) {
      opts.onStatus(
        `[runner:hook:post-session] killed after timeout (${ms}ms, ignored)`,
      )
    } else if (code !== 0) {
      opts.onStatus(
        `[runner:hook:post-session] exited ${code ?? 'via signal'} (${ms}ms, ignored)`,
      )
    } else {
      opts.onStatus(`[runner:hook:post-session] done (exit 0, ${ms}ms)`)
    }
    finish()
  })
  await done
}
