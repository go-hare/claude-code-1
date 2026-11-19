/**
 * densable Veu / p2A — auto_default_nudge DialogHost renderer.
 * Official 2.1.326 #25 (arm/refuse window against stray setup Enter)
 * & #26 (capture stray typing over dialog and lock Enter until navigation).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Dialog, Text, useInput } from '@anthropic/ink';
import { CONFIRM_SELECT_ARM_MS, confirmSelectRefused } from '../../components/ConfirmSelect.js';
import { Select } from '../../components/CustomSelect/index.js';

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
  const [armed, setArmed] = useState(false);
  const guardRef = useRef<StrayTypingGuard | null>(null);
  if (guardRef.current === null) {
    guardRef.current = createAutoDefaultNudgeStrayTypingGuard();
  }
  const [capturedDraft, setCapturedDraft] = useState('');
  const [enterLocked, setEnterLocked] = useState(false);

  // Official 2.1.326 #25: arm after CONFIRM_SELECT_ARM_MS so a stray Enter right after setup cannot accept.
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), CONFIRM_SELECT_ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  // Stash any captured stray typing so REPL delivers it into draftController when dialog closes (#26).
  const flushDraft = () => {
    const text = guardRef.current?.getDraft() ?? '';
    if (text.length > 0) {
      pendingStrayDraft = pendingStrayDraft ? `${pendingStrayDraft}${text}` : text;
    }
  };

  useInput((input, key) => {
    const guard = guardRef.current!;
    if (key.upArrow || key.downArrow) {
      guard.unlockByNavigation();
      setEnterLocked(false);
      return;
    }
    if (key.backspace || key.delete) {
      if (guard.getDraft().length > 0) {
        guard.backspace();
        setCapturedDraft(guard.getDraft());
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
    }
  });

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

  return (
    <Dialog title="Try auto mode as your default?" color="warning" onCancel={() => finish('cancelled')}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Auto mode can handle routine permission prompts for you
          {currentMode ? ` (current mode: ${currentMode})` : ''}.
        </Text>
        {capturedDraft.length > 0 ? <Text dimColor>Saved to prompt draft: {capturedDraft}</Text> : null}
        {enterLocked ? <Text dimColor>Use ↑/↓ to choose an option, or Esc to dismiss and keep typing.</Text> : null}
        <Select
          options={[
            { value: 'accepted', label: 'Yes, set auto as default' },
            { value: 'declined', label: 'Not now' },
          ]}
          isDisabled={!armed}
          disablePrintableKeybindings
          declineValue="declined"
          onChange={value => finish(value as 'accepted' | 'declined')}
          onCancel={() => finish('cancelled')}
        />
      </Box>
    </Dialog>
  );
}
