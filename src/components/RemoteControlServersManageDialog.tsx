/**
 * densable 2.1.218 multi-env Remote Control list → detail (DaemonHub Remote Control tab subset).
 *
 * densable OGa kind=remoteControl:
 *   rows from $Lf (dir/name/spawnMode/isRunning)
 *   empty: "(no remoteControls)" style empty
 *   + Add new remoteControl…
 *   select row → B8a detail
 */

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from './CustomSelect/select.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { PermissionDialog } from './permissions/PermissionDialog.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
import { listRemoteControlServersWithStatus, type RemoteControlServerView } from '../bridge/remoteControlServers.js';
import { RemoteControlServerDetailDialog } from './RemoteControlServerDetailDialog.js';
import { RemoteControlAddServerDialog } from './RemoteControlAddServerDialog.js';
import { errorMessage } from '../utils/errors.js';

type Props = {
  onDone: (result?: string, options?: { display?: 'system' | 'skip' }) => void;
  /** Optional preselect by dir substring / name (from slash args). */
  filter?: string;
};

type Phase =
  | { type: 'loading' }
  | { type: 'list' }
  | { type: 'detail'; server: RemoteControlServerView }
  | { type: 'add' }
  | { type: 'error'; message: string };

export function RemoteControlServersManageDialog({ onDone, filter }: Props): React.ReactNode {
  useRegisterOverlay('remote-control-servers-manage');
  const [phase, setPhase] = useState<Phase>({ type: 'loading' });
  const [servers, setServers] = useState<RemoteControlServerView[]>([]);

  const reload = useCallback(async () => {
    try {
      const all = await listRemoteControlServersWithStatus();
      const f = filter?.trim();
      const shown = f ? all.filter(e => e.dir.includes(f) || e.name.includes(f)) : all;
      setServers(shown);
      setPhase({ type: 'list' });
    } catch (err) {
      setPhase({ type: 'error', message: errorMessage(err) });
    }
  }, [filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (phase.type === 'loading') {
    return (
      <PermissionDialog title="Remote Control">
        <Box paddingX={2} paddingY={1}>
          <Text dimColor>Loading…</Text>
        </Box>
      </PermissionDialog>
    );
  }

  if (phase.type === 'error') {
    return (
      <PermissionDialog title="Remote Control" color="error">
        <Box paddingX={2} paddingY={1}>
          <Text color="error">{phase.message}</Text>
        </Box>
      </PermissionDialog>
    );
  }

  if (phase.type === 'detail') {
    return (
      <RemoteControlServerDetailDialog
        server={phase.server}
        onBack={() => {
          void reload();
        }}
        onDone={onDone}
        refresh={reload}
      />
    );
  }

  if (phase.type === 'add') {
    return (
      <RemoteControlAddServerDialog
        onDone={result => {
          if (result === 'cancelled') {
            void reload();
            return;
          }
          void reload();
        }}
      />
    );
  }

  // list
  const options: OptionWithDescription<string>[] = [
    ...servers.map(s => ({
      label: s.name,
      description: `${s.dir} · ${s.spawnMode} · ${s.isRunning ? 'running' : 'not running'}`,
      value: `server:${s.dir}`,
    })),
    {
      label: '+ Add new remoteControl…',
      description: 'New Remote Control server (trust gate + config)',
      value: 'add',
    },
    {
      label: 'Done',
      description: 'Close this dialog',
      value: 'done',
    },
  ];

  return (
    <PermissionDialog title="Remote Control">
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        {servers.length === 0 ? (
          <Text dimColor>
            {filter?.trim() ? `  (no remoteControls match ${JSON.stringify(filter.trim())})` : '  (no remoteControls)'}
          </Text>
        ) : null}
        <Box>
          <Select
            options={options}
            onChange={v => {
              if (v === 'done') {
                onDone(undefined, { display: 'skip' });
                return;
              }
              if (v === 'add') {
                setPhase({ type: 'add' });
                return;
              }
              if (v.startsWith('server:')) {
                const dir = v.slice('server:'.length);
                const server = servers.find(s => s.dir === dir);
                if (server) setPhase({ type: 'detail', server });
              }
            }}
            onCancel={() => onDone(undefined, { display: 'skip' })}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
