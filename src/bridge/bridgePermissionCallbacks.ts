import { logForDebugging } from '../utils/debug.js'
import { permissionRuleValueToString } from '../utils/permissions/permissionRuleParser.js'
import {
  permissionUpdateSchema,
  type PermissionUpdate,
} from '../utils/permissions/PermissionUpdateSchema.js'
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js'

type BridgePermissionResponse = {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionUpdate[]
  /**
   * Official 2.1.326 #325 (`Qva`): set when the incoming bridge response
   * carried `updatedPermissions` that failed schema validation and were dropped.
   */
  updatedPermissionsDropped?: boolean
  message?: string
  /**
   * Official 2.1.326 #325 (`Eut`/`hxe`): optional tool name echoed by the
   * bridge client so we can reject mismatched permission responses.
   */
  toolName?: string
}

type BridgePermissionCallbacks = {
  sendRequest(
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    description: string,
    permissionSuggestions?: PermissionUpdate[],
    blockedPath?: string,
    suppressAlwaysAllowRule?: boolean,
    /**
     * Official 2.1.326 #254: normalized site name (e.g. `example.com`) for
     * Claude in Chrome permission requests so claude.ai names the site.
     */
    chromeSite?: string,
  ): void
  sendResponse(requestId: string, response: BridgePermissionResponse): void
  /** Cancel a pending control_request so the web app can dismiss its prompt. */
  cancelRequest(requestId: string): void
  onResponse(
    requestId: string,
    handler: (response: BridgePermissionResponse) => void,
    /** Optional expected tool name for #325 toolName mismatch validation (`Eut`). */
    expectedToolName?: string,
  ): () => void // returns unsubscribe
  /**
   * Official 2.1.326 #94 (`reportTerminalOnlyAsk`): mark that the session is
   * waiting on a prompt that can only be answered in the terminal so Remote
   * Control reports `requires_action` instead of `running`. Returns a release
   * callback to invoke when the terminal-only prompt closes.
   */
  reportTerminalOnlyAsk?(): () => void
}

/**
 * Official `Zy` / `Tmr` (#1543) — suppress "don't ask again" (`permissionSuggestions`)
 * when a plugin mod (`hookCaller` / `pluginSteered`) invoked the tool or the
 * permission result explicitly requested suppression.
 */
function shouldSuppressAlwaysAllowRule(
  toolUseContext: { hookCaller?: unknown; pluginSteered?: unknown } | undefined,
  explicitSuppress?: boolean,
): boolean {
  return (
    explicitSuppress === true ||
    toolUseContext?.hookCaller !== undefined ||
    toolUseContext?.pluginSteered === true
  )
}

/**
 * Official 2.1.326 #325 (`Eut` / `hxe`): returns true when the bridge response
 * explicitly names a `toolName` that does not match the pending tool's name.
 */
function isBridgePermissionToolNameMismatch(
  responseToolName: string | undefined,
  pendingToolName: string | undefined,
  requestId: string,
): boolean {
  if (typeof responseToolName !== 'string' || !pendingToolName) {
    return false
  }
  if (responseToolName === pendingToolName) {
    return false
  }
  logForDebugging(
    `Ignoring can_use_tool control_response for request_id=${requestId}: toolName '${responseToolName}' does not match pending '${pendingToolName}'`,
    { level: 'warn' },
  )
  return true
}

const PERSISTENT_PERMISSION_DESTINATIONS = new Set([
  'userSettings',
  'projectSettings',
  'localSettings',
])

/**
 * Official 2.1.326 #325 (`_Ze`): filter "always allow" permission updates
 * returned over Remote Control or on self-hosted runners.
 *
 * - If `suppressAllUpdates` or `hasNonClassifierApprovableSafetyCheck` is true,
 *   all permission updates are stripped so safety-checked asks cannot save rules.
 * - If `suppressAlwaysAllowRule` is true, persistent destinations
 *   (`userSettings` / `projectSettings` / `localSettings`) are stripped, and
 *   unoffered grants are dropped.
 * - Enforces strict allowlisting against `opts.allowedSuggestions` (defaulting
 *   to `[]` when no suggestions were offered):
 *   - `addRules` / `replaceRules` with `behavior === 'allow'` only keep rules
 *     offered in `allowedSuggestions` (with matching destination or downgraded
 *     to `'session'`).
 *   - `addDirectories` only keeps directories offered in `allowedSuggestions`
 *     (with matching destination or downgraded to `'session'`).
 *   - Widening `setMode` updates (anything other than `'default'` / `'plan'`)
 *     must also match an offered `setMode` suggestion (with matching destination
 *     or downgraded to `'session'`).
 *   - Restrictive updates (`deny`/`ask` rules, `removeRules`, `removeDirectories`,
 *     empty `replaceRules`) are preserved.
 */
function filterBridgeAlwaysAllowUpdates(
  updates: readonly PermissionUpdate[] | undefined,
  opts: {
    suppressAlwaysAllowRule?: boolean
    suppressAllUpdates?: boolean
    hasNonClassifierApprovableSafetyCheck?: boolean
    allowedSuggestions?: readonly PermissionUpdate[]
  } = {},
): PermissionUpdate[] {
  if (!updates || updates.length === 0) return []
  if (opts.suppressAllUpdates || opts.hasNonClassifierApprovableSafetyCheck) {
    return []
  }
  const offered = opts.allowedSuggestions ?? []
  const countGrants = (list: readonly PermissionUpdate[]): number => {
    let n = 0
    for (const u of list) {
      if (u.type === 'addDirectories') {
        n += u.directories.length
      } else if (
        (u.type === 'addRules' || u.type === 'replaceRules') &&
        u.behavior === 'allow'
      ) {
        n += u.rules.length
      } else if (
        u.type === 'setMode' &&
        u.mode !== 'default' &&
        u.mode !== 'plan'
      ) {
        n += 1
      }
    }
    return n
  }

  const out: PermissionUpdate[] = []
  for (const update of updates) {
    if (
      opts.suppressAlwaysAllowRule &&
      PERSISTENT_PERMISSION_DESTINATIONS.has(update.destination)
    ) {
      continue
    }
    switch (update.type) {
      case 'removeRules':
      case 'removeDirectories': {
        out.push(update)
        break
      }
      case 'setMode': {
        if (
          update.mode === 'default' ||
          update.mode === 'plan' ||
          offered.some(
            s =>
              s.type === 'setMode' &&
              s.mode === update.mode &&
              (s.destination === update.destination ||
                update.destination === 'session'),
          )
        ) {
          out.push(update)
        }
        break
      }
      case 'addDirectories': {
        const allowedDirs = update.directories.filter(dir =>
          offered.some(
            s =>
              s.type === 'addDirectories' &&
              (s.destination === update.destination ||
                update.destination === 'session') &&
              s.directories.includes(dir),
          ),
        )
        if (allowedDirs.length > 0) {
          out.push({ ...update, directories: allowedDirs })
        }
        break
      }
      case 'addRules':
      case 'replaceRules': {
        if (update.behavior !== 'allow') {
          out.push(update)
          break
        }
        if (update.type === 'replaceRules' && update.rules.length === 0) {
          out.push(update)
          break
        }
        const allowedRules = update.rules.filter(rule => {
          const key = permissionRuleValueToString(rule)
          return offered.some(
            s =>
              (s.type === 'addRules' || s.type === 'replaceRules') &&
              s.behavior === 'allow' &&
              (s.destination === update.destination ||
                update.destination === 'session') &&
              s.rules.some(
                offeredRule => permissionRuleValueToString(offeredRule) === key,
              ),
          )
        })
        if (allowedRules.length > 0) {
          out.push({ ...update, rules: allowedRules })
        }
        break
      }
    }
  }

  if (countGrants(out) < countGrants(updates)) {
    logForDebugging(
      'an answer over the network carried allow rules or directories that were left out: only what its card offered is added',
      { level: 'warn' },
    )
  }
  return out
}

/** Type predicate for validating a parsed control_response payload
 *  as a BridgePermissionResponse. Checks the required `behavior`
 *  discriminant rather than using an unsafe `as` cast. */
function isBridgePermissionResponse(
  value: unknown,
): value is BridgePermissionResponse {
  if (!value || typeof value !== 'object') return false
  return (
    'behavior' in value &&
    (value.behavior === 'allow' || value.behavior === 'deny')
  )
}

function validateRawUpdatedPermissions(raw: unknown): {
  updates?: PermissionUpdate[]
  dropped: boolean
} {
  if (raw === undefined) {
    return { updates: undefined, dropped: false }
  }
  if (!Array.isArray(raw)) {
    logForDebugging(
      'Malformed bridge permission updatedPermissions ignored: expected array',
      { level: 'warn' },
    )
    return { updates: undefined, dropped: true }
  }
  const parsed: PermissionUpdate[] = []
  for (const item of raw) {
    const res = permissionUpdateSchema().safeParse(item)
    if (!res.success) {
      logForDebugging(
        `Malformed bridge permission updatedPermissions entry ignored: ${res.error.issues[0]?.message ?? 'unknown'}`,
        { level: 'warn' },
      )
      return { updates: undefined, dropped: true }
    }
    parsed.push(res.data)
  }
  return { updates: parsed, dropped: false }
}

function sanitizeBridgePermissionPayload(
  raw: BridgePermissionResponse,
): BridgePermissionResponse {
  const rawRecord = raw as Record<string, unknown>
  const { updates, dropped } = validateRawUpdatedPermissions(
    rawRecord.updatedPermissions,
  )
  const rawUpdatedInput = rawRecord.updatedInput
  const updatedInput =
    rawUpdatedInput &&
    typeof rawUpdatedInput === 'object' &&
    !Array.isArray(rawUpdatedInput) &&
    Object.keys(rawUpdatedInput as Record<string, unknown>).length > 0
      ? (rawUpdatedInput as Record<string, unknown>)
      : undefined
  const toolName =
    typeof rawRecord.toolName === 'string'
      ? rawRecord.toolName
      : typeof rawRecord.tool_name === 'string'
        ? rawRecord.tool_name
        : undefined
  const message =
    typeof rawRecord.message === 'string' ? rawRecord.message : undefined
  return {
    behavior: raw.behavior,
    ...(updatedInput !== undefined ? { updatedInput } : {}),
    ...(updates !== undefined ? { updatedPermissions: updates } : {}),
    ...(dropped ? { updatedPermissionsDropped: true } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(toolName !== undefined ? { toolName } : {}),
  }
}

function toBridgePermissionMessage(
  controlResponse: Record<string, unknown>,
  parsed: BridgePermissionResponse | undefined,
): string | undefined {
  if (typeof controlResponse.message === 'string' && controlResponse.message) {
    return controlResponse.message
  }
  if (typeof parsed?.message === 'string' && parsed.message) {
    return parsed.message
  }
  if (typeof controlResponse.error === 'string' && controlResponse.error) {
    return controlResponse.error
  }
  return undefined
}

/**
 * Normalize a control_response from the bridge transport into the simplified
 * allow/deny shape used by interactive permission handlers.
 */
function parseBridgePermissionResponse(
  message: SDKControlResponse,
): BridgePermissionResponse | null {
  const controlResponse = message.response
  if (!controlResponse || typeof controlResponse !== 'object') return null

  if (
    controlResponse.subtype === 'success' &&
    'response' in controlResponse &&
    isBridgePermissionResponse(controlResponse.response)
  ) {
    return sanitizeBridgePermissionPayload(controlResponse.response)
  }

  if (controlResponse.subtype !== 'error') {
    return null
  }

  const nested =
    'response' in controlResponse &&
    isBridgePermissionResponse(controlResponse.response)
      ? sanitizeBridgePermissionPayload(controlResponse.response)
      : undefined

  const messageText = toBridgePermissionMessage(controlResponse, nested)

  if (nested) {
    return messageText ? { ...nested, message: messageText } : nested
  }

  if (messageText) {
    return {
      behavior: 'deny',
      message: messageText,
    }
  }

  return null
}

export {
  filterBridgeAlwaysAllowUpdates,
  isBridgePermissionResponse,
  isBridgePermissionToolNameMismatch,
  parseBridgePermissionResponse,
  shouldSuppressAlwaysAllowRule,
}
export type { BridgePermissionCallbacks, BridgePermissionResponse }
