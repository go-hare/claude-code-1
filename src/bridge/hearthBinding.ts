/**
 * densable 2.1.289 `pur` / `Fcs` / `$cs` — hearth projects binding parse.
 *
 * Gold: `/tmp/gold289-extract/oee_projects_site.txt`
 * Do **not** export minify `pur` / `Fcs` / `$cs` / `xet` / `wQt`.
 */

import { logForDebugging } from '../utils/debug.js'
import {
  HEARTHBOT_AUTO_ALLOW_TOOLS,
  HEARTHBOT_MCP_SERVER_NAME,
  HEARTH_BINDING_ID_RE,
  hearthbotMcpPath,
} from './hearthbotMcp.js'

/** densable `Fcs` / `HEARTH_BINDING_CHANGED_HINT` — mcp_set_servers hint. */
export const HEARTH_BINDING_CHANGED = 'hearth_binding_changed'
/** densable export alias used by headless print mcp_set_servers arm. */
export const HEARTH_BINDING_CHANGED_HINT = HEARTH_BINDING_CHANGED

export type HearthBinding = {
  channelId: string
  threadId: string
  mountUrl: string
  autoAllowTools: string[]
}

export type ParseHearthBindingResult =
  | { binding: HearthBinding; reason?: undefined }
  | {
      binding: null
      reason:
        | 'not_joined'
        | 'bad_ids'
        | 'bad_server_name'
        | 'not_http'
        | 'untrusted_origin'
        | 'url_mismatch'
        | 'bad_tools'
    }

export type ParseHearthBindingOpts = {
  apiBaseUrl: string
  sessionId: string
}

/**
 * densable `xet(apiBaseUrl)` — approved ingress origin when URL parses and
 * is not rejected by the local sanitize/trust gate. Local: any parseable
 * http(s) origin is accepted for mount URL construction; untrusted_origin
 * only when parse fails (gold `_(e)===null` trust gate is Desktop-host
 * specific — CLI uses parseable origin).
 */
export function approvedIngressOrigin(
  apiBaseUrl: string | undefined,
): string | null {
  if (apiBaseUrl === undefined) return null
  try {
    return new URL(apiBaseUrl).origin
  } catch {
    return null
  }
}

/**
 * densable `wQt(server, name=kc|pp)` name-list arm used by `pur`:
 * missing tools → []; non-array → null (bad_tools); malformed entry → null.
 * Returns bare tool leaf names (not FQNs).
 */
export function extractInjectedMcpToolNames(
  server: object,
  _serverName: string = HEARTHBOT_MCP_SERVER_NAME,
): string[] | null {
  if (!('tools' in server) || server.tools === undefined) return []
  if (!Array.isArray(server.tools)) {
    logForDebugging(
      '[bridge:projects] binding tools[] is not an array — no mount',
      { level: 'warn' },
    )
    return null
  }
  const names: string[] = []
  for (const entry of server.tools) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !('name' in entry) ||
      typeof (entry as { name: unknown }).name !== 'string' ||
      !HEARTH_BINDING_ID_RE.test((entry as { name: string }).name)
    ) {
      logForDebugging(
        '[bridge:projects] binding tools[] entry is malformed — no mount',
        { level: 'warn' },
      )
      return null
    }
    names.push((entry as { name: string }).name)
  }
  return names
}

/**
 * densable `pur(assertion, {apiBaseUrl, sessionId})`.
 */
export function parseHearthBinding(
  assertion: unknown,
  opts: ParseHearthBindingOpts,
): ParseHearthBindingResult {
  if (
    assertion === null ||
    typeof assertion !== 'object' ||
    !('hearth' in assertion)
  ) {
    return { binding: null, reason: 'not_joined' }
  }
  const hearth = (assertion as { hearth: unknown }).hearth
  if (hearth === null || typeof hearth !== 'object') {
    return { binding: null, reason: 'not_joined' }
  }
  const h = hearth as Record<string, unknown>
  const channelId = typeof h.channel_id === 'string' ? h.channel_id : ''
  const threadId = typeof h.thread_id === 'string' ? h.thread_id : ''
  if (
    !HEARTH_BINDING_ID_RE.test(channelId) ||
    !HEARTH_BINDING_ID_RE.test(threadId)
  ) {
    logForDebugging('[bridge:projects] binding ids are malformed — no mount', {
      level: 'warn',
    })
    return { binding: null, reason: 'bad_ids' }
  }
  const mcpServer = h.mcp_server
  if (mcpServer === null || typeof mcpServer !== 'object') {
    return { binding: null, reason: 'bad_server_name' }
  }
  const server = mcpServer as Record<string, unknown>
  if (server.name !== HEARTHBOT_MCP_SERVER_NAME) {
    logForDebugging(
      '[bridge:projects] binding names an unexpected MCP server — no mount',
      { level: 'warn' },
    )
    return { binding: null, reason: 'bad_server_name' }
  }
  if (server.type !== 'http' || typeof server.url !== 'string') {
    return { binding: null, reason: 'not_http' }
  }
  const origin = approvedIngressOrigin(opts.apiBaseUrl)
  if (origin === null) {
    logForDebugging(
      '[bridge:projects] api base is not an approved ingress origin — no mount',
      { level: 'warn' },
    )
    return { binding: null, reason: 'untrusted_origin' }
  }
  const mountUrl = `${origin}${hearthbotMcpPath(opts.sessionId)}`
  let parsedUrl: URL
  try {
    parsedUrl = new URL(server.url)
  } catch {
    return { binding: null, reason: 'url_mismatch' }
  }
  const expectedPath = hearthbotMcpPath(opts.sessionId)
  if (
    parsedUrl.origin !== origin ||
    parsedUrl.pathname !== expectedPath ||
    parsedUrl.search !== '' ||
    parsedUrl.hash !== '' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== ''
  ) {
    logForDebugging(
      "[bridge:projects] binding url is not this session's hearthbot mount on our own api base — no mount",
      { level: 'warn' },
    )
    return { binding: null, reason: 'url_mismatch' }
  }
  const toolNames = extractInjectedMcpToolNames(
    server,
    HEARTHBOT_MCP_SERVER_NAME,
  )
  if (!toolNames) {
    return { binding: null, reason: 'bad_tools' }
  }
  const autoAllowTools = toolNames.filter(name =>
    HEARTHBOT_AUTO_ALLOW_TOOLS.has(name),
  )
  return {
    binding: {
      channelId,
      threadId,
      mountUrl,
      autoAllowTools,
    },
  }
}

const SESSION_URL_RE = /^(.*)\/v1\/code\/sessions\/([^/?#]+)$/

/**
 * densable `$cs(url)` — split `/v1/code/sessions/{id}` into apiBaseUrl + sessionId.
 */
export function parseCodeSessionUrl(
  url: string | undefined | null,
): { apiBaseUrl: string; sessionId: string } | null {
  if (!url) return null
  const match = SESSION_URL_RE.exec(url)
  if (!match?.[1] || !match[2]) return null
  return { apiBaseUrl: match[1], sessionId: match[2] }
}

/** densable export alias — `$cs as parseBridgeSdkUrl`. */
export const parseBridgeSdkUrl = parseCodeSessionUrl

/** densable export alias — `pur as decodeHearthWorkerBinding`. */
export const decodeHearthWorkerBinding = parseHearthBinding
