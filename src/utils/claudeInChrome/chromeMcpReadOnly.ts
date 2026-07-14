/**
 * Official 2.1.198/199/207: classify Claude-in-Chrome (and related browser MCP)
 * tools as read-only for plan-mode auto-allow.
 *
 * Mirrors official `heo(cie(tool), input)`:
 * - always-RO tools (find, read_page, …)
 * - input-dependent RO (read_console_messages without clear, tabs_context without createIfEmpty)
 * - computer action when the nested action is a RO subaction and not save_to_disk
 * - browser_batch when every nested {name,input} action is RO
 */

const BROWSER_MCP_PREFIXES = [
  'mcp__claude-in-chrome__',
  'mcp__Claude_in_Chrome__',
  'mcp__Claude_Preview__',
  'mcp__Claude_Browser__',
] as const

/** Always read-only bare tool names (official FDu / $Du). */
const ALWAYS_READONLY_TOOLS = [
  'find',
  'get_page_text',
  'list_connected_browsers',
  'read_page',
  'shortcuts_list',
] as const

/**
 * Official IDu: always-safe bare tools for auto-mode classifier fast path
 * (superset of FDu — includes resize_window / switch_browser / tabs_close_mcp).
 */
const ALWAYS_SAFE_TOOLS = [
  'find',
  'get_page_text',
  'list_connected_browsers',
  'read_page',
  'resize_window',
  'shortcuts_list',
  'switch_browser',
  'tabs_close_mcp',
] as const

/** Official meo-only always-safe bare tools. */
const PREVIEW_ALWAYS_SAFE_TOOLS = [
  'tabs_close',
  'tabs_create',
  'tabs_select',
] as const

/**
 * Computer subactions that are read-only when not save_to_disk
 * (official BDu, intersected with safe LDu via iQi).
 */
const COMPUTER_READONLY_SUBACTIONS = new Set([
  'screenshot',
  'wait',
  'get_page_text',
  'find',
  'cursor_position',
])

/**
 * Official LDu: broader computer subactions safe for auto-mode allowlist
 * (still require !save_to_disk via iQi).
 */
const COMPUTER_SAFE_SUBACTIONS = new Set([
  'screenshot',
  'zoom',
  'wait',
  'get_page_text',
  'find',
  'scroll',
  'scroll_to',
  'hover',
  'mouse_move',
  'cursor_position',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'left_click_drag',
])

type InputPredicate = (input: unknown) => boolean

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Official GHu: read_console_messages / read_network_requests are RO unless clear. */
function isClearFree(input: unknown): boolean {
  return !isRecord(input) || !input.clear
}

/** Official HXi: tabs_context(_mcp) is RO unless createIfEmpty. */
function isNotCreateIfEmpty(input: unknown): boolean {
  return !isRecord(input) || !input.createIfEmpty
}

/** Official UDu + iQi: computer RO subaction and not save_to_disk. */
function isReadonlyComputerAction(input: unknown): boolean {
  if (!isRecord(input)) return false
  const action = String(input.action ?? '')
  if (!COMPUTER_READONLY_SUBACTIONS.has(action)) return false
  return !input.save_to_disk
}

/** Official UDu (safe): computer safe subaction and not save_to_disk. */
function isSafeComputerAction(input: unknown): boolean {
  if (!isRecord(input)) return false
  const action = String(input.action ?? '')
  if (!COMPUTER_SAFE_SUBACTIONS.has(action)) return false
  return !input.save_to_disk
}

const INPUT_DEPENDENT_READONLY: ReadonlyMap<string, InputPredicate> = new Map([
  ['read_console_messages', isClearFree],
  ['read_network_requests', isClearFree],
  ['tabs_context_mcp', isNotCreateIfEmpty],
  // Preview/Browser servers use bare tabs_context
  ['tabs_context', isNotCreateIfEmpty],
])

function withPrefixes(toolName: string): string[] {
  return BROWSER_MCP_PREFIXES.map(prefix => `${prefix}${toolName}`)
}

const ALWAYS_READONLY_FQ = new Set(
  ALWAYS_READONLY_TOOLS.flatMap(name => withPrefixes(name)),
)

/** Official HDu always-safe FQ names. */
const ALWAYS_SAFE_FQ = new Set([
  ...ALWAYS_SAFE_TOOLS.flatMap(name => withPrefixes(name)),
  ...PREVIEW_ALWAYS_SAFE_TOOLS.flatMap(name =>
    (['mcp__Claude_Preview__', 'mcp__Claude_Browser__'] as const).map(
      prefix => `${prefix}${name}`,
    ),
  ),
])

const COMPUTER_FQ = new Set(withPrefixes('computer'))
const BROWSER_BATCH_FQ = new Set(withPrefixes('browser_batch'))

const INPUT_DEPENDENT_FQ = new Map<string, InputPredicate>()
for (const [name, pred] of INPUT_DEPENDENT_READONLY) {
  if (name === 'tabs_context') {
    // Preview/Browser only (meo prefixes), not claude-in-chrome
    for (const prefix of [
      'mcp__Claude_Preview__',
      'mcp__Claude_Browser__',
    ] as const) {
      INPUT_DEPENDENT_FQ.set(`${prefix}${name}`, pred)
    }
    continue
  }
  for (const fq of withPrefixes(name)) {
    INPUT_DEPENDENT_FQ.set(fq, pred)
  }
}

const ALWAYS_READONLY_BARE = new Set<string>(ALWAYS_READONLY_TOOLS)
const ALWAYS_SAFE_BARE = new Set<string>(ALWAYS_SAFE_TOOLS)

const NESTED_INPUT_PREDICATES: ReadonlyMap<string, InputPredicate> = new Map([
  ['computer', isReadonlyComputerAction],
  ...INPUT_DEPENDENT_READONLY,
])

const NESTED_SAFE_PREDICATES: ReadonlyMap<string, InputPredicate> = new Map([
  ['computer', isSafeComputerAction],
  ...INPUT_DEPENDENT_READONLY,
])

/**
 * Nested browser_batch action: { name, input } using bare tool names.
 * Official aDg → MDu(action, sDg, iDg).
 */
function isReadonlyNestedBrowserAction(action: unknown): boolean {
  if (!isRecord(action)) return false
  const name = action.name
  if (typeof name !== 'string') return false
  const pred = NESTED_INPUT_PREDICATES.get(name)
  if (pred) return pred(action.input)
  return ALWAYS_READONLY_BARE.has(name)
}

/** Nested browser_batch action for auto-mode safe path (oDg). */
function isSafeNestedBrowserAction(action: unknown): boolean {
  if (!isRecord(action)) return false
  const name = action.name
  if (typeof name !== 'string') return false
  const pred = NESTED_SAFE_PREDICATES.get(name)
  if (pred) return pred(action.input)
  return ALWAYS_SAFE_BARE.has(name)
}

/**
 * Whether a fully-qualified MCP tool name + input is read-only for plan mode
 * (official `heo`).
 */
export function isChromeMcpReadOnlyTool(
  fullyQualifiedName: string,
  input: unknown,
): boolean {
  if (ALWAYS_READONLY_FQ.has(fullyQualifiedName)) {
    return true
  }

  const inputPred = INPUT_DEPENDENT_FQ.get(fullyQualifiedName)
  if (inputPred) {
    return inputPred(input)
  }

  if (COMPUTER_FQ.has(fullyQualifiedName)) {
    return isReadonlyComputerAction(input)
  }

  if (BROWSER_BATCH_FQ.has(fullyQualifiedName)) {
    if (!isRecord(input)) return false
    const actions = input.actions
    if (!Array.isArray(actions) || actions.length === 0) return false
    return actions.every(isReadonlyNestedBrowserAction)
  }

  return false
}

/**
 * Official `NDu`: whether chrome/browser MCP tool+input is safe to auto-allow
 * without running the transcript classifier (broader than plan-mode RO).
 */
export function isChromeMcpSafeForAutoMode(
  fullyQualifiedName: string,
  input: unknown,
): boolean {
  if (ALWAYS_SAFE_FQ.has(fullyQualifiedName)) {
    return true
  }

  const inputPred = INPUT_DEPENDENT_FQ.get(fullyQualifiedName)
  if (inputPred) {
    return inputPred(input)
  }

  if (COMPUTER_FQ.has(fullyQualifiedName)) {
    return isSafeComputerAction(input)
  }

  if (BROWSER_BATCH_FQ.has(fullyQualifiedName)) {
    if (!isRecord(input)) return false
    const actions = input.actions
    if (!Array.isArray(actions) || actions.length === 0) return false
    return actions.every(isSafeNestedBrowserAction)
  }

  return false
}

/** Test/export surface for pure unit tests. */
export const chromeMcpReadOnlyInternals = {
  ALWAYS_READONLY_TOOLS,
  ALWAYS_SAFE_TOOLS,
  COMPUTER_READONLY_SUBACTIONS,
  COMPUTER_SAFE_SUBACTIONS,
  BROWSER_MCP_PREFIXES,
  isReadonlyNestedBrowserAction,
  isSafeNestedBrowserAction,
  isReadonlyComputerAction,
  isSafeComputerAction,
  isClearFree,
  isNotCreateIfEmpty,
}
