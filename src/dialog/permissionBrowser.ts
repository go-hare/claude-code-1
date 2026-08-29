/**
 * densable Cno / Hnu / vum / wXn / Nmy / Lmy / Omy / Wce helpers.
 *
 * Gold 2.1.239: Fwl `LUt()&&startsWith(lwe)` → Cno; jsu `vM(Cno,Hnu)`.
 * Do not invent BLS/ULS (browser_batch → "use the browser"), ConsentRow mint,
 * or Xil. requestSource is gold iK/xSl (G2e), not a local banner.
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME } from '../utils/claudeInChrome/common.js'
import { shouldShowAlwaysAllowOptions } from '../utils/permissions/permissionsLoader.js'
import type { PermissionUpdate } from '../types/permissions.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

/** densable rvt */
export const CLAUDE_IN_CHROME_DOMAIN = 'ClaudeInChromeDomain'

/** densable lwe */
export const CHROME_MCP_PREFIX = `mcp__${normalizeNameForMCP(CLAUDE_IN_CHROME_MCP_SERVER_NAME)}__`

/** densable jPi (yO withheld marker) */
export const APPROVAL_WITHHELD_MARKER =
  '(value cannot be shown in full — approval withheld; one-time options only)'

/** densable wP — yO string budget for the URL preview */
export const URL_PREVIEW_MAX_UNITS = 200_000

/**
 * densable Xgt — yO withhold regex. Gold `a0` inits
 * `i4S=/\p{Default_Ignorable_Code_Point}/u` and `s4S=/\p{Cf}/u`;
 * `if(Xgt.test(i)) return withheld`. Combined class is the union (no /g).
 * Do not invent oge / Xil / WPi; string-arm Ug dump is truncated — do not
 * invent a stripper (stripping would make Xgt never fire).
 */
const PREVIEW_WITHHOLD_CHARS = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u

/** densable $LS */
export const BROWSER_TOOL_VERBS: Record<string, string> = {
  navigate: 'navigate',
  read_page: 'read the page',
  get_page_text: 'extract page text',
  find: 'find an element',
  form_input: 'fill in a form field',
  javascript_tool: 'run JavaScript',
  read_console_messages: 'read console messages',
  read_network_requests: 'read network requests',
  upload_image: 'upload an image',
  file_upload: 'upload a file',
  select_browser: 'select a browser',
  gif_creator: 'record a GIF of the page',
  shortcuts_execute: 'run a saved browser shortcut',
  tabs_create_mcp: 'open a new browser tab',
}

/** densable LPf */
export const COMPUTER_ACTION_VERBS: Record<string, string> = {
  screenshot: 'take a screenshot',
  left_click: 'click',
  right_click: 'right-click',
  middle_click: 'middle-click',
  double_click: 'double-click',
  triple_click: 'triple-click',
  type: 'type text',
  key: 'press keys',
  hold_key: 'hold a key',
  scroll: 'scroll',
  scroll_to: 'scroll to an element',
  left_click_drag: 'drag',
  zoom: 'zoom in',
  hover: 'hover',
  mouse_move: 'move the mouse',
  left_mouse_down: 'press the mouse button',
  left_mouse_up: 'release the mouse button',
  cursor_position: 'read the cursor position',
  wait: 'wait',
}

export type ChromeHostTarget = {
  host: string
  url?: string
}

export type BrowserPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  verbPhrase: string
  input?: unknown
  chrome?: ChromeHostTarget
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  /** densable iK requestSource — Hnu → Cm → G2e */
  requestSource?: PermissionRequestSource
}

export type ChromeDomainAllowRow = {
  display: string
  applies: PermissionUpdate[]
}

export type UrlPreview =
  | { kind: 'full'; text: string; needsGutter: boolean }
  | { kind: 'withheld'; marker: string }

export type BrowserPermissionChoice = 'allow' | 'allow-domain' | 'deny'

/** densable LUt — GB default false; do not LOCAL_GATE_DEFAULTS=true. */
export function isClaudeInChromeInProductPermissions(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_cfc_in_product_permissions',
    false,
  )
}

export function isClaudeInChromeToolName(name: string): boolean {
  return name.startsWith(CHROME_MCP_PREFIX)
}

/** densable wXn — browser_batch has no BLS/ULS here; gold fallback. */
export function formatBrowserVerbPhrase(
  toolName: string,
  input: unknown,
): string {
  const name = toolName.startsWith(CHROME_MCP_PREFIX)
    ? toolName.slice(CHROME_MCP_PREFIX.length)
    : toolName
  const parsed =
    input !== null && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {}
  if (name === 'computer') {
    const action = typeof parsed.action === 'string' ? parsed.action : undefined
    if (action && COMPUTER_ACTION_VERBS[action]) {
      return COMPUTER_ACTION_VERBS[action]
    }
    return 'use the browser'
  }
  if (name === 'browser_batch') {
    return 'use the browser'
  }
  if (name === 'tabs_context_mcp') {
    return parsed.createIfEmpty
      ? 'create a browser window and read your tabs'
      : 'read your browser tabs'
  }
  return BROWSER_TOOL_VERBS[name] ?? 'use the browser'
}

/** densable Wce — empty / non-string → null. No oge/Xil invent. */
export function sanitizeHostDisplay(host: unknown): { display: string } | null {
  if (typeof host !== 'string') return null
  const trimmed = host.trim()
  if (trimmed === '') return null
  return { display: trimmed }
}

/**
 * densable yO string arm used by Hnu (`yO(jDe.url,{maxUnits:wP})`).
 * Non-strings are not previewed (Hnu only passes chrome.url).
 */
export function previewUrlString(url: unknown): UrlPreview | null {
  if (typeof url !== 'string') return null
  if (url.length > URL_PREVIEW_MAX_UNITS) {
    return { kind: 'withheld', marker: APPROVAL_WITHHELD_MARKER }
  }
  // gold yO string arm: o = Ug(n).replace(/\t/g," "); if (Xgt.test(o)) withheld
  const text = url.replace(/\t/g, ' ')
  if (PREVIEW_WITHHOLD_CHARS.test(text)) {
    return { kind: 'withheld', marker: APPROVAL_WITHHELD_MARKER }
  }
  return {
    kind: 'full',
    text,
    needsGutter: text.includes('\n'),
  }
}

/** densable vum chrome extraction */
export function extractChromeHostTarget(
  permissionResult: unknown,
  input: unknown,
): ChromeHostTarget | undefined {
  const meta = permissionResult as {
    metadata?: { command?: { chrome?: unknown } }
  }
  const fromMeta = meta?.metadata?.command?.chrome
  if (isChromeHostTarget(fromMeta)) return fromMeta
  const url =
    input !== null && typeof input === 'object'
      ? (input as { url?: unknown }).url
      : undefined
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      if (parsed.host) return { host: parsed.host, url: parsed.href }
    } catch {
      /* densable swallows */
    }
  }
  return undefined
}

function isChromeHostTarget(value: unknown): value is ChromeHostTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { host?: unknown }).host === 'string'
  )
}

type AlwaysAllowInput = {
  permissionResult: unknown
  tool?: { suppressesAlwaysAllowRule?: (input: never) => boolean }
  input?: unknown
  requestSource?: PermissionRequestSource
}

/** densable iK showAlwaysAllow — exclude remote-agent. */
export function computeShowAlwaysAllow(input: AlwaysAllowInput): boolean {
  if (!shouldShowAlwaysAllowOptions()) return false
  const result = input.permissionResult as {
    behavior?: string
    suppressAlwaysAllowRule?: boolean
  }
  if (result?.behavior === 'ask' && result.suppressAlwaysAllowRule === true) {
    return false
  }
  if (input.tool?.suppressesAlwaysAllowRule?.(input.input as never) === true) {
    return false
  }
  if (input.requestSource?.type === 'remote-agent') {
    return false
  }
  return true
}

export function computeIsAskCappedByOrg(tool: {
  mcpInfo?: { effectiveMaxPermission?: string }
}): boolean {
  return tool.mcpInfo?.effectiveMaxPermission === 'ask'
}

/** densable Nmy */
export function shouldShowChromeDomainAllow(
  payload: BrowserPermissionPayload,
): boolean {
  const result = payload.permissionResult as {
    behavior?: string
    decisionReason?: { type?: string; classifierApprovable?: boolean }
  }
  const reason = result?.behavior === 'ask' ? result.decisionReason : undefined
  if (reason?.type === 'safetyCheck' && !reason.classifierApprovable) {
    return false
  }
  return (
    payload.showAlwaysAllow === true &&
    payload.isAskCappedByOrg !== true &&
    !!payload.chrome &&
    !payload.chrome.host.includes('*')
  )
}

/** densable Lmy — {display, applies} stand-in for ConsentRow (no mint token). */
export function buildChromeDomainAllowRow(
  chrome: ChromeHostTarget | undefined,
): ChromeDomainAllowRow | null {
  if (!chrome) return null
  const sanitized = sanitizeHostDisplay(chrome.host)
  if (sanitized === null) return null
  return {
    display: sanitized.display,
    applies: [
      {
        type: 'addRules',
        rules: [
          {
            toolName: CLAUDE_IN_CHROME_DOMAIN,
            ruleContent: chrome.host,
          },
        ],
        behavior: 'allow',
        destination: 'session',
      },
    ],
  }
}

function isValidAllowRow(row: ChromeDomainAllowRow | null): boolean {
  return row !== null && Array.isArray(row.applies) && row.applies.length > 0
}

/** densable Omy */
export function resolveBrowserPermissionAnswer(
  choice: BrowserPermissionChoice,
  payload: BrowserPermissionPayload,
  row: ChromeDomainAllowRow | null,
): PermissionPromptResult {
  switch (choice) {
    case 'allow':
      return { behavior: 'allow', updatedInput: payload.input }
    case 'allow-domain':
      if (!isValidAllowRow(row)) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: row!.applies,
      }
    case 'deny':
      return { behavior: 'deny' }
  }
}
