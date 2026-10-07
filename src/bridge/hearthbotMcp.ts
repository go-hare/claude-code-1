/**
 * densable 2.1.289 hearthbot / meta MCP factories — gold `kc` / `pp` / `uJo` /
 * `Cet` / `F7r` / `pJo` / meta path + Server-ID.
 *
 * Do **not** export minify `kc` / `pp` / `uJo` / `Cet` / `F7r`.
 */

/** densable `kc` */
export const HEARTHBOT_MCP_SERVER_NAME = 'hearthbot'

/** densable `pp` */
export const CLAUDE_CODE_REMOTE_MCP_SERVER_NAME = 'claude-code-remote'

/** densable `dJo` — display title for meta mount. */
export const CLAUDE_CODE_REMOTE_MCP_DISPLAY_NAME = 'Claude Code Remote'

/** densable `iqt` — fixed meta `X-MCP-Server-ID`. */
export const CLAUDE_CODE_REMOTE_MCP_SERVER_ID =
  'bf7c680d-5fdc-5ef4-b4a0-abadb619bf0a'

/** densable meta path constant `p`. */
export const CLAUDE_CODE_REMOTE_META_MCP_PATH = '/v2/ccr-sessions/-/meta/mcp'

/** densable `N7r` — channel_id / thread_id. */
export const HEARTH_BINDING_ID_RE = /^[A-Za-z0-9_-]{1,160}$/

/** densable hearthbot pathname `G`. */
export const HEARTHBOT_MCP_PATH_RE =
  /^\/v2\/ccr-sessions\/(?:-|[A-Za-z0-9_-]+)\/hearthbot\/mcp$/

/** densable `q` — legacy hearthbot path accepted by `Jkn`. */
export const HEARTHBOT_LEGACY_MCP_PATH = '/v1/code/mcp/hearthbot'

/**
 * densable `pJo` — tools eligible for session always-allow on reply mount.
 */
export const HEARTHBOT_AUTO_ALLOW_TOOLS = new Set([
  'reply',
  'update_status',
  'no_reply_needed',
  'switch_model',
  'fetch_thread',
  'fetch_project_timeline',
  'fetch_messages',
  'search_channels',
  'set_thread_label',
  'set_thread_resolved',
  'list_thread_sessions',
  'list_thread_connectors',
  'list_project_members',
  'list_project_artifacts',
  'list_project_prs',
  'list_project_files',
  'read_project_file',
  'react',
  'unreact',
  'update_message',
  'get_channel_session_id',
  'get_project_session_id',
  'read_memory',
  'update_memory',
  'report_issue',
  'set_time_zone',
  'pin_artifact',
  'unpin_artifact',
  'suggest_connectors',
  'post_widget',
  'cookie_sign_in_request',
])

/** densable `F7r(sessionId)`. */
export function hearthbotMcpPath(sessionId: string): string {
  return `/v2/ccr-sessions/${sessionId}/hearthbot/mcp`
}

export type HearthbotHttpConfig = {
  type: 'http'
  url: string
  headers: Record<string, string>
  alwaysLoad: true
}

/**
 * densable `uJo(url, sessionId)` — hearthbot reply HTTP config (no Server-ID).
 */
export function createHearthbotHttpConfig(
  url: string,
  sessionId: string,
): HearthbotHttpConfig {
  return {
    type: 'http',
    url,
    headers: {
      'X-Session-UUID': sessionId,
      'anthropic-version': '2023-06-01',
    },
    alwaysLoad: true,
  }
}

/**
 * densable `Cet(url, sessionId)` — meta / carrier HTTP config with Server-ID.
 */
export function createRemoteMetaHttpConfig(
  url: string,
  sessionId: string,
): HearthbotHttpConfig {
  return {
    type: 'http',
    url,
    headers: {
      'X-MCP-Server-ID': CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
      'X-Session-UUID': sessionId,
      'anthropic-version': '2023-06-01',
    },
    alwaysLoad: true,
  }
}

/** densable `Sme` — `mcp__hearthbot__reply` FQN leaf helper. */
export function hearthbotReplyToolName(): string {
  return `mcp__${HEARTHBOT_MCP_SERVER_NAME}__reply`
}
