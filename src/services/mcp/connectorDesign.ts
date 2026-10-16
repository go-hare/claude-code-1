/**
 * densable 2.1.289 connector Design MCP (Vr/Fi, Gr/Ui, yo/br).
 *
 * Two gold bundles share one local factory (`fetchToolsForClient`). The
 * flag is `jo`: sse or http, `https://api.anthropic.com/v1/design/…`, and
 * no Authorization header. `my` allows only that host.
 */
import type { PermissionResult } from '../../types/permissions.js'

const DESIGN_PATH_PREFIX = '/v1/design/'
const FIRST_PARTY_DESIGN_HOST = 'api.anthropic.com'

/** Gold Ho — tokenless writes the connector must deny. */
const TOKENLESS_CONNECTOR_WRITE_OPS = new Set([
  'write_files',
  'create_support_js',
  'copy_files',
])

/**
 * Gold Kr — Ho plus finalize_plan, delete_files, and xke
 * (update_sharing, add_member, update_member_role). Suppresses a
 * persistent allow rule. Not the tokenless-deny set.
 */
const PERSISTENT_ALLOW_SUPPRESSED_OPS = new Set([
  'write_files',
  'create_support_js',
  'copy_files',
  'finalize_plan',
  'delete_files',
  'update_sharing',
  'add_member',
  'update_member_role',
])

const TOKENLESS_DENY_REASON =
  'tokenless design writes are native-tool-only — this connector surface has no reserved-path or grant-approval flow'

function hasAuthorizationHeader(
  headers: Record<string, string> | undefined,
): boolean {
  if (!headers) return false
  return Object.keys(headers).some(key => key.toLowerCase() === 'authorization')
}

/** Gold Vx && jo's URL half: https + my(href) + pathname /v1/design/. */
function isFirstPartyDesignMcpUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.host !== FIRST_PARTY_DESIGN_HOST) return false
    return parsed.pathname.startsWith(DESIGN_PATH_PREFIX)
  } catch {
    return false
  }
}

/**
 * Gold `jo` / `isFirstPartyDesignServer`. First boolean of Vr, Fi, Gr, and Ui.
 */
export function isFirstPartyDesignMcpServer(config: {
  type?: string
  url?: string
  headers?: Record<string, string>
}): boolean {
  if (config.type !== 'sse' && config.type !== 'http') return false
  if (hasAuthorizationHeader(config.headers)) return false
  return isFirstPartyDesignMcpUrl(config.url)
}

function planToken(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return undefined
  if (!('plan_token' in input)) return undefined
  return input.plan_token
}

/** Gold Gr/Ui. Null means the connector check does not decide. */
export function connectorDesignTokenlessWriteDeny(
  isFirstPartyDesignServer: boolean,
  operation: string,
  input: unknown,
): PermissionResult | null {
  if (
    !isFirstPartyDesignServer ||
    !TOKENLESS_CONNECTOR_WRITE_OPS.has(operation)
  ) {
    return null
  }
  const token = planToken(input)
  if (typeof token === 'string' && token.length > 0) return null
  return {
    behavior: 'deny',
    message: `${operation}: writing without a plan_token is available only through the native Claude Design tool — call finalize_plan with writes (and deletes if needed), then pass the returned plan_token.`,
    decisionReason: {
      type: 'safetyCheck',
      reason: TOKENLESS_DENY_REASON,
      classifierApprovable: false,
    },
  }
}

/** Gold yo/br. */
export function connectorDesignOmitsPersistentAllow(
  isFirstPartyDesignServer: boolean,
  operation: string,
): boolean {
  return (
    isFirstPartyDesignServer && PERSISTENT_ALLOW_SUPPRESSED_OPS.has(operation)
  )
}

/** Top-level MCP `project_id`, matching Vr/Fi `s.project_id`. */
function connectorDesignProjectId(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return undefined
  if (!('project_id' in args)) return undefined
  return args.project_id
}

/**
 * Gold `if (b) Vr(state, b, name, args)`. `note` is
 * `noteDesignProjectMembershipChange` so this module does not import it.
 */
export function applyConnectorDesignMembership(
  isFirstPartyDesignServer: boolean,
  operation: string,
  args: unknown,
  note: (operation: string, projectId: unknown) => void,
): void {
  if (!isFirstPartyDesignServer) return
  note(operation, connectorDesignProjectId(args))
}
