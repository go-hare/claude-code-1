import React from 'react';
import { Box, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';

export type AutofixPhase =
  | 'detecting'
  | 'checking_eligibility'
  | 'acquiring_lock'
  | 'launching'
  | 'registered'
  | 'done'
  | 'error';

interface AutofixProgressProps {
  phase: AutofixPhase;
  target: string;
  sessionUrl?: string;
  errorMessage?: string;
  /** Official 2.1.327 (#447): Esc immediately dismisses the dialog and stops any started session asynchronously. */
  onCancel?: () => void;
}

/**
 * Official 2.1.327 (#447) `ee`: cancellation message shown immediately when Esc
 * closes `/autofix-pr`. Before spawning begins, says only "Autofix PR cancelled";
 * once launching may have started a cloud session, explains that stopping runs
 * in the background and any failure will be reported afterwards with a link.
 */
export function formatAutofixCancelMessage(phase: AutofixPhase | 'checking' | 'spawning' | 'subscribing'): string {
  if (phase === 'detecting' || phase === 'checking' || phase === 'checking_eligibility') {
    return 'Autofix PR cancelled';
  }
  return 'Autofix PR cancelled. Any cloud session it started will be stopped. If that fails, a link to stop it yourself will appear here.';
}

/**
 * Official 2.1.327 (#447) `ue`: message reported afterwards if stopping a
 * started cloud session failed after Esc closed the dialog.
 */
export function formatAutofixStopFailedMessage(sessionUrl: string): string {
  return `A cloud session had already started and Claude Code couldn't stop it, so it may still work on the PR. Stop it here: ${sessionUrl}`;
}

const PHASE_LABELS: Record<AutofixPhase, string> = {
  detecting: 'Detecting repository...',
  checking_eligibility: 'Checking remote agent eligibility...',
  acquiring_lock: 'Acquiring monitor lock...',
  launching: 'Launching remote session...',
  registered: 'Session registered',
  done: 'Autofix launched',
  error: 'Error',
};

const PHASE_ORDER: AutofixPhase[] = [
  'detecting',
  'checking_eligibility',
  'acquiring_lock',
  'launching',
  'registered',
  'done',
];

function phaseIndex(phase: AutofixPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

/**
 * Inline progress component for /autofix-pr.
 * Rendered by the REPL alongside the onDone text message.
 */
export function AutofixProgress({
  phase,
  target,
  sessionUrl,
  errorMessage,
  onCancel,
}: AutofixProgressProps): React.ReactElement {
  const currentIdx = phaseIndex(phase);
  const isError = phase === 'error';

  const body = (
    <Box flexDirection="column" marginTop={onCancel ? 0 : 1} marginBottom={onCancel ? 0 : 1}>
      <Box>
        <Text bold>Autofix PR </Text>
        <Text color={'claude' as keyof Theme}>{target}</Text>
      </Box>
      {PHASE_ORDER.map((p, i) => {
        const isDone = currentIdx > i;
        const isActive = currentIdx === i && !isError;
        const symbol = isDone ? '✓' : isActive ? '→' : '·';
        const color: keyof Theme = isDone ? 'success' : isActive ? 'warning' : 'subtle';
        return (
          <Box key={p} marginLeft={2}>
            <Text color={color}>
              {symbol} {PHASE_LABELS[p]}
            </Text>
          </Box>
        );
      })}
      {isError && errorMessage && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={'error' as keyof Theme}>✗ {errorMessage}</Text>
        </Box>
      )}
      {sessionUrl && (
        <Box marginTop={1} marginLeft={2}>
          <Text color={'subtle' as keyof Theme}>Track: </Text>
          <Text color={'claude' as keyof Theme}>{sessionUrl}</Text>
        </Box>
      )}
    </Box>
  );

  if (onCancel) {
    return (
      <Dialog
        title="Autofix PR"
        onCancel={onCancel}
        inputGuide={<KeyboardShortcutHint shortcut="esc" action="cancel" />}
      >
        {body}
      </Dialog>
    );
  }

  return body;
}
