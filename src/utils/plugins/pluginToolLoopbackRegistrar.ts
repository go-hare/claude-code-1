/**
 * densable 2.1.289 `$.tool.register` HTTP loopback registrar
 * (LHt / MHt / OHt / DHt / Ais / YLo / YNo).
 *
 * Semantic exports only — never export minify LHt|MHt|OHt|DHt|Ais|YLo|YNo.
 */
import { randomUUID, timingSafeEqual } from 'crypto'
import {
  Server,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server'
import { buildMcpToolName } from 'src/services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from 'src/services/mcp/types.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import {
  listPluginRegisteredTools,
  type PluginRegisteredToolSpec,
} from './pluginToolRegistry.js'

export const PLUGIN_TOOL_REGISTER_VISIBLE_TIMEOUT_MS = 8000
export const PLUGIN_TOOL_REGISTER_POLL_MS = 100

export type PluginToolRegistrarResult = {
  key: string
  config: ScopedMcpServerConfig
}

export type PluginToolRegistrar = ((
  plugin: string,
  tools: PluginRegisteredToolSpec[],
) => PluginToolRegistrarResult) & {
  serves?: (url: string) => boolean
}

type LoopbackState = {
  port: number
  secret: string
}

type RegistrarSlot = {
  current: PluginToolRegistrar | undefined
}

const registrarSlot: RegistrarSlot = { current: undefined }

/** densable Ais — install registrar into the YLo slot. */
export function installPluginToolRegistrar(
  registrar: PluginToolRegistrar = createBunPluginToolRegistrar(),
): void {
  registrarSlot.current = registrar
}

/** densable YLo */
export function getPluginToolRegistrar(): PluginToolRegistrar | undefined {
  return registrarSlot.current
}

/** densable YNo — install once if missing. */
export function ensurePluginToolRegistrarInstalled(): void {
  if (registrarSlot.current) return
  installPluginToolRegistrar()
}

export function clearPluginToolRegistrarForTests(): void {
  registrarSlot.current = undefined
  stopLoopbackServerForTests()
}

let loopback:
  | {
      state: LoopbackState
      server: ReturnType<typeof Bun.serve>
      /** plugin → generation (MCP Server.version suffix) */
      generations: Map<string, number>
    }
  | undefined

function stopLoopbackServerForTests(): void {
  if (!loopback) return
  try {
    loopback.server.stop(true)
  } catch {
    // ignore
  }
  loopback = undefined
}

/**
 * densable Bx(plugin, _k(plugin)) — the raw plugin name. Gold only swaps in a
 * legacy alias for `@builtin` ids; this build ships no builtin alias table.
 */
function pluginToolServerKey(pluginName: string): string {
  return pluginName
}

/** densable DHt / 325 Rpo — dynamic HTTP MCP config for a plugin's registered tools. */
export function buildPluginToolsDynamicHttpConfig(input: {
  pluginName: string
  port: number
  secret: string
  version: number
}): PluginToolRegistrarResult {
  const key = pluginToolServerKey(input.pluginName)
  const config: ScopedMcpServerConfig = {
    type: 'http',
    url: `http://127.0.0.1:${input.port}/${encodeURIComponent(input.pluginName)}?v=${input.version}`,
    headers: {
      Authorization: `Bearer ${input.secret}`,
    },
    scope: 'dynamic',
  }
  return { key, config }
}

/** 325 `Tpo` — attach `anthropic/alwaysLoad` when `isDeferred` is specified. */
function toolMeta(
  tool: PluginRegisteredToolSpec,
): { _meta: { 'anthropic/alwaysLoad': boolean } } | Record<string, never> {
  return tool.isDeferred === undefined
    ? {}
    : { _meta: { 'anthropic/alwaysLoad': tool.isDeferred === false } }
}

/**
 * densable MHt / 325 Epo — MCP Server listing bag tools; CallTool returns gold stub error
 * until a plugin `tool.call` hook answers.
 */
export function createPluginToolsMcpServer(
  plugin: string,
  version: number,
): Server {
  const qualifiedServer = pluginToolServerKey(plugin)
  const server = new Server(
    {
      name: plugin,
      version: `plugin-tools-${version}`,
    },
    {
      capabilities: { tools: {} },
      instructions: `Tools registered by the ${plugin} plugin through $.tool.register.`,
    },
  )

  server.setRequestHandler('tools/list', async () => {
    const tools = listPluginRegisteredTools(plugin).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        ...tool.inputSchema,
        type: 'object' as const,
      },
      ...toolMeta(tool),
    }))
    return { tools }
  })

  server.setRequestHandler('tools/call', async request => {
    const params = (
      request as {
        params?: { name?: string }
      }
    ).params
    const toolName = params?.name ?? ''
    // Advertise the session-visible matcher (normalized), not the raw config-map key.
    const advertised = buildMcpToolName(qualifiedServer, toolName)
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `${plugin} registered the tool ${toolName} but no tool.call hook answered this call: add on("tool.call", { tool: "${advertised}" }, ($, e) => ({ result: ... })) to the plugin.`,
        },
      ],
    }
  })

  return server
}

async function handleLoopbackFetch(
  request: Request,
  state: LoopbackState,
  generations: Map<string, number>,
): Promise<Response> {
  const url = new URL(request.url)
  const [, rawPlugin = ''] = url.pathname.split('/')
  let plugin: string | undefined
  try {
    plugin = rawPlugin ? decodeURIComponent(rawPlugin) : undefined
  } catch {
    plugin = undefined
  }
  const generation = plugin === undefined ? undefined : generations.get(plugin)
  const authHeader = Buffer.from(request.headers.get('authorization') ?? '')
  const expectedAuth = Buffer.from(`Bearer ${state.secret}`)
  if (
    authHeader.byteLength !== expectedAuth.byteLength ||
    !timingSafeEqual(authHeader, expectedAuth) ||
    plugin === undefined ||
    generation === undefined
  ) {
    return new Response('not found', { status: 404 })
  }
  if (request.method !== 'POST') {
    return new Response('method not allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    })
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const mcp = createPluginToolsMcpServer(plugin, generation)
  await mcp.connect(transport)
  return transport.handleRequest(request)
}

function ensureLoopbackListening(): LoopbackState {
  if (loopback) return loopback.state
  const state: LoopbackState = { port: 0, secret: randomUUID() }
  const generations = new Map<string, number>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (req: Request) => handleLoopbackFetch(req, state, generations),
  })
  server.unref()
  registerCleanup(() => {
    stopLoopbackServerForTests()
  })
  state.port = server.port ?? 0
  loopback = { state, server, generations }
  logForDebugging(
    `$.tool.register: loopback MCP server listening on 127.0.0.1:${state.port}`,
  )
  return state
}

/** densable LHt / 325 Apo */
export function createBunPluginToolRegistrar(): PluginToolRegistrar {
  return Object.assign(
    (plugin: string, tools: PluginRegisteredToolSpec[]) => {
      const state = ensureLoopbackListening()
      if (!loopback) {
        throw new Error('plugin tool loopback failed to start')
      }
      const next = (loopback.generations.get(plugin) ?? 0) + 1
      loopback.generations.set(plugin, next)
      logForDebugging(
        `$.tool.register (${plugin}): ${tools.length} tool(s) served at 127.0.0.1:${state.port}/${plugin} v${next}`,
      )
      return buildPluginToolsDynamicHttpConfig({
        pluginName: plugin,
        port: state.port,
        secret: state.secret,
        version: next,
      })
    },
    {
      serves: (url: string): boolean =>
        loopback !== undefined &&
        URL.parse(url)?.origin === `http://127.0.0.1:${loopback.state.port}`,
    },
  )
}
