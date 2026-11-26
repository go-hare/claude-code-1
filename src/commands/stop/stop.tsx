import type * as React from 'react';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { getActiveAttachHandle, stopBackgroundSession } from './stopCore.js';

/**
 * Official 2.1.331 `Q9s` — interactive `/stop` handler.
 */
export async function call(onDone: LocalJSXCommandOnDone, _context: LocalJSXCommandContext): Promise<React.ReactNode> {
  onDone();
  const attach = getActiveAttachHandle();
  if (attach !== null) {
    attach.close();
    return null;
  }
  await stopBackgroundSession('stop_command');
  return null;
}
