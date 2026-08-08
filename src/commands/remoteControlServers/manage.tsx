/**
 * densable multi-env Remote Control manage surface (list → B8a detail).
 * /remote-control-servers interactive path.
 */
import * as React from 'react';
import { RemoteControlServersManageDialog } from '../../components/RemoteControlServersManageDialog.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  return (
    <RemoteControlServersManageDialog
      filter={args?.trim() || undefined}
      onDone={(result, options) => {
        onDone(result, options);
      }}
    />
  );
};
