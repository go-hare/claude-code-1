import * as React from 'react';
import { useEffect, useRef } from 'react';
import { useTheme } from '@anthropic/ink';
import { Settings } from '../../components/Settings/Settings.js';
import type { LocalJSXCommandCall, LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import {
  applyConfigShorthandFromArgs,
  formatConfigShorthandUsage,
  getConfigSettingsCatalog,
  isConfigHelpOrListToken,
  parseConfigKeyValueArgs,
} from './configShorthand.js';

/**
 * Official 2.1.331 `d` (@364068550): mount a lightweight Ink component when
 * running `/config key=value` interactively so `useTheme()` provides the live
 * Ink theme setter to `ceFromCommandContext` / `applyConfigKeyValues`.
 */
function ConfigShorthandRunner({
  rawArgs,
  caller,
  onDone,
}: {
  rawArgs: string;
  caller: LocalJSXCommandContext;
  onDone: LocalJSXCommandOnDone;
}): React.ReactNode {
  const [, setTheme] = useTheme();
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void applyConfigShorthandFromArgs(rawArgs, caller, { setTheme }).then(message => {
      onDone(message, { display: 'system' });
    });
  }, [rawArgs, caller, onDone, setTheme]);
  return null;
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const trimmed = args?.trim() || '';
  if (!trimmed) {
    return <Settings onClose={onDone} context={context} defaultTab="Config" />;
  }
  const lower = trimmed.toLowerCase();
  if (isConfigHelpOrListToken(lower)) {
    const usage = formatConfigShorthandUsage(await getConfigSettingsCatalog(context, { includeHooks: false }));
    onDone(`Run /config to open settings, or /config key=value to set one directly.\n${usage}`, {
      display: 'system',
    });
    return null;
  }
  if (!parseConfigKeyValueArgs(trimmed)) {
    onDone(`Expected key=value, got "${trimmed}". Run /config to open settings.`, {
      display: 'system',
    });
    return null;
  }
  return <ConfigShorthandRunner rawArgs={trimmed} caller={context} onDone={onDone} />;
};
