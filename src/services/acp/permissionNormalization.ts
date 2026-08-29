/**
 * claude-agent-acp permissions/normalization.ts — validate and snapshot
 * PermissionUpdate[] before they appear as a durable ACP option.
 */
import type {
  PermissionBehavior,
  PermissionUpdate,
  PermissionUpdateDestination,
} from '../../types/permissions.js'

export type DurablePermissionChangeSet = {
  updates: PermissionUpdate[]
}

const MAX_UPDATES = 100
const MAX_RULES_PER_UPDATE = 100
const MAX_DIRECTORIES_PER_UPDATE = 100
const MAX_TOOL_NAME_LENGTH = 512
const MAX_RULE_CONTENT_LENGTH = 10_000
const MAX_DIRECTORY_LENGTH = 4_096

const DESTINATIONS = new Set<PermissionUpdateDestination>([
  'session',
  'cliArg',
  'userSettings',
  'projectSettings',
  'localSettings',
])
const BEHAVIORS = new Set<PermissionBehavior>(['allow', 'deny', 'ask'])
const MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isDestination(value: unknown): value is PermissionUpdateDestination {
  return (
    typeof value === 'string' &&
    DESTINATIONS.has(value as PermissionUpdateDestination)
  )
}

function safePlainString(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return (
    normalized.length > 0 &&
    value.length <= maxLength &&
    !Array.from(normalized).some(character => {
      const code = character.charCodeAt(0)
      return (
        code <= 0x08 ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      )
    })
  )
}

function isRule(
  value: unknown,
): value is { toolName: string; ruleContent?: string } {
  if (
    !isRecord(value) ||
    !safePlainString(value.toolName, MAX_TOOL_NAME_LENGTH)
  ) {
    return false
  }
  return (
    value.ruleContent === undefined ||
    safePlainString(value.ruleContent, MAX_RULE_CONTENT_LENGTH)
  )
}

function isKnownUpdate(value: unknown): value is PermissionUpdate {
  if (
    !isRecord(value) ||
    !isDestination(value.destination) ||
    typeof value.type !== 'string'
  ) {
    return false
  }
  switch (value.type) {
    case 'addRules':
    case 'replaceRules':
    case 'removeRules':
      return (
        Array.isArray(value.rules) &&
        value.rules.length <= MAX_RULES_PER_UPDATE &&
        (value.type === 'replaceRules' || value.rules.length > 0) &&
        value.rules.every(isRule) &&
        typeof value.behavior === 'string' &&
        BEHAVIORS.has(value.behavior as PermissionBehavior)
      )
    case 'setMode':
      return typeof value.mode === 'string' && MODES.has(value.mode)
    case 'addDirectories':
    case 'removeDirectories':
      return (
        Array.isArray(value.directories) &&
        value.directories.length > 0 &&
        value.directories.length <= MAX_DIRECTORIES_PER_UPDATE &&
        value.directories.every(directory =>
          safePlainString(directory, MAX_DIRECTORY_LENGTH),
        )
      )
    default:
      return false
  }
}

export function normalizeDurablePermissionChangeSet(
  suggestions: unknown,
  forcedAsk = false,
): DurablePermissionChangeSet | undefined {
  if (forcedAsk) return undefined
  try {
    if (
      !Array.isArray(suggestions) ||
      suggestions.length === 0 ||
      suggestions.length > MAX_UPDATES ||
      !suggestions.every(isKnownUpdate)
    ) {
      return undefined
    }
    return {
      updates: structuredClone(suggestions as PermissionUpdate[]),
    }
  } catch {
    return undefined
  }
}
