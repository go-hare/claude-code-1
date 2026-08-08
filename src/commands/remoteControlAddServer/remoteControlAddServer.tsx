/**
 * densable 2.1.218 multi-env Add-server command call surface.
 * Mounts RemoteControlAddServerDialog (form → Trust this directory? → Omt → qpn).
 */
import * as React from 'react';
import { RemoteControlAddServerDialog } from '../../components/RemoteControlAddServerDialog.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = args?.trim();
  return (
    <RemoteControlAddServerDialog
      initialDir={trimmed || undefined}
      onDone={result => {
        if (result === 'cancelled') {
          onDone('Remote Control Add server cancelled.', { display: 'system' });
          return;
        }
        onDone(result === 'updated' ? 'Remote Control server updated.' : 'Remote Control server added.', {
          display: 'system',
        });
      }}
    />
  );
};
