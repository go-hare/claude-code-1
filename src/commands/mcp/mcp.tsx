import React, { useEffect, useRef } from 'react';
import { getIsInteractive } from '../../bootstrap/state.js';
import { MCPSettings } from '../../components/mcp/index.js';
import { MCPReconnect } from '../../components/mcp/MCPReconnect.js';
import { useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSessionWithoutTerminal } from '../../utils/concurrentSessions.js';
import { PluginSettings } from '../plugin/PluginSettings.js';

/** densable Be usage line. */
export const MCP_INLINE_USAGE =
  'Usage: /mcp [reconnect|enable|disable [<server>|all]]. With no server name, applies to all.';

const MCP_INLINE_ACTIONS = new Set(['reconnect', 'enable', 'disable']);

export function formatUnrecognizedMcpAction(action: string): string {
  return `"${action}" isn't a recognized /mcp action. Try reconnect, enable, or disable.`;
}

export const MCP_INLINE_SESSION_UNAVAILABLE = "Reconnect, enable, and disable aren't available in this session.";

export const MCP_INLINE_VIEW_UNAVAILABLE =
  "MCP controls aren't available right now — the terminal is still starting up or is showing another view.";

// TODO: This is a hack to get the context value from toggleMcpServer (useContext only works in a component)
// Ideally, all MCP state and functions would be in global state.
function MCPToggle({
  action,
  target,
  onComplete,
}: {
  action: 'enable' | 'disable';
  target: string;
  onComplete: (result: string) => void;
}): null {
  const mcpClients = useAppState(s => s.mcp.clients);
  const toggleMcpServer = useMcpToggleEnabled();
  const didRun = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const isEnabling = action === 'enable';
    const clients = mcpClients.filter(c => c.name !== 'ide');

    if (target !== 'all') {
      const match = clients.find(c => c.name === target);
      if (!match) {
        onComplete(`MCP server "${target}" not found`);
        return;
      }
      const needsToggle = isEnabling ? match.type === 'disabled' : match.type !== 'disabled';
      if (!needsToggle) {
        onComplete(`MCP server "${target}" is already ${isEnabling ? 'enabled' : 'disabled'}`);
        return;
      }
      void Promise.resolve(toggleMcpServer(match.name))
        .then(() => {
          if (mountedRef.current) {
            onComplete(`MCP server "${target}" ${isEnabling ? 'enabled' : 'disabled'}`);
          }
        })
        .catch(err => {
          if (mountedRef.current) {
            const msg = err instanceof Error ? err.message : String(err);
            onComplete(`Failed to ${action} MCP server "${target}": ${msg}`);
          }
        });
      return;
    }

    const toToggle = clients.filter(c => (isEnabling ? c.type === 'disabled' : c.type !== 'disabled'));
    if (toToggle.length === 0) {
      onComplete(`All MCP servers are already ${isEnabling ? 'enabled' : 'disabled'}`);
      return;
    }

    void Promise.allSettled(toToggle.map(s => toggleMcpServer(s.name))).then(results => {
      if (!mountedRef.current) return;
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const succeeded = results.length - failures.length;
      if (failures.length === 0) {
        onComplete(`${isEnabling ? 'Enabled' : 'Disabled'} ${succeeded} MCP server(s)`);
      } else {
        const firstErr =
          failures[0]!.reason instanceof Error ? failures[0]!.reason.message : String(failures[0]!.reason);
        onComplete(
          `${isEnabling ? 'Enabled' : 'Disabled'} ${succeeded}/${results.length} MCP server(s) (${failures.length} failed: ${firstErr})`,
        );
      }
    });
  }, [action, target, mcpClients, toggleMcpServer, onComplete]);

  return null;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  if (args) {
    const parts = args.trim().split(/\s+/);

    // Allow /mcp no-redirect to bypass the redirect for testing
    if (parts[0] === 'no-redirect') {
      return <MCPSettings onComplete={onDone} />;
    }

    const action = parts[0] ?? '';
    if (action === '') {
      onDone(MCP_INLINE_USAGE, { display: 'system' });
      return null;
    }
    if (!MCP_INLINE_ACTIONS.has(action)) {
      onDone(formatUnrecognizedMcpAction(action), { display: 'system' });
      return null;
    }
    if (!getIsInteractive()) {
      onDone(MCP_INLINE_VIEW_UNAVAILABLE, { display: 'system' });
      return null;
    }

    if (action === 'reconnect') {
      // densable 2.1.289: bare `/mcp reconnect` and `/mcp reconnect all` both mean all
      const target = parts.slice(1).join(' ') || 'all';
      return <MCPReconnect serverName={target} onComplete={onDone} />;
    }

    // densable: enable/disable stay available without terminal (steer without panel)
    if (action === 'enable' || action === 'disable') {
      return (
        <MCPToggle action={action} target={parts.length > 1 ? parts.slice(1).join(' ') : 'all'} onComplete={onDone} />
      );
    }
  }

  // densable 2.1.216 sof/CUt: park needs-input in agent view when bg has no attacher.
  // enable/disable/reconnect above still work (steer without the panel).
  if (isBgSessionWithoutTerminal()) {
    const { parkMcpSettingsNeedsInput } = await import('../../utils/bgCommandNeedsPark.js');
    onDone(await parkMcpSettingsNeedsInput(), { display: 'system' });
    return null;
  }

  // Redirect base /mcp command to /plugins installed tab for ant users
  if (process.env.USER_TYPE === 'ant') {
    return <PluginSettings onComplete={onDone} args="manage" showMcpRedirectMessage />;
  }

  return <MCPSettings onComplete={onDone} />;
}
