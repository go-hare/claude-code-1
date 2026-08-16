import { Server, type CallToolResult } from '@modelcontextprotocol/server'
import { createBridgeClient } from './bridgeClient.js'
import { BROWSER_TOOLS } from './browserTools.js'
import { createMcpSocketClient } from './mcpSocketClient.js'
import { createMcpSocketPool } from './mcpSocketPool.js'
import { handleToolCall } from './toolCalls.js'
import type { ClaudeForChromeContext, SocketClient } from './types.js'

/**
 * Create the socket/bridge client for the Chrome extension MCP server.
 * Exported so Desktop can share a single instance between the registered
 * MCP server and the InternalMcpServerManager (CCD sessions).
 */
export function createChromeSocketClient(
  context: ClaudeForChromeContext,
): SocketClient {
  return context.bridgeConfig
    ? createBridgeClient(context)
    : context.getSocketPaths
      ? createMcpSocketPool(context)
      : createMcpSocketClient(context)
}

export function createClaudeForChromeMcpServer(
  context: ClaudeForChromeContext,
  existingSocketClient?: SocketClient,
): Server {
  const { serverName, logger } = context

  // Choose transport: bridge (WebSocket) > socket pool (multi-profile) > single socket.
  const socketClient = existingSocketClient ?? createChromeSocketClient(context)

  const server = new Server(
    {
      name: serverName,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  )

  server.setRequestHandler('tools/list', async () => {
    if (context.isDisabled?.()) {
      return { tools: [] }
    }
    // Always advertise multi-browser tools. Bridge path uses cloud peers;
    // native socket path uses local socket-pool profiles (no OAuth required).
    // CLI still handles them in toolCalls.ts before any tool_request.
    // Cast: local tool bag is structurally ListToolsResult-compatible; v2
    // wants literal "object" nested JSON Schema types that our const bag widens.
    return { tools: BROWSER_TOOLS as never }
  })

  server.setRequestHandler(
    'tools/call',
    async (request): Promise<CallToolResult> => {
      logger.info(`[${serverName}] Executing tool: ${request.params.name}`)

      return handleToolCall(
        context,
        socketClient,
        request.params.name,
        request.params.arguments || {},
      )
    },
  )

  socketClient.setNotificationHandler(notification => {
    logger.info(
      `[${serverName}] Forwarding MCP notification: ${notification.method}`,
    )
    server
      .notification({
        method: notification.method,
        params: notification.params,
      })
      .catch(error => {
        // Server may not be connected yet (e.g., during startup or after disconnect)
        logger.info(
          `[${serverName}] Failed to forward MCP notification: ${error.message}`,
        )
      })
  })

  return server
}
