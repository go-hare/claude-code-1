import React, { useCallback, useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../commands.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw input for "any key" dismiss and y/n prompt
import { Box, Dialog, LoadingState, Text, useInput } from '@anthropic/ink';
import { getDesktopInstallStatus, openCurrentSessionInDesktop } from '../utils/desktopDeepLink.js';
import { openBrowser } from '../utils/browser.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';

import { requestBgDetach } from '../daemon/rendezvousServer.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { errorMessage } from '../utils/errors.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { flushSessionStorage } from '../utils/sessionStorage.js';

const DESKTOP_DOCS_URL = 'https://clau.de/desktop';

export function getDownloadUrl(): string {
  switch (process.platform) {
    case 'win32':
      return 'https://claude.ai/api/desktop/win32/x64/exe/latest/redirect';
    default:
      return 'https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect';
  }
}

type DesktopHandoffState = 'checking' | 'prompt-download' | 'flushing' | 'opening' | 'success' | 'error';

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

export function DesktopHandoff({ onDone }: Props): React.ReactNode {
  const [state, setState] = useState<DesktopHandoffState>('checking');
  const [error, setError] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string>('');

  const handleCancel = useCallback(() => {
    onDone(`Cancelled. Learn more about Claude Desktop at ${DESKTOP_DOCS_URL}`, { display: 'system' });
  }, [onDone]);

  useInput((input, key) => {
    if (key.escape) {
      return;
    }
    if (key.meta && (input === 'c' || input === 'd')) {
      handleCancel();
      return;
    }
    if (key.ctrl || key.meta) {
      return;
    }
    if (state === 'error') {
      onDone(error ?? 'Unknown error', { display: 'system' });
      return;
    }
    if (state === 'prompt-download') {
      if (input === 'y' || input === 'Y') {
        openBrowser(getDownloadUrl()).catch(() => {});
        onDone(`Starting download. Re-run /desktop once you’ve installed the app.\nLearn more at ${DESKTOP_DOCS_URL}`, {
          display: 'system',
        });
      } else if (input === 'n' || input === 'N') {
        onDone(`The desktop app is required for /desktop. Learn more at ${DESKTOP_DOCS_URL}`, { display: 'system' });
      }
    }
  });

  useEffect(() => {
    async function performHandoff(): Promise<void> {
      setState('checking');
      const installStatus = await getDesktopInstallStatus();

      if (installStatus.status === 'not-installed') {
        setDownloadMessage('Claude Desktop is not installed.');
        setState('prompt-download');
        return;
      }

      if (installStatus.status === 'version-too-old') {
        setDownloadMessage(`Claude Desktop needs to be updated (found v${installStatus.version}, need v1.1.2396+).`);
        setState('prompt-download');
        return;
      }

      try {
        const { beginQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
        beginQuotaAutoResumeHandoff('desktop_handoff');
      } catch {
        /* best-effort */
      }

      setState('flushing');
      await flushSessionStorage();

      setState('opening');
      const result = await openCurrentSessionInDesktop();

      if (!result.success) {
        try {
          const { endQuotaAutoResumeHandoff } = await import('../services/quotaAutoResume.js');
          endQuotaAutoResumeHandoff();
        } catch {
          /* best-effort */
        }
        setError(result.error ?? 'Failed to open Claude Desktop');
        setState('error');
        return;
      }

      setState('success');

      setTimeout(
        async (doneCallback: Props['onDone']) => {
          doneCallback('Session transferred to Claude Desktop', { display: 'system' });
          if (isBgSession()) requestBgDetach({ broadcast: true });
          await gracefulShutdown(0, 'other');
        },
        500,
        onDone,
      );
    }

    performHandoff().catch(err => {
      void import('../services/quotaAutoResume.js')
        .then(({ endQuotaAutoResumeHandoff }) => {
          endQuotaAutoResumeHandoff();
        })
        .catch(() => {});
      setError(errorMessage(err));
      setState('error');
    });
  }, [onDone]);

  if (state === 'error') {
    return (
      <Dialog title="Claude Desktop" onCancel={handleCancel} inputGuide="Press any key to continue…">
        <Box flexDirection="column">
          <Text color="error">Error: {error}</Text>
        </Box>
      </Dialog>
    );
  }

  if (state === 'prompt-download') {
    return (
      <Dialog
        title="Claude Desktop"
        onCancel={handleCancel}
        inputGuide={
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
        }
      >
        <Box flexDirection="column">
          <Text>{downloadMessage}</Text>
          <Text>Download now? (y/n)</Text>
        </Box>
      </Dialog>
    );
  }

  const messages: Record<Exclude<DesktopHandoffState, 'error' | 'prompt-download'>, string> = {
    checking: 'Checking for Claude Desktop…',
    flushing: 'Saving session…',
    opening: 'Opening Claude Desktop…',
    success: 'Opening in Claude Desktop…',
  };

  return <LoadingState message={messages[state]} />;
}
