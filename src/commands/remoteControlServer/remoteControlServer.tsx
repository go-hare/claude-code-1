import { type ChildProcess } from 'child_process';
import { resolve } from 'path';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getBridgeDisabledReason } from '../../bridge/bridgeEnabled.js';
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js';
import { BRIDGE_LOGIN_INSTRUCTION } from '../../bridge/types.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { ListItem } from '../../components/design-system/ListItem.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { buildCliLaunch, spawnCli } from '../../utils/cliLaunch.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { errorMessage } from '../../utils/errors.js';
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js';

type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

type Props = {
  onDone: LocalJSXCommandOnDone;
};

/**
 * /remote-control-server command — manages the daemon-backed persistent bridge server.
 *
 * When invoked, it starts the daemon supervisor as a child process, which in
 * turn spawns remoteControl workers that run headless bridge loops. The server
 * accepts multiple concurrent remote sessions.
 *
 * If the server is already running, shows a management dialog with status
 * and options to stop or continue.
 */

type RemoteControlServerHostState = {
  daemonProcess: ChildProcess | null;
  daemonStatus: ServerStatus;
  daemonLogs: string[];
};

const remoteControlServerHostSlot = new HostSlot<RemoteControlServerHostState>(() => ({
  daemonProcess: null,
  daemonStatus: 'stopped',
  daemonLogs: [],
}));

function getRemoteControlServerHostState(): RemoteControlServerHostState {
  return remoteControlServerHostSlot.of(getBootstrapSessionHost());
}

const MAX_LOG_LINES = 50;

function RemoteControlServer({ onDone }: Props): React.ReactNode {
  const hostState = getRemoteControlServerHostState();
  const [status, setStatus] = useState<ServerStatus>(hostState.daemonStatus);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If already running, show management dialog
    if (hostState.daemonProcess && !hostState.daemonProcess.killed) {
      setStatus('running');
      return;
    }

    let cancelled = false;
    void (async () => {
      // Pre-flight checks
      const checkError = await checkPrerequisites();
      if (cancelled) return;
      if (checkError) {
        onDone(checkError, { display: 'system' });
        return;
      }

      // Start the daemon
      setStatus('starting');
      try {
        startDaemon(hostState);
        if (!cancelled) {
          setStatus('running');
          hostState.daemonStatus = 'running';
          onDone('Remote Control Server started. Use /remote-control-server to manage.', { display: 'system' });
        }
      } catch (err) {
        if (!cancelled) {
          const msg = errorMessage(err);
          setStatus('error');
          setError(msg);
          hostState.daemonStatus = 'error';
          onDone(`Remote Control Server failed to start: ${msg}`, {
            display: 'system',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'running' && hostState.daemonProcess && !hostState.daemonProcess.killed) {
    return <ServerManagementDialog onDone={onDone} />;
  }

  if (status === 'error' && error) {
    return null;
  }

  return null;
}

/**
 * Dialog shown when /remote-control-server is used while the daemon is running.
 */
function ServerManagementDialog({ onDone }: Props): React.ReactNode {
  useRegisterOverlay('remote-control-server-dialog');
  const hostState = getRemoteControlServerHostState();
  const [focusIndex, setFocusIndex] = useState(2);

  const logPreview = hostState.daemonLogs.slice(-5);

  function handleStop(): void {
    stopDaemon(hostState);
    onDone('Remote Control Server stopped.', { display: 'system' });
  }

  function handleRestart(): void {
    stopDaemon(hostState);
    try {
      startDaemon(hostState);
      onDone('Remote Control Server restarted.', { display: 'system' });
    } catch (err) {
      onDone(`Failed to restart: ${errorMessage(err)}`, { display: 'system' });
    }
  }

  function handleContinue(): void {
    onDone(undefined, { display: 'skip' });
  }

  const ITEM_COUNT = 3;

  useKeybindings(
    {
      'select:next': () => setFocusIndex(i => (i + 1) % ITEM_COUNT),
      'select:previous': () => setFocusIndex(i => (i - 1 + ITEM_COUNT) % ITEM_COUNT),
      'select:accept': () => {
        if (focusIndex === 0) {
          handleStop();
        } else if (focusIndex === 1) {
          handleRestart();
        } else {
          handleContinue();
        }
      },
    },
    { context: 'Select' },
  );

  return (
    <Dialog title="Remote Control Server" onCancel={handleContinue} hideInputGuide>
      <Box flexDirection="column" gap={1}>
        <Text>
          Remote Control Server is{' '}
          <Text bold color="success">
            running
          </Text>
          {hostState.daemonProcess ? ` (PID: ${hostState.daemonProcess.pid})` : ''}
        </Text>
        {logPreview.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Recent logs:</Text>
            {logPreview.map((line, i) => (
              <Text key={i} dimColor>
                {line}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <ListItem isFocused={focusIndex === 0}>
            <Text>Stop server</Text>
          </ListItem>
          <ListItem isFocused={focusIndex === 1}>
            <Text>Restart server</Text>
          </ListItem>
          <ListItem isFocused={focusIndex === 2}>
            <Text>Continue</Text>
          </ListItem>
        </Box>
        <Text dimColor>Enter to select · Esc to continue</Text>
      </Box>
    </Dialog>
  );
}

/**
 * Check prerequisites for starting the Remote Control Server.
 */
async function checkPrerequisites(): Promise<string | null> {
  const disabledReason = await getBridgeDisabledReason();
  if (disabledReason) {
    return disabledReason;
  }

  if (!getBridgeAccessToken()) {
    return BRIDGE_LOGIN_INSTRUCTION;
  }

  return null;
}

/**
 * Start the daemon supervisor as a child process.
 */
function startDaemon(hostState: RemoteControlServerHostState = getRemoteControlServerHostState()): void {
  const dir = resolve('.');

  const launch = buildCliLaunch(['daemon', 'start', `--dir=${dir}`]);

  const child = spawnCli(launch, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  hostState.daemonProcess = child;
  hostState.daemonLogs = [];

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      hostState.daemonLogs.push(line);
      if (hostState.daemonLogs.length > MAX_LOG_LINES) {
        hostState.daemonLogs.shift();
      }
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      hostState.daemonLogs.push(`[err] ${line}`);
      if (hostState.daemonLogs.length > MAX_LOG_LINES) {
        hostState.daemonLogs.shift();
      }
    }
  });

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (hostState.daemonProcess === child) {
      hostState.daemonProcess = null;
      hostState.daemonStatus = 'stopped';
    }
    hostState.daemonLogs.push(`[daemon] exited (code=${code ?? 'unknown'}, signal=${signal})`);
  });

  child.on('error', (err: Error) => {
    if (hostState.daemonProcess === child) {
      hostState.daemonProcess = null;
      hostState.daemonStatus = 'error';
    }
    hostState.daemonLogs.push(`[daemon] error: ${err.message}`);
  });
}

/**
 * Stop the daemon supervisor.
 */
function stopDaemon(hostState: RemoteControlServerHostState = getRemoteControlServerHostState()): void {
  const proc = hostState.daemonProcess;
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    // Force kill after 10s grace
    const pid = proc.pid;
    const timer = setTimeout(() => {
      try {
        if (pid) process.kill(pid, 0); // Check if still alive
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {
        // Process already gone
      }
    }, 10_000);
    timer.unref?.();
  }
  hostState.daemonProcess = null;
  hostState.daemonStatus = 'stopped';
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
): Promise<React.ReactNode> {
  return <RemoteControlServer onDone={onDone} />;
}
