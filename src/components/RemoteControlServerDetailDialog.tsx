/**
 * densable 2.1.218 B8a — single multi-env Remote Control server detail.
 *
 * SEA ~240782285:
 *   title: server.name
 *   Directory / Spawn mode / Status (running | not running)
 *   options: Restart ${zb()}, Remove, Back
 *   Restart → system: "The background server picks up config changes
 *     automatically — no restart needed."
 *   Remove → ba cancelFirst/focus cancel:
 *     title "Remove server?"
 *     subtitle "Stop serving ${dir} to claude.ai. The ${zb()} will stop
 *       the worker on its next reconcile."
 *     Yes, remove / No, cancel → jpn(dir)
 */

import * as React from 'react';
import { useCallback, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from './CustomSelect/select.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { PermissionDialog } from './permissions/PermissionDialog.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
import {
  backgroundServiceLabel,
  removeRemoteControlServer,
  type RemoteControlServerView,
} from '../bridge/remoteControlServers.js';
import { errorMessage } from '../utils/errors.js';

export const RC_REMOVE_SERVER_TITLE = 'Remove server?';
export const RC_REMOVE_SERVER_CONFIRM = 'Yes, remove';
export const RC_REMOVE_SERVER_CANCEL = 'No, cancel';
export const RC_RESTART_NOOP_MESSAGE =
  'The background server picks up config changes automatically — no restart needed.';

export function formatRcRemoveServerSubtitle(dir: string, serviceLabel: string = backgroundServiceLabel()): string {
  return `Stop serving ${dir} to claude.ai. The ${serviceLabel} will stop the worker on its next reconcile.`;
}

type Props = {
  server: RemoteControlServerView;
  onBack: () => void;
  onDone: (result?: string, options?: { display?: 'system' | 'skip' }) => void;
  /** densable refresh after remove — parent reloads list */
  refresh?: () => void | Promise<void>;
};

type Phase = 'detail' | 'confirm-remove';

export function RemoteControlServerDetailDialog({ server, onBack, onDone, refresh }: Props): React.ReactNode {
  useRegisterOverlay('remote-control-server-detail');
  const [phase, setPhase] = useState<Phase>('detail');
  const [busy, setBusy] = useState(false);

  const runAction = useCallback(
    async (action: 'restart' | 'remove') => {
      if (busy) return;
      setBusy(true);
      try {
        if (action === 'remove') {
          removeRemoteControlServer(server.dir);
          await refresh?.();
          onDone(`Removed remote-control server for ${server.dir}.`, {
            display: 'system',
          });
          return;
        }
        // densable restart: no hard restart — config reconcile is automatic
        onDone(RC_RESTART_NOOP_MESSAGE, { display: 'system' });
      } catch (err) {
        onDone(`Action failed: ${errorMessage(err)}`, { display: 'system' });
      } finally {
        setBusy(false);
      }
    },
    [busy, onDone, refresh, server.dir],
  );

  if (phase === 'confirm-remove') {
    const trustOptions: OptionWithDescription<'yes' | 'no'>[] = [
      {
        label: RC_REMOVE_SERVER_CANCEL,
        description: 'Keep this Remote Control server.',
        value: 'no',
      },
      {
        label: RC_REMOVE_SERVER_CONFIRM,
        description: 'Remove this directory from multi-env Remote Control.',
        value: 'yes',
      },
    ];
    return (
      <PermissionDialog
        title={RC_REMOVE_SERVER_TITLE}
        subtitle={formatRcRemoveServerSubtitle(server.dir)}
        color="error"
      >
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
          <Box>
            <Select
              options={trustOptions}
              defaultValue={'no'}
              isDisabled={busy}
              onChange={v => {
                if (v === 'yes') void runAction('remove');
                else setPhase('detail');
              }}
              onCancel={() => setPhase('detail')}
            />
          </Box>
        </Box>
      </PermissionDialog>
    );
  }

  const service = backgroundServiceLabel();
  const detailOptions: OptionWithDescription<'restart' | 'remove' | 'back'>[] = [
    {
      label: `Restart ${service}`,
      description: 'Config changes are picked up automatically.',
      value: 'restart',
    },
    {
      label: 'Remove',
      description: 'Stop serving this directory to claude.ai.',
      value: 'remove',
    },
    {
      label: 'Back',
      description: 'Return to the server list.',
      value: 'back',
    },
  ];

  const statusLabel = server.isRunning ? 'running' : 'not running';
  const statusColor = server.isRunning ? 'success' : undefined;

  return (
    <PermissionDialog title={server.name}>
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>Directory {server.dir}</Text>
          <Text dimColor>Spawn mode {server.spawnMode}</Text>
          <Text dimColor>
            Status{'     '}
            <Text color={statusColor}>{statusLabel}</Text>
          </Text>
        </Box>
        <Box>
          <Select
            options={detailOptions}
            isDisabled={busy}
            onChange={v => {
              if (v === 'back') {
                onBack();
                return;
              }
              if (v === 'remove') {
                setPhase('confirm-remove');
                return;
              }
              void runAction('restart');
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
