/**
 * densable $To — exit overlay router:
 *   worktree → WorktreeExitDialog (Ubs)
 *   chose background → BackgroundAndExit (xTo)
 *   backgroundItems → ExitBackgroundWorkDialog (Lbs)
 *   else null
 */
import { feature } from 'bun:bundle';
import sample from 'lodash-es/sample.js';
import React, { useCallback, useState } from 'react';
import { getMainLoopBusy } from '../bootstrap/state.js';
import type { ExitBackgroundWorkItem } from '../utils/exitBackgroundItems.js';
import { exitPromptShutdown } from '../utils/exitPromptShutdown.js';
import { BackgroundAndExit, canOfferBackgroundAndExit } from './BackgroundAndExit.js';
import type { BackgroundSeedMessage } from '../cli/bg/helpers.js';
import { ExitBackgroundWorkDialog } from './ExitBackgroundWorkDialog.js';
import { WorktreeExitDialog } from './WorktreeExitDialog.js';

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}

type Props = {
  showWorktree: boolean;
  backgroundItems?: readonly ExitBackgroundWorkItem[];
  messages?: readonly BackgroundSeedMessage[];
  getMessages?: () => readonly BackgroundSeedMessage[] | undefined;
  getIsMidTurn?: () => boolean;
  getIsResponseStreaming?: () => boolean;
  isMidTurn?: boolean;
  onDone: (message?: string) => void;
  onCancel?: () => void;
  onBeforeExit?: () => void | Promise<void>;
  getTasks?: () => Record<string, unknown> | null | undefined;
};

export function ExitFlow({
  showWorktree,
  backgroundItems = [],
  messages,
  getMessages,
  getIsMidTurn,
  getIsResponseStreaming,
  isMidTurn,
  onDone,
  onCancel,
  onBeforeExit,
  getTasks,
}: Props): React.ReactNode {
  const [choseBackground, setChoseBackground] = useState(false);

  const resolveMessages = useCallback((): readonly BackgroundSeedMessage[] | undefined => {
    return getMessages?.() ?? messages;
  }, [getMessages, messages]);

  const resolveMidTurn = useCallback((): boolean => {
    return getIsMidTurn?.() ?? isMidTurn ?? getMainLoopBusy();
  }, [getIsMidTurn, isMidTurn]);

  const resolveStreaming = useCallback((): boolean => {
    return (getIsResponseStreaming ?? getIsMidTurn)?.() ?? isMidTurn ?? getMainLoopBusy();
  }, [getIsResponseStreaming, getIsMidTurn, isMidTurn]);

  // densable $To Pkr → await iwg?.(); owg(...); nst(...)
  // wZt does not pass onBeforeExit (iwg); wO0/TTc may pass it.
  const finishExit = useCallback(
    async (resultMessage?: string) => {
      await onBeforeExit?.();
      onDone(resultMessage ?? getRandomGoodbyeMessage());
      const snap = resolveMessages();
      await exitPromptShutdown({
        messages: snap,
        responseStreaming: resolveStreaming() === true,
      });
    },
    [onBeforeExit, onDone, resolveMessages, resolveStreaming],
  );

  // densable $To order (do not reorder):
  //   1. showWorktree → Ubs (WorktreeExitDialog) — even if backgroundItems nonempty
  //   2. choseBackground → xTo (BackgroundAndExit)
  //   3. backgroundItems → Lbs (ExitBackgroundWorkDialog)
  // Combined worktree + bg tasks: user finishes worktree flow first; Lbs is not shown
  // in the same $To pass (matches 239 SEA).
  if (showWorktree) {
    return <WorktreeExitDialog onDone={msg => void finishExit(msg)} onCancel={onCancel} />;
  }

  const msgSnap = resolveMessages();
  if (choseBackground && msgSnap) {
    // densable xTo: isMidTurn + responseStreaming separate;
    // replyOnResume uses isMidTurn only (CTo).
    return (
      <BackgroundAndExit
        messages={msgSnap}
        isMidTurn={resolveMidTurn()}
        onDone={msg => onDone(msg)}
        getTasks={getTasks}
      />
    );
  }

  if (backgroundItems.length > 0) {
    // feature() must be if/ternary condition only (bun:bundle).
    const canBg = feature('BG_SESSIONS') ? msgSnap !== undefined && canOfferBackgroundAndExit(msgSnap) : false;
    return (
      <ExitBackgroundWorkDialog
        items={backgroundItems}
        onExit={() => void finishExit()}
        onCancel={onCancel ?? (() => {})}
        onBackground={canBg ? () => setChoseBackground(true) : undefined}
      />
    );
  }

  return null;
}
