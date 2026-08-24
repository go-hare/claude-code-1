import * as React from 'react';
import { useEffect, useMemo } from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/select.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';
import {
  FABLE_ADVISOR_CREDITS_NOTICE,
  getAdvisorCommandAliases,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../../utils/advisor.js';
import {
  getDefaultMainLoopModelSetting,
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
  renderModelName,
} from '../../utils/model/model.js';
import { validateModel } from '../../utils/model/validateModel.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

const DOCS_URL = 'https://code.claude.com/docs/en/model-config';

/**
 * densable Mno — apply advisor choice (off | alias | model id).
 */
export function applyAdvisor(
  choice: string,
  baseModel: string,
  setAppState: ReturnType<typeof useSetAppState>,
): string {
  logEvent('tengu_advisor_command', {
    advisor: choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  if (choice === 'off' || choice === 'unset') {
    setAppState(s => (s.advisorModel === undefined ? s : { ...s, advisorModel: undefined }));
    updateSettingsForSource('userSettings', { advisorModel: undefined });
    return 'Advisor disabled';
  }

  const normalizedModel = normalizeModelStringForAPI(parseUserSpecifiedModel(choice));

  if (!isValidAdvisorModel(normalizedModel)) {
    if (normalizedModel.toLowerCase().includes('fable') || choice.toLowerCase() === 'fable') {
      return `${FABLE_ADVISOR_CREDITS_NOTICE} Run /model fable to review and enable, then set it as the advisor.`;
    }
    const valid = [...getAdvisorCommandAliases(), 'off'].join(', ');
    return `${renderModelName(normalizedModel)} cannot be used as an advisor. Valid options: ${valid}`;
  }

  setAppState(s => (s.advisorModel === normalizedModel ? s : { ...s, advisorModel: normalizedModel }));
  updateSettingsForSource('userSettings', { advisorModel: normalizedModel });

  let msg = `Advisor set to ${renderModelName(normalizedModel)}`;
  if (!modelSupportsAdvisor(baseModel)) {
    msg += `\nNote: the current main model (${renderModelName(baseModel)}) does not support the advisor. It will activate when you switch to a supported main model.`;
  }
  return msg;
}

function AdvisorDialog({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const advisorModel = useAppState(s => s.advisorModel);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const setAppState = useSetAppState();
  const baseModel = parseUserSpecifiedModel(mainLoopModel ?? getDefaultMainLoopModelSetting());

  useEffect(() => {
    logEvent('tengu_advisor_dialog_shown', {});
  }, []);

  const aliases = useMemo(() => getAdvisorCommandAliases(), []);

  const options = useMemo(() => {
    const aliasOpts = aliases.map(a => ({
      label: renderModelName(parseUserSpecifiedModel(a)),
      value: a,
    }));
    // densable: if current is a custom valid advisor not in alias list, keep it
    const currentLower = advisorModel?.toLowerCase();
    const matchedAlias = currentLower ? aliases.find(a => currentLower.includes(a)) : undefined;
    const custom =
      advisorModel && !matchedAlias && isValidAdvisorModel(advisorModel)
        ? [
            {
              label: renderModelName(advisorModel),
              value: advisorModel,
            },
          ]
        : [];
    return [...aliasOpts, ...custom, { label: 'No advisor', value: 'off' }];
  }, [aliases, advisorModel]);

  const defaultValue = useMemo(() => {
    if (!advisorModel) return 'off';
    const currentLower = advisorModel.toLowerCase();
    const matched = aliases.find(a => currentLower.includes(a));
    if (matched) return matched;
    if (isValidAdvisorModel(advisorModel)) return advisorModel;
    return 'off';
  }, [advisorModel, aliases]);

  return (
    <Dialog title="Advisor (experimental)" onCancel={() => onDone(undefined, { display: 'skip' })}>
      <Box flexDirection="column" gap={1}>
        <Text>
          When Claude needs stronger judgment — a complex decision, an ambiguous failure, a problem it&apos;s circling
          without progress — it escalates to the advisor model for guidance, then resumes. The advisor runs server-side
          and uses additional tokens.
        </Text>
        {!modelSupportsAdvisor(baseModel) && (
          <Text color="warning">
            The current main model ({renderModelName(baseModel)}) does not support the advisor.
          </Text>
        )}
        <Select
          options={options}
          defaultValue={defaultValue}
          defaultFocusValue={defaultValue}
          onChange={value => {
            onDone(applyAdvisor(value, baseModel, setAppState));
          }}
          onCancel={() => onDone(undefined, { display: 'skip' })}
        />
        <Text>
          <Text color="suggestion">Recommended setup: </Text>
          Sonnet as the main model with Opus as the advisor. For certain workloads this gives near-Opus performance with
          reduced token usage.
        </Text>
        <Text dimColor>{DOCS_URL}</Text>
      </Box>
    </Dialog>
  );
}

function ApplyAdvisorArgs({ args, onDone }: { args: string; onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const setAppState = useSetAppState();
  const baseModel = parseUserSpecifiedModel(mainLoopModel ?? getDefaultMainLoopModelSetting());

  React.useEffect(() => {
    async function run(): Promise<void> {
      const arg = args.trim().toLowerCase();
      if (arg === 'off' || arg === 'unset') {
        onDone(applyAdvisor('off', baseModel, setAppState));
        return;
      }
      const resolved = parseUserSpecifiedModel(args.trim());
      const { valid, error } = await validateModel(resolved);
      if (!valid) {
        onDone(error ? `Invalid advisor model: ${error}` : `Unknown model: ${args.trim()} (${resolved})`);
        return;
      }
      onDone(applyAdvisor(args.trim(), baseModel, setAppState));
    }
    void run();
  }, [args, baseModel, onDone, setAppState]);

  return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = args?.trim() ?? '';
  if (trimmed) {
    return <ApplyAdvisorArgs args={trimmed} onDone={onDone} />;
  }
  return <AdvisorDialog onDone={onDone} />;
};
