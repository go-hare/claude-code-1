/**
 * densable Kmy / znu — chrome_install_setup + chrome_install_upsell Host renderers.
 *
 * Gold 2.1.239: Kmy reads {phase, installPageOpened} and answers
 * continue | keep_waiting | skip | cancelled. znu ignores payload, logs
 * tengu_chrome_install_upsell_shown, answers install | not_now |
 * dont_ask_again | cancelled. THr=250.
 *
 * This is Host UI only. Wait-loop, nvt(c0e), and
 * chromeInstallUpsellDismissed live in installUpsell.ts (HAVE).
 * Do not invent them here.
 */
import React, { useEffect, useRef } from 'react';
import { Box, Dialog, StatusIcon, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';
import { logEvent } from '../../services/analytics/index.js';

/** densable THr — shared by Kmy + znu */
export const CHROME_INSTALL_ANSWER_DEBOUNCE_MS = 250;

/** densable c0e — waiting_install helper when installPageOpened is false */
export const CHROME_EXTENSION_INSTALL_URL = 'https://claude.ai/chrome';

export type ChromeInstallSetupPhase = 'waiting_install' | 'connecting' | 'stalled' | 'connected' | 'failed';

export type ChromeInstallSetupResult = 'continue' | 'keep_waiting' | 'skip' | 'cancelled';

export type ChromeInstallSetupPayload = {
  phase: ChromeInstallSetupPhase;
  installPageOpened: boolean;
};

export type ChromeInstallUpsellResult = 'install' | 'not_now' | 'dont_ask_again' | 'cancelled';

const SETUP_PHASES: readonly ChromeInstallSetupPhase[] = [
  'waiting_install',
  'connecting',
  'stalled',
  'connected',
  'failed',
];

export function isChromeInstallSetupPhase(value: unknown): value is ChromeInstallSetupPhase {
  return typeof value === 'string' && (SETUP_PHASES as readonly string[]).includes(value);
}

/** densable Unu */
export const CHROME_INSTALL_SKIP_OPTION = {
  value: 'skip' as const,
  label: 'Continue without browser tools',
  description: 'Finish setup later with /chrome',
};

/** densable Xmy */
export const CHROME_INSTALL_UPSELL_OPTIONS = [
  {
    value: 'install' as const,
    label: 'Install extension',
    description: 'Opens the install page in Chrome',
  },
  {
    value: 'not_now' as const,
    label: 'Not now',
    description: 'Continue without browser tools',
  },
  {
    value: 'dont_ask_again' as const,
    label: "Don't ask again",
    description: 'Revisit anytime with /chrome',
  },
];

/** densable Kmy option set — connected → continue+skip; stalled → keep_waiting+skip; else skip */
export function chromeInstallSetupOptions(phase: ChromeInstallSetupPhase): Array<{
  value: 'continue' | 'keep_waiting' | 'skip';
  label: string;
  description: string;
}> {
  if (phase === 'connected') {
    return [
      {
        value: 'continue',
        label: 'Continue with browser tools',
        description: 'Claude picks the task back up in your browser',
      },
      CHROME_INSTALL_SKIP_OPTION,
    ];
  }
  if (phase === 'stalled') {
    return [
      {
        value: 'keep_waiting',
        label: 'Keep waiting',
        description: 'Setup keeps checking for the connection',
      },
      CHROME_INSTALL_SKIP_OPTION,
    ];
  }
  return [CHROME_INSTALL_SKIP_OPTION];
}

function connectStatus(phase: ChromeInstallSetupPhase): 'success' | 'error' | 'loading' | 'pending' {
  if (phase === 'connected') return 'success';
  if (phase === 'failed') return 'error';
  if (phase !== 'waiting_install') return 'loading';
  return 'pending';
}

type SetupProps = {
  payload: ChromeInstallSetupPayload;
  onAnswer: (result: ChromeInstallSetupResult) => void;
};

/** densable Kmy */
export function ChromeInstallSetupDialog({ payload, onAnswer }: SetupProps): React.ReactNode {
  const { phase, installPageOpened } = payload;
  const phaseRef = useRef(phase);
  const openedAtRef = useRef(Date.now());
  if (phaseRef.current !== phase) {
    phaseRef.current = phase;
    openedAtRef.current = Date.now();
  }

  function answer(result: ChromeInstallSetupResult): void {
    if (Date.now() - openedAtRef.current < CHROME_INSTALL_ANSWER_DEBOUNCE_MS) return;
    onAnswer(result);
  }

  const installDone = phase !== 'waiting_install';
  const options = chromeInstallSetupOptions(phase);

  return (
    <Dialog color="permission" title="Setting up Claude in Chrome" onCancel={() => answer('cancelled')}>
      <Box flexDirection="column" marginTop={1} paddingX={1} gap={1}>
        {phase !== 'connected' && phase !== 'failed' && (
          <Text dimColor>
            Finish setup in Chrome. This screen follows along and updates on its own as each step completes.
          </Text>
        )}
        <Box flexDirection="column">
          <Text>
            <StatusIcon status={installDone ? 'success' : 'loading'} withSpace />
            Install the extension
          </Text>
          {!installDone && (
            <Box paddingLeft={3}>
              <Text dimColor>
                {installPageOpened
                  ? 'Add Claude in Chrome from the page that just opened in Chrome.'
                  : `Add Claude in Chrome from ${CHROME_EXTENSION_INSTALL_URL}.`}
              </Text>
            </Box>
          )}
          <Text>
            <StatusIcon status={connectStatus(phase)} withSpace />
            Connect to Chrome
          </Text>
          {phase === 'stalled' && (
            <Box paddingLeft={3}>
              <Text dimColor>
                Taking longer than expected. Check that the extension is added and that you're signed in to it in
                Chrome.
              </Text>
            </Box>
          )}
          {phase === 'failed' && (
            <Box paddingLeft={3}>
              <Text dimColor>Couldn't connect to the extension. Finish setup later with /chrome.</Text>
            </Box>
          )}
          {phase === 'connected' && (
            <Box paddingLeft={3}>
              <Text dimColor>
                Browser tools are ready. Continuing keeps them enabled for future sessions too — manage anytime with
                /chrome.
              </Text>
            </Box>
          )}
        </Box>
        <Select
          key={phase}
          options={options}
          onChange={value => answer(value as ChromeInstallSetupResult)}
          onCancel={() => answer('cancelled')}
        />
      </Box>
    </Dialog>
  );
}

type UpsellProps = {
  onAnswer: (result: ChromeInstallUpsellResult) => void;
};

/** densable znu */
export function ChromeInstallUpsellDialog({ onAnswer }: UpsellProps): React.ReactNode {
  const openedAtRef = useRef(Date.now());

  useEffect(() => {
    logEvent('tengu_chrome_install_upsell_shown', {});
  }, []);

  function answer(result: ChromeInstallUpsellResult): void {
    if (Date.now() - openedAtRef.current < CHROME_INSTALL_ANSWER_DEBOUNCE_MS) return;
    onAnswer(result);
  }

  return (
    <Dialog color="permission" title="Claude wants to use your browser" onCancel={() => answer('cancelled')}>
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text>
          This task could use your Chrome browser. The Claude in Chrome extension lets Claude navigate sites, click
          buttons, and fill forms in your existing session.
        </Text>
        <Box marginTop={1}>
          <Select
            options={CHROME_INSTALL_UPSELL_OPTIONS}
            onChange={value => answer(value as ChromeInstallUpsellResult)}
            onCancel={() => answer('cancelled')}
          />
        </Box>
      </Box>
    </Dialog>
  );
}
