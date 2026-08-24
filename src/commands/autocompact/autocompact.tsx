import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { isAutoCompactEnabled } from '../../services/compact/autoCompact.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';
import {
  AUTO_COMPACT_WINDOW_MAX,
  AUTO_COMPACT_WINDOW_MIN,
  AUTO_COMPACT_WINDOW_STEP,
  applyAutoCompactWindow,
  describeAutoCompactWindowSource,
  formatAutoCompactWindowStatus,
  resolveAutoCompactWindow,
} from '../../utils/autoCompactWindow.js';
import { formatTokens } from '../../utils/format.js';
import { getInitialSettings } from '../../utils/settings/settings.js';

/** densable kSe sentinel for "auto" in the dialog cursor. */
const AUTO_SENTINEL = 0;

function ApplyAutoCompactArgs({ args, onDone }: { args: string; onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const model = useMainLoopModel();
  React.useEffect(() => {
    onDone(applyAutoCompactWindow(args, model));
  }, [args, model, onDone]);
  return null;
}

function AutoCompactWindowDialog({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const model = useMainLoopModel();
  const settingsWindow = getInitialSettings().autoCompactWindow;
  const resolved = resolveAutoCompactWindow(model, settingsWindow);
  const { window: effectiveWindow, configured, source } = resolved;
  const envLocked = source === 'env';

  // densable juD: start cursor at auto for auto/experiment/… else snap to step
  const initialCursor =
    source === 'auto' || source === 'experiment' || source === 'clientdata' || source === 'unknown-model'
      ? AUTO_SENTINEL
      : Math.min(
          AUTO_COMPACT_WINDOW_MAX,
          Math.max(
            AUTO_COMPACT_WINDOW_MIN,
            Math.round(configured / AUTO_COMPACT_WINDOW_STEP) * AUTO_COMPACT_WINDOW_STEP,
          ),
        );

  const [cursor, setCursor] = useState(initialCursor);
  const [dirty, setDirty] = useState(false);
  const doneRef = useRef(false);

  const step = useCallback(
    (delta: number) => {
      if (envLocked) return;
      setDirty(true);
      setCursor(prev => {
        if (prev === AUTO_SENTINEL) {
          return delta > 0 ? AUTO_COMPACT_WINDOW_MIN : AUTO_COMPACT_WINDOW_MAX;
        }
        const next = prev + delta * AUTO_COMPACT_WINDOW_STEP;
        if (next < AUTO_COMPACT_WINDOW_MIN) return AUTO_SENTINEL;
        if (next > AUTO_COMPACT_WINDOW_MAX) return AUTO_SENTINEL;
        return next;
      });
    },
    [envLocked],
  );

  const currentLabel = describeAutoCompactWindowSource(resolved);
  const subtitle = `Current setting: ${currentLabel}`;
  const selectionLabel = cursor === AUTO_SENTINEL ? 'auto' : `${formatTokens(cursor)} tokens`;

  const finish = useCallback(
    (message: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone(message);
    },
    [onDone],
  );

  const accept = useCallback(() => {
    if (doneRef.current) return;
    if (!dirty) {
      finish(`Auto-compact window unchanged: ${currentLabel}`);
      return;
    }
    const arg = cursor === AUTO_SENTINEL ? 'auto' : String(cursor);
    finish(applyAutoCompactWindow(arg, model));
  }, [cursor, dirty, currentLabel, finish, model]);

  const cancel = useCallback(() => {
    finish(`Auto-compact window unchanged: ${currentLabel}`);
  }, [currentLabel, finish]);

  useKeybindings(
    {
      'select:previous': () => step(1),
      'select:next': () => step(-1),
      'select:accept': accept,
    },
    { context: 'Select' },
  );
  useKeybindings(
    {
      'tabs:next': () => step(1),
      'tabs:previous': () => step(-1),
    },
    { context: 'Tabs' },
  );

  return (
    <Dialog
      title="Auto-compact window"
      subtitle={subtitle}
      onCancel={cancel}
      inputGuide={() => (
        <Byline>
          <KeyboardShortcutHint shortcut="↑/↓" action="change" />
          <KeyboardShortcutHint shortcut="Enter" action="apply" />
          <KeyboardShortcutHint shortcut="Esc" action="cancel" />
        </Byline>
      )}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          This command configures when auto-compaction happens. The actual threshold is the minimum of this setting and
          your model&apos;s maximum context window.
        </Text>
        <Text>
          The auto setting picks a window tuned for your model and is <Text bold>strongly recommended</Text> for the
          best cost and performance. You can override it below.
        </Text>
        {!isAutoCompactEnabled() && <Text color="warning">Auto-compact is currently disabled (see /config)</Text>}
        {cursor !== AUTO_SENTINEL && (
          <Text color="warning">
            Overriding auto may result in high token usage, especially when resuming long sessions.
          </Text>
        )}
        {envLocked ? (
          <Text color="warning">
            CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting here.
          </Text>
        ) : (
          <Box>
            <Text>Select auto-compact window: </Text>
            <Text bold color="suggestion">
              {selectionLabel}
            </Text>
            {configured > effectiveWindow ? (
              <Text dimColor> · capped to {formatTokens(effectiveWindow)} by model</Text>
            ) : null}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}

/** densable non-interactive / headless text path (uxi). */
export function formatStatusForModel(model: string): string {
  return formatAutoCompactWindowStatus(model);
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const n = args?.trim() || '';
  if (n) {
    return <ApplyAutoCompactArgs args={n} onDone={onDone} />;
  }

  logEvent('tengu_autocompact_dialog_opened', {
    source: 'dialog' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  return <AutoCompactWindowDialog onDone={onDone} />;
};
