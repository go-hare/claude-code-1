/**
 * densable 2.1.246 #50 — MCP `_meta["anthropic/requiresUserInteraction"]`.
 *
 * Official factory `W`: when true, the permission card is the interaction
 * surface. Do not offer "Yes, and don't ask again" (that wrote an allow
 * rule the tool then ignored).
 */
import type { PermissionResult } from '../../types/permissions.js'
import { isPreviewBrowserServer } from '../../utils/permissions/mcpPermissionMode.js'

export const MCP_REQUIRES_USER_INTERACTION_META =
  'anthropic/requiresUserInteraction' as const

const MCP_PERMISSION_MESSAGE = 'MCPTool requires permission.'
const PREVIEW_BROWSER_PERMISSION_MESSAGE = (server: string): string =>
  `${server} requires permission.`

/** densable `W = A._meta?.["anthropic/requiresUserInteraction"]===!0` */
export function isMcpRequiresUserInteraction(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    (meta as Record<string, unknown>)[MCP_REQUIRES_USER_INTERACTION_META] ===
      true
  )
}

/**
 * densable MCP `checkPermissions` interaction branch.
 * `W` → ask + empty suggestions + `suppressAlwaysAllowRule`.
 * Gold `s8t` Preview/Browser: ask + `chrome.hostHandlesOriginConsent`.
 * else passthrough + whole-tool allow suggestion (official `U2t` omit not ported).
 */
export function mcpToolCheckPermissionsResult(
  requiresUserInteraction: boolean,
  fullyQualifiedName: string,
  serverName?: string,
): PermissionResult {
  if (isPreviewBrowserServer(serverName)) {
    return {
      behavior: 'ask',
      message: PREVIEW_BROWSER_PERMISSION_MESSAGE(serverName),
      suggestions: [
        {
          type: 'addRules',
          rules: [
            {
              toolName: fullyQualifiedName,
              ruleContent: undefined,
            },
          ],
          behavior: 'allow',
          destination: 'session',
        },
      ],
      metadata: {
        command: {
          name: fullyQualifiedName,
          chrome: { hostHandlesOriginConsent: true },
        },
      },
    }
  }
  if (requiresUserInteraction) {
    return {
      behavior: 'ask',
      message: MCP_PERMISSION_MESSAGE,
      suggestions: [],
      suppressAlwaysAllowRule: true,
    }
  }
  return {
    behavior: 'passthrough',
    message: MCP_PERMISSION_MESSAGE,
    suggestions: [
      {
        type: 'addRules',
        rules: [
          {
            toolName: fullyQualifiedName,
            ruleContent: undefined,
          },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  }
}
