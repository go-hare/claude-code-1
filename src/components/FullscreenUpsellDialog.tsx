/**
 * Official densable fullscreen TUI upsell dialog (Npf accept path).
 * Pure gate: utils/fullscreenUpsellGate.ts.
 * Accept → enable /tui marker + mark fully seen; decline → mark fully seen.
 *
 * densable 2.1.234: accept must pass live AppState into `/tui on` so W4e refuse
 * and Cmt+Rmt carry see `un(t)` (toolPermissionContext + effort), same as the
 * slash-command panel path — never callTui('on') with empty carry.
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React from 'react';
import { callTui, type TuiRelaunchCarryInput } from '../commands/tui/index.js';
import { useAppStateStore } from '../state/AppState.js';
import { saveGlobalConfig } from '../utils/config.js';
import { markFullscreenUpsellFullySeen, recordFullscreenUpsellImpression } from '../utils/fullscreenUpsellGate.js';
import { ConfirmSelect } from './ConfirmSelect.js';

export type FullscreenUpsellDialogProps = {
  onDone: (result: 'accepted' | 'declined') => void;
};

type Choice = 'accept' | 'decline';

/** densable un(t) + taskRegistry snapshot for /tui relaunch from upsell accept. */
export function carryFromAppStore(store: {
  getState: () => {
    toolPermissionContext?: TuiRelaunchCarryInput['toolPermissionContext'];
    effortValue?: unknown;
    tasks?: TuiRelaunchCarryInput['tasks'];
    messages?: TuiRelaunchCarryInput['messages'];
    proactivityLevel?: unknown;
  };
}): TuiRelaunchCarryInput | undefined {
  try {
    const state = store.getState();
    if (
      !state.toolPermissionContext &&
      !state.tasks &&
      state.messages === undefined &&
      state.proactivityLevel === undefined
    ) {
      return undefined;
    }
    return {
      toolPermissionContext: state.toolPermissionContext,
      effort: state.effortValue,
      tasks: state.tasks,
      messages: state.messages,
      proactivityLevel: state.proactivityLevel,
    };
  } catch {
    return undefined;
  }
}

export function FullscreenUpsellDialog({ onDone }: FullscreenUpsellDialogProps): React.ReactNode {
  const store = useAppStateStore();

  // Official udc: increment seen on show so an unanswered prompt still counts
  // toward M4r=3 (changelog #21). Decline still jfn-caps at max.
  React.useEffect(() => {
    saveGlobalConfig(prev => ({
      ...prev,
      ...recordFullscreenUpsellImpression(prev),
    }));
  }, []);

  function handleSelect(value: Choice): void {
    if (value === 'accept') {
      // densable 2.1.234: /tui on path owns W4e refuse + Cmt/Rmt carry + OLt
      // relaunch (callTui → enableTui → acceptTuiRelaunch). Do not double-call
      // acceptTuiRelaunch here.
      void (async () => {
        await callTui('on', carryFromAppStore(store));
        saveGlobalConfig(prev => ({
          ...prev,
          ...markFullscreenUpsellFullySeen(prev),
        }));
        onDone('accepted');
      })();
      return;
    }
    saveGlobalConfig(prev => ({
      ...prev,
      ...markFullscreenUpsellFullySeen(prev),
    }));
    onDone('declined');
  }

  // densable 2.1.289 p8 @208494727: qn focus is "cancel" when the dialog was
  // dismissed, otherwise "confirm".
  return (
    <Dialog title="Try the new fullscreen renderer?" onCancel={() => handleSelect('decline')}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>· Flicker-free output — fixes the flashing you see during long responses</Text>
          <Text dimColor>· Mouse support — click to move your cursor or expand results</Text>
          <Text dimColor>· Selected text auto-copies to your clipboard</Text>
        </Box>
        <ConfirmSelect
          confirmLabel="Yes, try it"
          cancelLabel="Not now"
          onConfirm={() => handleSelect('accept')}
          onCancel={() => handleSelect('decline')}
        />
      </Box>
    </Dialog>
  );
}
