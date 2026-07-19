import * as React from 'react';
import { Settings } from '../../components/Settings/Settings.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import {
  applyConfigShorthand,
  configShorthandUsage,
  isConfigHelpOrListToken,
  parseConfigShorthand,
} from './argumentCompletions.js';

/**
 * densable JO_ (2.1.211):
 * - no args → open Settings panel (Config tab)
 * - help/list tokens → system usage + key list
 * - key=value… → apply shorthand, system message, no panel
 */
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const trimmed = args?.trim() || '';
  if (!trimmed) {
    return <Settings onClose={onDone} context={context} defaultTab="Config" />;
  }

  const lower = trimmed.toLowerCase();
  if (isConfigHelpOrListToken(lower)) {
    onDone(configShorthandUsage(), { display: 'system' });
    return null;
  }

  const pairs = parseConfigShorthand(trimmed);
  if (!pairs) {
    onDone(`Expected key=value, got "${trimmed}". Run /config to open settings.`, { display: 'system' });
    return null;
  }

  // densable BEp: apply once on mount then onDone — fork applies inline.
  const results = await applyConfigShorthand(pairs);
  onDone(results.map(r => r.message).join('\n'), { display: 'system' });
  return null;
};
