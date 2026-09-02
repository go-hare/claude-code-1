/**
 * Official 2.1.x `snt(tool, permissionContext)`:
 * effective permission mode for an MCP tool, considering per-server overrides
 * and Chrome/Preview classifier floors.
 */

import type { PermissionMode } from '../../types/permissions.js'
import { isSessionBypassClass } from './planBypass.js'

/** Official jDu: preview/browser server display names. */
const PREVIEW_BROWSER_SERVERS = new Set(['Claude Preview', 'Claude Browser'])

/** Official dDg: all chrome-related server names that support classifier floor. */
const CHROME_CLASSIFIER_FLOOR_SERVERS = new Set([
  'claude-in-chrome',
  'Claude in Chrome',
  ...PREVIEW_BROWSER_SERVERS,
])

export type McpPermissionModeContext = {
  mode: PermissionMode
  isBypassPermissionsModeAvailable?: boolean
  /** Plan inherited from bypass — densable plan+bypass, not merely listable. */
  prePlanMode?: PermissionMode
  /** Per MCP serverName → forced mode when session is elevated. */
  mcpPermissionModeOverrides?: Readonly<
    Record<string, PermissionMode | undefined>
  >
  /** When true, claude-in-chrome tools use classifier-floor demotion. */
  chromeClassifierFloorEnabled?: boolean
  /** When true, Claude Preview/Browser tools use classifier-floor demotion. */
  previewClassifierFloorEnabled?: boolean
  /** When true, classifier floor demotes to auto; else to default. */
  canAutoClassifierRun?: boolean
}

/**
 * Whether the session mode is "elevated" enough for MCP overrides / floors
 * (bypassPermissions, auto, or plan with bypass available).
 */
function isElevatedMode(ctx: McpPermissionModeContext): boolean {
  return (
    ctx.mode === 'auto' ||
    isSessionBypassClass({ mode: ctx.mode, prePlanMode: ctx.prePlanMode })
  )
}

/**
 * Official `snt`: resolve the effective permission mode for a tool that may
 * be an MCP tool. Non-MCP tools (no serverName) return context.mode.
 */
export function getEffectivePermissionMode(
  tool: { mcpInfo?: { serverName?: string } } | null | undefined,
  ctx: McpPermissionModeContext,
): PermissionMode {
  const serverName = tool?.mcpInfo?.serverName
  const override =
    serverName !== undefined
      ? ctx.mcpPermissionModeOverrides?.[serverName]
      : undefined
  const elevated = isElevatedMode(ctx)

  if (override !== undefined && elevated) {
    return override
  }

  if (
    elevated &&
    serverName !== undefined &&
    CHROME_CLASSIFIER_FLOOR_SERVERS.has(serverName) &&
    (PREVIEW_BROWSER_SERVERS.has(serverName)
      ? ctx.previewClassifierFloorEnabled === true
      : ctx.chromeClassifierFloorEnabled === true)
  ) {
    return ctx.canAutoClassifierRun === true ? 'auto' : 'default'
  }

  return ctx.mode
}

/** Parse override string from config (official WDu). */
export function parseMcpPermissionModeOverride(
  value: string | null | undefined,
):
  | { ok: true; override: PermissionMode | undefined }
  | { ok: false; rejected: string } {
  if (value === null || value === undefined) {
    return { ok: true, override: undefined }
  }
  if (value === 'default' || value === 'auto') {
    return { ok: true, override: value }
  }
  return { ok: false, rejected: value }
}

export const mcpPermissionModeInternals = {
  PREVIEW_BROWSER_SERVERS,
  CHROME_CLASSIFIER_FLOOR_SERVERS,
  isElevatedMode,
}
