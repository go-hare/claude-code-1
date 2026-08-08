/**
 * densable 2.1.218 LGa / HGa / OGa — full DaemonHub product shell.
 *
 * SEA ~240799772–240811400:
 *   title: "Claude daemon"
 *   tabs: Scheduled | Remote Control  (Qx Tabs, color permission)
 *   state machine: hub | detail-scheduled | detail-remoteControl | new
 *   OGa empty: `  (no ${roi[kind]}s)` → "(no scheduled tasks)" / "(no remote-control servers)"
 *   OGa add: `+ Add new ${roi[kind]}…`
 *   service footer (when available): Uninstall service / Stop
 *   detail-scheduled → mGa; detail-remoteControl → B8a
 *
 * Local adapters:
 *   tasks ← listAllCronTasks / scheduled_tasks.json
 *   servers ← listRemoteControlServersWithStatus
 *   service actions ← daemonMain(['uninstall'|'stop'])
 */

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Box, Text, Pane, Tab, Tabs } from '@anthropic/ink';
import { Select } from '../CustomSelect/select.js';
import type { OptionWithDescription } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { type CronTask, isCronTaskEnabled, listAllCronTasks } from '../../utils/cronTasks.js';
import { cronToHuman } from '../../utils/cron.js';
import { listRemoteControlServersWithStatus, type RemoteControlServerView } from '../../bridge/remoteControlServers.js';
import { RemoteControlServerDetailDialog } from '../RemoteControlServerDetailDialog.js';
import { RemoteControlAddServerDialog } from '../RemoteControlAddServerDialog.js';
import { ScheduledTaskDetailDialog } from './ScheduledTaskDetailDialog.js';
import { ScheduledTaskFormDialog } from './ScheduledTaskFormDialog.js';
import { errorMessage } from '../../utils/errors.js';

/** densable roi map */
export const DAEMON_HUB_KIND_LABEL = {
  scheduled: 'scheduled task',
  remoteControl: 'remote-control server',
} as const;

export const DAEMON_HUB_TITLE = 'Claude daemon';
export const DAEMON_HUB_TAB_SCHEDULED = 'Scheduled';
export const DAEMON_HUB_TAB_REMOTE = 'Remote Control';
export const DAEMON_SERVICE_UNINSTALL = 'Uninstall service';
export const DAEMON_SERVICE_STOP = 'Stop';

export type DaemonHubData = {
  tasks: CronTask[];
  servers: RemoteControlServerView[];
};

/** densable HGa data load (tasks + servers; lock/status optional soft). */
export async function loadDaemonHubData(): Promise<DaemonHubData> {
  const [tasks, servers] = await Promise.all([
    listAllCronTasks().catch(() => [] as CronTask[]),
    listRemoteControlServersWithStatus().catch(() => [] as RemoteControlServerView[]),
  ]);
  return { tasks, servers };
}

type Props = {
  onDone: (result?: string, options?: { display?: 'system' | 'skip' }) => void;
  /** densable initialData from HGa — optional for tests */
  initialData?: DaemonHubData;
  /** densable selectedTab default scheduled */
  defaultTab?: 'scheduled' | 'remoteControl';
};

type Nav =
  | { type: 'hub' }
  | { type: 'detail-scheduled'; entry: CronTask }
  | { type: 'detail-remoteControl'; entry: RemoteControlServerView }
  | { type: 'new'; kind: 'scheduled' | 'remoteControl'; prefill?: CronTask };

export function DaemonHubDialog({ onDone, initialData, defaultTab = 'scheduled' }: Props): React.ReactNode {
  useRegisterOverlay('daemon-hub');
  const [data, setData] = useState<DaemonHubData | null>(initialData ?? null);
  const [nav, setNav] = useState<Nav>({ type: 'hub' });
  const [selectedTab, setSelectedTab] = useState<string>(
    defaultTab === 'remoteControl' ? 'Remote Control' : 'Scheduled',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await loadDaemonHubData();
      setData(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      void reload();
    }
  }, [initialData, reload]);

  const backToHub = useCallback(() => {
    void reload();
    setNav({ type: 'hub' });
  }, [reload]);

  const runService = useCallback(
    async (action: 'uninstall' | 'stop') => {
      if (busy) return;
      setBusy(true);
      setMessage(null);
      try {
        const { daemonMain } = await import('../../daemon/main.js');
        // capture console like /daemon text path
        const lines: string[] = [];
        const origLog = console.log;
        const origErr = console.error;
        console.log = (...a: unknown[]) => lines.push(a.map(String).join(' '));
        console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
        try {
          await daemonMain([action]);
        } finally {
          console.log = origLog;
          console.error = origErr;
        }
        setMessage(lines.join('\n') || `${action} done.`);
        await reload();
      } catch (err) {
        setMessage(`${action} failed: ${errorMessage(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, reload],
  );

  if (nav.type === 'detail-scheduled') {
    return (
      <ScheduledTaskDetailDialog
        task={nav.entry}
        onBack={backToHub}
        onEdit={task => setNav({ type: 'new', kind: 'scheduled', prefill: task })}
        onDone={onDone}
        refresh={reload}
      />
    );
  }

  if (nav.type === 'detail-remoteControl') {
    return <RemoteControlServerDetailDialog server={nav.entry} onBack={backToHub} onDone={onDone} refresh={reload} />;
  }

  if (nav.type === 'new') {
    if (nav.kind === 'remoteControl') {
      return (
        <RemoteControlAddServerDialog
          onDone={result => {
            if (result === 'cancelled') {
              backToHub();
              return;
            }
            backToHub();
          }}
        />
      );
    }
    return (
      <ScheduledTaskFormDialog
        existingIds={(data?.tasks ?? []).map(t => t.id)}
        prefill={nav.prefill}
        onCancel={backToHub}
        onDone={onDone}
        onSaved={async () => {
          await reload();
          setNav({ type: 'hub' });
        }}
      />
    );
  }

  // hub
  if (!data && !loadError) {
    return (
      <PermissionDialog title={DAEMON_HUB_TITLE}>
        <Box paddingX={2} paddingY={1}>
          <Text dimColor>Loading…</Text>
        </Box>
      </PermissionDialog>
    );
  }

  if (loadError && !data) {
    return (
      <PermissionDialog title={DAEMON_HUB_TITLE} color="error">
        <Box paddingX={2} paddingY={1}>
          <Text color="error">{loadError}</Text>
        </Box>
      </PermissionDialog>
    );
  }

  const tasks = data?.tasks ?? [];
  const servers = data?.servers ?? [];

  const scheduledOptions: OptionWithDescription<string>[] = [
    ...tasks.map(t => {
      const en = isCronTaskEnabled(t);
      return {
        label: t.id,
        description: `${t.cron} (${cronToHuman(t.cron)}) · ${en ? 'enabled' : 'disabled'} · ${t.prompt.slice(0, 48)}`,
        value: `task:${t.id}`,
      };
    }),
    {
      label: `+ Add new ${DAEMON_HUB_KIND_LABEL.scheduled}…`,
      description: 'Fire a prompt on a recurring schedule',
      value: 'add-scheduled',
    },
    {
      label: DAEMON_SERVICE_UNINSTALL,
      description: 'Remove the background service (launchctl/systemd).',
      value: 'service:uninstall',
    },
    {
      label: DAEMON_SERVICE_STOP,
      description: 'Shut down the supervisor and background sessions.',
      value: 'service:stop',
    },
    {
      label: 'Done',
      description: 'Close DaemonHub',
      value: 'done',
    },
  ];

  const remoteOptions: OptionWithDescription<string>[] = [
    ...servers.map(s => ({
      label: s.name,
      description: `${s.dir} · ${s.spawnMode} · ${s.isRunning ? 'running' : 'not running'}`,
      value: `server:${s.dir}`,
    })),
    {
      label: `+ Add new ${DAEMON_HUB_KIND_LABEL.remoteControl}…`,
      description: 'New Remote Control server (trust gate + config)',
      value: 'add-remote',
    },
    {
      label: DAEMON_SERVICE_UNINSTALL,
      description: 'Remove the background service (launchctl/systemd).',
      value: 'service:uninstall',
    },
    {
      label: DAEMON_SERVICE_STOP,
      description: 'Shut down the supervisor and background sessions.',
      value: 'service:stop',
    },
    {
      label: 'Done',
      description: 'Close DaemonHub',
      value: 'done',
    },
  ];

  const onSelect = (v: string) => {
    if (v === 'done') {
      onDone(undefined, { display: 'skip' });
      return;
    }
    if (v === 'add-scheduled') {
      setNav({ type: 'new', kind: 'scheduled' });
      return;
    }
    if (v === 'add-remote') {
      setNav({ type: 'new', kind: 'remoteControl' });
      return;
    }
    if (v === 'service:uninstall') {
      void runService('uninstall');
      return;
    }
    if (v === 'service:stop') {
      void runService('stop');
      return;
    }
    if (v.startsWith('task:')) {
      const id = v.slice('task:'.length);
      const entry = tasks.find(t => t.id === id);
      if (entry) setNav({ type: 'detail-scheduled', entry });
      return;
    }
    if (v.startsWith('server:')) {
      const dir = v.slice('server:'.length);
      const entry = servers.find(s => s.dir === dir);
      if (entry) setNav({ type: 'detail-remoteControl', entry });
    }
  };

  return (
    <Pane color="permission">
      <Tabs
        color="permission"
        title={DAEMON_HUB_TITLE}
        selectedTab={selectedTab}
        onTabChange={setSelectedTab}
        initialHeaderFocused={false}
      >
        <Tab key="scheduled" title={DAEMON_HUB_TAB_SCHEDULED}>
          <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
            {tasks.length === 0 ? <Text dimColor>{`  (no ${DAEMON_HUB_KIND_LABEL.scheduled}s)`}</Text> : null}
            {message ? <Text dimColor>{busy ? 'working…' : message}</Text> : null}
            <Select
              options={scheduledOptions}
              isDisabled={busy}
              onChange={onSelect}
              onCancel={() => onDone(undefined, { display: 'skip' })}
            />
          </Box>
        </Tab>
        <Tab key="remoteControl" title={DAEMON_HUB_TAB_REMOTE}>
          <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
            {servers.length === 0 ? <Text dimColor>{`  (no ${DAEMON_HUB_KIND_LABEL.remoteControl}s)`}</Text> : null}
            {message ? <Text dimColor>{busy ? 'working…' : message}</Text> : null}
            <Select
              options={remoteOptions}
              isDisabled={busy}
              onChange={onSelect}
              onCancel={() => onDone(undefined, { display: 'skip' })}
            />
          </Box>
        </Tab>
      </Tabs>
    </Pane>
  );
}
