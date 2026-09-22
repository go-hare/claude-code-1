import React, { useMemo, useState } from 'react';
import { Box, Dialog, Text, useInput } from '@anthropic/ink';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { callTui, type TuiRelaunchCarryInput } from './index.js';

type TuiAction = {
  label: string;
  description: string;
  run: () => void;
};

const ACTION_LABEL_COLUMN_WIDTH = 24;

function carryFromContext(context: unknown): TuiRelaunchCarryInput | undefined {
  try {
    const ctx = context as {
      getAppState?: () => {
        toolPermissionContext?: TuiRelaunchCarryInput['toolPermissionContext'];
        effortValue?: unknown;
        tasks?: TuiRelaunchCarryInput['tasks'];
        messages?: TuiRelaunchCarryInput['messages'];
        proactivityLevel?: unknown;
      };
      messages?: TuiRelaunchCarryInput['messages'];
      getProactivityLevel?: () => unknown;
      storageV5?: unknown;
    };
    const state = ctx.getAppState?.();
    const messages = ctx.messages ?? state?.messages;
    if (
      !state?.toolPermissionContext &&
      !state?.tasks &&
      messages === undefined &&
      !ctx.getProactivityLevel &&
      ctx.storageV5 === undefined &&
      state?.proactivityLevel === undefined
    ) {
      return undefined;
    }
    return {
      toolPermissionContext: state?.toolPermissionContext,
      effort: state?.effortValue,
      tasks: state?.tasks,
      messages,
      getProactivityLevel: ctx.getProactivityLevel,
      storageV5: ctx.storageV5,
      proactivityLevel: state?.proactivityLevel,
    };
  } catch {
    return undefined;
  }
}

async function runTuiAction(
  subcommand: string,
  onDone: LocalJSXCommandOnDone,
  carry?: TuiRelaunchCarryInput,
): Promise<void> {
  const result = await callTui(subcommand, carry);
  if (result.type === 'text') {
    onDone(result.value, { display: 'system' });
  }
}

function TuiPanel({
  onDone,
  carry,
}: {
  onDone: LocalJSXCommandOnDone;
  carry?: TuiRelaunchCarryInput;
}): React.ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const actions = useMemo<TuiAction[]>(
    () => [
      {
        label: 'Status',
        description: 'Show marker and environment override state',
        run: () => void runTuiAction('status', onDone, carry),
      },
      {
        label: 'Toggle',
        description: 'Flip persisted TUI mode for the next session',
        run: () => void runTuiAction('toggle', onDone, carry),
      },
      {
        label: 'On',
        description: 'Enable flicker-free alternate-screen mode',
        run: () => void runTuiAction('on', onDone, carry),
      },
      {
        label: 'Off',
        description: 'Disable flicker-free alternate-screen mode',
        run: () => void runTuiAction('off', onDone, carry),
      },
    ],
    [onDone, carry],
  );

  const selectCurrent = () => {
    const action = actions[selectedIndex];
    if (!action) return;
    action.run();
  };

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex(index => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(index => Math.min(actions.length - 1, index + 1));
      return;
    }
    if (key.return) {
      selectCurrent();
    }
  });

  return (
    <Dialog
      title="TUI Mode"
      subtitle={`${actions.length} actions`}
      onCancel={() => onDone('TUI mode panel dismissed', { display: 'system' })}
      color="background"
      hideInputGuide
    >
      <Box flexDirection="column">
        {actions.map((action, index) => (
          <Box key={action.label} flexDirection="row">
            <Text>{`${index === selectedIndex ? '›' : ' '} ${action.label}`.padEnd(ACTION_LABEL_COLUMN_WIDTH)}</Text>
            <Text dimColor>{action.description}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>↑/↓ select · Enter run · Esc close</Text>
        </Box>
      </Box>
    </Dialog>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, context: unknown, args?: string): Promise<React.ReactNode> {
  const carry = carryFromContext(context);
  const trimmed = args?.trim() ?? '';
  if (trimmed) {
    await runTuiAction(trimmed, onDone, carry);
    return null;
  }
  return <TuiPanel onDone={onDone} carry={carry} />;
}
