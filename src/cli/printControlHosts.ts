/**
 * densable 2.1.289 print control hosts — unique English + validation.
 * Gold print @206543667 rewind / @206564468 mcp_call / @206539981 dialogs /
 * @206584617 hooks listing / @206584803 update_settings / @206564194 reload_skills.
 */
import { mcpInfoFromString } from 'src/services/mcp/mcpStringUtils.js'
import { EFFORT_LEVELS } from 'src/utils/effort.js'
import { isSettingSourceEnabled } from 'src/utils/settings/constants.js'
import type { SettingSource } from 'src/utils/settings/constants.js'

export const UPDATE_SETTINGS_ALLOWED_KEYS = {
  localSettings: new Set(['outputStyle']),
  userSettings: new Set(['effortLevel']),
} as const

export type UpdateSettingsSource = keyof typeof UPDATE_SETTINGS_ALLOWED_KEYS

export function isUpdateSettingsSource(
  value: unknown,
): value is UpdateSettingsSource {
  return value === 'localSettings' || value === 'userSettings'
}

export function updateSettingsEffortError(): string {
  return `update_settings: effortLevel must be one of ${EFFORT_LEVELS.join(', ')}`
}

/**
 * densable `JA` @206418137.
 */
export function validateUpdateSettingsRequest(
  isRemoteTransport: boolean,
  sourceEnabled: boolean,
  source: unknown,
  settings: unknown,
): string | null {
  if (isRemoteTransport) {
    return 'update_settings is not available over a remote transport'
  }
  if (
    typeof settings !== 'object' ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return `update_settings requires \`settings\` to be an object, got ${
      settings === null
        ? 'null'
        : Array.isArray(settings)
          ? 'an array'
          : typeof settings
    }`
  }
  if (!isUpdateSettingsSource(source)) {
    return `update_settings: unsupported source ${String(source)}`
  }
  if (!sourceEnabled) {
    return `update_settings: the ${source} source is disabled for this session (--setting-sources)`
  }
  const bag = settings as Record<string, unknown>
  if (Object.keys(bag).length === 0) {
    return 'update_settings requires at least one key'
  }
  const allowed = UPDATE_SETTINGS_ALLOWED_KEYS[source]
  const extra = Object.keys(bag).filter(key => !allowed.has(key))
  if (extra.length > 0) {
    return `update_settings keys not allowed: ${extra.sort().join(', ')}`
  }
  const nonString = Object.keys(bag).filter(key => typeof bag[key] !== 'string')
  if (nonString.length > 0) {
    return `update_settings values must be strings (deletion is not supported): ${nonString.sort().join(', ')}`
  }
  if (source === 'userSettings') {
    const effort = bag.effortLevel
    if (
      typeof effort !== 'string' ||
      !EFFORT_LEVELS.includes(
        effort.trim().toLowerCase() as (typeof EFFORT_LEVELS)[number],
      )
    ) {
      return updateSettingsEffortError()
    }
  }
  return null
}

export function isSettingSourceEnabledForUpdate(
  source: SettingSource,
): boolean {
  return isSettingSourceEnabled(source)
}

export function unavailableOnThisConnection(subtype: string): string {
  return `${subtype} is not available on this connection`
}

export function rewindTargetUuidError(): string {
  return 'rewind_conversation: target_message_uuid must be a string'
}

export type RewindConversationCut = {
  index: number
  echoUuid: string
  prefillText?: string
  precedingAssistantUuid?: string
}

/**
 * densable `Ed` analog — find the last user/assistant message with this uuid.
 */
export function findRewindCut(
  messages: ReadonlyArray<{ uuid?: string; type?: string }>,
  targetMessageUuid: string,
): RewindConversationCut | { refuse: 'target_not_found' } {
  let index = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.uuid === targetMessageUuid) index = i
  }
  if (index < 0) return { refuse: 'target_not_found' }
  return { index, echoUuid: targetMessageUuid }
}

export function rewindBusyResponse(busy: boolean): string | null {
  return busy ? 'turn_running' : null
}

export function mcpCallToolMustBeString(): string {
  return 'mcp_call: tool must be a string'
}

export function mcpCallNotFullyQualified(tool: string): string {
  return `Not a fully-qualified MCP tool name: ${tool}`
}

export function mcpCallServerNotConnected(serverName: string): string {
  return `MCP server not connected: ${serverName}`
}

export function mcpCallCancelledByClient(serverName: string): string {
  return `mcp_call cancelled by client: ${serverName}`
}

export function mcpCallStagedDisabled(): string {
  return 'staged mcp_call is disabled'
}

export function mcpCallSdkUnsupported(serverName: string): string {
  return (
    'mcp_call does not support SDK MCP servers. ' +
    `SDK servers are caller-provided — invoke ${serverName} directly.`
  )
}

export function parseMcpCallTool(tool: unknown): {
  serverName: string
  toolName: string
} | null {
  if (typeof tool !== 'string') return null
  const info = mcpInfoFromString(tool)
  if (!info?.toolName) return null
  return { serverName: info.serverName, toolName: info.toolName }
}

export function isStagedMcpCall(request: Record<string, unknown>): boolean {
  return (
    request.input_files !== undefined ||
    request.output_files !== undefined ||
    request.expires_at !== undefined ||
    request.timeout_ms !== undefined
  )
}

export function listHooksForControl(
  registered: Partial<Record<string, unknown[]>> | null,
): { events: Record<string, number> } {
  const events: Record<string, number> = {}
  if (registered) {
    for (const [event, matchers] of Object.entries(registered)) {
      events[event] = Array.isArray(matchers) ? matchers.length : 0
    }
  }
  return { events }
}
