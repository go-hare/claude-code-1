import { setTimeout as delay } from 'node:timers/promises'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from 'src/services/mcp/types.js'
import { isAccountMemoryTool } from '../../services/mcp/accountMemoryMcp.js'
import { getMcpTimeoutMs } from '../../services/mcp/mcpConnectTimeout.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { getBootstrapSession } from '../sessionRoot.js'
import type { McpToolHook } from '../settings/types.js'

const NON_BLOCKING_EVENTS = new Set<string>([
  'Notification',
  'SessionStart',
  'SessionEnd',
  'Setup',
  'StopFailure',
  'SubagentStart',
  'PostToolUseFailure',
  'PostCompact',
  'PostModelSwitch',
  'PermissionDenied',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'DirectoryAdded',
  'MessageDisplay',
  'StatusLine',
  'FileSuggestion',
])
const MEMORY_READ_TOOLS = new Set([
  'memory_read',
  'memory_list',
  'memory_search',
])

export type McpToolHookResult = {
  ok: boolean
  body: string
  error?: string
  aborted?: boolean
  withheld?: boolean
}

/** densable jzo: interpolation preserves non-string values and recursively visits containers. */
export function interpolateMcpHookInput(
  input: Record<string, unknown>,
  hookInput: unknown,
): Record<string, unknown> {
  const interpolate = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(
        /\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g,
        (_, path: string) => {
          let resolved: unknown = hookInput
          for (const key of path.split('.')) {
            if (resolved === null || typeof resolved !== 'object') return ''
            resolved = (resolved as Record<string, unknown>)[key]
          }
          if (resolved === undefined || resolved === null) return ''
          return typeof resolved === 'object'
            ? JSON.stringify(resolved)
            : String(resolved)
        },
      )
    }
    if (Array.isArray(value)) return value.map(interpolate)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, interpolate(entry)]),
      )
    }
    return value
  }
  return interpolate(input) as Record<string, unknown>
}

function currentClients(): readonly MCPServerConnection[] | undefined {
  const clients = getBootstrapSession().mcpSessionWiring.clientsFromAccessor()
  return Array.isArray(clients) ? clients : undefined
}

async function waitForClient(
  name: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MCPServerConnection | undefined> {
  let deadline = Date.now() + timeoutMs
  let retryBounded = false
  for (;;) {
    const client = currentClients()?.find(candidate => candidate.name === name)
    if (client?.type !== 'pending') return client
    if (!retryBounded && client.reconnectAttempt !== undefined) {
      deadline = Math.min(deadline, Date.now() + 5000)
      retryBounded = true
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0 || signal?.aborted) return undefined
    try {
      await delay(Math.min(50, remaining), undefined, { signal })
    } catch {
      return undefined
    }
  }
}

function memoryHookWithheld(
  client: ConnectedMCPServer,
  toolName: string,
): boolean {
  if (!isAccountMemoryTool(client, 'memory_read')) return false
  const capability = client.capabilities.experimental?.['anthropic/memory']
  if (capability !== undefined) {
    if (
      capability === null ||
      typeof capability !== 'object' ||
      Array.isArray(capability)
    )
      return true
    const mode = capability.subagent_memory
    if (
      mode !== undefined &&
      mode !== 'all' &&
      mode !== 'read_only' &&
      mode !== 'none'
    )
      return true
    if (mode === 'none') return true
  }
  return !MEMORY_READ_TOOLS.has(toolName)
}

/** densable GFe: invokes an already configured server and returns raw hook output. */
export async function execMcpToolHook(
  hook: McpToolHook,
  hookEvent: HookEvent,
  jsonInput: string,
  clients?: readonly MCPServerConnection[],
  signal?: AbortSignal,
  defaultTimeoutMs = 600_000,
): Promise<McpToolHookResult> {
  const available = clients ?? currentClients()
  if (available === undefined) {
    const error = `mcp_tool hooks are not available for the '${hookEvent}' hook event (no MCP client context)`
    logForDebugging(`Hooks: mcp_tool hook skipped — ${error}`, {
      level: 'warn',
    })
    return { ok: false, body: '', error }
  }
  const timeoutMs = hook.timeout ? hook.timeout * 1000 : defaultTimeoutMs
  const deadline = Date.now() + timeoutMs
  let client = available.find(candidate => candidate.name === hook.server)
  if (client === undefined && clients !== undefined) {
    client = currentClients()?.find(candidate => candidate.name === hook.server)
  }
  if (client?.type === 'pending' && !NON_BLOCKING_EVENTS.has(hookEvent)) {
    client =
      (await waitForClient(
        hook.server,
        Math.min(timeoutMs, getMcpTimeoutMs()),
        signal,
      )) ?? client
  }
  if (signal?.aborted) return { ok: false, body: '', aborted: true }
  if (client?.type !== 'connected') {
    const error = `MCP server '${hook.server}' not connected`
    logForDebugging(`Hooks: mcp_tool hook skipped — ${error}`, {
      level: 'warn',
    })
    return { ok: false, body: '', error }
  }
  const remaining = deadline - Date.now()
  if (remaining <= 0) return { ok: false, body: '', aborted: true }
  const combined = createCombinedAbortSignal(signal, { timeoutMs: remaining })
  try {
    const args = hook.input
      ? interpolateMcpHookInput(hook.input, JSON.parse(jsonInput))
      : {}
    const ensureConnected =
      getBootstrapSession().host.mcpProcessWiring.ensureConnectedClient() as
        | ((
            client: ConnectedMCPServer,
            options?: {
              signal?: AbortSignal
              timeoutMs: number
              context: string
            },
          ) => Promise<ConnectedMCPServer>)
        | undefined
    if (!ensureConnected)
      return {
        ok: false,
        body: '',
        error: `MCP server '${hook.server}' not connected`,
      }
    const connection = createCombinedAbortSignal(combined.signal, {
      timeoutMs: Math.min(remaining, getMcpTimeoutMs()),
    })
    let live: ConnectedMCPServer
    let onAbort: (() => void) | undefined
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(new Error('MCP hook connection timed out or was cancelled'))
        if (connection.signal.aborted) onAbort()
        else
          connection.signal.addEventListener('abort', onAbort, { once: true })
      })
      live = await Promise.race([
        ensureConnected(client, {
          signal: connection.signal,
          timeoutMs: Math.min(remaining, getMcpTimeoutMs()),
          context: 'mcp_tool hook',
        }),
        aborted,
      ])
    } finally {
      if (onAbort) connection.signal.removeEventListener('abort', onAbort)
      connection.cleanup()
    }
    if (combined.signal.aborted) return { ok: false, body: '', aborted: true }
    if (memoryHookWithheld(live, hook.tool)) {
      const error = `The account memory server's ${hook.tool} is not available to a hook in this session`
      return { ok: false, body: '', error, withheld: true }
    }
    const memory = isAccountMemoryTool(live, 'memory_read')
    const result = await live.client.callTool(
      {
        name: hook.tool,
        arguments: args,
        ...(memory ? { _meta: { 'anthropic/memory.caller': 'worker' } } : {}),
      },
      { signal: combined.signal, timeout: Math.max(1, deadline - Date.now()) },
    )
    const body = Array.isArray(result.content)
      ? result.content
          .map(part => (part.type === 'text' ? part.text : `[${part.type}]`))
          .join('\n')
      : ''
    return result.isError
      ? { ok: false, body, error: body || 'MCP tool returned an error' }
      : { ok: true, body }
  } catch (error) {
    if (combined.signal.aborted) return { ok: false, body: '', aborted: true }
    const message = errorMessage(error)
    logForDebugging(`Hooks: mcp_tool hook error: ${message}`, {
      level: 'error',
    })
    return { ok: false, body: '', error: message }
  } finally {
    combined.cleanup()
  }
}
