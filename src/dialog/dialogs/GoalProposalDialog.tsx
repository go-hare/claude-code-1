/**
 * densable xou — goal_proposal DialogHost renderer.
 * Gold: `wou=wt(nFA),ApN=vou()` live-read inside the renderer. Producer
 * payload is `{condition}` only — do not invent extras on the dialog payload.
 */
import React, { useRef, useSyncExternalStore } from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { truncateGoalConditionForRender } from '@claude-code/builtin-tools/tools/ProposeGoalTool/canonicalize.js';
import { getMainLoopBusy, subscribeMainLoopBusy } from '../../bootstrap/state.js';
import { Select } from '../../components/CustomSelect/index.js';
import { useAppState } from '../../state/AppState.js';
import { firstLineOf } from '../../utils/stringUtils.js';

/** densable THr answer debounce */
const ANSWER_DEBOUNCE_MS = 150;

export type GoalProposalDialogPayload = {
  condition: string;
};

export type GoalProposalResult = {
  approved: boolean;
  explicit?: boolean;
};

type Props = {
  payload: GoalProposalDialogPayload;
  onAnswer: (result: GoalProposalResult) => void;
};

export function GoalProposalDialog({ payload, onAnswer }: Props): React.ReactNode {
  const openedAt = useRef(Date.now());

  function answer(result: GoalProposalResult): void {
    if (Date.now() - openedAt.current < ANSWER_DEBOUNCE_MS) return;
    onAnswer(result);
  }

  // densable vou() — official qGo host; subscribe so help flips when turn ends.
  const stillWorking = useSyncExternalStore(subscribeMainLoopBusy, getMainLoopBusy, getMainLoopBusy);
  const help = stillWorking
    ? 'Claude continues with the current work while you decide.'
    : 'Claude has finished its current work — approving starts it working again, toward this goal. Esc dismisses without setting it.';
  // densable wt(nFA) — replace-line iff AppState.activeGoal exists.
  // Gold xou: `Y4t(fp(wou.condition), 200)` — first line then official truncate.
  // Do not read the in-memory goalState store — /goal writes activeGoal.
  const liveGoal = useAppState(s => s.activeGoal?.condition);
  const replaceLine = liveGoal !== undefined ? truncateGoalConditionForRender(firstLineOf(liveGoal), 200) : null;

  return (
    <Dialog
      title="Claude proposes a goal"
      color="permission"
      onCancel={() => answer({ approved: false, explicit: true })}
    >
      <Box paddingX={1}>
        <Text>{payload.condition}</Text>
      </Box>
      <Text dimColor>
        Approving sets this as the session goal, like running /goal: after each turn a separate check decides whether
        the condition is met, and Claude keeps working until it is. {help}
      </Text>
      {replaceLine !== null && <Text dimColor>Approving replaces the current goal: {replaceLine}</Text>}
      <Select
        options={[
          { value: 'cancel', label: 'Not now' },
          { value: 'confirm', label: 'Set this goal' },
        ]}
        defaultFocusValue="cancel"
        onChange={value => {
          if (value === 'confirm') {
            answer({ approved: true, explicit: true });
          } else {
            answer({ approved: false, explicit: true });
          }
        }}
        onCancel={() => answer({ approved: false, explicit: true })}
      />
    </Dialog>
  );
}
