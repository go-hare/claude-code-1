import React from 'react';
import { Settings } from '../../components/Settings/Settings.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';

/**
 * /usage — unified command replacing /cost and /stats (v2.1.289 upstream alignment).
 *
 * Routing:
 *   - /stats → Settings panel → Stats tab
 *   - /usage or /cost → Settings panel → Usage tab
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
  invokedName?: string,
): Promise<React.ReactNode> {
  const defaultTab = invokedName === 'stats' ? 'Stats' : 'Usage';
  return <Settings onClose={onDone} context={context} defaultTab={defaultTab} />;
}
