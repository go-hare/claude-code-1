/**
 * Official 2.1.x `snt(tool, permissionContext)`:
 * effective permission mode for an MCP tool, considering per-server overrides
 * and Chrome/Preview classifier floors.
 */

import type { PermissionMode } from '../../types/permissions.js'
import { getIsInteractive } from '../../bootstrap/state.js'

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
 * densable XH elevated @176056210:
 * `bypassPermissions || auto || t2(mode, isBypassPermissionsModeAvailable)`
 * gold t2 @176056748: `plan && n===true && !Ae()` (Ae = !isInteractive).
 * Do not substitute prePlanMode inherit.
 */
function isElevatedMode(ctx: McpPermissionModeContext): boolean {
  if (ctx.mode === 'auto' || ctx.mode === 'bypassPermissions') return true
  return (
    ctx.mode === 'plan' &&
    ctx.isBypassPermissionsModeAvailable === true &&
    getIsInteractive()
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

  // gold XH @176056210: i && (Dc(preview) || Mc(chrome) && chromeClassifierFloorEnabled).
  // Preview (c8e/Dc) floors whenever elevated — gold has 0 previewClassifierFloorEnabled.
  // Chrome (Zs/Mc) still needs chromeClassifierFloorEnabled. Do not invent remote-devices tr().
  if (elevated && serverName !== undefined) {
    const preview = PREVIEW_BROWSER_SERVERS.has(serverName)
    const chrome = CHROME_CLASSIFIER_FLOOR_SERVERS.has(serverName)
    if (preview || (chrome && ctx.chromeClassifierFloorEnabled === true)) {
      return ctx.canAutoClassifierRun === true ? 'auto' : 'default'
    }
  }

  return ctx.mode
}

/**
 * densable xHo @185571872:
 *   chrome-family Ug prefix && (preview JNe || chromeClassifierFloorEnabled)
 *   && canAutoClassifierRun
 * Wraps the existing PREVIEW/CHROME server-name hosts used by XH's floor.
 * Gold NHo Fe also ORs chrome-metadata (`domainAllowed` /
 * `hostHandlesOriginConsent`) produced by Preview/Browser `s8t`.
 */
export function isChromeFamilyClassifierEligible(
  tool: { mcpInfo?: { serverName?: string } } | null | undefined,
  ctx: Pick<
    McpPermissionModeContext,
    'chromeClassifierFloorEnabled' | 'canAutoClassifierRun'
  >,
): boolean {
  const serverName = tool?.mcpInfo?.serverName
  if (serverName === undefined) return false
  const preview = PREVIEW_BROWSER_SERVERS.has(serverName)
  const chrome = CHROME_CLASSIFIER_FLOOR_SERVERS.has(serverName)
  if (!chrome) return false
  return (
    (preview || ctx.chromeClassifierFloorEnabled === true) &&
    ctx.canAutoClassifierRun === true
  )
}

/** densable JNe / `pHe` — Claude Preview / Claude Browser display names. */
export function isPreviewBrowserServer(
  serverName: string | undefined,
): serverName is string {
  return serverName !== undefined && PREVIEW_BROWSER_SERVERS.has(serverName)
}

/**
 * densable NHo Fe chrome-metadata arm @185578944:
 * `Ne?.domainAllowed===true || Ne?.hostHandlesOriginConsent===true`.
 * `PermissionCommandMetadata` is an index signature; read chrome via unknown.
 */
export function chromeCommandBypassesDontAsk(result: {
  metadata?: { command?: { name?: string; [key: string]: unknown } }
}): boolean {
  const command = result.metadata?.command
  if (command === null || typeof command !== 'object') return false
  const chrome = command.chrome
  if (chrome === null || typeof chrome !== 'object') return false
  const rec = chrome as {
    domainAllowed?: unknown
    hostHandlesOriginConsent?: unknown
  }
  return rec.domainAllowed === true || rec.hostHandlesOriginConsent === true
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
  isChromeFamilyClassifierEligible,
  isPreviewBrowserServer,
  chromeCommandBypassesDontAsk,
}
