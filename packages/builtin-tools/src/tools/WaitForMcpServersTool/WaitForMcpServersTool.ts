/**
 * Official 2.1.331 WaitForMcpServersTool (`CEi` / `Vj`).
 *
 * Waits for pending MCP servers in `appState.mcp.clients` (or a specific
 * `servers` list) to settle up to `WAIT_FOR_MCP_SERVERS_TIMEOUT_MS` (5000ms),
 * polling every 50ms until settled, timed out, or aborted.
 */

import { z } from 'zod/v4'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isCodeModeEnabled } from 'src/services/codeMode/index.js'
import { normalizeNameForMCP } from 'src/services/mcp/normalization.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import {
  buildTool,
  type ToolDef,
  type ToolResultBlockParam,
  type ToolUseContext,
  toolMatchesName,
} from 'src/Tool.js'
import { logForDebugging } from 'src/utils/debug.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getBootstrapSessionHost, HostSlot } from 'src/utils/sessionHost.js'
import { sleep } from 'src/utils/sleep.js'
import { REPL_TOOL_NAME } from '../REPLTool/constants.js'
import {
  WAIT_FOR_MCP_SERVERS_POLL_INTERVAL_MS,
  WAIT_FOR_MCP_SERVERS_TIMEOUT_MS,
  WAIT_FOR_MCP_SERVERS_TOOL_NAME,
} from './constants.js'
import { getWaitForMcpServersPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.object({
    servers: z
      .array(z.string())
      .optional()
      .describe('Server names to wait for (default: all pending)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type WaitForMcpServersInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    ready: z.boolean(),
    connected: z.array(z.string()),
    cached: z.array(z.string()).optional(),
    failed: z.array(z.string()),
    stillPending: z.array(z.string()),
    needsAuth: z.array(z.string()),
    disabled: z.array(z.string()),
    unconfigured: z.array(z.string()).optional(),
    codeModeRouted: z.boolean().optional(),
    unknown: z.array(z.string()),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type WaitForMcpServersOutput = z.infer<OutputSchema>

/** Extended MCP connection union accommodating cached/heldBy runtime fields. */
type WaitableMcpClient =
  | MCPServerConnection
  | {
      name: string
      type: 'cached'
      config?: MCPServerConnection['config']
    }

type ClientWithOptionalMeta = WaitableMcpClient & {
  errorCode?: string
  heldBy?: unknown
}

// Host-level state mirroring official `xAt` (declared latch) + live clients
// accessor so zero-arg `isEnabled()` reflects pending MCP connections per host.
type WaitForMcpHostState = {
  liveClientsSnapshot: readonly WaitableMcpClient[]
  declaredSticky: boolean
}

const fallbackWaitForMcpHost: object = {}

function getActiveWaitForMcpHost(): object {
  try {
    const host = getBootstrapSessionHost()
    if (
      host !== null &&
      (typeof host === 'object' || typeof host === 'function')
    ) {
      return host
    }
  } catch {
    // Fall back when sessionHost is mocked in tests
  }
  return fallbackWaitForMcpHost
}

const waitForMcpHostSlot = new HostSlot<WaitForMcpHostState>(() => ({
  liveClientsSnapshot: [],
  declaredSticky: false,
}))

function getWaitForMcpHostState(): WaitForMcpHostState {
  return waitForMcpHostSlot.of(getActiveWaitForMcpHost())
}

/** Return names of MCP servers currently in `'pending'` state (official `AAt`). */
export function getPendingMcpServerNames(
  clients: readonly WaitableMcpClient[],
): string[] {
  return clients.filter(c => c.type === 'pending').map(c => c.name)
}

/** Update the snapshot of live MCP clients used by zero-arg `isEnabled()`. */
export function setLiveMcpClientsForWait(
  clients: readonly WaitableMcpClient[],
): void {
  getWaitForMcpHostState().liveClientsSnapshot = clients
}

/** Official `jZn` / `bdr` — set or clear the sticky declared latch for this host. */
export function setWaitForMcpServersDeclared(declared: boolean): void {
  getWaitForMcpHostState().declaredSticky = declared
}

/** Official `cBt` — whether WaitForMcpServers has been declared this session. */
export function isWaitForMcpServersDeclared(): boolean {
  return getWaitForMcpHostState().declaredSticky
}

/** Official `mnl` — true when at least one MCP server is currently pending. */
export function hasPendingMcpServers(
  clients: readonly WaitableMcpClient[] = getWaitForMcpHostState()
    .liveClientsSnapshot,
): boolean {
  return getPendingMcpServerNames(clients).length > 0
}

/** Official `eNs` — enabled when any MCP server is pending or declared sticky. */
export function isWaitForMcpServersEnabled(
  clients: readonly WaitableMcpClient[] = getWaitForMcpHostState()
    .liveClientsSnapshot,
): boolean {
  return (
    getPendingMcpServerNames(clients).length > 0 ||
    getWaitForMcpHostState().declaredSticky
  )
}

/** Reset host-level latches between unit tests. */
export function resetWaitForMcpServersStateForTests(): void {
  const state = getWaitForMcpHostState()
  state.liveClientsSnapshot = []
  state.declaredSticky = false
}

/** Official `A3` — failed server whose config lacks a URL / endpoint. */
function isUnconfiguredFailedClient(client: ClientWithOptionalMeta): boolean {
  return client.type === 'failed' && client.errorCode === 'UNCONFIGURED'
}

/** Ineligible claude.ai connector failure (skipped from default failed list). */
function isIneligibleFailedClient(client: ClientWithOptionalMeta): boolean {
  if (client.type !== 'failed') return false
  const cfg = client.config
  return (
    cfg !== undefined && cfg.type === 'claudeai-proxy' && cfg.eligible === false
  )
}

function getLiveMcpClientsFromContext(
  context: ToolUseContext,
): readonly WaitableMcpClient[] {
  if (context.options.refreshMcpClients) {
    return context.options.refreshMcpClients()
  }
  if (context.getMcp) {
    return context.getMcp().clients
  }
  const appClients = context.getAppState?.()?.mcp?.clients
  if (Array.isArray(appClients) && appClients.length > 0) {
    return appClients
  }
  return context.options.mcpClients ?? appClients ?? []
}

function isReplPresentInTools(context: ToolUseContext): boolean {
  const tools = context.options.tools
  if (!Array.isArray(tools)) return false
  return tools.some(t => toolMatchesName(t, REPL_TOOL_NAME))
}

export async function waitForMcpServers(
  input: WaitForMcpServersInput,
  deps: {
    getClients: () => readonly WaitableMcpClient[]
    signal?: AbortSignal
    timeoutMs?: number
    pollIntervalMs?: number
    codeModeRouted?: boolean
  },
): Promise<WaitForMcpServersOutput> {
  const timeoutMs = deps.timeoutMs ?? WAIT_FOR_MCP_SERVERS_TIMEOUT_MS
  const pollIntervalMs =
    deps.pollIntervalMs ?? WAIT_FOR_MCP_SERVERS_POLL_INTERVAL_MS

  const initialClients = deps.getClients()
  const pendingNames = getPendingMcpServerNames(initialClients)
  const requestedNames =
    input.servers && input.servers.length > 0
      ? input.servers
      : pendingNames.length > 0
        ? pendingNames
        : initialClients
            .filter(
              c =>
                c.type === 'failed' &&
                !isIneligibleFailedClient(c as ClientWithOptionalMeta),
            )
            .map(c => c.name)

  const requestedNormalized = new Set(
    requestedNames.map(name => normalizeNameForMCP(name)),
  )

  const getMatchedClients = (): readonly WaitableMcpClient[] =>
    deps
      .getClients()
      .filter(
        c =>
          requestedNames.includes(c.name) ||
          requestedNormalized.has(normalizeNameForMCP(c.name)),
      )

  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs

  while (
    getMatchedClients().some(c => c.type === 'pending') &&
    Date.now() < deadline &&
    !deps.signal?.aborted
  ) {
    try {
      await sleep(pollIntervalMs, deps.signal)
    } catch {
      // Abort while sleeping — break immediately and report current snapshot.
      break
    }
  }

  const waitedMs = Date.now() - startedAt
  const finalClients = getMatchedClients()

  const connected: string[] = []
  const cached: string[] = []
  const failed: string[] = []
  const stillPending: string[] = []
  const needsAuth: string[] = []
  const disabled: string[] = []
  const unconfigured: string[] = []

  for (const rawClient of finalClients) {
    const client = rawClient as ClientWithOptionalMeta
    switch (client.type) {
      case 'connected':
        connected.push(client.name)
        break
      case 'cached':
        cached.push(client.name)
        break
      case 'failed':
        if (isUnconfiguredFailedClient(client)) {
          unconfigured.push(client.name)
        } else if (!isIneligibleFailedClient(client)) {
          failed.push(client.name)
        }
        break
      case 'pending':
        stillPending.push(client.name)
        break
      case 'needs-auth':
        needsAuth.push(client.name)
        break
      case 'disabled':
        disabled.push(client.name)
        break
    }
  }

  const matchedNormalized = new Set(
    finalClients.map(c => normalizeNameForMCP(c.name)),
  )
  const unknown = requestedNames.filter(
    name => !matchedNormalized.has(normalizeNameForMCP(name)),
  )

  const ready =
    stillPending.length === 0 &&
    failed.length === 0 &&
    needsAuth.length === 0 &&
    disabled.length === 0 &&
    unknown.length === 0

  logForDebugging(
    `[WaitForMcpServers] waited=${waitedMs}ms connected=${connected.join(',')} cached=${cached.join(',')} failed=${failed.join(',')} pending=${stillPending.join(',')} needsAuth=${needsAuth.join(',')} disabled=${disabled.join(',')} unconfigured=${unconfigured.join(',')} unknown=${unknown.join(',')}`,
  )
  logEvent('tengu_mcp_pending_call', {
    requestedCount: requestedNames.length,
    connectedCount: connected.length,
    cachedCount: cached.length,
    failedCount: failed.length,
    pendingCount: stillPending.length,
    needsAuthCount: needsAuth.length,
    disabledCount: disabled.length,
    unconfiguredCount: unconfigured.length,
    unknownCount: unknown.length,
    waitMs: waitedMs,
    matched: ready,
    matchType:
      'wait' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    success: ready,
  })

  return {
    ready,
    connected,
    cached,
    failed,
    stillPending,
    needsAuth,
    disabled,
    unconfigured,
    unknown,
    ...(deps.codeModeRouted ? { codeModeRouted: true } : {}),
  }
}

export const WaitForMcpServersTool = buildTool({
  name: WAIT_FOR_MCP_SERVERS_TOOL_NAME,
  backgrounding: 'never',
  shouldDefer: false,
  maxResultSizeChars: 10_000,

  isEnabled() {
    return isWaitForMcpServersEnabled()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },

  async description() {
    return getWaitForMcpServersPrompt(isCodeModeEnabled())
  },
  async prompt() {
    return getWaitForMcpServersPrompt(isCodeModeEnabled())
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  userFacingName() {
    return 'MCP Wait For Servers'
  },

  renderToolUseMessage(input: Partial<WaitForMcpServersInput>) {
    const servers = input.servers?.join(', ')
    return servers
      ? `Wait for MCP servers to connect: ${servers}`
      : 'Wait for pending MCP servers to connect'
  },

  async call(input: WaitForMcpServersInput, context: ToolUseContext) {
    const data = await waitForMcpServers(input, {
      getClients: () => getLiveMcpClientsFromContext(context),
      signal: context.abortController?.signal,
      codeModeRouted: isCodeModeEnabled() && isReplPresentInTools(context),
    })
    return { data }
  },

  mapToolResultToToolResultBlockParam(
    data: WaitForMcpServersOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const routed = isCodeModeEnabled() && data.codeModeRouted === true
    const lines = [
      `ready: ${data.ready}`,
      data.connected.length
        ? routed
          ? `Connected (their tools are now callable inside the REPL environment — not as top-level tools): ${data.connected.join(', ')}`
          : `Connected (their tools are now available — call them directly): ${data.connected.join(', ')}`
        : '',
      data.cached?.length
        ? routed
          ? `Cached (their tools are callable inside the REPL environment now; connects on first call): ${data.cached.join(', ')}`
          : `Cached (their tools are available now; connects on first call): ${data.cached.join(', ')}`
        : '',
      data.failed.length ? `Failed to connect: ${data.failed.join(', ')}` : '',
      data.stillPending.length
        ? `Still connecting (try again or proceed without): ${data.stillPending.join(', ')}`
        : '',
      data.needsAuth.length
        ? `Needs authentication (ask the user to run /mcp): ${data.needsAuth.join(', ')}`
        : '',
      data.disabled.length
        ? `Disabled (ask the user to enable via /mcp): ${data.disabled.join(', ')}`
        : '',
      data.unconfigured?.length
        ? `Not configured (no URL set — retrying will not help; the user must configure the server first): ${data.unconfigured.join(', ')}`
        : '',
      data.unknown.length
        ? `Unknown (no MCP server with this name is configured): ${data.unknown.join(', ')}`
        : '',
    ].filter(Boolean)

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: lines.join('\n'),
      is_error: !data.ready,
    }
  },
} satisfies ToolDef<InputSchema, WaitForMcpServersOutput>)
