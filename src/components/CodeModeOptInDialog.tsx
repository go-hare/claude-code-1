/**
 * Official 2.1.328 (`chunk@330304979.js` — `CodeModeOptIn`):
 * Caveats & opt-in confirmation dialog for Code Mode (experimental).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { logEvent } from '../services/analytics/index.js';
import { CODE_MODE_EXPERIMENTAL_NAME, CODE_MODE_NAME } from '../services/codeMode/constants.js';
import { type CodeModeOptInSource, confirmCodeModeCaveatsDialog } from '../services/codeMode/optIn.js';
import { CONFIRM_SELECT_ARM_MS, ConfirmSelect } from './ConfirmSelect.js';

export type CodeModeOptInDialogStep = 'ask' | 'restart_into_mode' | 'restart_without_mode';

export type CodeModeOptInDialogOutcome = 'none' | 'restart_into_mode' | 'restart_without_mode';

export type CodeModeOptInDialogProps = {
  /** Initial dialog step. Defaults to `'ask'`. */
  step?: CodeModeOptInDialogStep;
  /** Optional opt-in source passed through to `confirmCodeModeCaveatsDialog`. */
  source?: CodeModeOptInSource;
  /** Invoked once the user declines or the restart handoff completes. */
  onDone: (outcome: CodeModeOptInDialogOutcome) => void;
  /**
   * Optional custom answer handler (primarily for tests or callers that manage
   * persistence externally). When omitted, calls `confirmCodeModeCaveatsDialog`.
   */
  onAnswer?: (accepted: boolean) => Promise<'none' | 'restart_into_mode'> | 'none' | 'restart_into_mode';
};

function emitDialogEvent(
  eventName:
    | 'tengu_repl_mode_opt_in_dialog_shown'
    | 'tengu_repl_mode_opt_in_dialog_accept'
    | 'tengu_repl_mode_opt_in_dialog_decline',
): void {
  try {
    logEvent(eventName, {});
  } catch {
    // Ignore telemetry failures so the dialog never crashes.
  }
}

export function CodeModeOptInDialog({
  step: initialStep = 'ask',
  source,
  onDone,
  onAnswer,
}: CodeModeOptInDialogProps): React.ReactNode {
  const [step, setStep] = useState<CodeModeOptInDialogStep>(initialStep);
  const answeredRef = useRef(false);

  useEffect(() => {
    if (step === 'ask') {
      emitDialogEvent('tengu_repl_mode_opt_in_dialog_shown');
    }
  }, [step]);

  useEffect(() => {
    if (step === 'restart_into_mode' || step === 'restart_without_mode') {
      const timer = setTimeout(() => {
        onDone(step);
      }, 250);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [step, onDone]);

  const handleAnswer = useCallback(
    (accepted: boolean) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      emitDialogEvent(accepted ? 'tengu_repl_mode_opt_in_dialog_accept' : 'tengu_repl_mode_opt_in_dialog_decline');
      const run = onAnswer ? Promise.resolve(onAnswer(accepted)) : confirmCodeModeCaveatsDialog(accepted, source);
      void run.then(outcome => {
        if (outcome === 'none') {
          onDone('none');
        } else {
          setStep(outcome);
        }
      });
    },
    [onAnswer, onDone, source],
  );

  if (step === 'restart_into_mode') {
    return <Text dimColor>Restarting Claude Code in {CODE_MODE_NAME}…</Text>;
  }

  if (step === 'restart_without_mode') {
    return <Text dimColor>Restarting Claude Code without {CODE_MODE_NAME}…</Text>;
  }

  const inputGuide = (
    <Byline>
      <KeyboardShortcutHint shortcut="enter" action="confirm" />
      <ConfigurableShortcutHint
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description="start without it"
      />
    </Byline>
  );

  return (
    <Dialog
      title={CODE_MODE_EXPERIMENTAL_NAME}
      color="warning"
      onCancel={() => handleAnswer(false)}
      exitOnCtrlCD
      inputGuide={inputGuide}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          In {CODE_MODE_NAME}, Claude works by writing and running JavaScript that calls its tools, instead of calling
          them one at a time.
        </Text>
        <Text>
          This is an early experiment. It can behave differently from normal Claude Code, and it may change or be
          removed in any release. Remote Control, Claude in Chrome and computer use are off in {CODE_MODE_NAME}.
        </Text>
        <Text bold>
          A session that you start in {CODE_MODE_NAME} can be resumed only with {CODE_MODE_NAME} on. If you turn{' '}
          {CODE_MODE_NAME} off, turn it on again to resume the session. Where {CODE_MODE_NAME} isn&apos;t available, the
          session can&apos;t be resumed: cloud sessions and the Claude apps can&apos;t continue it, and older versions
          of Claude Code may open it but not work properly in it.
        </Text>
        <Text>
          Sessions start in the same permission mode as without {CODE_MODE_NAME}, which can be auto mode where it&apos;s
          available. In auto mode, the safety check reads each piece of JavaScript once, before it runs. It doesn&apos;t
          check each tool call that the code then makes, so it can&apos;t see values that the code works out as it runs.
        </Text>
      </Box>
      <ConfirmSelect
        hideIndexes
        disablePrintableKeybindings
        armAfterMs={CONFIRM_SELECT_ARM_MS}
        cancelFirst
        focus="cancel"
        confirmLabel={`Yes, turn on ${CODE_MODE_NAME}`}
        cancelLabel="No, start without it"
        onConfirm={() => handleAnswer(true)}
        onCancel={() => handleAnswer(false)}
      />
      <Text dimColor>Tell us how it goes with /feedback</Text>
    </Dialog>
  );
}
