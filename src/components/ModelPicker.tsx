import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { has1mContext } from '../utils/context.js';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import {
  clampEffortForModel,
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  getSupportedEffortLevels,
  getUltracodeEffortForModel,
  isEffortLaunchPinned,
  isEffortLevel,
  isUltracodeOfferable,
  modelSupportsEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
  unpinAllEffortLaunchPins,
} from '../utils/effort.js';
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js';
import { getModelOptions } from '../utils/model/modelOptions.js';
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline, KeyboardShortcutHint, Pane } from '@anthropic/ink';
import { effortLevelToSymbol } from './EffortIndicator.js';

export type Props = {
  initial: string | null;
  sessionModel?: ModelSetting;
  /**
   * densable: effort is EffortLevel only. Ultracode is applied as session
   * AppState inside the picker (not via this callback).
   *
   * When `deferEffortApply` is true, N9 / settings / AppState effort writes
   * are NOT applied here — caller must invoke the third `commitEffort`
   * callback after any gate (e.g. Fable consent) succeeds. Decline/cancel
   * must not call `commitEffort`.
   */
  onSelect: (model: string | null, effort: EffortLevel | undefined, commitEffort?: () => void) => void;
  onCancel?: () => void;
  isStandaloneCommand?: boolean;
  showFastModeNotice?: boolean;
  /** Overrides the dim header line below "Select model". */
  headerText?: string;
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped (written to the assistant's .claude/settings.json via
   * install.ts) and should not leak to the user's global ~/.claude/settings.
   * densable mk_: also skips session ultracode / effort AppState writes.
   */
  skipSettingsWrite?: boolean;
  /**
   * Defer N9 + effort AppState/settings writes until caller runs
   * `commitEffort` from onSelect. Used by /model Fable consent so decline
   * does not unpin launch pins or sticky effort.
   */
  deferEffortApply?: boolean;
};

const NO_PREFERENCE = '__NO_PREFERENCE__';

/** densable ModelPicker effort cursor: EffortLevel + optional ultracode slot. */
type PickerEffort = EffortLevel | 'ultracode';

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
  deferEffortApply,
}: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const exitState = useExitOnCtrlCDWithKeybindings();
  const maxVisible = 10;

  const initialValue = initial === null ? NO_PREFERENCE : initial;
  const [focusedValue, setFocusedValue] = useState<string | undefined>(initialValue);

  const isFastMode = useAppState(s => (isFastModeEnabled() ? s.fastMode : false));

  const [marked1MValues, setMarked1MValues] = useState<Set<string>>(
    () => new Set(has1mContext(initialValue) ? [initialValue.replace(/\[1m\]/i, '')] : []),
  );

  const handleToggle1M = useCallback(() => {
    if (!focusedValue || focusedValue === NO_PREFERENCE) return;
    // Key on the base value so lookups in handleSelect / is1MMarked match the
    // initializer — predefined 1M options arrive with a `[1m]` suffix in
    // `focusedValue`, which would diverge from the base-value key set.
    const baseKey = focusedValue.replace(/\[1m\]/i, '');
    setMarked1MValues(prev => {
      const next = new Set(prev);
      if (next.has(baseKey)) {
        next.delete(baseKey);
      } else {
        next.add(baseKey);
      }
      return next;
    });
  }, [focusedValue]);

  const [hasToggledEffort, setHasToggledEffort] = useState(false);
  const effortValue = useAppState(s => s.effortValue);
  const ultracodeFlag = useAppState(s => s.ultracode);
  // densable: AppState.ultracode → cursor "ultracode"; else effortValue level.
  const [effort, setEffort] = useState<PickerEffort | undefined>(() => {
    if (ultracodeFlag) return 'ultracode';
    return effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined;
  });

  // Memoize all derived values to prevent re-renders
  const modelOptions = useMemo(() => getModelOptions(isFastMode ?? false), [isFastMode]);

  // Ensure the initial value is in the options list
  // This handles edge cases where the user's current model (e.g., 'haiku' for 3P users)
  // is not in the base options but should still be selectable and shown as selected
  const optionsWithInitial = useMemo(() => {
    if (initial !== null && !modelOptions.some(opt => opt.value === initial)) {
      return [
        ...modelOptions,
        {
          value: initial,
          label: modelDisplayString(initial),
          description: 'Current model',
        },
      ];
    }
    return modelOptions;
  }, [modelOptions, initial]);

  const selectOptions = useMemo(
    () =>
      optionsWithInitial.map(opt => ({
        ...opt,
        value: opt.value === null ? NO_PREFERENCE : opt.value,
      })),
    [optionsWithInitial],
  );
  const initialFocusValue = useMemo(
    () => (selectOptions.some(_ => _.value === initialValue) ? initialValue : (selectOptions[0]?.value ?? undefined)),
    [selectOptions, initialValue],
  );
  const visibleCount = Math.min(maxVisible, selectOptions.length);
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount);

  const focusedModelName = selectOptions.find(opt => opt.value === focusedValue)?.label;
  const focusedModel = resolveOptionModel(focusedValue);
  const is1MMarked =
    focusedValue !== undefined &&
    focusedValue !== NO_PREFERENCE &&
    marked1MValues.has(focusedValue.replace(/\[1m\]/i, ''));
  const focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false;
  // densable MDe-shaped ladder (capability ∩ org). Exclusive catalog rows
  // (DeepSeek high|max, Grok low|medium|high, Kimi low|high|max) replace the
  // densable low/medium/high + max/xhigh flag filter.
  const focusedEffortLevels = focusedModel ? getSupportedEffortLevels(focusedModel) : [];
  // densable gbp `i` (gY): append ultracode when FE + wire tier available.
  const focusedUltracodeOfferable = focusedModel ? isUltracodeOfferable(focusedModel) : false;
  const focusedPickerLadder = useMemo((): readonly PickerEffort[] => {
    if (focusedEffortLevels.length === 0) return [];
    return focusedUltracodeOfferable ? [...focusedEffortLevels, 'ultracode'] : focusedEffortLevels;
  }, [focusedEffortLevels, focusedUltracodeOfferable]);
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue);
  const focusedUltracodeWire = focusedModel ? getUltracodeEffortForModel(focusedModel) : undefined;
  // densable r7s: !IGe && Ave(focused) → force model default for display/cycle base.
  // Session effort under pin is ignored until the user cycles (then confirm N9).
  const pinHoldsDisplay = !hasToggledEffort && focusedModel !== undefined && isEffortLaunchPinned(focusedModel);
  // densable display: pin forces hMt; ultracode cursor stays "ultracode"; else clamp.
  const displayEffort = ((): PickerEffort | undefined => {
    if (pinHoldsDisplay) return focusedDefaultEffort;
    if (effort === undefined) return effort;
    if (effort === 'ultracode') {
      // densable: ultracode + !offerable → fall back to max/high
      if (focusedUltracodeOfferable) return 'ultracode';
      if (focusedEffortLevels.includes('max')) return 'max';
      if (focusedEffortLevels.includes('high')) return 'high';
      return focusedDefaultEffort;
    }
    if (!focusedModel) return effort;
    const clamped = clampEffortForModel(effort, focusedModel);
    return typeof clamped === 'string' && isEffortLevel(clamped) ? clamped : effort;
  })();

  const handleFocus = useCallback(
    (value: string) => {
      setFocusedValue(value);
      if (!hasToggledEffort && effortValue === undefined && !ultracodeFlag) {
        setEffort(getDefaultEffortLevelForOption(value));
      }
    },
    [hasToggledEffort, effortValue, ultracodeFlag],
  );

  // Effort level cycling keybindings (densable gbp).
  // densable: ←/→ only moves local cursor (IGe); N9 runs in Dan on confirm,
  // not here — Esc after cycle must leave launch pin intact.
  // densable gbp base: r7s ? hMt : (T50 ?? hMt).
  const handleCycleEffort = useCallback(
    (direction: 'left' | 'right') => {
      if (!focusedSupportsEffort || focusedPickerLadder.length === 0) return;
      setEffort(prev =>
        cyclePickerEffort(
          pinHoldsDisplay ? focusedDefaultEffort : (prev ?? focusedDefaultEffort),
          direction,
          focusedPickerLadder,
        ),
      );
      setHasToggledEffort(true);
    },
    [focusedSupportsEffort, focusedPickerLadder, focusedDefaultEffort, pinHoldsDisplay],
  );

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
      'modelPicker:toggle1M': () => handleToggle1M(),
    },
    { context: 'ModelPicker' },
  );

  function handleSelect(value: string): void {
    const selectedModel = resolveOptionModel(value);
    const wantsUltracode = effort === 'ultracode' && selectedModel !== undefined && isUltracodeOfferable(selectedModel);
    const ultracodeWire = wantsUltracode ? getUltracodeEffortForModel(selectedModel) : undefined;

    // densable: wve(fMt, model) on confirm for non-ultracode; ultracode is
    // session-only wire (catalog top tier) + AppState.ultracode.
    const effortForModel: EffortLevel | undefined = wantsUltracode
      ? ultracodeWire
      : effort !== undefined && effort !== 'ultracode' && selectedModel
        ? (() => {
            const c = clampEffortForModel(effort, selectedModel);
            return typeof c === 'string' && isEffortLevel(c) ? c : effort;
          })()
        : effort === 'ultracode'
          ? undefined
          : effort;

    logEvent('tengu_model_command_menu_effort', {
      effort: (wantsUltracode
        ? 'ultracode'
        : effortForModel) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    // densable Dan: only touch effort/ultracode AppState when user cycled (IGe).
    // Model-only confirm leaves session effort / ultracode alone.
    // When deferEffortApply (Fable consent), N9 + writes run only after accept
    // via commitEffort — decline must not unpin or sticky-write.
    const commitEffort = (): void => {
      if (skipSettingsWrite || !hasToggledEffort) return;
      if (wantsUltracode && ultracodeWire !== undefined) {
        // densable Dan: ultracode → N9 + session effortValue=wire + ultracode:true.
        // Do not write effortLevel to userSettings (session-only orchestration).
        unpinAllEffortLaunchPins();
        setAppState(prev => ({
          ...prev,
          effortValue: ultracodeWire,
          ultracode: true,
        }));
        return;
      }
      // Prior comes from userSettings on disk — NOT merged settings (which
      // includes project/policy layers that must not leak into the user's
      // global ~/.claude/settings.json), and NOT AppState.effortValue (which
      // includes session-ephemeral sources like --effort CLI flag).
      // See resolvePickerEffortPersistence JSDoc.
      const effortLevel = resolvePickerEffortPersistence(
        effortForModel,
        getDefaultEffortLevelForOption(value),
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort,
      );
      const persistable = toPersistableEffort(effortLevel);
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', { effortLevel: persistable });
      }
      // densable: non-ultracode confirm clears ultracode flag.
      unpinAllEffortLaunchPins();
      setAppState(prev => ({
        ...prev,
        effortValue: effortLevel,
        ultracode: false,
      }));
    };

    if (!deferEffortApply) {
      commitEffort();
    }

    // densable: onSelect gets EffortLevel only; ultracode is session AppState.
    const selectedEffort =
      hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel) && !wantsUltracode
        ? effortForModel
        : undefined;
    const deferredCommit = deferEffortApply ? commitEffort : undefined;
    if (value === NO_PREFERENCE) {
      onSelect(null, selectedEffort, deferredCommit);
      return;
    }
    // Apply or strip [1m] suffix based on user toggle. marked1MValues is keyed
    // on the base value (see initializer + handleToggle1M), so look up with the
    // base form — not `value`, which may carry a `[1m]` suffix from predefined
    // 1M options and would never match.
    const baseValue = value.replace(/\[1m\]/i, '');
    const wants1M = marked1MValues.has(baseValue);
    const finalValue = wants1M ? `${baseValue}[1m]` : baseValue;
    onSelect(finalValue, selectedEffort, deferredCommit);
  }

  const content = (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select model
          </Text>
          <Text dimColor>
            {headerText ??
              'Choose a model for this and future sessions. Use ← → to adjust effort, Space to toggle 1M context.'}
          </Text>
          {sessionModel && (
            <Text dimColor>
              Currently using {modelDisplayString(sessionModel)} for this session (set by plan mode). Selecting a model
              will undo this.
            </Text>
          )}
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="column">
            <Select
              defaultValue={initialValue}
              defaultFocusValue={initialFocusValue}
              options={selectOptions}
              onChange={handleSelect}
              onFocus={handleFocus}
              onCancel={onCancel ?? (() => {})}
              visibleOptionCount={visibleCount}
            />
          </Box>
          {hiddenCount > 0 && (
            <Box paddingLeft={3}>
              <Text dimColor>and {hiddenCount} more…</Text>
            </Box>
          )}
        </Box>

        <Box marginBottom={1} flexDirection="column">
          {focusedSupportsEffort ? (
            <Text dimColor>
              <EffortLevelIndicator
                effort={displayEffort === 'ultracode' ? (focusedUltracodeWire ?? focusedDefaultEffort) : displayEffort}
              />{' '}
              {displayEffort === 'ultracode' ? (
                <>
                  ultracode
                  {focusedUltracodeWire ? ` · ${focusedUltracodeWire} + workflows` : ''}
                </>
              ) : (
                <>
                  {displayEffort === 'xhigh' ? 'xHigh' : capitalize(displayEffort ?? 'high')} effort
                  {displayEffort === focusedDefaultEffort ? ` (default)` : ``}
                </>
              )}{' '}
              <Text color="subtle">← → to adjust</Text>
            </Text>
          ) : (
            <Text color="subtle">
              <EffortLevelIndicator effort={undefined} /> Effort not supported
              {focusedModelName ? ` for ${focusedModelName}` : ''}
            </Text>
          )}
          {is1MMarked ? (
            <Text dimColor>
              <EffortLevelIndicator effort={'high'} /> 1M context on
              <Text color="subtle"> · Space to toggle</Text>
            </Text>
          ) : (
            <Text color="subtle">
              <EffortLevelIndicator effort={undefined} /> 1M context off
              {focusedModelName ? ` for ${focusedModelName}` : ''}
              <Text color="subtle"> · Space to toggle</Text>
            </Text>
          )}
        </Box>

        {isFastModeEnabled() ? (
          showFastModeNotice ? (
            <Box marginBottom={1}>
              <Text dimColor>
                Fast mode is <Text bold>ON</Text> and available with {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching
                to other models turn off fast mode.
              </Text>
            </Box>
          ) : isFastModeAvailable() && !isFastModeCooldown() ? (
            <Box marginBottom={1}>
              <Text dimColor>
                Use <Text bold>/fast</Text> to turn on Fast mode ({FAST_MODE_MODEL_DISPLAY} only).
              </Text>
            </Box>
          ) : null
        ) : null}
      </Box>

      {isStandaloneCommand && (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="select:cancel" context="Select" fallback="Esc" description="exit" />
            </Byline>
          )}
        </Text>
      )}
    </Box>
  );

  if (!isStandaloneCommand) {
    return content;
  }

  return <Pane color="permission">{content}</Pane>;
}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined;
  return value === NO_PREFERENCE ? getDefaultMainLoopModel() : parseUserSpecifiedModel(value);
}

function EffortLevelIndicator({ effort }: { effort?: EffortLevel }): React.ReactNode {
  return <Text color={effort ? 'claude' : 'subtle'}>{effortLevelToSymbol(effort ?? 'low')}</Text>;
}

/**
 * densable gbp-shaped cycle over the picker ladder (MDe levels + optional
 * ultracode). When current isn't in the ladder (e.g. medium on DeepSeek),
 * snap to high if present else the last rung, then step.
 */
function cyclePickerEffort(
  current: PickerEffort,
  direction: 'left' | 'right',
  levels: readonly PickerEffort[],
): PickerEffort {
  if (levels.length === 0) return current;
  const idx = levels.indexOf(current);
  const highIdx = levels.indexOf('high');
  const currentIndex = idx !== -1 ? idx : highIdx !== -1 ? highIdx : levels.length - 1;
  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!;
  }
  return levels[(currentIndex - 1 + levels.length) % levels.length]!;
}

function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel();
  const defaultValue = getDefaultEffortForModel(resolved);
  return defaultValue !== undefined ? convertEffortValueToLevel(defaultValue) : 'high';
}
