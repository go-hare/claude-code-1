/**
 * Official bPu — attach repo visibility metadata for exfil-capable git/gh
 * Bash|PowerShell commands when auto-mode CLAUDE_CODE_AUTO_MODE_REPO_VISIBILITY
 * / GB repoVisibility is on.
 *
 * Pure command parsing + remote URL → host/owner/name + optional GitHub API
 * visibility lookup (yDg/Ceo) with process-local cache. Branch/state races are
 * best-effort; overall budget REPO_VISIBILITY_BUDGET_MS.
 */

import axios from 'axios'
import { basename, isAbsolute, resolve } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getCwd } from '../cwd.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { parseGitRemote } from '../detectRepository.js'
import { getUserAgent } from '../http.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { resolveRepoVisibility } from './autoModeFlags.js'

/** Official IDg — overall budget for repo visibility enrichment. */
export const REPO_VISIBILITY_BUDGET_MS = 5_000

/** Official XDu — per-request GitHub API timeout. */
export const REPO_VISIBILITY_GH_TIMEOUT_MS = 3_000

const GH_API_VERSION = '2022-11-28'

/** Official ODg — gh subcommands that can exfil / publish. */
const GH_EXFIL_RE =
  /\bgh\s+(pr\s+create|pr\s+merge|pr\s+comment|issue\s+create|issue\s+comment|release\s+create|release\s+upload|repo\s+fork)\b([^&|;\n]*)/gi

const GIT_OPTS_WITH_VALUE = new Set(['-c', '-C', '--git-dir'])

export type RepoVisibility = 'public' | 'private' | 'unknown'

export type RepoVisibilityEntry = {
  remote: string
  branch?: string
  visibility: RepoVisibility
}

/** Official Ceo cache — host/owner/name → visibility. */
const visibilityCache = new Map<string, RepoVisibility>()

/**
 * Official lXt process-local origin snapshot cache (cwd → branch/host/slug/vis).
 * Populated by seedRepoOriginCache / resolve helpers to skip re-git under bPu races.
 */
export type RepoOriginSnapshot = {
  branch?: string
  host?: string
  slug?: string
  visibility?: RepoVisibility
}

const originSnapshotCache = new Map<string, RepoOriginSnapshot>()

/** Official Fm — github.com (strip www.). */
export function isGithubDotComHost(host: string): boolean {
  let h = host.toLowerCase()
  while (h.startsWith('www.')) h = h.slice(4)
  return h === 'github.com'
}

/** Official NAr — REST base for github.com or GHE. */
export function githubRestApiBase(host: string): string {
  return isGithubDotComHost(host)
    ? 'https://api.github.com'
    : `https://${host}/api/v3`
}

function logVisibilityLookupFailed(reason: string): void {
  logEvent('tengu_auto_mode_repo_visibility_lookup_failed', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Official SJn/RTg portable — GH_TOKEN/GITHUB_TOKEN (or enterprise tokens)
 * then `gh auth token --hostname`.
 */
export async function resolveGithubAuthToken(
  host: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (isGithubDotComHost(host)) {
    const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    if (t) return t
  } else {
    const t =
      process.env.GH_ENTERPRISE_TOKEN || process.env.GITHUB_ENTERPRISE_TOKEN
    if (t) return t
  }
  const result = await execFileNoThrowWithCwd(
    'gh',
    ['auth', 'token', '--hostname', host],
    {
      cwd: getCwd(),
      timeout: 5_000,
      maxBuffer: 10_000,
      abortSignal: signal,
      preserveOutputOnError: false,
      env: {
        ...process.env,
        // Avoid feeding host tokens back into nested gh accidentally.
        GH_TOKEN: '',
        GITHUB_TOKEN: '',
      },
    },
  )
  if (result.code !== 0) return null
  const token = (result.stdout ?? '').trim()
  return token || null
}

/**
 * Official yDg — GET /repos/{owner}/{repo} → public|private|unknown.
 * Skips under essential-traffic privacy; caches via Ceo.
 */
export async function lookupGithubRepoVisibility(
  host: string,
  owner: string,
  name: string,
  signal?: AbortSignal,
): Promise<RepoVisibility> {
  const cacheKey = `${host}/${owner}/${name}`
  const cached = visibilityCache.get(cacheKey)
  if (cached !== undefined) return cached

  if (!isGithubDotComHost(host) && !host.includes('.')) {
    logVisibilityLookupFailed('non_github_host')
    visibilityCache.set(cacheKey, 'unknown')
    return 'unknown'
  }
  if (isEssentialTrafficOnly()) {
    logVisibilityLookupFailed('essential_traffic_only')
    visibilityCache.set(cacheKey, 'unknown')
    return 'unknown'
  }

  const url = `${githubRestApiBase(host)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  try {
    const token = await resolveGithubAuthToken(host, signal)
    const resp = await axios.get(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GH_API_VERSION,
        'User-Agent': getUserAgent(),
      },
      timeout: REPO_VISIBILITY_GH_TIMEOUT_MS,
      signal,
      maxRedirects: 0,
      validateStatus: s => s >= 200 && s < 300,
    })
    const data = resp.data as {
      visibility?: string
      private?: boolean
    }
    let vis: RepoVisibility = 'unknown'
    if (data.visibility === 'public') vis = 'public'
    else if (data.visibility === 'private' || data.visibility === 'internal')
      vis = 'private'
    else if (data.private === true) vis = 'private'
    else if (data.private === false) vis = 'public'
    else {
      logVisibilityLookupFailed('missing_fields')
      vis = 'unknown'
    }
    visibilityCache.set(cacheKey, vis)
    return vis
  } catch {
    logVisibilityLookupFailed('http_error')
    visibilityCache.set(cacheKey, 'unknown')
    return 'unknown'
  }
}

/** Test helper — clear Ceo + lXt caches. */
export function clearRepoVisibilityCache(): void {
  visibilityCache.clear()
  originSnapshotCache.clear()
}

/** Official lXt seed — used by tests / CCR pre-warm. */
export function seedRepoOriginCache(
  cwd: string,
  snapshot: RepoOriginSnapshot,
): void {
  originSnapshotCache.set(cwd, snapshot)
}

/**
 * Official YDg — current branch via rev-parse, preferring lXt snapshot.
 */
export async function resolveCurrentBranch(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const snap = originSnapshotCache.get(cwd)
  if (snap?.branch !== undefined) return snap.branch
  const result = await execFileNoThrowWithCwd(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ],
    {
      cwd,
      timeout: 2000,
      maxBuffer: 10_000,
      abortSignal: signal,
      preserveOutputOnError: false,
    },
  )
  if (result.code !== 0) return undefined
  const branch = (result.stdout ?? '').trim()
  if (!branch || branch === 'HEAD') return undefined
  const prev = originSnapshotCache.get(cwd) ?? {}
  originSnapshotCache.set(cwd, { ...prev, branch })
  return branch
}

/**
 * Official JDg — origin host/slug/visibility from cache or remote parse + yDg.
 */
export async function resolveOriginRepoState(
  cwd: string,
  signal?: AbortSignal,
): Promise<{
  host: string
  slug: string
  visibility: RepoVisibility
} | null> {
  const snap = originSnapshotCache.get(cwd)
  if (snap?.host && snap.slug) {
    return {
      host: snap.host,
      slug: snap.slug,
      visibility: snap.visibility ?? 'unknown',
    }
  }
  const url =
    (await gitConfigGet(cwd, 'remote.origin.pushurl', signal)) ??
    (await gitConfigGet(cwd, 'remote.origin.url', signal))
  if (!url) return null
  const ref = parseRepoRef(url)
  if (!ref) return null
  const visibility = await lookupGithubRepoVisibility(
    ref.host,
    ref.owner,
    ref.name,
    signal,
  )
  const slug = `${ref.owner}/${ref.name}`
  const prev = originSnapshotCache.get(cwd) ?? {}
  originSnapshotCache.set(cwd, {
    ...prev,
    host: ref.host,
    slug,
    visibility,
  })
  return { host: ref.host, slug, visibility }
}

export type ParsedGitExfil =
  | { kind: 'push'; optsSpan: string; rest: string }
  | { kind: 'remote-mutate'; optsSpan: string; rest: string }

/** Official veo — sanitize remote/branch for classifier text. */
export function sanitizeRepoVisibilityToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 128)
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '')
}

/**
 * Official MDg — extract git push / git remote set-url|add segments from a
 * compound shell command (split on &|; newline).
 */
export function parseGitExfilCommands(command: string): ParsedGitExfil[] {
  const out: ParsedGitExfil[] = []
  for (const part of command.split(/[&|;\n]/)) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < tokens.length) {
      const tok = tokens[i]!
      if (tok !== 'git' && !tok.endsWith('/git')) {
        i++
        continue
      }
      const opts: string[] = []
      let a = i + 1
      for (; a < tokens.length; a++) {
        const c = tokens[a]!
        if (!c.startsWith('-')) break
        opts.push(c)
        if (GIT_OPTS_WITH_VALUE.has(c) && a + 1 < tokens.length) {
          opts.push(tokens[++a]!)
        }
      }
      const sub = tokens[a]
      if (sub === 'push') {
        out.push({
          kind: 'push',
          optsSpan: opts.join(' '),
          rest: tokens.slice(a + 1).join(' '),
        })
        break
      }
      if (
        sub === 'remote' &&
        (tokens[a + 1] === 'set-url' || tokens[a + 1] === 'add')
      ) {
        out.push({
          kind: 'remote-mutate',
          optsSpan: opts.join(' '),
          rest: tokens.slice(a + 1).join(' '),
        })
        break
      }
      break
    }
  }
  return out
}

/** Official NDg / ODg — match gh exfil subcommands. */
export function parseGhExfilMatches(
  command: string,
): { sub: string; args: string }[] {
  const out: { sub: string; args: string }[] = []
  const re = new RegExp(GH_EXFIL_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    out.push({
      sub: (m[1] ?? '').replace(/\s+/g, ' '),
      args: (m[2] ?? '').trim(),
    })
  }
  return out
}

/** Official FDg — cwd override from git -C / --git-dir. */
export function extractGitCwdOverride(optsSpan: string): string | undefined {
  const c = optsSpan.match(/-C\s+(\S+)/)
  if (c?.[1]) return stripQuotes(c[1])
  const d = optsSpan.match(/--git-dir[=\s]+(\S+)/)
  if (d?.[1]) return stripQuotes(d[1])
  return undefined
}

/**
 * Official BDg / remote-mutate URL extract — first non-flag positional after
 * set-url/add (skip -t/-m value pairs).
 */
export function extractRemoteMutateUrl(rest: string): string | undefined {
  const tokens = rest.trim().split(/\s+/).filter(Boolean)
  // rest starts with set-url|add [flags] <name> <url>
  let i = 0
  if (tokens[0] === 'set-url' || tokens[0] === 'add') i = 1
  const skipVal = new Set(['-t', '-m'])
  const positionals: string[] = []
  for (; i < tokens.length && positionals.length < 2; i++) {
    const t = tokens[i]!
    if (t.startsWith('-')) {
      if (skipVal.has(t)) i++
      continue
    }
    positionals.push(stripQuotes(t))
  }
  // prefer URL (2nd positional) when present
  return positionals[1] ?? positionals[0]
}

/** Official BDg push remotes — first non-flag + --repo. */
export function extractPushRemotes(rest: string): string[] {
  const out: string[] = []
  const tokens = rest.trim().split(/\s+/).filter(Boolean)
  const skipVal = new Set([
    '-o',
    '--push-option',
    '--receive-pack',
    '--exec',
    '--repo',
  ])
  for (let i = 0; i < tokens.length && out.length < 1; i++) {
    const t = tokens[i]!
    if (t.startsWith('-')) {
      if (skipVal.has(t) || t.startsWith('--repo=')) {
        if (!t.includes('=') && skipVal.has(t)) i++
      }
      continue
    }
    if (/^[\d*]*[<>]/.test(t)) continue
    out.push(stripQuotes(t))
  }
  const repo = [...rest.matchAll(/(?:^|\s)--repo[=\s]+(\S+)/g)].at(-1)?.[1]
  if (repo) {
    const r = stripQuotes(repo)
    if (!out.includes(r)) out.push(r)
  }
  return out
}

/** Official jDg — -R / --repo on gh. */
export function extractGhRepoFlag(args: string): string | undefined {
  const m = [...args.matchAll(/(?:^|\s)(?:--repo|-R)[=\s]+(\S+)/g)].at(-1)?.[1]
  return m ? stripQuotes(m) : undefined
}

export function isUrlLikeRemote(s: string): boolean {
  return s.includes('://') || s.startsWith('git@')
}

/**
 * Official zDg / owner/repo heuristic without network.
 * Returns host/owner/name or null.
 */
export function parseRepoRef(
  ref: string,
): { host: string; owner: string; name: string } | null {
  if (isUrlLikeRemote(ref)) {
    const p = parseGitRemote(ref)
    if (!p) return null
    return { host: p.host, owner: p.owner, name: p.name }
  }
  if (ref.startsWith('/') || ref.startsWith('.')) return null
  const cleaned = ref.replace(/\.git$/, '')
  const parts = cleaned.split('/')
  const ok = (s: string) =>
    /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..' && !s.startsWith('-')
  if (parts.length === 2 && ok(parts[0]!) && ok(parts[1]!)) {
    return { host: 'github.com', owner: parts[0]!, name: parts[1]! }
  }
  if (
    parts.length === 3 &&
    parts[0]!.includes('.') &&
    ok(parts[0]!) &&
    ok(parts[1]!) &&
    ok(parts[2]!)
  ) {
    return { host: parts[0]!, owner: parts[1]!, name: parts[2]! }
  }
  return null
}

/**
 * Collect remote refs from a command without I/O (pure).
 * Used by tests and as the first stage of fetchAutoModeRepoVisibility.
 */
export function collectExfilRemoteRefs(command: string): string[] {
  const refs: string[] = []
  for (const g of parseGitExfilCommands(command)) {
    if (g.kind === 'remote-mutate') {
      const u = extractRemoteMutateUrl(g.rest)
      if (u) refs.push(u)
      continue
    }
    for (const r of extractPushRemotes(g.rest)) {
      refs.push(r)
    }
  }
  for (const gh of parseGhExfilMatches(command)) {
    const r = extractGhRepoFlag(gh.args)
    if (r) refs.push(r)
    // pr create without --repo still targets current origin — marker
    if (gh.sub === 'pr create' && !r) {
      refs.push('origin')
    }
  }
  return refs
}

async function gitConfigGet(
  cwd: string,
  key: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const result = await execFileNoThrowWithCwd(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'safe.bareRepository=explicit',
      '-c',
      'protocol.file.allow=never',
      'config',
      '--get',
      key,
    ],
    {
      cwd,
      timeout: 2000,
      maxBuffer: 100_000,
      abortSignal: signal,
      preserveOutputOnError: false,
    },
  )
  if (result.code !== 0) return undefined
  const v = (result.stdout ?? '').trim()
  return v || undefined
}

/**
 * Official bPu(toolName, input, abortSignal) — returns null when disabled /
 * inapplicable. Pure parse + origin remote resolution + optional GitHub API
 * visibility (yDg/Ceo) under REPO_VISIBILITY_BUDGET_MS.
 */
export async function fetchAutoModeRepoVisibility(
  toolName: string,
  toolInput: unknown,
  signal?: AbortSignal,
): Promise<RepoVisibilityEntry[] | null> {
  try {
    if (!resolveRepoVisibility()) return null
    if (toolName !== 'Bash' && toolName !== 'PowerShell') return null
    if (
      toolInput === null ||
      typeof toolInput !== 'object' ||
      !('command' in toolInput) ||
      typeof (toolInput as { command: unknown }).command !== 'string'
    ) {
      return null
    }
    const command = (toolInput as { command: string }).command
    const gitExfil = parseGitExfilCommands(command)
    const ghExfil = parseGhExfilMatches(command)
    if (gitExfil.length === 0 && ghExfil.length === 0) return null

    const cwd = getCwd()
    const entries: RepoVisibilityEntry[] = []
    const seen = new Set<string>()
    const budgetController = new AbortController()
    const budgetTimer = setTimeout(
      () => budgetController.abort(),
      REPO_VISIBILITY_BUDGET_MS,
    )
    const combinedSignal = signal
      ? AbortSignal.any([signal, budgetController.signal])
      : budgetController.signal

    const pushEntry = (
      remote: string,
      visibility: RepoVisibility = 'unknown',
      branch?: string,
    ) => {
      const sanitized = sanitizeRepoVisibilityToken(remote)
      if (!sanitized || seen.has(sanitized)) return
      seen.add(sanitized)
      entries.push({
        remote: sanitized,
        visibility,
        ...(branch ? { branch: sanitizeRepoVisibilityToken(branch) } : {}),
      })
    }

    const pushResolvedRef = async (ref: {
      host: string
      owner: string
      name: string
    }): Promise<void> => {
      const remote = `${ref.owner}/${ref.name}`
      const visibility = await lookupGithubRepoVisibility(
        ref.host,
        ref.owner,
        ref.name,
        combinedSignal,
      )
      pushEntry(remote, visibility)
    }

    // Resolve bare "origin" / remote names via git config when possible.
    const resolveRemote = async (
      nameOrUrl: string,
      gitCwd: string,
    ): Promise<void> => {
      if (isUrlLikeRemote(nameOrUrl) || parseRepoRef(nameOrUrl)) {
        const ref = parseRepoRef(nameOrUrl)
        if (ref) {
          await pushResolvedRef(ref)
        } else {
          pushEntry(nameOrUrl)
        }
        return
      }
      if (nameOrUrl === 'origin' || /^[A-Za-z0-9._-]+$/.test(nameOrUrl)) {
        // Official YDg — attach current branch when resolving bare remote names.
        const branch = await resolveCurrentBranch(gitCwd, combinedSignal)
        if (nameOrUrl === 'origin') {
          const originState = await resolveOriginRepoState(
            gitCwd,
            combinedSignal,
          )
          if (originState) {
            pushEntry(originState.slug, originState.visibility, branch)
            return
          }
        }
        const url =
          (await gitConfigGet(
            gitCwd,
            `remote.${nameOrUrl}.pushurl`,
            combinedSignal,
          )) ??
          (await gitConfigGet(
            gitCwd,
            `remote.${nameOrUrl}.url`,
            combinedSignal,
          ))
        if (url) {
          const ref = parseRepoRef(url)
          if (ref) {
            const visibility = await lookupGithubRepoVisibility(
              ref.host,
              ref.owner,
              ref.name,
              combinedSignal,
            )
            pushEntry(`${ref.owner}/${ref.name}`, visibility, branch)
            return
          }
          pushEntry(nameOrUrl, 'unknown', branch)
          return
        }
        pushEntry(nameOrUrl, 'unknown', branch)
        return
      }
      pushEntry(nameOrUrl)
    }

    try {
      for (const g of gitExfil) {
        const override = extractGitCwdOverride(g.optsSpan)
        const gitCwd = override
          ? isAbsolute(override)
            ? override
            : resolve(cwd, override)
          : cwd
        if (g.kind === 'remote-mutate') {
          const u = extractRemoteMutateUrl(g.rest)
          if (u) await resolveRemote(u, gitCwd)
          continue
        }
        const remotes = extractPushRemotes(g.rest)
        if (remotes.length === 0) {
          await resolveRemote('origin', gitCwd)
        } else {
          for (const r of remotes) await resolveRemote(r, gitCwd)
        }
      }

      for (const gh of ghExfil) {
        const r = extractGhRepoFlag(gh.args)
        if (r) {
          await resolveRemote(r, cwd)
        } else if (gh.sub === 'pr create') {
          await resolveRemote('origin', cwd)
        } else {
          // other gh exfil without -R: still emit unresolved marker entry
          pushEntry(basename(cwd) || 'unresolved')
        }
      }
    } finally {
      clearTimeout(budgetTimer)
    }

    return entries.length > 0 ? entries : null
  } catch {
    return null
  }
}
