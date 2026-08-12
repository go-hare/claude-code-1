/**
 * densable 2.1.224 session child spawn helpers (sjv / Njv / tBh / fff / xWl / AFi).
 * Pure recovered surface — full process lifecycle lives in sessionHandler.
 */
import { join } from 'node:path'

/** densable `ojv` — flags blocked from server-supplied claude_code_args */
export const BLOCKED_CLAUDE_CODE_ARGS = new Set([
  'sdk-url',
  'resume',
  'print',
  'input-format',
  'output-format',
  'replay-user-messages',
  'debug-file',
  'mcp-config',
])

/** densable `vfS` — allowed flag name shape for fff */
const FLAG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** densable `KPv` — operator tool prefix stripped from server tools arg */
export const SELF_HOSTED_RUNNER_TOOL_PREFIX = 'self_hosted_runner_'

/**
 * densable `yM` equivalent — expand CSV tool lists (densable tool-name normalizer).
 * SEA does not expose full yM body in this region; recovered usage is CSV split.
 */
export function expandToolNames(values: string[]): string[] {
  const out: string[] = []
  for (const v of values) {
    for (const part of v.split(',')) {
      const t = part.trim()
      if (t) out.push(t)
    }
  }
  return out
}

/** densable `kWl` */
export function isSelfHostedRunnerOperatorTool(name: string): boolean {
  return name.startsWith(SELF_HOSTED_RUNNER_TOOL_PREFIX)
}

/** densable `kvh` */
export function stripSelfHostedRunnerToolNames(toolsCsv: string): string {
  return expandToolNames([toolsCsv])
    .filter(t => !isSelfHostedRunnerOperatorTool(t))
    .join(',')
}

/** densable `AFi` — true if any server tools value is an operator tool */
export function serverToolsValueNamesSelfHostedRunnerTool(
  tools: unknown,
): boolean {
  if (tools === undefined) return false
  const t = typeof tools === 'string' ? tools : String(tools)
  return expandToolNames([t]).some(isSelfHostedRunnerOperatorTool)
}

/** densable `xWl` — sanitize claude_code_args.tools */
export function sanitizeServerClaudeCodeArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const tools = args.tools
  if (tools === undefined) return args
  const r = typeof tools === 'string' ? tools : String(tools)
  if (!serverToolsValueNamesSelfHostedRunnerTool(r)) {
    return typeof tools === 'string' ? args : { ...args, tools: r }
  }
  return { ...args, tools: stripSelfHostedRunnerToolNames(r) }
}

/** densable `sIa` — push `--flag value` or `--flag=-value` */
export function pushClaudeFlag(
  argv: string[],
  flag: string,
  value: unknown,
): void {
  const n = String(value)
  if (n.length > 1 && n.startsWith('-')) {
    argv.push(`--${flag}=${n}`)
  } else {
    argv.push(`--${flag}`, n)
  }
}

/**
 * densable `fff` — merge server claude_code_args into argv.
 * Returns count of flags actually added.
 */
export function mergeClaudeCodeArgs(
  argv: string[],
  serverArgs: Record<string, unknown>,
  blocked: Set<string>,
  onSkip: (kind: string, name: string) => void,
): number {
  let added = 0
  for (const [key, val] of Object.entries(serverArgs)) {
    if (!FLAG_NAME_RE.test(key)) {
      onSkip('malformed', JSON.stringify(key))
      continue
    }
    if (blocked.has(key)) {
      onSkip('blocked', key)
      continue
    }
    if (val !== '') {
      pushClaudeFlag(argv, key, val)
      added++
    }
  }
  return added
}

/** densable `Njv` — sdk/resume URL for session child */
export function buildSessionSdkUrls(
  apiBaseUrl: string,
  sessionId: string,
): { sdkUrl: string; resumeUrl: string } {
  const local =
    apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')
  const host = apiBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const url = `${local ? 'http' : 'https'}://${host}/v1/code/sessions/${sessionId}`
  return { sdkUrl: url, resumeUrl: url }
}

/** densable `tBh` — epoch fence token file path */
export function sessionIngressTokenPath(
  configDir: string,
  epoch: number,
): string {
  return join(configDir, `.session_ingress_token.e${epoch}`)
}

/** densable `UUi` — account email from session JWT `act.email` */
export function extractSessionActorEmail(token: string): string | null {
  const stripped = token.replace(/^sk-ant-[a-z]+-/, '')
  const parts = stripped.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as {
      act?: { email?: unknown }
    }
    const email = json.act?.email
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}

/**
 * densable `Onn` — remote session UUID from id ending `_01` + base58.
 * Returns undefined when not convertible (densable same).
 */
export function remoteSessionUuidFromId(sessionId: string): string | undefined {
  const t = sessionId.lastIndexOf('_')
  if (t < 0) return undefined
  const r = sessionId.slice(t + 1)
  if (!r.startsWith('01')) return undefined
  const payload = r.slice(2)
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  if (payload.length !== 22) return undefined
  let n = 0n
  const base = 58n
  for (const ch of payload) {
    const o = alphabet.indexOf(ch)
    if (o < 0) return undefined
    n = n * base + BigInt(o)
  }
  const hex = n.toString(16).padStart(32, '0')
  if (hex.length !== 32) return undefined
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export type BuildSessionChildArgsOpts = {
  execArgs?: string[]
  apiBaseUrl: string
  sessionId: string
  debugFile: string
  mcpConfigPath?: string
  addDirs?: string[]
  /** densable remote config `claude_code_args` object */
  claudeCodeArgs?: Record<string, unknown>
  onDebug?: (msg: string) => void
}

/**
 * densable `sjv` argv construction (without spawn).
 * Core flags + optional mcp/add-dir + sanitized server args.
 */
export function buildSessionChildArgs(
  opts: BuildSessionChildArgsOpts,
): string[] {
  const { sdkUrl, resumeUrl } = buildSessionSdkUrls(
    opts.apiBaseUrl,
    opts.sessionId,
  )
  const execArgs = opts.execArgs ?? []
  const argv: string[] = [
    ...execArgs,
    '--print',
    '--sdk-url',
    sdkUrl,
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--replay-user-messages',
    `--resume=${resumeUrl}`,
    '--debug-file',
    opts.debugFile,
  ]
  if (opts.mcpConfigPath) {
    argv.push('--mcp-config', opts.mcpConfigPath)
  }
  for (const dir of opts.addDirs ?? []) {
    argv.push('--add-dir', dir)
  }

  const rawArgs = opts.claudeCodeArgs ?? {}
  let serverArgs = sanitizeServerClaudeCodeArgs(rawArgs)
  if (
    serverToolsValueNamesSelfHostedRunnerTool(rawArgs.tools) &&
    opts.onDebug
  ) {
    opts.onDebug(
      '[runner:session] Stripped self-hosted-runner operator tool names from the server-supplied tools arg',
    )
    if (serverArgs.tools === '') {
      opts.onDebug(
        '[runner:warn] server-supplied tools arg contained ONLY self-hosted-runner operator tool names; dropping --tools and using the default pool',
      )
    }
  }
  // densable drops empty tools key after strip when only operator tools
  if (serverArgs.tools === '') {
    const { tools: _drop, ...rest } = serverArgs
    serverArgs = rest
  }

  const added = mergeClaudeCodeArgs(
    argv,
    serverArgs,
    BLOCKED_CLAUDE_CODE_ARGS,
    (kind, name) => {
      opts.onDebug?.(
        `[runner:session] Skipping ${kind} claude_code_arg: ${name}`,
      )
    },
  )
  if (added > 0) {
    opts.onDebug?.(
      `[runner:session] Added ${added}/${Object.keys(rawArgs).length} claude_code_args`,
    )
  }
  return argv
}

export type BuildSessionChildEnvOpts = {
  sessionId: string
  sessionToken: string
  workerEpoch: number
  configDir: string
  stageFileRoot: string
  apiBaseUrl: string
  /** remote config environment_variables */
  environmentVariables?: Record<string, string | undefined>
  inferenceAccessToken: string
  capacity?: number
  healthPort?: number
  clientPlatform?: string
  governedGitConfigPath?: string
  governedGitConfig?: boolean
  governedGhPathShim?: boolean
  agentProxyUrlFromEnv?: string
}

/**
 * densable `sjv` child env object (core keys).
 * Strips host pool secrets; sets BYOC remote markers.
 */
export function buildSessionChildEnv(
  opts: BuildSessionChildEnvOpts,
): NodeJS.ProcessEnv {
  const envVars = opts.environmentVariables ?? {}
  const email = extractSessionActorEmail(opts.sessionToken)
  const sessionOtelId = opts.sessionId.replace(/^cse_/, 'session_')
  const hostOtel =
    envVars.OTEL_RESOURCE_ATTRIBUTES ?? process.env.OTEL_RESOURCE_ATTRIBUTES
  const multiCapOtel =
    (opts.capacity ?? 1) > 1 &&
    opts.healthPort !== undefined &&
    opts.healthPort > 0 &&
    process.env.OTEL_METRICS_EXPORTER === 'prometheus'
      ? {
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json',
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `http://127.0.0.1:${opts.healthPort}/v1/metrics`,
          OTEL_EXPORTER_OTLP_METRICS_COMPRESSION: 'none',
          OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
          OTEL_RESOURCE_ATTRIBUTES:
            (hostOtel ? `${hostOtel},` : '') +
            `session.id=${sessionOtelId}` +
            (opts.clientPlatform
              ? `,client.platform=${opts.clientPlatform}`
              : ''),
        }
      : {}

  const useGoverned =
    Boolean(opts.governedGitConfig) || Boolean(opts.governedGhPathShim)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envVars,
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: opts.sessionToken,
    CLAUDE_SESSION_INGRESS_TOKEN_FILE: sessionIngressTokenPath(
      opts.configDir,
      opts.workerEpoch,
    ),
    CLAUDE_CODE_OAUTH_TOKEN: opts.inferenceAccessToken,
    CLAUDE_CODE_OAUTH_SCOPES:
      'user:inference user:ccr_inference user:file_upload',
    CLAUDE_CONFIG_DIR: opts.configDir,
    CLAUDE_STAGE_FILE_ROOT: opts.stageFileRoot,
    ANTHROPIC_MODEL: undefined,
    CLAUDE_CODE_ENVIRONMENT_KIND: 'byoc',
    CLAUDE_CODE_BYOC_ENABLE_DATADOG:
      process.env.CLAUDE_CODE_BYOC_ENABLE_DATADOG,
    DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY,
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    DISABLE_ERROR_REPORTING: process.env.DISABLE_ERROR_REPORTING,
    DISABLE_GROWTHBOOK: process.env.DISABLE_GROWTHBOOK,
    ...multiCapOtel,
    CLAUDE_CODE_OTEL_DIAG_STDERR: '1',
    CLAUDE_CODE_TEE_SDK_STDOUT: '1',
    CLAUDE_RUNNER_ACTIVITY_FD: '3',
    CLAUDE_CODE_REMOTE: 'true',
    CLAUDE_CODE_RETRY_WATCHDOG: '1',
    CLAUDE_CODE_MAX_RETRIES: '',
    CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'self_hosted',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_RUNNER_CLAUDE_BIN: process.execPath,
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    CLAUDE_CODE_REMOTE_SESSION_ID: opts.sessionId,
    CLAUDE_CODE_REMOTE_SESSION_UUID:
      remoteSessionUuidFromId(opts.sessionId) ?? undefined,
    CLAUDE_CODE_ACCOUNT_UUID: envVars.CLAUDE_CODE_ACCOUNT_UUID,
    CLAUDE_CODE_ORGANIZATION_UUID: envVars.CLAUDE_CODE_ORGANIZATION_UUID,
    CCR_SESSION_ACCOUNT_EMAIL: email ?? undefined,
    ANTHROPIC_BASE_URL: opts.apiBaseUrl,
    SESSION_INGRESS_URL: opts.apiBaseUrl,
    ...(opts.apiBaseUrl.includes('staging')
      ? { USE_STAGING_OAUTH: '1' }
      : { USE_STAGING_OAUTH: undefined }),
    CLAUDE_CODE_USE_CCR_V2: '1',
    CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG: opts.governedGitConfig
      ? '1'
      : undefined,
    CLAUDE_CODE_AGENT_PROXY_GH_SHIM: opts.governedGhPathShim ? '1' : undefined,
    ...(opts.governedGitConfig && opts.governedGitConfigPath
      ? { GIT_CONFIG_GLOBAL: opts.governedGitConfigPath }
      : {}),
    ...(useGoverned
      ? { CCR_AGENT_PROXY_ENABLED: '1' }
      : envVars.AGENT_PROXY_URL || opts.agentProxyUrlFromEnv
        ? {}
        : { CCR_AGENT_PROXY_ENABLED: undefined }),
    SELF_HOSTED_RUNNER_POOL_SECRET: undefined,
    SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: undefined,
    SELF_HOSTED_RUNNER_HOST_CONFIG_DIR: undefined,
    CLAUDE_CODE_EXIT_AFTER_STOP_DELAY: undefined,
    CLAUDE_CODE_WORKER_EPOCH: String(opts.workerEpoch),
    CLAUDE_CODE_RESUME_INTERRUPTED_TURN: opts.workerEpoch > 1 ? '1' : undefined,
    CLAUDE_CODE_RESUME_PROMPT:
      opts.workerEpoch > 1
        ? 'Continue from where you left off. This session moved to a new runner; files you created earlier may no longer exist, so verify the working directory state before relying on prior edits.'
        : undefined,
  }
  return env
}
