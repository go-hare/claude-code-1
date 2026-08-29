/**
 * densable nlg / Zag / Qag / ilg — interactive /auto-mode-setup wizard UI.
 * Gold: gold-wide-nlg.txt · gold-wide-elg.txt · gold-wide-step-confirm-*.txt
 */
import React, { useEffect, useState } from 'react';
import figures from 'figures';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text, useKeybinding, useKeybindings } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';
import { AutoModeFlaggedAllowPicker, AutoModeSetupReviewDialog } from '../../dialog/dialogs/AutoModeSetupDialogs.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { answersToReconFlags, type AutoModeSetupAnswers } from '../../services/autoModeSetup/answers.js';
import type { ProposeAutoModeSetupResult } from '../../services/autoModeSetup/propose.js';
import {
  answersFromConfirmSelection,
  depthSelectionFromDepth,
  type AutoModeSetupWizardState,
} from '../../services/autoModeSetup/wizardState.js';
import { formatAutoModeSavedMessage, type AutoModeWriteResult } from '../../services/autoModeSetup/write.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';

const FRESH_MS = 250;

const TITLE = 'Teach auto mode about your environment?';
const INTRO =
  'Claude Code reads this project, your recent Claude sessions, and optionally your shell history and other repositories. Claude analyzes this data and customizes auto mode to make better decisions.';
const POSTURE_LABEL = 'How you use Claude here';

const POSTURE_OPTIONS: Array<{
  value: AutoModeSetupAnswers['posture'];
  label: string;
}> = [
  { value: 'enterprise', label: 'Work' },
  { value: 'open-source', label: 'Open source' },
  { value: 'personal', label: 'Hobby' },
  { value: 'mixed', label: 'Mixed' },
];

const EXTRA_READS = [
  { value: 'shell', label: 'Also scan shell history' },
  { value: 'repos', label: 'Also scan your other repos' },
] as const;

const SR_DEPTH_OPTIONS = [
  { value: 'shell', label: 'Also scan shell history (default)' },
  { value: 'repos', label: 'Also scan your other repos' },
  { value: 'both', label: 'Scan both' },
  { value: 'here', label: 'Neither — just this project and sessions' },
] as const;

const LABEL_PAD = Math.max(POSTURE_LABEL.length, ...EXTRA_READS.map(r => r.label.length));

export type AutoModeSetupWizardProps = {
  state: AutoModeSetupWizardState;
  propose: (answers: AutoModeSetupAnswers) => Promise<ProposeAutoModeSetupResult>;
  onBackgroundStart?: (answers: AutoModeSetupAnswers) => void;
  abort: () => void;
  write: (
    proposal: NonNullable<AutoModeSetupWizardState['proposal']>,
    mode: 'append' | 'replace',
  ) => Promise<AutoModeWriteResult>;
  writeRemoval: (rules: string[]) => Promise<AutoModeWriteResult>;
  onDone: (message: string) => void;
  onCancel: () => void;
};

/** densable nlg */
export function AutoModeSetupWizard({
  state,
  propose,
  onBackgroundStart,
  abort,
  write,
  writeRemoval,
  onDone,
  onCancel,
}: AutoModeSetupWizardProps): React.ReactNode {
  const [, bump] = useState(state.step);
  if (state.lastAcceptAt === undefined) {
    state.lastAcceptAt = Date.now();
  }
  useEffect(() => {
    state.notify = () => bump(state.step);
    bump(state.step);
    return () => {
      state.notify = undefined;
    };
  }, [state]);
  useEffect(() => {
    if (!state.shownLogged) {
      state.shownLogged = true;
      logEvent('tengu_auto_mode_setup_wizard_shown', {
        has_existing: state.hasExisting ? 1 : 0,
      });
    }
  }, [state]);

  const step = state.step;

  function isFreshKeypress(): boolean {
    const now = Date.now();
    const last = state.lastAcceptAt;
    state.lastAcceptAt = Math.max(now, last ?? now);
    return last !== undefined && now - last >= FRESH_MS;
  }

  function canAccept(expected: AutoModeSetupWizardState['step']): boolean {
    if (!isFreshKeypress()) return false;
    return state.step === expected && state.resolution === 'none';
  }

  function go(next: AutoModeSetupWizardState['step']): void {
    state.lastAcceptAt = Math.max(Date.now(), state.lastAcceptAt ?? 0);
    state.step = next;
    state.notify?.();
  }

  function resolveCancel(choice: string): void {
    if (state.resolution !== 'none') return;
    state.resolution = 'cancel';
    logEvent('tengu_auto_mode_setup_wizard_resolved', {
      choice: choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      step: state.step as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    onCancel();
  }

  function cancel(): void {
    resolveCancel('cancel');
  }

  function finishSaved(
    saved: AutoModeWriteResult,
    removal: { removed: number; skipped: number; notFound?: number },
  ): void {
    if (state.resolution !== 'none') return;
    state.resolution = 'done';
    logEvent('tengu_auto_mode_setup_wizard_resolved', {
      choice: 'saved' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      mode: state.mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    onDone(formatAutoModeSavedMessage(saved, removal));
  }

  function closeError(): void {
    if (!isFreshKeypress()) return;
    if (state.saved) {
      finishSaved(state.saved, { removed: 0, skipped: 0 });
      return;
    }
    resolveCancel('error');
  }

  const footer = (exitState: { pending: boolean; keyName: string | null }): React.ReactNode =>
    exitState.pending ? (
      <Text>Press {exitState.keyName} again to exit</Text>
    ) : (
      <Byline>
        {step === 'confirm' ? <KeyboardShortcutHint shortcut="←/→" action="change usage" /> : null}
        <KeyboardShortcutHint shortcut="Enter" action="continue" />
        <KeyboardShortcutHint shortcut="Esc" action="cancel" />
      </Byline>
    );

  if (step === 'existing') {
    return (
      <Dialog
        title="You already have auto-mode entries — add to them, or start fresh?"
        onCancel={cancel}
        inputGuide={footer}
      >
        <Select
          options={[
            {
              value: 'append',
              label: 'Add to them (keeps your existing entries)',
            },
            {
              value: 'replace',
              label: 'Start fresh (replaces the environment section)',
            },
            { value: 'cancel', label: 'Cancel' },
          ]}
          onChange={value => {
            if (!canAccept('existing')) return;
            if (value === 'cancel') {
              cancel();
              return;
            }
            state.mode = value as 'append' | 'replace';
            go('confirm');
          }}
          onCancel={cancel}
        />
      </Dialog>
    );
  }

  if (step === 'confirm') {
    return (
      <ConfirmStep
        state={state}
        cancel={cancel}
        footer={footer}
        isFreshKeypress={isFreshKeypress}
        onContinue={selection => {
          if (!canAccept('confirm')) return;
          const answers = answersFromConfirmSelection(state.posture, selection);
          logEvent('tengu_auto_mode_setup_wizard_answers', {
            posture: answers.posture as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            scope: answers.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            depth: answers.depth as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          state.gathersFromGitHubOrg = answersToReconFlags(answers).allProjects;
          if (onBackgroundStart) {
            state.resolution = 'done';
            onBackgroundStart(answers);
            onDone(
              `Gathering data and drafting your auto-mode setup; back soon${
                state.gathersFromGitHubOrg
                  ? ' (also scanning your GitHub org — stoppable from the background tasks list)'
                  : ''
              }`,
            );
            return;
          }
          go('propose');
          void propose(answers).then(
            result => {
              if (result.ok) {
                state.proposal = result.proposal;
                go('review');
              } else if (result.code === 'aborted') {
                cancel();
              } else {
                state.error = result.reason;
                go('error');
              }
            },
            err => {
              state.error = err instanceof Error ? err.message : String(err);
              go('error');
            },
          );
        }}
      />
    );
  }

  if (step === 'propose') {
    return (
      <ScanBusy
        message={
          state.gathersFromGitHubOrg
            ? 'Scanning your repo, recent sessions, and your GitHub org…'
            : 'Scanning your repo and recent sessions…'
        }
        subtitle="then drafting a proposal — this can take a moment (Esc to cancel)"
        onEscape={abort}
      />
    );
  }

  if (step === 'review' && state.proposal) {
    const proposal = state.proposal;
    return (
      <AutoModeSetupReviewDialog
        payload={{ ...proposal, mode: state.mode }}
        onAnswer={result => {
          if (result === 'cancelled') {
            cancel();
            return;
          }
          if (result === 'decline') {
            if (!canAccept('review')) return;
            state.resolution = 'done';
            logEvent('tengu_auto_mode_setup_wizard_resolved', {
              choice: 'decline' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            });
            onDone('Discarded — nothing was saved. Re-run /auto-mode-setup anytime.');
            return;
          }
          if (!canAccept('review')) return;
          go('write');
          void write(proposal, state.mode).then(
            saved => {
              state.saved = saved;
              if (proposal.remove_from_permissions_allow.length > 0) {
                go('flagged');
              } else {
                finishSaved(saved, { removed: 0, skipped: 0 });
              }
            },
            err => {
              state.error = err instanceof Error ? err.message : String(err);
              go('error');
            },
          );
        }}
      />
    );
  }

  if (step === 'write') {
    return (
      <Dialog title="Auto-mode setup" onCancel={() => {}} hideInputGuide>
        <Text>Saving…</Text>
      </Dialog>
    );
  }

  if (step === 'flagged' && state.proposal && state.saved) {
    const saved = state.saved;
    return (
      <AutoModeFlaggedAllowPicker
        flagged={state.proposal.remove_from_permissions_allow}
        initialPicking={state.flaggedPicking}
        onPickingChange={next => {
          state.flaggedPicking = next;
        }}
        initialSelection={state.flaggedSelection}
        onSelectionChange={next => {
          state.flaggedSelection = next;
        }}
        onCancel={() => {
          if (!isFreshKeypress()) return;
          finishSaved(saved, { removed: 0, skipped: 0 });
        }}
        onResolve={toRemove => {
          if (!canAccept('flagged')) return;
          if (toRemove.length === 0) {
            finishSaved(saved, { removed: 0, skipped: 0 });
            return;
          }
          go('write');
          void writeRemoval(toRemove).then(
            rem =>
              finishSaved(saved, {
                removed: rem.permissionsAllowRemoved.length,
                skipped: rem.permissionsAllowSkipped ? toRemove.length : 0,
                notFound: rem.permissionsAllowNotFound.length,
              }),
            err => {
              state.error = err instanceof Error ? err.message : String(err);
              go('error');
            },
          );
        }}
      />
    );
  }

  return (
    <Dialog title="Auto-mode setup" onCancel={closeError}>
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text color="error">{figures.cross}</Text> {state.error ?? 'Something went wrong.'}
        </Text>
        <Select options={[{ value: 'close', label: 'Close' }]} onChange={closeError} onCancel={closeError} />
      </Box>
    </Dialog>
  );
}

type ConfirmProps = {
  state: AutoModeSetupWizardState;
  cancel: () => void;
  footer: (exitState: { pending: boolean; keyName: string | null }) => React.ReactNode;
  isFreshKeypress: () => boolean;
  onContinue: (selection: string[]) => void;
};

function ConfirmStep(props: ConfirmProps): React.ReactNode {
  if (isScreenReaderModeEnabled()) {
    return <ConfirmScreenReader {...props} />;
  }
  return <ConfirmVisual {...props} />;
}

/** densable Zag */
function ConfirmVisual({ state, cancel, footer, isFreshKeypress, onContinue }: ConfirmProps): React.ReactNode {
  const [, bump] = useState(0);
  const refresh = (): void => {
    bump(n => n + 1);
  };
  const focusCount = EXTRA_READS.length + 2;
  const focus = state.confirmFocus;

  const cyclePosture = (delta: number): void => {
    const idx = POSTURE_OPTIONS.findIndex(o => o.value === state.posture);
    const next = POSTURE_OPTIONS[(idx + delta + POSTURE_OPTIONS.length) % POSTURE_OPTIONS.length];
    if (next) {
      state.posture = next.value;
      refresh();
    }
  };

  const moveFocus = (delta: number): void => {
    state.confirmFocus = (state.confirmFocus + delta + focusCount) % focusCount;
    refresh();
  };

  const toggle = (value: string): void => {
    state.confirmSelection = state.confirmSelection.includes(value)
      ? state.confirmSelection.filter(v => v !== value)
      : [...state.confirmSelection, value];
    refresh();
  };

  const activate = (): void => {
    if (state.confirmFocus === focusCount - 1) {
      onContinue(state.confirmSelection);
      return;
    }
    if (!isFreshKeypress()) return;
    const read = EXTRA_READS[state.confirmFocus - 1];
    if (read) toggle(read.value);
  };

  useKeybindings(
    {
      'tabs:previous': () => cyclePosture(-1),
      'tabs:next': () => cyclePosture(1),
    },
    { context: 'Tabs', isActive: state.confirmFocus === 0 },
  );
  useKeybindings(
    {
      'confirm:previous': () => moveFocus(-1),
      'confirm:next': () => moveFocus(1),
      'confirm:toggle': activate,
      'confirm:yes': activate,
    },
    { context: 'Confirmation' },
  );

  const postureLabel = POSTURE_OPTIONS.find(o => o.value === state.posture)?.label ?? state.posture;

  const marker = (i: number): React.ReactNode => (
    <Text color={focus === i ? 'suggestion' : undefined}>{focus === i ? figures.pointer : ' '} </Text>
  );

  return (
    <Dialog title={TITLE} onCancel={cancel} inputGuide={footer}>
      <Text>{INTRO}</Text>
      <Box flexDirection="column">
        <Box>
          {marker(0)}
          <Text color={focus === 0 ? 'suggestion' : undefined}>{POSTURE_LABEL.padEnd(LABEL_PAD)} </Text>
          <Text dimColor>{figures.triangleLeft} </Text>
          <Text>{postureLabel}</Text>
          <Text dimColor> {figures.triangleRight}</Text>
        </Box>
        {EXTRA_READS.map((read, i) => {
          const row = i + 1;
          const on = state.confirmSelection.includes(read.value);
          return (
            <Box key={read.value}>
              {marker(row)}
              <Text color={focus === row ? 'suggestion' : undefined}>{read.label.padEnd(LABEL_PAD)} </Text>
              <Text color={on ? 'success' : undefined}>[{on ? figures.tick : ' '}]</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          {marker(focusCount - 1)}
          <Text bold color={focus === focusCount - 1 ? 'suggestion' : undefined}>
            Continue
          </Text>
        </Box>
      </Box>
    </Dialog>
  );
}

/** densable Qag */
function ConfirmScreenReader({ state, cancel, onContinue }: ConfirmProps): React.ReactNode {
  const [, bump] = useState(0);
  const mark = (): void => {
    state.lastAcceptAt = Math.max(Date.now(), state.lastAcceptAt ?? 0);
  };

  return (
    <Dialog title={TITLE} onCancel={cancel}>
      <Text>{INTRO}</Text>
      {state.confirmSrAtPosture ? (
        <>
          <Text>{POSTURE_LABEL}:</Text>
          <Select
            options={POSTURE_OPTIONS.map(o => ({
              value: o.value,
              label: o.label,
            }))}
            defaultValue={state.posture}
            onChange={value => {
              state.posture = value as AutoModeSetupAnswers['posture'];
              state.confirmSrAtPosture = false;
              mark();
              bump(n => n + 1);
            }}
            onCancel={cancel}
          />
        </>
      ) : (
        <>
          <Text>Optional reads (Claude already reads this project):</Text>
          <Select
            options={SR_DEPTH_OPTIONS.map(o => ({
              value: o.value,
              label: o.label,
            }))}
            defaultValue="shell"
            onChange={value => {
              const selection = depthSelectionFromDepth(value as AutoModeSetupAnswers['depth']);
              state.confirmSelection = selection;
              onContinue(selection);
            }}
            onCancel={cancel}
          />
        </>
      )}
    </Dialog>
  );
}

/** densable ilg */
function ScanBusy({
  message,
  subtitle,
  onEscape,
}: {
  message: string;
  subtitle: string;
  onEscape: () => void;
}): React.ReactNode {
  useKeybinding('confirm:no', onEscape, { context: 'Settings' });
  return (
    <Dialog title="Auto-mode setup" onCancel={onEscape} hideInputGuide>
      <Box flexDirection="column">
        <Text>{message}</Text>
        <Text dimColor>{subtitle}</Text>
      </Box>
    </Dialog>
  );
}
