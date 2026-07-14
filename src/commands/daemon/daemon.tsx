import * as React from 'react';
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js';
import { DaemonInstallDialog, type DaemonInstallDialogChoice } from '../../components/DaemonInstallDialog.js';
import { setDaemonInstallPromptDismissed } from '../../daemon/installPrompt.js';

/**
 * /daemon slash command — manages daemon and background sessions from the REPL.
 *
 * Subcommands: status | start | install | uninstall | stop | bg | attach | logs | kill
 * Default (no args): status
 *
 * `install` with no flags shows the official cold-start Dialog denser
 * (yes / once / never / no). `install --yes` skips the Dialog and installs.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const parts = args ? args.trim().split(/\s+/) : [];
  const sub = parts[0] || 'status';

  // attach is interactive/blocking — not available inside the REPL
  if (sub === 'attach') {
    onDone('Use `claude daemon attach` from the CLI. Attach is not available inside the REPL.', { display: 'system' });
    return null;
  }

  // Official denser Dialog for install (unless --yes).
  if (sub === 'install' && !parts.includes('--yes')) {
    return (
      <DaemonInstallDialog
        onChoice={choice => {
          void handleInstallChoice(choice, onDone);
        }}
      />
    );
  }

  // For all other subcommands, capture console output and return via onDone
  const lines = await captureConsole(async () => {
    if (sub === 'bg') {
      const bg = await import('../../cli/bg.js');
      await bg.handleBgStart(parts.slice(1));
    } else {
      const { daemonMain } = await import('../../daemon/main.js');
      // Strip --yes for install so daemonMain sees plain install
      const rest = sub === 'install' ? parts.slice(1).filter(p => p !== '--yes') : parts.slice(1);
      await daemonMain([sub, ...rest]);
    }
  });

  onDone(lines.join('\n') || 'Done.', { display: 'system' });
  return null;
}

async function handleInstallChoice(choice: DaemonInstallDialogChoice, onDone: LocalJSXCommandOnDone): Promise<void> {
  switch (choice) {
    case 'yes': {
      const lines = await captureConsole(async () => {
        const { daemonMain } = await import('../../daemon/main.js');
        await daemonMain(['install']);
      });
      onDone(lines.join('\n') || 'Installed.', { display: 'system' });
      return;
    }
    case 'once': {
      const lines = await captureConsole(async () => {
        const { startBgManager } = await import('../../daemon/bgManager.js');
        await startBgManager({ onLog: () => {} });
        console.log('Started transient daemon for this session.');
      });
      onDone(lines.join('\n') || 'Transient daemon started.', {
        display: 'system',
      });
      return;
    }
    case 'never': {
      setDaemonInstallPromptDismissed(true);
      const lines = await captureConsole(async () => {
        const { startBgManager } = await import('../../daemon/bgManager.js');
        await startBgManager({ onLog: () => {} });
        console.log("Won't ask again. Started transient daemon for this session.");
      });
      onDone(lines.join('\n') || 'Dismissed install prompt.', {
        display: 'system',
      });
      return;
    }
    case 'no':
    default:
      onDone('Daemon install cancelled.', { display: 'system' });
  }
}

async function captureConsole(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return lines;
}
