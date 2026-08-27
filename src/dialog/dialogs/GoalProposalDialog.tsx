/**
 * densable xou — goal_proposal DialogHost renderer.
 */
import React, { useRef } from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';

/** densable THr answer debounce */
const ANSWER_DEBOUNCE_MS = 150;

export type GoalProposalDialogPayload = {
  condition: string;
  /** Current goal condition if replacing */
  currentCondition?: string;
  /** densable vou() — agent still working */
  stillWorking?: boolean;
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

  const stillWorking = payload.stillWorking === true;
  const help = stillWorking
    ? 'Claude continues with the current work while you decide.'
    : 'Claude has finished its current work — approving starts it working again, toward this goal. Esc dismisses without setting it.';

  return (
    <Dialog
      title="Claude proposes a goal"
      color="permission"
      onCancel={() => answer({ approved: false, explicit: true })}
    >
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text bold color="permission">
          Claude proposes a goal
        </Text>
        <Text>{payload.condition}</Text>
        <Text dimColor>
          Approving sets this as the session goal, like running /goal: after each turn a separate check decides whether
          the condition is met, and Claude keeps working until it is. {help}
        </Text>
        {payload.currentCondition !== undefined && (
          <Text dimColor>
            Approving replaces the current goal:{' '}
            {payload.currentCondition.length > 200
              ? `${payload.currentCondition.slice(0, 200)}…`
              : payload.currentCondition}
          </Text>
        )}
        <Select
          options={[
            { value: 'cancel', label: 'Not now' },
            { value: 'confirm', label: 'Set this goal' },
          ]}
          defaultValue="cancel"
          onChange={value => {
            if (value === 'confirm') {
              answer({ approved: true, explicit: true });
            } else {
              answer({ approved: false, explicit: true });
            }
          }}
          onCancel={() => answer({ approved: false, explicit: true })}
        />
      </Box>
    </Dialog>
  );
}
