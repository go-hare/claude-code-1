import * as React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Byline, Dialog, type KeyboardEvent, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { getSdkBetas } from '../../bootstrap/state.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
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
  describeAutoCompactWindowSource,
  formatAutoCompactWindowStatus,
  parseAutoCompactWindowArg,
  resolveAutoCompactWindow,
} from '../../utils/autoCompactWindow.js';
import { getContextWindowForModel } from '../../utils/context.js';
import { canonicalEffortModelKey } from '../../utils/effort.js';
import { formatTokens } from '../../utils/format.js';
import { getDefaultMainLoopModel, parseUserSpecifiedModel } from '../../utils/model/model.js';
import { resolveAutoCompactWindowOverride } from '../../utils/residualFinalEnvGates.js';
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { findNearestSliderStopIndex } from '../../components/EffortPanel/EffortPanel.js';

/** densable kSe sentinel for "auto" in the dialog cursor. */
const AUTO_SENTINEL = 0;

export type ValueSliderStop = {
  value: number;
  label: string;
};

/**
 * Official 2.1.326 #285: build all discrete stops for the `/autocompact` slider
 * (`auto`, `100k`, `200k`, ..., `1M`).
 */
export function buildAutoCompactSliderStops(): ValueSliderStop[] {
  const stops: ValueSliderStop[] = [{ value: AUTO_SENTINEL, label: 'auto' }];
  for (let v = AUTO_COMPACT_WINDOW_MIN; v <= AUTO_COMPACT_WINDOW_MAX; v += AUTO_COMPACT_WINDOW_STEP) {
    stops.push({ value: v, label: formatTokens(v) });
  }
  return stops;
}

/**
 * Official 2.1.326 #285: compute horizontal stop positions for a value slider
 * that shows every value and adapts gap width to narrow terminals.
 */
export function computeValueSliderLayout(
  stops: readonly ValueSliderStop[],
  maxWidth: number,
): {
  width: number;
  stopCols: number[];
  gap: number;
  trackChars: string;
  compact: boolean;
} {
  const minSum = stops.reduce((sum, s) => sum + s.label.length, 0);
  const count = stops.length;
  const availableGap = count > 1 ? Math.floor((maxWidth - minSum) / (count - 1)) : 0;
  const compact = availableGap < 1;
  const gap = compact ? 1 : Math.min(2, availableGap);
  const stopCols: number[] = [];
  let col = 0;
  for (let i = 0; i < count; i++) {
    const labelLen = stops[i]!.label.length;
    stopCols.push(col + Math.floor(labelLen / 2));
    col += labelLen + (i < count - 1 ? gap : 0);
  }
  const width = Math.max(1, col);
  const track = Array.from({ length: width }, (_, c) => (stopCols.includes(c) ? '●' : '─')).join('');
  return { width, stopCols, gap, trackChars: track, compact };
}

/**
 * Official jSr — only warn about high token usage when the selected window
 * exceeds the model's auto-compact window.
 */
export function shouldWarnHighTokenUsage(
  model: string,
  selectedWindow: number,
  autoWindow: number = resolveAutoCompactWindow(model, undefined).window,
): boolean {
  const modelContextWindow = getContextWindowForModel(model, getSdkBetas());
  return Math.min(modelContextWindow, selectedWindow) > autoWindow;
}

/**
 * Official V3s — build per-model settings patch, falling back to top-level
 * if canonical key collides with Object.prototype.
 */
export function buildAutoCompactModelSettingsPatch(
  model: string,
  perModelValue: { autoCompactWindow: 'auto' | number },
  topLevelFallback: { autoCompactWindow: number | undefined },
): Partial<SettingsJson> {
  const key = canonicalEffortModelKey(model);
  return Object.hasOwn(Object.prototype, key) ? topLevelFallback : { modelSettings: { [key]: perModelValue } };
}

/**
 * Resolve per-model autoCompactWindow from settings (modelSettings[canonical]
 * overrides top-level autoCompactWindow; 'auto' resolves to undefined).
 */
export function resolvePerModelAutoCompactWindow(
  model: string,
  settings: Pick<SettingsJson, 'autoCompactWindow' | 'modelSettings'> = getInitialSettings(),
): number | undefined {
  const targetKey = canonicalEffortModelKey(model);
  let matched: 'auto' | number | undefined;
  for (const [rawKey, entry] of Object.entries(settings.modelSettings ?? {})) {
    const win = entry?.autoCompactWindow;
    if (win === undefined) continue;
    const canonical = canonicalEffortModelKey(rawKey);
    if (canonical !== targetKey) continue;
    if (rawKey === canonical) {
      matched = win;
      break;
    }
    matched ??= win;
  }
  if (matched !== undefined) {
    return matched === 'auto' ? undefined : matched;
  }
  return settings.autoCompactWindow;
}

/**
 * Official kht — persist per-model modelSettings.<model>.autoCompactWindow.
 */
export function applyPerModelAutoCompactWindow(raw: string, model: string): string {
  if (resolveAutoCompactWindowOverride() !== null) {
    return 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting.';
  }

  const parsed = parseAutoCompactWindowArg(raw);
  if (parsed === undefined) {
    return `Couldn't parse '${raw}'. Expected 'auto' or 100k–1M tokens (e.g. 500k, 200000, or 200 as shorthand)`;
  }

  const value = parsed === 'auto' ? undefined : parsed;
  const patch = buildAutoCompactModelSettingsPatch(model, { autoCompactWindow: parsed }, { autoCompactWindow: value });
  const { error } = updateSettingsForSource('userSettings', patch);
  if (error) {
    return `Couldn't save setting: ${error.message}`;
  }

  const after = resolvePerModelAutoCompactWindow(model, getInitialSettings());
  const { window, source } = resolveAutoCompactWindow(model, after);
  const higherPriority = source === 'env' || (value !== undefined && after !== value);

  logEvent('tengu_autocompact_command', {
    action: (parsed === 'auto' ? 'auto' : 'set') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(typeof value === 'number' ? { tokens: value } : {}),
  });

  if (parsed === 'auto') {
    return higherPriority
      ? `Auto-compact window set to auto in settings, but a higher-priority override is active (${formatTokens(window)} tokens)`
      : 'Auto-compact window set to auto';
  }

  let suffix = '';
  if (higherPriority) {
    suffix = `, but a higher-priority override is active (${formatTokens(window)} tokens)`;
  } else if (window < parsed) {
    suffix = ` (capped to model limit of ${formatTokens(window)})`;
  }
  return `Auto-compact window set to ${formatTokens(parsed)} tokens${suffix}`;
}

function ApplyAutoCompactArgs({ args, onDone }: { args: string; onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const model = useMainLoopModel();
  React.useEffect(() => {
    onDone(applyPerModelAutoCompactWindow(args, model));
  }, [args, model, onDone]);
  return null;
}

function AutoCompactWindowDialog({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const model = useMainLoopModel();
  const { columns } = useTerminalSize();
  const settingsWindow = resolvePerModelAutoCompactWindow(model, getInitialSettings());
  const resolved = resolveAutoCompactWindow(model, settingsWindow);
  const { window: effectiveWindow, configured, source } = resolved;
  const envLocked = source === 'env';

  const stops = useMemo(() => buildAutoCompactSliderStops(), []);
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

  const selectedIndex = Math.max(
    0,
    stops.findIndex(s => s.value === cursor),
  );

  const selectIndex = useCallback(
    (idx: number) => {
      if (envLocked) return;
      const clamped = Math.max(0, Math.min(stops.length - 1, idx));
      setDirty(true);
      setCursor(stops[clamped]!.value);
    },
    [envLocked, stops],
  );

  const step = useCallback(
    (delta: number) => {
      if (envLocked) return;
      setDirty(true);
      setCursor(prev => {
        const curIdx = Math.max(
          0,
          stops.findIndex(s => s.value === prev),
        );
        const nextIdx = Math.max(0, Math.min(stops.length - 1, curIdx + delta));
        return stops[nextIdx]!.value;
      });
    },
    [envLocked, stops],
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
    finish(applyPerModelAutoCompactWindow(arg, model));
  }, [cursor, dirty, currentLabel, finish, model]);

  const cancel = useCallback(() => {
    finish(`Auto-compact window unchanged: ${currentLabel}`);
  }, [currentLabel, finish]);

  // Official 2.1.326 #285: support Home/End in addition to Left/Right/Up/Down.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (envLocked) return;
      if (e.name === 'home') {
        e.preventDefault();
        selectIndex(0);
      } else if (e.name === 'end') {
        e.preventDefault();
        selectIndex(stops.length - 1);
      }
    },
    [envLocked, selectIndex, stops.length],
  );

  useKeybindings(
    {
      'select:previous': () => step(-1),
      'select:next': () => step(1),
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

  const availableWidth = Math.max(20, columns - 6);
  const layout = useMemo(() => computeValueSliderLayout(stops, availableWidth), [stops, availableWidth]);
  const markerCol = layout.stopCols[selectedIndex] ?? 0;
  const trackBefore = layout.trackChars.slice(0, markerCol);
  const trackAfter = layout.trackChars.slice(markerCol + 1);

  return (
    <Dialog
      title="Auto-compact window"
      subtitle={subtitle}
      onCancel={cancel}
      inputGuide={() => (
        <Byline>
          <KeyboardShortcutHint shortcut="←/→" action="adjust" />
          <KeyboardShortcutHint shortcut="Home/End" action="min/max" />
          <KeyboardShortcutHint shortcut="Enter" action="apply" />
          <KeyboardShortcutHint shortcut="Esc" action="cancel" />
        </Byline>
      )}
    >
      <Box flexDirection="column" gap={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
        <Text>
          This command configures when auto-compaction happens. The actual threshold is the minimum of this setting and
          your model&apos;s maximum context window.
        </Text>
        <Text>
          The auto setting picks a window tuned for your model and is <Text bold>strongly recommended</Text> for the
          best cost and performance. You can override it below.
        </Text>
        {!isAutoCompactEnabled() && <Text color="warning">Auto-compact is currently disabled (see /config)</Text>}
        {cursor !== AUTO_SENTINEL && shouldWarnHighTokenUsage(model, cursor) && (
          <Text color="warning">
            Overriding auto may result in high token usage, especially when resuming long sessions.
          </Text>
        )}
        {envLocked ? (
          <Text color="warning">
            CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting here.
          </Text>
        ) : (
          <Box flexDirection="column" gap={0}>
            <Box>
              <Text>Window: </Text>
              <Text bold color="suggestion">
                {selectionLabel}
              </Text>
              {configured > effectiveWindow ? (
                <Text dimColor> · capped to {formatTokens(effectiveWindow)} by model</Text>
              ) : null}
            </Box>
            {layout.compact ? (
              <Box flexWrap="wrap" columnGap={1}>
                {stops.map((stop, idx) => (
                  <Box
                    key={stop.value}
                    onClick={e => {
                      e.stopImmediatePropagation();
                      selectIndex(idx);
                    }}
                  >
                    <Text
                      bold={idx === selectedIndex}
                      color={idx === selectedIndex ? 'suggestion' : undefined}
                      dimColor={idx !== selectedIndex}
                    >
                      {idx === selectedIndex ? `[${stop.label}]` : stop.label}
                    </Text>
                  </Box>
                ))}
              </Box>
            ) : (
              <Box flexDirection="column" width={layout.width}>
                <Box
                  onClick={e => {
                    e.stopImmediatePropagation();
                    selectIndex(findNearestSliderStopIndex(e.localCol, layout.stopCols));
                  }}
                >
                  <Text dimColor>{trackBefore}</Text>
                  <Text bold color="suggestion">
                    ▲
                  </Text>
                  <Text dimColor>{trackAfter}</Text>
                </Box>
                <Box>
                  {stops.map((stop, idx) => (
                    <React.Fragment key={stop.value}>
                      {idx > 0 && <Text>{' '.repeat(layout.gap)}</Text>}
                      <Box
                        onClick={e => {
                          e.stopImmediatePropagation();
                          selectIndex(idx);
                        }}
                      >
                        <Text
                          bold={idx === selectedIndex}
                          color={idx === selectedIndex ? 'suggestion' : undefined}
                          dimColor={idx !== selectedIndex}
                        >
                          {stop.label}
                        </Text>
                      </Box>
                    </React.Fragment>
                  ))}
                </Box>
              </Box>
            )}
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

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const n = args?.trim() || '';
  if (n) {
    if (typeof context?.getAppState === 'function') {
      const appState = context.getAppState();
      const model = parseUserSpecifiedModel(
        appState.mainLoopModelForSession ?? appState.mainLoopModel ?? getDefaultMainLoopModel(),
      );
      onDone(applyPerModelAutoCompactWindow(n, model));
      return null;
    }
    return <ApplyAutoCompactArgs args={n} onDone={onDone} />;
  }

  logEvent('tengu_autocompact_dialog_opened', {
    source: 'dialog' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  return <AutoCompactWindowDialog onDone={onDone} />;
};
