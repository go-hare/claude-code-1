import { Settings } from '../../components/Settings/Settings.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import {
  applyConfigShorthandFromArgs,
  formatConfigShorthandUsage,
  getConfigSettingsCatalog,
  isConfigHelpOrListToken,
  parseConfigKeyValueArgs,
} from './configShorthand.js';

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const trimmed = args?.trim() || '';
  if (!trimmed) {
    return <Settings onClose={onDone} context={context} defaultTab="Config" />;
  }
  const lower = trimmed.toLowerCase();
  if (isConfigHelpOrListToken(lower)) {
    const usage = formatConfigShorthandUsage(await getConfigSettingsCatalog(context));
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
  const message = await applyConfigShorthandFromArgs(trimmed, context);
  onDone(message, { display: 'system' });
  return null;
};
