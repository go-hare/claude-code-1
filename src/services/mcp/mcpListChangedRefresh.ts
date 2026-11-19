/**
 * densable 2.1.214 #42 — MCP prompts/resources list_changed keep-previous.
 *
 * Transient list refresh failures must not wipe slash commands / resources.
 * densable copy:
 *   prompts:  "…prompts/list_changed refresh failed (…); keeping previous commands"
 *   resources: "…resources/list_changed refresh partial failure (…); keeping previous for failed fields"
 */

export type SettledField<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

/**
 * densable prompts list_changed: all-or-nothing. On any failure, keep previous.
 */
export function resolvePromptsListChangedRefresh<T>(
  previous: T,
  result: SettledField<T>,
): { next: T; keptPrevious: boolean } {
  if (result.ok) {
    return { next: result.value, keptPrevious: false }
  }
  return { next: previous, keptPrevious: true }
}

/**
 * densable resources list_changed with optional skill/command fields:
 * apply each successful field; keep previous for failed fields.
 */
export function resolveResourcesListChangedRefresh<TResources, TCommands>(
  previous: { resources: TResources; commands: TCommands },
  next: {
    resources: SettledField<TResources>
    commands?: SettledField<TCommands>
  },
): {
  resources: TResources
  commands: TCommands
  failedFields: string[]
  appliedAny: boolean
} {
  const failedFields: string[] = []
  let appliedAny = false

  let resources = previous.resources
  if (next.resources.ok) {
    resources = next.resources.value
    appliedAny = true
  } else {
    failedFields.push('resources')
  }

  let commands = previous.commands
  if (next.commands) {
    if (next.commands.ok) {
      commands = next.commands.value
      appliedAny = true
    } else {
      failedFields.push('commands')
    }
  }

  return { resources, commands, failedFields, appliedAny }
}

export function formatListChangedRefreshFailed(
  serverName: string,
  kind: 'prompts' | 'resources',
  err: string,
  mode: 'full' | 'partial',
): string {
  if (kind === 'prompts') {
    return `[mcp] ${serverName}: prompts/list_changed refresh failed (${err}); keeping previous commands`
  }
  if (mode === 'partial') {
    return `[mcp] ${serverName}: resources/list_changed refresh partial failure (${err}); keeping previous for failed fields`
  }
  return `[mcp] ${serverName}: resources/list_changed refresh failed (${err}); keeping previous for failed fields`
}

/**
 * Official 325 `toolRefreshSequences` (#1893) — per-connection monotonic
 * refresh counter so an older in-flight `tools/list` response that resolves
 * after a newer refresh (or reconnect/cwd change) is discarded instead of
 * overwriting/emptying the server's tools.
 */
export type ToolRefreshSequenceState = {
  started: number
  applied: number
}

const toolRefreshSequences = new WeakMap<object, ToolRefreshSequenceState>()

export function beginMcpToolRefreshSequence(connection: object): number {
  let state = toolRefreshSequences.get(connection)
  if (!state) {
    state = { started: 0, applied: 0 }
    toolRefreshSequences.set(connection, state)
  }
  state.started += 1
  return state.started
}

export function isMcpToolRefreshSuperseded(
  connection: object,
  seq: number,
): boolean {
  const state = toolRefreshSequences.get(connection)
  return state !== undefined && state.applied > seq
}

export function commitMcpToolRefreshSequence(
  connection: object,
  seq: number,
): boolean {
  let state = toolRefreshSequences.get(connection)
  if (!state) {
    state = { started: seq, applied: 0 }
    toolRefreshSequences.set(connection, state)
  }
  if (state.applied > seq) {
    return false
  }
  state.applied = seq
  return true
}
