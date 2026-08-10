import type { Command } from '../../../commands.js';
import { formatFailedMcpReconnectIssue } from '../../../services/mcp/mcpConnectionIssue.js';
import type { MCPServerConnection, ServerResource } from '../../../services/mcp/types.js';
import type { Tool } from '../../../Tool.js';

export interface ReconnectResult {
  message: string;
  success: boolean;
}

/**
 * Handles the result of a reconnect attempt and returns an appropriate user message
 */
export function handleReconnectResult(
  result: {
    client: MCPServerConnection;
    tools: Tool[];
    commands: Command[];
    resources?: ServerResource[];
  },
  serverName: string,
  options?: { hasHeadersHelper?: boolean },
): ReconnectResult {
  switch (result.client.type) {
    case 'connected':
      // densable ati: discoveryBearerRejected / toolsListError on connected
      if (result.client.discoveryBearerRejected) {
        return {
          message: `Reconnected to ${serverName}, but your claude.ai session token was rejected. Run /login, then reconnect.`,
          success: false,
        };
      }
      if (result.client.toolsListError) {
        return {
          message: `Reconnected to ${serverName}, but fetching tools failed: ${result.client.toolsListError}`,
          success: false,
        };
      }
      return {
        message: `Reconnected to ${serverName}.`,
        success: true,
      };

    case 'needs-auth':
      // densable ati needs-auth arm — headersHelper-aware copy
      return {
        message: options?.hasHeadersHelper
          ? `${serverName} requires authentication. Use 'Authenticate' if the upstream server uses OAuth, or check the headersHelper script and use 'Reconnect'.`
          : `${serverName} requires authentication. Use the 'Authenticate' option.`,
        success: false,
      };

    case 'failed': {
      // densable 2.1.219 `Ujo` / Bjo failed arm — include HTTP/error detail.
      const detail = formatFailedMcpReconnectIssue(result.client);
      return {
        message: detail ? `Failed to reconnect to ${serverName}: ${detail}` : `Failed to reconnect to ${serverName}.`,
        success: false,
      };
    }

    default:
      return {
        message: `Unknown result when reconnecting to ${serverName}.`,
        success: false,
      };
  }
}

/**
 * Handles errors from reconnect attempts
 */
export function handleReconnectError(error: unknown, serverName: string): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return `Error reconnecting to ${serverName}: ${errorMessage}`;
}
