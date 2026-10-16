/**
 * densable 2.1.289 `/goal` local-jsx — Dialog `v` + helper `k` + `_t` call.
 *
 * Gold empty: `if(t==="")return e(v,{messages,onDone:()=>u(void 0,{display:"skip"})})`
 * Gold set: `u(\`Goal set: ${t}\`,{shouldQuery:!0,metaMessages:[Xbn(t)]})`
 * Gold clear/too_long/gate: onDone display:"system", return null.
 *
 * Do not export minify names (v/k/_t/Xqr/s3t/gi). Do not invent a footer pill.
 */
import * as React from 'react';
import { useState } from 'react';
import { Box, Byline, Dialog, KeyboardShortcutHint, StatusIcon, Text, useInterval } from '@anthropic/ink';
import { getTotalOutputTokens } from '../../bootstrap/state.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { formatDuration, formatNumber } from '../../utils/format.js';
import { firstLineOf, plural } from '../../utils/stringUtils.js';
import {
  applyGoalClear,
  applyGoalSet,
  GOAL_SYSTEM_MESSAGE,
  isGoalClearKeyword,
  logGoalTooLong,
  MAX_GOAL_CONDITION_LENGTH,
} from '../goal.js';

/** densable s3t = "◎" (◎). */
const GOAL_ACTIVE_MARK = '◎';

type GoalStatusDialogProps = {
  messages: Message[];
  onDone: () => void;
};

type AchievedGoal = {
  condition: string;
  iterations?: number;
  durationMs?: number;
  tokens?: number;
};

/** densable Xqr — last non-sentinel met goal_status. */
function findLastAchievedGoal(messages: readonly Message[]): AchievedGoal | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const attachment = msg?.type === 'attachment' ? msg.attachment : undefined;
    if (attachment?.type !== 'goal_status') continue;
    if (!attachment.met || attachment.sentinel) continue;
    const condition = attachment.condition;
    if (typeof condition !== 'string' || condition.length === 0) continue;
    return {
      condition,
      iterations: typeof attachment.iterations === 'number' ? attachment.iterations : undefined,
      durationMs: typeof attachment.durationMs === 'number' ? attachment.durationMs : undefined,
      tokens: typeof attachment.tokens === 'number' ? attachment.tokens : undefined,
    };
  }
  return null;
}

/** densable k — "Label: children" row. */
function GoalField({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text dimColor>
          {label}
          {': '}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap">{children}</Text>
      </Box>
    </Box>
  );
}

/** densable Xr — empty-state body + optional hint. */
function EmptyHint({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }): React.ReactNode {
  if (!hint) {
    return <Text dimColor>{children}</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text dimColor>{children}</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

function GoalStatusDialog({ messages, onDone }: GoalStatusDialogProps): React.ReactNode {
  const activeGoal = useAppState(s => s.activeGoal);
  const [, setTick] = useState(0);
  useInterval(() => setTick(n => n + 1), activeGoal ? 1000 : null);

  if (activeGoal) {
    const elapsed = formatDuration(Date.now() - activeGoal.setAt, {
      mostSignificantOnly: true,
    });
    const tokenDelta = getTotalOutputTokens() - activeGoal.tokensAtStart;
    const subtitle = [
      `running ${elapsed}`,
      activeGoal.iterations > 0 && `${activeGoal.iterations} ${plural(activeGoal.iterations, 'turn')}`,
      `${formatNumber(tokenDelta)} tokens`,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <Dialog
        title={`${GOAL_ACTIVE_MARK} Goal active`}
        subtitle={subtitle}
        onCancel={onDone}
        inputGuide={() => (
          <Byline>
            <Text>/goal clear to stop early</Text>
            <KeyboardShortcutHint shortcut="Esc" action="dismiss" />
          </Byline>
        )}
      >
        <Box flexDirection="column">
          <GoalField label="Goal">{activeGoal.condition}</GoalField>
          {activeGoal.lastReason ? (
            <GoalField label="Last check">{firstLineOf(activeGoal.lastReason.trim())}</GoalField>
          ) : null}
        </Box>
      </Dialog>
    );
  }

  const achieved = findLastAchievedGoal(messages);
  if (achieved) {
    const bits: string[] = [];
    if (achieved.durationMs !== undefined) {
      bits.push(formatDuration(achieved.durationMs, { mostSignificantOnly: true }));
    }
    if (achieved.iterations !== undefined) {
      bits.push(`${achieved.iterations} ${plural(achieved.iterations, 'turn')}`);
    }
    if (achieved.tokens !== undefined) {
      bits.push(`${formatNumber(achieved.tokens)} tokens`);
    }
    return (
      <Dialog
        title={
          <>
            <StatusIcon status="success" withSpace />
            Goal achieved
          </>
        }
        subtitle={bits.join(' · ')}
        color="success"
        onCancel={onDone}
        inputGuide={() => (
          <Byline>
            <Text>/goal {'<condition>'} to set another</Text>
            <KeyboardShortcutHint shortcut="Esc" action="dismiss" />
          </Byline>
        )}
      >
        <GoalField label="Goal">{achieved.condition}</GoalField>
      </Dialog>
    );
  }

  return (
    <Dialog title="Goal" onCancel={onDone} inputGuide={() => <KeyboardShortcutHint shortcut="Esc" action="dismiss" />}>
      <EmptyHint hint="/goal <condition> to set one">No goal set</EmptyHint>
    </Dialog>
  );
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const input = args.trim();
  if (input === '') {
    return <GoalStatusDialog messages={context.messages} onDone={() => onDone(undefined, { display: 'skip' })} />;
  }
  if (isGoalClearKeyword(input)) {
    const cleared = await applyGoalClear(context);
    onDone(cleared === null ? 'No goal set' : `Goal cleared: ${cleared}`, {
      display: 'system',
    });
    return null;
  }
  if (input.length > MAX_GOAL_CONDITION_LENGTH) {
    logGoalTooLong();
    onDone(`Goal condition is limited to ${MAX_GOAL_CONDITION_LENGTH} characters (got ${input.length})`, {
      display: 'system',
    });
    return null;
  }
  const gate = await applyGoalSet(input, context);
  if (gate !== null) {
    onDone(gate, { display: 'system' });
    return null;
  }
  onDone(`Goal set: ${input}`, {
    shouldQuery: true,
    metaMessages: [GOAL_SYSTEM_MESSAGE(input)],
  });
  return null;
};
