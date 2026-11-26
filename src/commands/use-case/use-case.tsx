import React, { useRef } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import {
  type ProgramUseCaseChoice,
  forgetSavedProgramUseCase,
  getCurrentProgramUseCaseId,
  getEnvLockedProgramUseCaseId,
  getProgramUseCaseChoiceMode,
  getProgramUseCaseChoices,
  readSavedProgramUseCaseId,
  selectProgramUseCase,
} from './useCaseStore.js';

const FORGET_VALUE = '__forget__';

function findChoice(choices: readonly ProgramUseCaseChoice[], query: string): ProgramUseCaseChoice | undefined {
  const lower = query.toLowerCase();
  return choices.find(c => c.id === query || c.name.toLowerCase() === lower);
}

function UseCasePicker({
  choices,
  currentId,
  hasSaved,
  onChoose,
  onForget,
  onCancel,
}: {
  choices: readonly ProgramUseCaseChoice[];
  currentId: string | null;
  hasSaved: boolean;
  onChoose: (choice: ProgramUseCaseChoice) => void;
  onForget: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const settled = useRef(false);
  const options = [
    ...choices.map(c => ({
      label: c.id === currentId ? `${c.name} (current)` : c.name,
      ...(c.description ? { description: c.description } : {}),
      value: c.id,
    })),
    ...(hasSaved ? [{ label: 'Forget saved use case', value: FORGET_VALUE }] : []),
  ];

  return (
    <Dialog
      title="Choose Life Sciences use case"
      onCancel={() => {
        if (!settled.current) {
          settled.current = true;
          onCancel();
        }
      }}
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Choose the Life Sciences use case that applies to your requests:</Text>
        <Select<string>
          options={options}
          defaultFocusValue={currentId ?? choices[0]?.id}
          onChange={value => {
            if (settled.current) return;
            settled.current = true;
            if (value === FORGET_VALUE) {
              onForget();
              return;
            }
            const found = choices.find(c => c.id === value);
            if (found) onChoose(found);
          }}
          onCancel={() => {
            if (!settled.current) {
              settled.current = true;
              onCancel();
            }
          }}
        />
      </Box>
    </Dialog>
  );
}

/**
 * Official 2.1.331 `chunk-ba2864wv.js` — `/use-case` interactive selector and direct matcher.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const choices = getProgramUseCaseChoices();

  if (getEnvLockedProgramUseCaseId() !== null) {
    onDone(
      "This session's use case was set by the app that started it, so it can't be changed here. To change it, use that app.",
      { display: 'system' },
    );
    return null;
  }

  if (choices.length === 1 && choices[0] !== undefined) {
    onDone(`You have one Life Sciences use case: ${choices[0].name}. There's nothing to choose.`, {
      display: 'system',
    });
    return null;
  }

  if (getProgramUseCaseChoiceMode() === 'per_grant') {
    onDone("Your Life Sciences use cases all apply to your requests automatically, so there's nothing to choose.", {
      display: 'system',
    });
    return null;
  }

  if (choices.length === 0) {
    onDone(
      "No Life Sciences use cases are available in this session. If you expected some, restart Claude Code or ask your organization's admin.",
      { display: 'system' },
    );
    return null;
  }

  const applyChoice = (choice: ProgramUseCaseChoice) => {
    const status = selectProgramUseCase(choice.id);
    if (status === 'not_offered') {
      onDone(`${choice.name} is no longer available. Run /use-case again.`, {
        display: 'system',
      });
      return;
    }
    onDone(
      status === 'saved'
        ? `Use case set to ${choice.name}. It applies from your next request and in later sessions.`
        : `Use case set to ${choice.name} from your next request. It couldn't be saved, so later sessions won't use it.`,
      { display: 'system' },
    );
  };

  const applyForget = () => {
    const ok = forgetSavedProgramUseCase();
    onDone(
      ok
        ? "Saved use case forgotten. You'll be asked to choose one when you next send a message, unless your account's default use case applies first. Restarting Claude Code applies that default, if you have one."
        : "Claude Code couldn't confirm your saved use case was removed, so this and later sessions may still use it. If one does, run /use-case there to forget it.",
      { display: 'system' },
    );
  };

  const query = (args ?? '').trim();
  if (query.length > 0) {
    const matched = findChoice(choices, query);
    if (matched === undefined) {
      const names = choices.map(c => c.name).join(', ');
      onDone(`There's no use case called "${query}". Run /use-case with one of: ${names}.`, { display: 'system' });
      return null;
    }
    applyChoice(matched);
    return null;
  }

  return (
    <UseCasePicker
      choices={choices}
      currentId={getCurrentProgramUseCaseId()}
      hasSaved={readSavedProgramUseCaseId() !== null}
      onChoose={applyChoice}
      onForget={applyForget}
      onCancel={() => onDone('Use case unchanged.', { display: 'system' })}
    />
  );
}
