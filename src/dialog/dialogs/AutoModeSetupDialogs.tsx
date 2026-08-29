/**
 * densable snu / anu / gmn / hmn — auto_mode_setup_review + flagged_allow.
 * Tip bridge: accept/decline (review) and multi-select remove (flagged).
 * Wizard nlg flagged step uses AutoModeFlaggedAllowPicker (hmn).
 */
import React, { useState } from 'react';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { Select, SelectMulti } from '../../components/CustomSelect/index.js';
import { Markdown } from '../../components/Markdown.js';
import { AUTO_MODE_DEFAULTS_SENTINEL } from '../../services/autoModeSetup/write.js';

/** densable gmn */
export function filterDefaultsSentinel(rules: readonly string[]): string[] {
  return rules.filter(rule => rule !== AUTO_MODE_DEFAULTS_SENTINEL);
}

export type AutoModeSetupReviewPayload = {
  environment?: string[];
  allow?: string[];
  soft_deny?: string[];
  hard_deny?: string[];
  remove_from_permissions_allow?: string[];
  notes?: string[];
  mode?: 'append' | 'replace';
};

export type AutoModeSetupReviewResult = 'accept' | 'decline' | 'cancelled';

type ReviewProps = {
  payload: AutoModeSetupReviewPayload;
  onAnswer: (result: AutoModeSetupReviewResult) => void;
  /** densable ymn hideIndexes — Host/wizard omit */
  hideIndexes?: boolean;
  /** densable ymn defaultFocusValue — Host/wizard omit */
  defaultFocusValue?: AutoModeSetupReviewResult;
  /** densable ymn onFocus — Host/wizard omit */
  onFocus?: (value: AutoModeSetupReviewResult) => void;
};

/** densable xy0 — Markdown renderer around each M9e entry */
function renderAutoModeEntry(entry: string): React.ReactNode {
  return <Markdown>{entry}</Markdown>;
}

/** densable M9e */
function AutoModeProposalSection({
  label,
  entries,
  empty,
  dim,
  headers,
}: {
  label: string;
  entries: readonly string[];
  empty?: string;
  dim?: boolean;
  headers?: boolean;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      {entries.length === 0 ? (
        <Text dimColor>{` ${empty ?? 'nothing found'}`}</Text>
      ) : (
        entries.map((entry, index) =>
          headers && entry.startsWith('### ') ? (
            <Text key={index} dimColor>
              {'  '}
              {renderAutoModeEntry(entry.slice(4))}
            </Text>
          ) : (
            <Text key={index} dimColor={dim}>
              {'  · '}
              {renderAutoModeEntry(entry)}
            </Text>
          ),
        )
      )}
    </Box>
  );
}

const YMN_INPUT_GUIDE = (
  <Byline>
    <KeyboardShortcutHint shortcut="Enter" action="confirm" />
    <KeyboardShortcutHint shortcut="Esc" action="cancel" />
  </Byline>
);

/** densable ymn — Host + nlg review step */
export function AutoModeSetupReviewDialog({
  payload,
  onAnswer,
  hideIndexes,
  defaultFocusValue,
  onFocus,
}: ReviewProps): React.ReactNode {
  const allow = filterDefaultsSentinel(payload.allow ?? []);
  const softDeny = filterDefaultsSentinel(payload.soft_deny ?? []);
  const hardDeny = filterDefaultsSentinel(payload.hard_deny ?? []);

  return (
    <Dialog
      title="Review proposed auto-mode setup"
      onCancel={() => onAnswer('cancelled')}
      inputGuide={() => YMN_INPUT_GUIDE}
    >
      <Box flexDirection="column" gap={1}>
        <AutoModeProposalSection label="Environment" entries={payload.environment ?? []} headers />
        <AutoModeProposalSection
          label="Allow carve-outs"
          entries={allow}
          empty="none suggested — defaults look like they cover your usage"
        />
        <AutoModeProposalSection label="Extra soft blocks" entries={softDeny} empty="none suggested" />
        <AutoModeProposalSection label="Extra hard blocks" entries={hardDeny} empty="none suggested" />
        <AutoModeProposalSection label="Notes" entries={payload.notes ?? []} empty="none" dim />
        <Select
          options={[
            { value: 'accept', label: 'Looks good — save it' },
            { value: 'decline', label: 'Discard and exit' },
          ]}
          hideIndexes={hideIndexes}
          defaultFocusValue={defaultFocusValue}
          onFocus={onFocus}
          onChange={value => onAnswer(value as 'accept' | 'decline')}
          onCancel={() => onAnswer('cancelled')}
        />
      </Box>
    </Dialog>
  );
}

export type AutoModeFlaggedAllowPayload = {
  flagged: string[];
  runId: string;
};

export type AutoModeFlaggedAllowResult = { toRemove: string[] } | 'cancelled';

type FlaggedProps = {
  payload: AutoModeFlaggedAllowPayload;
  onAnswer: (result: AutoModeFlaggedAllowResult) => void;
};

export function AutoModeFlaggedAllowDialog({ payload, onAnswer }: FlaggedProps): React.ReactNode {
  return (
    <AutoModeFlaggedAllowPicker
      flagged={payload.flagged}
      onCancel={() => onAnswer('cancelled')}
      onResolve={toRemove => onAnswer({ toRemove })}
    />
  );
}

const HMN_INPUT_GUIDE = (
  <Byline>
    <Text>Your setup is saved either way</Text>
    <KeyboardShortcutHint shortcut="Enter" action="confirm" />
    <KeyboardShortcutHint shortcut="Esc" action="skip" />
  </Byline>
);

/** densable hmn — nlg flagged step + Host flagged_allow */
export function AutoModeFlaggedAllowPicker(props: {
  flagged?: string[];
  initialPicking?: boolean;
  onPickingChange?: (picking: boolean) => void;
  initialSelection?: string[];
  onSelectionChange?: (selected: string[]) => void;
  hideIndexes?: boolean;
  onCancel: () => void;
  onResolve: (toRemove: string[]) => void;
}): React.ReactNode {
  const rawFlagged = props.flagged ?? [];
  const flagged = filterDefaultsSentinel(rawFlagged);
  const [picking, setPicking] = useState(props.initialPicking ?? false);

  const setPickingBoth = (next: boolean) => {
    setPicking(next);
    props.onPickingChange?.(next);
  };

  if (picking) {
    return (
      <Dialog title="Pick which to remove" onCancel={props.onCancel} inputGuide={() => HMN_INPUT_GUIDE}>
        <SelectMulti
          hideIndexes={props.hideIndexes}
          options={flagged.map(rule => ({ value: rule, label: rule }))}
          defaultValue={props.initialSelection}
          onChange={props.onSelectionChange}
          submitButtonText="Remove selected"
          onSubmit={props.onResolve}
          onCancel={props.onCancel}
        />
      </Dialog>
    );
  }

  return (
    <Dialog title="Review rules that skip checks" onCancel={props.onCancel} inputGuide={() => HMN_INPUT_GUIDE}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          These permissions.allow entries in your user settings are broad enough that auto mode either ignores them at
          runtime, or auto-approves destructive commands with no check. Removing one means matching commands prompt
          again outside auto mode too.
        </Text>
        <Box flexDirection="column">
          {flagged.map(rule => (
            <Text key={rule}>{` · ${rule}`}</Text>
          ))}
        </Box>
        <Text dimColor>Removed entries can be restored by re-adding them verbatim.</Text>
        <Select
          hideIndexes={props.hideIndexes}
          options={[
            { value: 'all', label: 'Remove them all' },
            { value: 'pick', label: 'Pick which to remove' },
            { value: 'leave', label: 'Leave them' },
          ]}
          onChange={value => {
            if (value === 'all') {
              props.onResolve(rawFlagged);
              return;
            }
            if (value === 'pick') {
              setPickingBoth(true);
              return;
            }
            props.onResolve([]);
          }}
          onCancel={props.onCancel}
        />
      </Box>
    </Dialog>
  );
}
