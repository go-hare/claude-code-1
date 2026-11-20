/**
 * densable Veu / p2A — auto_default_nudge DialogHost renderer.
 * Official 2.1.326 #25 (arm/refuse window against stray setup Enter)
 * & #26 (capture stray typing over dialog and lock Enter until navigation).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Dialog, type PasteEvent, Text, useInput } from '@anthropic/ink';
import { CONFIRM_SELECT_ARM_MS, confirmSelectRefused } from '../../components/ConfirmSelect.js';
import { Select } from '../../components/CustomSelect/index.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { type PermissionMode, permissionModeTitle } from '../../utils/permissions/PermissionMode.js';

export type AutoDefaultNudgeResult = 'accepted' | 'declined' | 'cancelled';

let pendingStrayDraft = '';

/** Consume any stray text typed while AutoDefaultNudgeDialog was open (#26). */
export function consumePendingAutoDefaultNudgeDraft(): string {
  const out = pendingStrayDraft;
  pendingStrayDraft = '';
  return out;
}

export type StrayTypingGuard = {
  /** Record printable stray typing; locks Enter from accepting until explicit navigation. */
  capturePrintable: (text: string) => void;
  /** Record Backspace on captured stray draft. */
  backspace: () => void;
  /** Unlock Enter once the user explicitly navigates with Up/Down arrows. */
  unlockByNavigation: () => void;
  /** Whether Enter is currently locked against accepting the nudge. */
  isEnterLocked: () => boolean;
  /** Current captured stray draft. */
  getDraft: () => string;
};

/** Official 2.1.326 #26 (`I9e`): pure controller for stray-typing guard on AutoDefaultNudgeDialog. */
export function createAutoDefaultNudgeStrayTypingGuard(): StrayTypingGuard {
  let draft = '';
  let enterLocked = false;
  return {
    capturePrintable(text: string): void {
      if (!text) return;
      draft += text;
      enterLocked = true;
    },
    backspace(): void {
      if (draft.length > 0) {
        draft = draft.slice(0, -1);
      }
    },
    unlockByNavigation(): void {
      enterLocked = false;
    },
    isEnterLocked(): boolean {
      return enterLocked;
    },
    getDraft(): string {
      return draft;
    },
  };
}

type Props = {
  currentMode?: string;
  onAnswer: (result: AutoDefaultNudgeResult) => void;
};

export function AutoDefaultNudgeDialog({ currentMode, onAnswer }: Props): React.ReactNode {
  const [openedAt] = useState(() => Date.now());
  const guardRef = useRef<StrayTypingGuard | null>(null);
  if (guardRef.current === null) {
    guardRef.current = createAutoDefaultNudgeStrayTypingGuard();
  }
  const [capturedDraft, setCapturedDraft] = useState('');
  const [enterLocked, setEnterLocked] = useState(false);

  const loggedShownRef = useRef(false);
  useEffect(() => {
    if (loggedShownRef.current) return;
    loggedShownRef.current = true;
    logEvent('tengu_auto_default_nudge_shown', {
      current_mode: (currentMode ?? 'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface: 'repl' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
  }, [currentMode]);

  // Stash any captured stray typing so REPL delivers it into draftController when dialog closes (#26).
  const flushDraft = () => {
    const text = guardRef.current?.getDraft() ?? '';
    if (text.length > 0) {
      pendingStrayDraft = pendingStrayDraft ? `${pendingStrayDraft}${text}` : text;
    }
  };

  const handlePaste = (event: PasteEvent) => {
    const text = event.text;
    if (!text) return;
    const guard = guardRef.current!;
    guard.capturePrintable(text);
    setCapturedDraft(guard.getDraft());
    setEnterLocked(true);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  useInput(
    (input, key, event) => {
      const guard = guardRef.current!;
      if (key.upArrow || key.downArrow) {
        guard.unlockByNavigation();
        setEnterLocked(false);
        return;
      }
      if (key.return && guard.isEnterLocked()) {
        event.stopImmediatePropagation();
        return;
      }
      if (key.backspace || key.delete) {
        if (guard.getDraft().length > 0) {
          guard.backspace();
          setCapturedDraft(guard.getDraft());
          event.stopImmediatePropagation();
        }
        return;
      }
      if (
        !key.ctrl &&
        !key.meta &&
        !key.return &&
        !key.escape &&
        !key.tab &&
        input.length > 0 &&
        !/\p{Cc}/u.test(input)
      ) {
        guard.capturePrintable(input);
        setCapturedDraft(guard.getDraft());
        setEnterLocked(true);
        event.stopImmediatePropagation();
      }
    },
    { prepend: true },
  );

  const isRefused = () => confirmSelectRefused(openedAt, CONFIRM_SELECT_ARM_MS, Date.now());

  const finish = (result: AutoDefaultNudgeResult) => {
    if (isRefused()) {
      return;
    }
    if (result === 'accepted' && guardRef.current!.isEnterLocked()) {
      return;
    }
    flushDraft();
    onAnswer(result);
  };

  const currentModeLabel = permissionModeTitle((currentMode ?? 'default') as PermissionMode);

  return (
    <Dialog title="Make auto mode your default permission mode?" color="warning" onCancel={() => finish('declined')}>
      <Box flexDirection="column" gap={1} onPaste={handlePaste}>
        <Text>
          Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions
          and prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.
        </Text>
        {capturedDraft.length > 0 ? <Text dimColor>Saved to prompt draft: {capturedDraft}</Text> : null}
        {enterLocked ? <Text dimColor>Use ↑/↓ to choose an option, or Esc to dismiss and keep typing.</Text> : null}
        <Select
          options={[
            { value: 'accepted', label: 'Yes, set auto mode as my default permission mode' },
            { value: 'declined', label: `No, keep ${currentModeLabel}` },
          ]}
          hideIndexes
          refuseInput={isRefused}
          disablePrintableKeybindings
          declineValue="declined"
          onChange={value => finish(value as 'accepted' | 'declined')}
          onCancel={() => finish('declined')}
        />
      </Box>
    </Dialog>
  );
}
