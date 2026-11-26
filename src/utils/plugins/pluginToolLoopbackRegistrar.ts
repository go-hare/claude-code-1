/**
 * densable 2.1.289 `$.tool.register` HTTP loopback registrar
 * (LHt / MHt / OHt / DHt / Ais / YLo / YNo).
 *
 * Semantic exports only — never export minify LHt|MHt|OHt|DHt|Ais|YLo|YNo.
 */
import { randomUUID, timingSafeEqual } from 'crypto'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
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

type LoopbackServer = {
  readonly port: number
  stop(closeActiveConnections?: boolean): void
}

let loopback:
  | {
      state: LoopbackState
      server: LoopbackServer
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

function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  )
}

async function nodeRequestToWebRequest(
  req: IncomingMessage,
  port: number,
): Promise<Request> {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).toString()
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers })
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const body =
    chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined
  return new Request(url, { method, headers, body })
}

async function writeWebResponseToNode(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  if (res.destroyed || res.writableEnded) return
  res.statusCode = response.status
  if (response.statusText) {
    res.statusMessage = response.statusText
  }
  response.headers.forEach((value, key) => {
    if (typeof res.appendHeader === 'function') {
      res.appendHeader(key, value)
    } else {
      res.setHeader(key, value)
    }
  })
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (res.destroyed) {
        await reader.cancel()
        return
      }
      res.write(value)
    }
  } finally {
    reader.releaseLock()
    if (!res.writableEnded) {
      res.end()
    }
  }
}

async function handleNodeLoopbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: LoopbackState,
  generations: Map<string, number>,
): Promise<void> {
  try {
    const request = await nodeRequestToWebRequest(req, state.port)
    const response = await handleLoopbackFetch(request, state, generations)
    await writeWebResponseToNode(response, res)
  } catch (err) {
    logForDebugging(
      `$.tool.register: node loopback handler error: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('internal server error')
    } else if (!res.writableEnded) {
      res.end()
    }
  }
}

function createNodeLoopbackServer(
  state: LoopbackState,
  generations: Map<string, number>,
): LoopbackServer {
  const httpServer = createServer((req, res) => {
    if (
      req.socket.remoteAddress &&
      !isLoopbackAddress(req.socket.remoteAddress)
    ) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    void handleNodeLoopbackRequest(req, res, state, generations)
  })
  httpServer.on('connection', socket => {
    if (socket.remoteAddress && !isLoopbackAddress(socket.remoteAddress)) {
      socket.destroy()
    }
  })
  httpServer.on('error', err => {
    logForDebugging(
      `$.tool.register: node loopback server error: ${err.message}`,
      { level: 'error' },
    )
  })
  // Omit host so Node binds synchronously (passing '127.0.0.1' defers through
  // async dns.lookup and leaves address() null); loopback access is enforced
  // on both 'connection' and request handlers plus bearer token auth.
  httpServer.listen(0)
  httpServer.unref()
  const address = httpServer.address()
  const port =
    address !== null && typeof address === 'object' ? address.port : 0
  return {
    port,
    stop: (closeActiveConnections?: boolean) => {
      if (closeActiveConnections) {
        httpServer.closeAllConnections?.()
      }
      httpServer.close()
    },
  }
}

function createLoopbackServer(
  state: LoopbackState,
  generations: Map<string, number>,
  forceNode = false,
): LoopbackServer {
  if (
    !forceNode &&
    typeof Bun !== 'undefined' &&
    typeof Bun.serve === 'function'
  ) {
    const bunServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req: Request) => handleLoopbackFetch(req, state, generations),
    })
    bunServer.unref()
    return {
      port: bunServer.port ?? 0,
      stop: (closeActiveConnections?: boolean) => {
        bunServer.stop(closeActiveConnections)
      },
    }
  }
  return createNodeLoopbackServer(state, generations)
}

function ensureLoopbackListening(forceNode = false): LoopbackState {
  if (loopback) return loopback.state
  const state: LoopbackState = { port: 0, secret: randomUUID() }
  const generations = new Map<string, number>()
  const server = createLoopbackServer(state, generations, forceNode)
  registerCleanup(() => {
    stopLoopbackServerForTests()
  })
  state.port = server.port
  loopback = { state, server, generations }
  logForDebugging(
    `$.tool.register: loopback MCP server listening on 127.0.0.1:${state.port}`,
  )
  return state
}

function createPluginToolRegistrar(forceNode: boolean): PluginToolRegistrar {
  return Object.assign(
    (plugin: string, tools: PluginRegisteredToolSpec[]) => {
      const state = ensureLoopbackListening(forceNode)
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

/** Explicit node:http loopback registrar (also used automatically when Bun.serve is unavailable). */
export function createNodePluginToolRegistrar(): PluginToolRegistrar {
  return createPluginToolRegistrar(true)
}

/** densable LHt / 325 Apo */
export function createBunPluginToolRegistrar(): PluginToolRegistrar {
  return createPluginToolRegistrar(false)
}
