/**
 * Official 2.1.326 #339: Self-hosted runner built-in `gh api` stand-in shim
 * (`--use-anthropic-gh` / `SELF_HOSTED_RUNNER_USE_ANTHROPIC_GH` + `--gh-standin`).
 *
 * When a Linux or macOS self-hosted-runner session runs on a host without `gh`
 * installed, Claude Code offers a built-in `gh api` shim backed by Anthropic's
 * session GitHub proxy (REST requests to github.com only by default).
 */

import axios, { type AxiosResponse } from 'axios'
import { constants as fsConstants } from 'fs'
import { access, chmod, mkdir, readFile, writeFile } from 'fs/promises'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { delimiter, join, resolve } from 'path'

export const GH_STANDIN_FLAG = '--gh-standin'
export const GH_STANDIN_ANY_HOST = '--any-host'
export const GH_STANDIN_STANDALONE_PROXY = 'standalone-proxy'
export const GH_STANDIN_ANY_HOSTS_SENTINEL = 'any' as const

export type UseAnthropicGhSetting = boolean | 'default'

export type BuiltInGhBlockReason =
  | 'windows'
  | 'capacity'
  | 'standalone_proxy'
  | 'not_own_binary'
  | 'essential_traffic_only'
  | 'third_party_provider'
  | 'started_by_claude_code'
  | 'managed_git'
  | 'older_git_proxy'
  | 'not_agent_loop'
  | 'review'
  | 'github_tools_denied'

export type BuiltInGhDecision = 'on' | 'flag_off' | BuiltInGhBlockReason

export type RunnerBuiltInGhContext = {
  flag: boolean
  windows: boolean
  capacity: number
  standaloneProxy: boolean
  childIsOwnBinary: boolean
  essentialTrafficOnly: boolean
  thirdPartyProvider: boolean
  startedByClaudeCode: boolean
}

export type SessionBuiltInGhContext = RunnerBuiltInGhContext & {
  managedGit: boolean
  olderGitProxy: boolean
  childKind: 'agent-loop' | 'tools-only'
  review: boolean
  /** Official 2.1.328 (#678): true when `--use-anthropic-gh` was left at default (not explicitly `true`). */
  isDefaultOffer?: boolean
  /** Official 2.1.328 (#678): true when settings guard Claude's GitHub tools by name. */
  githubToolsDenied?: boolean
}

export const BUILT_IN_GH_REASON_TEXT: Record<BuiltInGhBlockReason, string> = {
  windows:
    'the built-in gh is a shell script, which a Windows runner cannot offer',
  capacity:
    "this runner runs with --capacity above 1, where one session could reach another session's repositories through that session's local port (run it with --capacity 1, and each runner on this machine under a Unix user of its own)",
  standalone_proxy:
    "this runner's sessions go through your own agent proxy (--agent-proxy-url, or the environment's relay mode), which does not carry it",
  not_own_binary:
    "sessions start through --exec-path or a command hook, and only this runner's own Claude Code is known to understand this setting (remove --exec-path or the command hook to get it)",
  essential_traffic_only:
    "nonessential traffic is disabled (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC in this runner's environment)",
  third_party_provider:
    "this runner's environment selects a model provider other than Anthropic's own API (CLAUDE_CODE_USE_BEDROCK, another provider's switch or a gateway), and the built-in gh sends its requests to Anthropic",
  started_by_claude_code:
    "this runner was started from a Claude Code session's shell (CLAUDE_CODE_CHILD_SESSION is set in its environment), and Claude Code ignores the offer there (start the runner from a terminal that no Claude Code session opened, or unset that variable first)",
  managed_git:
    'Anthropic-managed git serves this session, and decides whether it gets a gh',
  older_git_proxy:
    "--use-anthropic-git-proxy is on too, and this session's git goes through Anthropic's older git proxy",
  not_agent_loop: 'this session runs tools only',
  review: 'a code review gets no GitHub sign-in',
  github_tools_denied:
    "the session's settings restrict Claude's GitHub tools, and it is offered by default only (--use-anthropic-gh true sets it up all the same)",
}

const USE_ANTHROPIC_GH_FLAG_LABEL =
  '--use-anthropic-gh / SELF_HOSTED_RUNNER_USE_ANTHROPIC_GH'

const DEFAULT_STARTUP_BANNER =
  "[runner] built-in gh: on by default. Where no gh is installed, sessions get Claude Code's built-in `gh api`, whose requests for github.com go through Anthropic; --use-anthropic-gh false turns it off. Run each runner on this machine under a Unix user of its own: sessions under one user could use each other's connection to GitHub."

const FALSY_VALUES = new Set(['0', 'false', 'no', 'off'])
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function isFalsyFlagValue(val: string | undefined): boolean {
  return val !== undefined && FALSY_VALUES.has(val.trim().toLowerCase())
}

export function isTruthyFlagValue(val: string | undefined): boolean {
  return val !== undefined && TRUTHY_VALUES.has(val.trim().toLowerCase())
}

/**
 * Parse `SELF_HOSTED_RUNNER_USE_ANTHROPIC_GH` env value.
 * Unset / empty defaults to `'default'` (on by default, concise startup log).
 */
export function parseUseAnthropicGhEnv(
  raw: string | undefined,
): UseAnthropicGhSetting {
  if (raw === undefined || raw.trim() === '') return 'default'
  if (isFalsyFlagValue(raw)) return false
  if (isTruthyFlagValue(raw)) return true
  throw new Error(
    `SELF_HOSTED_RUNNER_USE_ANTHROPIC_GH must be true/false/1/0/yes/no/on/off (got: ${JSON.stringify(raw)})`,
  )
}

/**
 * Runner-level reasons that prevent any session of this runner from getting
 * the built-in `gh` stand-in (official `Ml()`).
 */
export function evaluateRunnerBuiltInGhBlocks(
  ctx: RunnerBuiltInGhContext,
): BuiltInGhBlockReason[] {
  if (!ctx.flag) return []
  const reasons: BuiltInGhBlockReason[] = []
  if (ctx.windows) reasons.push('windows')
  if (ctx.capacity > 1) reasons.push('capacity')
  if (ctx.standaloneProxy) reasons.push('standalone_proxy')
  if (!ctx.childIsOwnBinary) reasons.push('not_own_binary')
  if (ctx.essentialTrafficOnly) reasons.push('essential_traffic_only')
  if (ctx.thirdPartyProvider) reasons.push('third_party_provider')
  if (ctx.startedByClaudeCode) reasons.push('started_by_claude_code')
  return reasons
}

const GITHUB_TOOL_RULE_RE = /^(?:mcp__github(?:__|$)|Bash\(\s*gh(?:\s|:|$|\)))/i

/**
 * Official 2.1.328 `as()` (#678) — detect when session/managed settings guard
 * Claude's GitHub tools by name (deny/ask permission rules matching GitHub MCP
 * or `Bash(gh ...)`, or deniedMcpServers/managed-mcp restrictions on GitHub).
 */
export function areGitHubToolsRestrictedBySettings(
  settingsList: readonly (Record<string, unknown> | null | undefined)[],
  hasManagedMcpPolicyRestriction = false,
): boolean {
  if (hasManagedMcpPolicyRestriction) return true
  for (const settings of settingsList) {
    if (!settings || typeof settings !== 'object') continue
    const perms = settings.permissions as
      | { deny?: unknown; ask?: unknown }
      | undefined
    for (const list of [perms?.deny, perms?.ask]) {
      if (!Array.isArray(list)) continue
      for (const rule of list) {
        if (typeof rule === 'string' && GITHUB_TOOL_RULE_RE.test(rule.trim())) {
          return true
        }
      }
    }
    const deniedMcp = settings.deniedMcpServers
    if (Array.isArray(deniedMcp)) {
      for (const entry of deniedMcp) {
        if (!entry || typeof entry !== 'object') continue
        const rec = entry as { serverName?: unknown; serverUrl?: unknown }
        if (
          (typeof rec.serverName === 'string' &&
            rec.serverName.toLowerCase().includes('github')) ||
          (typeof rec.serverUrl === 'string' &&
            rec.serverUrl.toLowerCase().includes('/github/mcp'))
        ) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Session-level built-in `gh` eligibility decision (official `Ll()` + 2.1.328 #678).
 */
export function evaluateSessionBuiltInGhDecision(
  ctx: SessionBuiltInGhContext,
): BuiltInGhDecision {
  if (!ctx.flag) return 'flag_off'
  const [runnerBlock] = evaluateRunnerBuiltInGhBlocks(ctx)
  if (runnerBlock !== undefined) return runnerBlock
  if (ctx.managedGit) return 'managed_git'
  if (ctx.olderGitProxy) return 'older_git_proxy'
  if (ctx.childKind !== 'agent-loop') return 'not_agent_loop'
  if (ctx.review) return 'review'
  // Official 2.1.328 (#678): built-in `gh api` is off by default where settings
  // guard Claude's GitHub tools by name; explicit `--use-anthropic-gh true`
  // (`isDefaultOffer: false`) turns it on all the same.
  if (ctx.isDefaultOffer !== false && ctx.githubToolsDenied === true) {
    return 'github_tools_denied'
  }
  return 'on'
}

/**
 * Format runner startup log lines for built-in `gh` (official `$l()`).
 */
export function formatBuiltInGhStartupLines(
  ctx: RunnerBuiltInGhContext,
  isDefault = false,
): string[] {
  if (!ctx.flag) return []
  const blocks = evaluateRunnerBuiltInGhBlocks(ctx)
  if (isDefault) {
    return blocks.length > 0 ? [] : [DEFAULT_STARTUP_BANNER]
  }
  if (blocks.length > 0) {
    return [
      `[runner:warn] --use-anthropic-gh is on, but no session of this runner will get Claude Code's built-in gh: ${blocks.map(r => BUILT_IN_GH_REASON_TEXT[r]).join('; ')}. The runner starts all the same.`,
    ]
  }
  return [
    `[runner] built-in gh: offered (${USE_ANTHROPIC_GH_FLAG_LABEL}). Sessions with no gh installed, and not served by Anthropic-managed git, get Claude Code's built-in \`gh api\` (github.com's REST API only). Its requests go through Anthropic, which adds the GitHub credential, if any, that Anthropic holds for the session: in a person's own session, that person's GitHub sign-in. git is untouched, and an installed gh is left alone. Each session's "built-in gh:" lines say whether it was offered and set up.`,
  ]
}

/**
 * Check if the runner environment selects a third-party model provider
 * (Bedrock, Vertex, Foundry, OpenAI, Gemini, Grok, Gateway).
 */
export function isThirdPartyProviderEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    isTruthyFlagValue(env.CLAUDE_CODE_USE_BEDROCK) ||
    isTruthyFlagValue(env.CLAUDE_CODE_USE_VERTEX) ||
    isTruthyFlagValue(env.CLAUDE_CODE_USE_FOUNDRY) ||
    isTruthyFlagValue(env.CLAUDE_CODE_USE_OPENAI) ||
    isTruthyFlagValue(env.CLAUDE_CODE_USE_GEMINI) ||
    isTruthyFlagValue(env.CLAUDE_CODE_USE_GROK) ||
    Boolean(env.ANTHROPIC_GATEWAY_URL?.trim())
  )
}

export type ParsedGhStandinArgs = {
  port: number | typeof GH_STANDIN_STANDALONE_PROXY
  caBundlePath: string
  ghesHosts: string[] | typeof GH_STANDIN_ANY_HOSTS_SENTINEL
  ghArgs: string[]
}

/**
 * Parse CLI argv for `--gh-standin` fast-path (official `yXa()`).
 * Returns `undefined` if argv does not start with `--gh-standin`,
 * `'refused'` if malformed (and writes usage notice to stderr),
 * or the parsed arguments.
 */
export function parseGhStandinArgv(
  argv: string[] = process.argv.slice(2),
  writeStderr: (s: string) => void = s => {
    process.stderr.write(s)
  },
): ParsedGhStandinArgs | 'refused' | undefined {
  const [flag, portArg = '', caBundlePath = '', ...rest] = argv
  if (flag !== GH_STANDIN_FLAG) return undefined
  const remaining = [...rest]
  const isAnyHost = remaining[0] === GH_STANDIN_ANY_HOST
  const hostFlag =
    isAnyHost || remaining[0]?.startsWith('--hosts=')
      ? remaining.shift()
      : undefined
  const [separator, ...ghArgs] = remaining
  const validPort =
    portArg === GH_STANDIN_STANDALONE_PROXY ||
    (/^[1-9]\d{0,4}$/.test(portArg) && Number(portArg) <= 65535)
  if (validPort && caBundlePath !== '' && separator === '--') {
    const ghesHosts = isAnyHost
      ? GH_STANDIN_ANY_HOSTS_SENTINEL
      : (hostFlag?.slice(8).split(',').filter(Boolean) ?? [])
    return {
      port:
        portArg === GH_STANDIN_STANDALONE_PROXY
          ? GH_STANDIN_STANDALONE_PROXY
          : Number(portArg),
      caBundlePath,
      ghesHosts,
      ghArgs,
    }
  }
  writeStderr(
    'gh: this command is run by the gh shim Claude Code writes for a session; it is not for direct use.\n',
  )
  return 'refused'
}

export type BuildGhStandinShimOpts = {
  command: string[]
  port: number | typeof GH_STANDIN_STANDALONE_PROXY
  caBundlePath: string
  ghesHosts: string[] | typeof GH_STANDIN_ANY_HOSTS_SENTINEL
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Generate the executable `#!/bin/sh` shim script for `gh` (official `SXa()`).
 */
export function buildGhStandinShimScript(opts: BuildGhStandinShimOpts): string {
  const [hostArg, hostDesc] =
    opts.ghesHosts === GH_STANDIN_ANY_HOSTS_SENTINEL
      ? [GH_STANDIN_ANY_HOST, ' or the GitHub Enterprise host a command names']
      : opts.ghesHosts.length > 0
        ? [`--hosts=${opts.ghesHosts.join(',')}`, ' and the hosts named below']
        : [undefined, '']
  const cmdParts = [
    ...opts.command,
    GH_STANDIN_FLAG,
    String(opts.port),
    opts.caBundlePath,
    ...(hostArg === undefined ? [] : [hostArg]),
  ].map(shellSingleQuote)
  return `#!/bin/sh
# Claude Code gh stand-in shim (auto-generated; per-session).
# No GitHub CLI was found on this machine when this session started,
# so gh here is Claude Code's own implementation of \`gh api\`: REST
# requests to github.com${hostDesc} through the session's GitHub proxy. It reads
# no GitHub token from the environment and sends none.
exec ${cmdParts.join(' ')} -- "$@"
`
}

/**
 * Probe PATH for an existing executable `gh` binary (excluding `excludeDir`).
 */
export async function findInstalledGhOnPath(
  envPath: string | undefined = process.env.PATH,
  excludeDir?: string,
): Promise<string | undefined> {
  if (!envPath) return undefined
  const excluded = excludeDir ? resolve(excludeDir) : undefined
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue
    if (excluded && resolve(dir) === excluded) continue
    const candidate = join(dir, 'gh')
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // continue searching PATH
    }
  }
  return undefined
}

/**
 * Write the per-session `gh` stand-in shim into `shimDir/gh` when no `gh` is
 * installed on PATH (Linux/macOS only). Returns `{ shimDir, shimPath }` if
 * written, or `undefined` if an installed `gh` already exists.
 */
export async function writeGhStandinShimIfMissing(opts: {
  shimDir: string
  command: string[]
  port: number | typeof GH_STANDIN_STANDALONE_PROXY
  caBundlePath: string
  ghesHosts?: string[] | typeof GH_STANDIN_ANY_HOSTS_SENTINEL
  envPath?: string
  platform?: NodeJS.Platform
}): Promise<{ shimDir: string; shimPath: string } | undefined> {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return undefined
  const existingGh = await findInstalledGhOnPath(opts.envPath, opts.shimDir)
  if (existingGh !== undefined) return undefined
  await mkdir(opts.shimDir, { recursive: true, mode: 0o700 })
  const shimPath = join(opts.shimDir, 'gh')
  const script = buildGhStandinShimScript({
    command: opts.command,
    port: opts.port,
    caBundlePath: opts.caBundlePath,
    ghesHosts: opts.ghesHosts ?? [],
  })
  await writeFile(shimPath, script, { encoding: 'utf8', mode: 0o755 })
  await chmod(shimPath, 0o755)
  return { shimDir: opts.shimDir, shimPath }
}

// ── Built-in `gh api` REST client (official `ghStandinMain`) ───────────────

const ALLOWED_HEADERS = new Set([
  'accept',
  'content-type',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'x-github-api-version',
])

const ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

const MAX_BODY_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PLACEHOLDER_TOKEN = 'ghs_claude_code_proxy_placeholder'

class GhStandinError extends Error {}

export type GhStandinIO = {
  write: (stream: 'stdout' | 'stderr', data: string | Buffer) => Promise<void>
  stdin?: AsyncIterable<Buffer | string>
  env?: Record<string, string | undefined>
  requestFn?: (req: {
    method: string
    url: string
    headers: Record<string, string>
    data?: Buffer
    httpsAgent?: HttpsProxyAgent<string>
  }) => Promise<{
    status: number
    statusText: string
    headers: Record<string, string | string[] | undefined>
    data: Buffer
  }>
}

type ParsedApiCommand = {
  endpoint: string
  method?: string
  headers: string[]
  rawFields: Array<[string, string]>
  typedFields: Array<[string, string]>
  inputFile?: string
  include: boolean
  silent: boolean
  paginate: boolean
  hostname?: string
}

function parseGhApiArgs(ghArgs: string[]): ParsedApiCommand {
  if (ghArgs.length === 0 || ghArgs[0] === '--help' || ghArgs[0] === '-h') {
    throw new GhStandinError(
      'this built-in gh implements `gh api` (GitHub REST API) only. Example: gh api repos/{owner}/{repo}/pulls',
    )
  }
  if (ghArgs[0] !== 'api') {
    throw new GhStandinError(
      `this built-in gh implements \`gh api\` only (\`gh ${ghArgs[0]}\` is not available; use \`gh api <rest-endpoint>\`)`,
    )
  }
  const rest = ghArgs.slice(1)
  let endpoint: string | undefined
  let method: string | undefined
  const headers: string[] = []
  const rawFields: Array<[string, string]> = []
  const typedFields: Array<[string, string]> = []
  let inputFile: string | undefined
  let include = false
  let silent = false
  let paginate = false
  let hostname: string | undefined

  const needValue = (flag: string, idx: number): string => {
    const val = rest[idx + 1]
    if (val === undefined) {
      throw new GhStandinError(`flag ${flag} requires a value`)
    }
    return val
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg === '--') {
      const next = rest[i + 1]
      if (next !== undefined && endpoint === undefined) {
        endpoint = next
      }
      break
    }
    if (arg === '-X' || arg === '--method') {
      method = needValue(arg, i).toUpperCase()
      i++
    } else if (arg.startsWith('--method=')) {
      method = arg.slice('--method='.length).toUpperCase()
    } else if (arg === '-H' || arg === '--header') {
      headers.push(needValue(arg, i))
      i++
    } else if (arg.startsWith('--header=')) {
      headers.push(arg.slice('--header='.length))
    } else if (arg === '-f' || arg === '--raw-field') {
      const pair = needValue(arg, i)
      const eq = pair.indexOf('=')
      if (eq <= 0) throw new GhStandinError(`invalid --raw-field: ${pair}`)
      rawFields.push([pair.slice(0, eq), pair.slice(eq + 1)])
      i++
    } else if (arg === '-F' || arg === '--field') {
      const pair = needValue(arg, i)
      const eq = pair.indexOf('=')
      if (eq <= 0) throw new GhStandinError(`invalid --field: ${pair}`)
      typedFields.push([pair.slice(0, eq), pair.slice(eq + 1)])
      i++
    } else if (arg === '--input') {
      inputFile = needValue(arg, i)
      i++
    } else if (arg.startsWith('--input=')) {
      inputFile = arg.slice('--input='.length)
    } else if (arg === '-i' || arg === '--include') {
      include = true
    } else if (arg === '--silent') {
      silent = true
    } else if (arg === '--paginate') {
      paginate = true
    } else if (arg === '--hostname') {
      hostname = needValue(arg, i)
      i++
    } else if (arg.startsWith('--hostname=')) {
      hostname = arg.slice('--hostname='.length)
    } else if (arg.startsWith('-')) {
      throw new GhStandinError(`unsupported flag for built-in gh api: ${arg}`)
    } else if (endpoint === undefined) {
      endpoint = arg
    } else {
      throw new GhStandinError(`unexpected positional argument: ${arg}`)
    }
  }

  if (!endpoint) {
    throw new GhStandinError(
      'missing endpoint; give a REST path such as repos/{owner}/{repo}/pulls',
    )
  }
  if (endpoint === 'graphql' || endpoint === '/graphql') {
    throw new GhStandinError(
      'this built-in gh supports GitHub REST API endpoints only (GraphQL is not supported)',
    )
  }
  return {
    endpoint,
    method,
    headers,
    rawFields,
    typedFields,
    inputFile,
    include,
    silent,
    paginate,
    hostname,
  }
}

function parseTypedFieldValue(val: string): unknown {
  if (val === 'true') return true
  if (val === 'false') return false
  if (val === 'null') return null
  if (/^-?\d+$/.test(val)) return Number(val)
  return val
}

function buildValidatedHeaders(rawHeaders: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of rawHeaders) {
    const colon = h.indexOf(':')
    if (colon <= 0) {
      throw new GhStandinError(`header "${h}" must contain ':'`)
    }
    const name = h.slice(0, colon).trim().toLowerCase()
    const value = h.slice(colon + 1).trim()
    if (!ALLOWED_HEADERS.has(name)) {
      throw new GhStandinError(
        `the ${/^[a-z0-9-]+$/.test(name) ? `${name} ` : ''}header cannot be set through this session's GitHub proxy; headers that can: ${[...ALLOWED_HEADERS].join(', ')}`,
      )
    }
    if (/[^\P{Cc}\t]/u.test(value)) {
      throw new GhStandinError(
        `the ${name} header value contains a control character`,
      )
    }
    out[name] = value
  }
  return {
    accept: 'application/vnd.github+json',
    ...out,
    authorization: `token ${PLACEHOLDER_TOKEN}`,
    'user-agent': 'claude-code-gh-standin',
  }
}

const GRAPHQL_PATH_RE = /^(\/api\/v3)?\/graphql\/?$/i
const VALID_HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i
const GRAPHQL_UNSUPPORTED_ERROR =
  'this built-in gh supports GitHub REST API endpoints only (GraphQL is not supported)'

function resolveApiUrl(
  endpoint: string,
  hostname: string | undefined,
  ghesHosts: string[] | typeof GH_STANDIN_ANY_HOSTS_SENTINEL,
): URL {
  if (/[\p{Cc}\\]|(?! )\s/u.test(endpoint)) {
    throw new GhStandinError(
      'the endpoint contains a tab, a line break, a control character or a backslash',
    )
  }
  let apiBase = 'https://api.github.com'
  if (hostname && hostname !== 'github.com') {
    if (!VALID_HOSTNAME_RE.test(hostname)) {
      throw new GhStandinError(`invalid hostname: ${hostname}`)
    }
    if (
      ghesHosts !== GH_STANDIN_ANY_HOSTS_SENTINEL &&
      !ghesHosts.includes(hostname)
    ) {
      throw new GhStandinError(
        `this gh sends requests to api.github.com only; host "${hostname}" is not allowed`,
      )
    }
    apiBase = `https://${hostname}/api/v3`
  }
  let url: URL
  try {
    if (endpoint.includes('://')) {
      url = new URL(endpoint)
    } else {
      url = new URL(endpoint.replace(/^\//, ''), `${apiBase}/`)
    }
  } catch {
    throw new GhStandinError(`invalid endpoint URL: ${endpoint}`)
  }
  const baseParsed = new URL(apiBase)
  if (
    url.protocol !== 'https:' ||
    url.origin !== baseParsed.origin ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new GhStandinError(
      `this gh sends requests to ${baseParsed.hostname} only; give a REST path such as repos/{owner}/{repo}/pulls`,
    )
  }
  if (GRAPHQL_PATH_RE.test(url.pathname)) {
    throw new GhStandinError(GRAPHQL_UNSUPPORTED_ERROR)
  }
  return url
}

function formatResponseHeaders(res: {
  status: number
  statusText: string
  headers: Record<string, string | string[] | undefined>
}): string {
  const lines = [`HTTP/1.1 ${res.status} ${res.statusText}`.trimEnd()]
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined) continue
    if (Array.isArray(v)) {
      for (const item of v) lines.push(`${k}: ${item}`)
    } else {
      lines.push(`${k}: ${v}`)
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

async function readBodyInput(
  inputFile: string,
  stdin?: AsyncIterable<Buffer | string>,
): Promise<Buffer> {
  if (inputFile === '-') {
    const chunks: Buffer[] = []
    let total = 0
    const stream = stdin ?? process.stdin
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > MAX_BODY_BYTES) {
        throw new GhStandinError(
          `standard input is larger than ${MAX_BODY_BYTES / 1048576} MB, the most this gh sends`,
        )
      }
      chunks.push(buf)
    }
    return Buffer.concat(chunks)
  }
  const buf = await readFile(inputFile)
  if (buf.length > MAX_BODY_BYTES) {
    throw new GhStandinError(
      `${inputFile} is larger than ${MAX_BODY_BYTES / 1048576} MB, the most this gh sends`,
    )
  }
  return buf
}

/**
 * Execute the built-in `gh api` stand-in CLI (official `ghStandinMain`).
 * Returns process exit code (`0` on success, `1` on error).
 */
export async function ghStandinMain(
  parsed: ParsedGhStandinArgs,
  io: GhStandinIO = {
    write: async (stream, data) => {
      const target = stream === 'stdout' ? process.stdout : process.stderr
      target.write(data)
    },
  },
): Promise<number> {
  try {
    const cmd = parseGhApiArgs(parsed.ghArgs)
    const hasFields = cmd.rawFields.length > 0 || cmd.typedFields.length > 0
    const method =
      cmd.method ?? (cmd.inputFile !== undefined || hasFields ? 'POST' : 'GET')
    if (!ALLOWED_METHODS.has(method)) {
      throw new GhStandinError(
        'unsupported method; use GET, HEAD, POST, PUT, PATCH or DELETE',
      )
    }
    let currentUrl = resolveApiUrl(cmd.endpoint, cmd.hostname, parsed.ghesHosts)
    const headers = buildValidatedHeaders(cmd.headers)
    let body: Buffer | undefined
    if (cmd.inputFile !== undefined) {
      body = await readBodyInput(cmd.inputFile, io.stdin)
      headers['content-type'] ??= 'application/json'
    } else if (hasFields) {
      if (method === 'GET' || method === 'HEAD') {
        for (const [k, v] of [...cmd.rawFields, ...cmd.typedFields]) {
          currentUrl.searchParams.append(k, v)
        }
      } else {
        const obj: Record<string, unknown> = {}
        for (const [k, v] of cmd.rawFields) obj[k] = v
        for (const [k, v] of cmd.typedFields) obj[k] = parseTypedFieldValue(v)
        body = Buffer.from(JSON.stringify(obj), 'utf8')
        headers['content-type'] ??= 'application/json'
      }
    }

    const env = io.env ?? process.env
    let httpsAgent: HttpsProxyAgent<string> | undefined
    if (parsed.port !== GH_STANDIN_STANDALONE_PROXY) {
      let ca: string | undefined
      try {
        ca = await readFile(parsed.caBundlePath, 'utf8')
      } catch {
        // CA bundle optional in tests / custom proxy
      }
      const localProxyUrl: string = `http://127.0.0.1:${parsed.port}`
      httpsAgent = new HttpsProxyAgent(localProxyUrl, {
        ...(ca ? { ca } : {}),
      })
    } else if (env.HTTPS_PROXY || env.https_proxy) {
      const proxyUrl = env.HTTPS_PROXY || env.https_proxy || ''
      if (proxyUrl) {
        let ca: string | undefined
        try {
          ca = await readFile(parsed.caBundlePath, 'utf8')
        } catch {
          // CA bundle optional
        }
        httpsAgent = new HttpsProxyAgent(proxyUrl, {
          ...(ca ? { ca } : {}),
        })
      }
    }

    const doRequest =
      io.requestFn ??
      (async req => {
        const resp: AxiosResponse<ArrayBuffer> = await axios.request({
          method: req.method,
          url: req.url,
          headers: req.headers,
          data: req.data,
          responseType: 'arraybuffer',
          validateStatus: () => true,
          maxRedirects: 0,
          maxContentLength: MAX_RESPONSE_BYTES,
          maxBodyLength: MAX_BODY_BYTES,
          proxy: false,
          httpsAgent: req.httpsAgent,
        })
        return {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers as Record<
            string,
            string | string[] | undefined
          >,
          data: Buffer.from(resp.data),
        }
      })

    let arrayOpened = false
    let arrayHasItems = false

    while (true) {
      let reqUrl = currentUrl
      let reqMethod = method
      let reqBody = body
      let reqHeaders = { ...headers }
      let response: Awaited<ReturnType<typeof doRequest>> | undefined

      for (let hops = 0; ; hops++) {
        response = await doRequest({
          method: reqMethod,
          url: reqUrl.href,
          headers: reqHeaders,
          data: reqBody,
          httpsAgent,
        })
        const loc = response.headers.location
        const locStr = Array.isArray(loc) ? loc[0] : loc
        if (
          !REDIRECT_STATUSES.has(response.status) ||
          typeof locStr !== 'string' ||
          locStr === ''
        ) {
          break
        }
        if (hops >= MAX_REDIRECTS) {
          throw new GhStandinError(`stopped after ${MAX_REDIRECTS} redirects`)
        }
        const nextUrl = new URL(locStr, reqUrl)
        if (
          nextUrl.protocol !== 'https:' ||
          nextUrl.origin !== reqUrl.origin ||
          nextUrl.username !== '' ||
          nextUrl.password !== ''
        ) {
          throw new GhStandinError(
            `refusing a redirect to ${nextUrl.protocol}//${nextUrl.host}: this gh sends requests to ${reqUrl.hostname} only`,
          )
        }
        if (GRAPHQL_PATH_RE.test(nextUrl.pathname)) {
          throw new GhStandinError(GRAPHQL_UNSUPPORTED_ERROR)
        }
        reqUrl = nextUrl
        if (response.status !== 307 && response.status !== 308) {
          reqMethod = reqMethod === 'HEAD' ? 'HEAD' : 'GET'
          reqBody = undefined
          delete reqHeaders['content-type']
        }
      }

      const isErr = response.status >= 400
      if (cmd.include) {
        await io.write('stdout', formatResponseHeaders(response))
      }
      const data = response.data
      if (data.length > 0 && !cmd.silent) {
        const contentType = String(response.headers['content-type'] ?? '')
        if (
          cmd.paginate &&
          !cmd.include &&
          !isErr &&
          /[/+]json(;|$)/.test(contentType) &&
          data[0] === 0x5b &&
          data[data.length - 1] === 0x5d
        ) {
          const inner = data.subarray(1, -1)
          if (!arrayOpened) {
            await io.write('stdout', '[')
            arrayOpened = true
          }
          if (inner.toString('utf8').trim().length > 0) {
            if (arrayHasItems) await io.write('stdout', ',')
            await io.write('stdout', inner)
            arrayHasItems = true
          }
        } else {
          await io.write('stdout', data)
        }
      }

      if (isErr) {
        let msg = `HTTP ${response.status}`
        try {
          const parsedBody = JSON.parse(data.toString('utf8')) as {
            message?: string
          }
          if (typeof parsedBody.message === 'string' && parsedBody.message) {
            msg = `${parsedBody.message} (HTTP ${response.status})`
          }
        } catch {
          // non-JSON error body
        }
        await io.write('stderr', `gh: ${msg}\n`)
        return 1
      }

      const linkHeader = String(response.headers.link ?? '')
      const nextMatch =
        cmd.paginate && method === 'GET'
          ? /<([^>]+)>;\s*rel="next"/.exec(linkHeader)
          : null
      if (!nextMatch?.[1]) {
        if (arrayOpened) await io.write('stdout', ']')
        return 0
      }
      currentUrl = resolveApiUrl(nextMatch[1], cmd.hostname, parsed.ghesHosts)
    }
  } catch (err) {
    const message =
      err instanceof GhStandinError
        ? err.message
        : err instanceof Error
          ? `could not reach GitHub through this session's GitHub proxy (${err.message})`
          : String(err)
    await io.write('stderr', `gh: ${message}\n`)
    return 1
  }
}
