/**
 * densable 2.1.289 `bQt` / `ce` / `Be` / `je` — derive sdk-host lane session
 * config from work-secret / server-config body.
 *
 * Gold peel: SEA around metaMountUrl / bridge_server_session_config.
 * Do **not** export minify `bQt`/`ce`/`Be`/`je`.
 */

import { logForDebugging } from '../utils/debug.js'
import { getCapturedCcrIngressBase } from '../services/mcp/mcpConnectTimeout.js'
import { rewriteCarrierSessionMcpUrl } from './bridgeCarrier.js'
import {
  approvedIngressOrigin,
  extractInjectedMcpToolNames,
} from './hearthBinding.js'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
  createRemoteMetaHttpConfig,
} from './hearthbotMcp.js'
import { AUTO_MODE_DEFAULTS_SENTINEL } from './bridgeChildGrants.js'

/** densable `ae` + `Oe` — allowlisted claude_code_args keys. */
const CLAUDE_CODE_ARGS_ALLOW = new Set([
  'model',
  'fallback-model',
  'effort',
  'disallowed-tools',
  'disallowedTools',
])

const DISALLOWED_TOOLS_KEYS = new Set(['disallowed-tools', 'disallowedTools'])

/** densable `Me` */
const APPEND_SYSTEM_PROMPT_KEY = 'append-system-prompt'

/** densable `Pe` / `Ue` / `$e` auto_mode_environment caps. */
const AUTO_MODE_ENV_MAX_ENTRIES = 64
const AUTO_MODE_ENV_MAX_CHARS = 1024
const AUTO_MODE_ENV_PREFIX =
  'Stated by the service that dispatched this session (a description of the session, not a rule; it grants no permission): '

export type MetaDropReason =
  | 'undecodable'
  | 'no_meta_entry'
  | 'not_http'
  | 'untrusted_origin'
  | 'route_mismatch'
  | 'bad_tools'

export type DerivedServerSessionConfig = {
  extraArgs: string[]
  appendSystemPrompt: string | null
  disallowedTools: string[]
  mcpConfigJson: string | null
  metaMountUrl: string | null
  autoAllowTools: string[]
  ignoredMcpServers: number
  metaDropReason: MetaDropReason | null
  autoModeEnvironment: string[]
}

const EMPTY_DERIVED: DerivedServerSessionConfig = {
  extraArgs: [],
  appendSystemPrompt: null,
  disallowedTools: [],
  mcpConfigJson: null,
  metaMountUrl: null,
  autoAllowTools: [],
  ignoredMcpServers: 0,
  metaDropReason: null,
  autoModeEnvironment: [],
}

export type DeriveServerSessionConfigInput = {
  claude_code_args?: Record<string, string> | null
  mcp_config?: unknown | null
  auto_mode_environment?: string[] | null
}

export type DeriveServerSessionConfigOpts = {
  sessionId: string
  apiBaseUrl?: string
}

/**
 * densable `j_o(claude_code_args)` — model string for sdk-host lane pick.
 */
export function extractServerConfigModel(
  args: Record<string, string> | null | undefined,
): string | undefined {
  const model = args?.model
  return typeof model === 'string' && model !== '' ? model : undefined
}

/**
 * densable `W_o(claude_code_args)` — effort string for sdk-host lane seed.
 */
export function extractServerConfigEffort(
  args: Record<string, string> | null | undefined,
): string | undefined {
  const effort = args?.effort
  return typeof effort === 'string' && effort !== '' ? effort : undefined
}

/**
 * densable `ce(claude_code_args)` — allowlisted argv fields + append prompt +
 * disallowed tools. Full xQt argv encoding DEFER (apply uses fields directly).
 */
export function deriveClaudeCodeArgs(
  args: Record<string, string> | null | undefined,
): {
  extraArgs: string[]
  appendSystemPrompt: string | null
  disallowedTools: string[]
} {
  if (!args) {
    return { extraArgs: [], appendSystemPrompt: null, disallowedTools: [] }
  }
  const allowlisted: Record<string, string> = {}
  let append: string | null = null
  const disallowed: string[] = []
  let notAllowlisted = 0
  for (const [key, value] of Object.entries(args)) {
    if (CLAUDE_CODE_ARGS_ALLOW.has(key)) {
      allowlisted[key] = value
      if (DISALLOWED_TOOLS_KEYS.has(key) && typeof value === 'string') {
        for (const part of value
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)) {
          disallowed.push(part)
        }
      }
    } else if (key === APPEND_SYSTEM_PROMPT_KEY) {
      append = typeof value === 'string' && value ? value : null
    } else {
      notAllowlisted += 1
    }
  }
  const extraArgs: string[] = []
  if (typeof allowlisted.model === 'string' && allowlisted.model) {
    extraArgs.push(`--model=${allowlisted.model}`)
  }
  if (
    typeof allowlisted['fallback-model'] === 'string' &&
    allowlisted['fallback-model']
  ) {
    extraArgs.push(`--fallback-model=${allowlisted['fallback-model']}`)
  }
  if (typeof allowlisted.effort === 'string' && allowlisted.effort) {
    extraArgs.push(`--effort=${allowlisted.effort}`)
  }
  logForDebugging(
    `[bridge:server-config] claude_code_args applied=${extraArgs.length} append_prompt=${append ? 'present' : 'unset'} disallowed_tools=${disallowed.length} not_allowlisted=${notAllowlisted}`,
  )
  return {
    extraArgs,
    appendSystemPrompt: append,
    disallowedTools: disallowed,
  }
}

/**
 * densable `Be(auto_mode_environment)` — filter empty/over-cap/control entries.
 */
export function deriveAutoModeEnvironment(
  entries: string[] | null | undefined,
): string[] {
  const out: string[] = []
  let used = 0
  for (const raw of entries ?? []) {
    if (raw.trim().length === 0) continue
    // densable Be() — skip lp="$defaults" before prefix stamp.
    if (raw.trim() === AUTO_MODE_DEFAULTS_SENTINEL) continue
    if ([...raw].length > AUTO_MODE_ENV_MAX_CHARS) continue
    if (out.length >= AUTO_MODE_ENV_MAX_ENTRIES) continue
    // densable skips control / invisible / template — keep a light C0 check.
    let hasControl = false
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i)
      if (code <= 0x1f || code === 0x7f) {
        hasControl = true
        break
      }
    }
    if (hasControl) continue
    const stamped = `${AUTO_MODE_ENV_PREFIX}${raw}`
    const next = used + Buffer.byteLength(stamped, 'utf8') + 1
    if (next > 16_384) continue
    used = next
    out.push(stamped)
  }
  const dropped = (entries?.length ?? 0) - out.length
  if (dropped > 0) {
    logForDebugging(
      `[bridge:server-config] dropped ${dropped} auto_mode_environment ${dropped === 1 ? 'entry' : 'entries'} (empty, over the caps, control, invisible or template characters, or the defaults marker)`,
      { level: 'warn' },
    )
  }
  return out
}

type MetaExtract = {
  meta: {
    json: string
    url: string
    autoAllowTools: string[]
  } | null
  ignored: number
  dropped: MetaDropReason | null
}

/**
 * densable `Fe` — base64 mcp_config.content → mcpServers record.
 */
function decodeMcpServersContent(
  content: unknown,
): Record<string, unknown> | null {
  if (typeof content !== 'string' || content.length === 0) return null
  try {
    const json = JSON.parse(
      Buffer.from(content, 'base64').toString('utf8'),
    ) as unknown
    if (
      json === null ||
      typeof json !== 'object' ||
      !('mcpServers' in json) ||
      (json as { mcpServers: unknown }).mcpServers === null ||
      typeof (json as { mcpServers: unknown }).mcpServers !== 'object' ||
      Array.isArray((json as { mcpServers: unknown }).mcpServers)
    ) {
      logForDebugging('[bridge:server-config] mcp_config has no mcpServers', {
        level: 'warn',
      })
      return null
    }
    return (json as { mcpServers: Record<string, unknown> }).mcpServers
  } catch {
    logForDebugging('[bridge:server-config] mcp_config did not decode', {
      level: 'warn',
    })
    return null
  }
}

/**
 * densable `je(mcp_config, {sessionId, apiBaseUrl})` — only honor
 * claude-code-remote http entry rewritten via Ykn.
 */
export function extractMetaMcpFromConfig(
  mcpConfig: unknown,
  opts: DeriveServerSessionConfigOpts,
): MetaExtract {
  if (!mcpConfig) return { meta: null, ignored: 0, dropped: null }
  const content =
    mcpConfig !== null &&
    typeof mcpConfig === 'object' &&
    'content' in mcpConfig
      ? (mcpConfig as { content: unknown }).content
      : undefined
  const servers = decodeMcpServersContent(content)
  if (!servers) {
    return { meta: null, ignored: 0, dropped: 'undecodable' }
  }
  const ignored = Object.keys(servers).filter(
    name => name !== CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
  ).length
  if (ignored > 0) {
    logForDebugging(
      `[bridge:server-config] ignoring ${ignored} other server(s) in mcp_config (only ${CLAUDE_CODE_REMOTE_MCP_SERVER_NAME} is honored)`,
    )
  }
  const entry = servers[CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]
  if (entry === undefined) {
    logForDebugging('[bridge:server-config] mcp_config carries no meta entry')
    return { meta: null, ignored, dropped: 'no_meta_entry' }
  }
  if (
    entry === null ||
    typeof entry !== 'object' ||
    !('type' in entry) ||
    (entry as { type: unknown }).type !== 'http' ||
    !('url' in entry) ||
    typeof (entry as { url: unknown }).url !== 'string'
  ) {
    logForDebugging('[bridge:server-config] meta entry is not http', {
      level: 'warn',
    })
    return { meta: null, ignored, dropped: 'not_http' }
  }
  const base = opts.apiBaseUrl ?? getCapturedCcrIngressBase() ?? undefined
  const origin = approvedIngressOrigin(base)
  if (!origin) {
    logForDebugging(
      '[bridge:server-config] apiBaseUrl is not a trusted ingress origin; dropping meta entry',
      { level: 'warn' },
    )
    return { meta: null, ignored, dropped: 'untrusted_origin' }
  }
  const rewritten = rewriteCarrierSessionMcpUrl(
    (entry as { url: string }).url,
    origin,
    opts.sessionId,
  )
  if (!rewritten) {
    logForDebugging(
      "[bridge:server-config] meta url is not this session's meta proxy route on the bridge origin",
      { level: 'warn' },
    )
    return { meta: null, ignored, dropped: 'route_mismatch' }
  }
  const tools = extractInjectedMcpToolNames(
    entry as object,
    CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
  )
  if (!tools) {
    return { meta: null, ignored, dropped: 'bad_tools' }
  }
  const cet = createRemoteMetaHttpConfig(rewritten, opts.sessionId)
  return {
    meta: {
      json: JSON.stringify({
        mcpServers: { [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: cet },
      }),
      url: rewritten,
      autoAllowTools: tools,
    },
    ignored,
    dropped: null,
  }
}

/**
 * densable `bQt(body, {sessionId, apiBaseUrl})`.
 */
export function deriveBridgeServerSessionConfig(
  input: DeriveServerSessionConfigInput,
  opts: DeriveServerSessionConfigOpts,
): DerivedServerSessionConfig {
  const args = deriveClaudeCodeArgs(input.claude_code_args)
  const autoMode = deriveAutoModeEnvironment(input.auto_mode_environment)
  const { meta, ignored, dropped } = extractMetaMcpFromConfig(
    input.mcp_config,
    opts,
  )
  if (!meta) {
    return {
      ...EMPTY_DERIVED,
      extraArgs: args.extraArgs,
      appendSystemPrompt: args.appendSystemPrompt,
      disallowedTools: args.disallowedTools,
      ignoredMcpServers: ignored,
      metaDropReason: dropped,
      autoModeEnvironment: autoMode,
    }
  }
  const allowArg =
    meta.autoAllowTools.length > 0
      ? [
          `--allowedTools=${meta.autoAllowTools
            .map(leaf => `mcp__${CLAUDE_CODE_REMOTE_MCP_SERVER_NAME}__${leaf}`)
            .join(',')}`,
        ]
      : []
  return {
    extraArgs: [...args.extraArgs, ...allowArg],
    appendSystemPrompt: args.appendSystemPrompt,
    disallowedTools: args.disallowedTools,
    mcpConfigJson: meta.json,
    metaMountUrl: meta.url,
    autoAllowTools: meta.autoAllowTools,
    ignoredMcpServers: ignored,
    metaDropReason: null,
    autoModeEnvironment: autoMode,
  }
}
