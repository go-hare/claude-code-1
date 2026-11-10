import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Pane, Ratchet, Text } from '@anthropic/ink';
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
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import {
  clampEffortForModel,
  convertEffortValueToLevel,
  type EffortLevel,
  effortModelSettingsPatch,
  getDefaultEffortForModel,
  getSupportedEffortLevels,
  isEffortLaunchPinned,
  isEffortLevel,
  isUltracodeModeActive,
  modelSupportsEffort,
  readUserSettingsEffortForModel,
  resolvePickerEffortPersistence,
  toPersistableEffort,
  unpinAllEffortLaunchPins,
} from '../utils/effort.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js';
import {
  computeModelPickerVisibleSlots,
  isModelPickerFastModeNoticeChrome,
} from '../utils/model/modelPickerVisible.js';
import { getModelOptions } from '../utils/model/modelOptions.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { effortLevelToSymbol } from './EffortIndicator.js';
import { MAX_EFFORT_WARNING } from './EffortPanel/effortPanelState.js';

export type Props = {
  initial: string | null;
  sessionModel?: ModelSetting;
  /**
   * densable: effort is EffortLevel only.
   *
   * When `deferEffortApply` is true, N9 / settings / AppState effort writes
   * are NOT applied here — caller must invoke the third `commitEffort`
   * callback after any gate (e.g. Fable consent) succeeds. Decline/cancel
   * must not call `commitEffort`.
   */
  onSelect: (model: string | null, effort: EffortLevel | undefined, commitEffort?: () => void) => void;
  /**
   * densable 2.1.289 onSetDefault: Enter latches this before onChange so
   * confirm persists as default; `s` skips it (session only).
   */
  onSetDefault?: (model: string | null) => void;
  onCancel?: () => void;
  isStandaloneCommand?: boolean;
  showFastModeNotice?: boolean;
  /** Overrides the dim header line below "Select model". */
  headerText?: string;
  /**
   * Override the Default (null) row description. Used by teammate default
   * picker so "currently …" reflects the leader/session model rather than
   * the platform tier default (e.g. Opus 5).
   */
  defaultOptionDescription?: string;
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped (written to the assistant's .claude/settings.json via
   * install.ts) and should not leak to the user's global ~/.claude/settings.
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

function isMaxEffortReminderEnabled(): boolean {
  if (process.env.CLAUDE_CODE_MAX_EFFORT_REMINDER !== undefined) {
    return isEnvTruthy(process.env.CLAUDE_CODE_MAX_EFFORT_REMINDER);
  }
  return Boolean(getFeatureValue_CACHED_MAY_BE_STALE('tengu_proud_clover', false));
}

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onSetDefault,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  defaultOptionDescription,
  skipSettingsWrite,
  deferEffortApply,
}: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const exitState = useExitOnCtrlCDWithKeybindings(onCancel, undefined, isStandaloneCommand === true);
  const { rows } = useTerminalSize();
  // densable sgM — LFh=14 chrome; no XKl search host → ngM=0
  const maxVisible = computeModelPickerVisibleSlots({
    rows,
    searchChrome: false,
    fastModeNotice: isModelPickerFastModeNoticeChrome(
      isFastModeEnabled(),
      showFastModeNotice,
      isFastModeAvailable(),
      isFastModeCooldown(),
    ),
    sessionModelBanner: sessionModel != null,
  });

  const initialValue = initial === null ? NO_PREFERENCE : initial;
  const [focusedValue, setFocusedValue] = useState<string | undefined>(initialValue);

  const isFastMode = useAppState(s => (isFastModeEnabled() ? s.fastMode : false));

  // densable 2.1.289: no Space 1M toggle row; `[1m]` is on the option value.

  const [hasToggledEffort, setHasToggledEffort] = useState(false);
  const effortValue = useAppState(s => s.effortValue);
  const ultracodeFlag = useAppState(s => s.ultracode);
  const [effort, setEffort] = useState<EffortLevel | undefined>(() =>
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  );

  // Memoize all derived values to prevent re-renders
  const modelOptions = useMemo(() => getModelOptions(isFastMode ?? false), [isFastMode]);

  // Ensure the initial value is in the options list
  // This handles edge cases where the user's current model (e.g., 'haiku' for 3P users)
  // is not in the base options but should still be selectable and shown as selected
  const optionsWithInitial = useMemo(() => {
    const withDefaultDesc =
      defaultOptionDescription === undefined
        ? modelOptions
        : modelOptions.map(opt => (opt.value === null ? { ...opt, description: defaultOptionDescription } : opt));
    if (initial !== null && !withDefaultDesc.some(opt => opt.value === initial)) {
      return [
        ...withDefaultDesc,
        {
          value: initial,
          label: modelDisplayString(initial),
          description: 'Current model',
        },
      ];
    }
    return withDefaultDesc;
  }, [modelOptions, initial, defaultOptionDescription]);

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

  const focusedOption = selectOptions.find(opt => opt.value === focusedValue);
  const focusedModelName = focusedOption?.label;
  const focusedDisabled = (focusedOption as { disabled?: boolean } | undefined)?.disabled === true;
  const focusedModel = resolveOptionModel(focusedValue);
  const focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false;
  // densable MDe-shaped ladder (capability ∩ org). Exclusive catalog rows
  // (DeepSeek high|max, Grok low|medium|high, Kimi low|high|max) replace the
  // densable low/medium/high + max/xhigh flag filter.
  const focusedEffortLevels = focusedModel ? getSupportedEffortLevels(focusedModel) : [];
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue);
  // densable r7s: !IGe && Ave(focused) → force model default for display/cycle base.
  // Session effort under pin is ignored until the user cycles (then confirm N9).
  const pinHoldsDisplay = !hasToggledEffort && focusedModel !== undefined && isEffortLaunchPinned(focusedModel);
  const displayEffort = ((): EffortLevel | undefined => {
    if (pinHoldsDisplay) return focusedDefaultEffort;
    if (effort === undefined) return focusedDefaultEffort;
    if (!focusedModel) return effort;
    const clamped = clampEffortForModel(effort, focusedModel);
    return typeof clamped === 'string' && isEffortLevel(clamped) ? clamped : effort;
  })();

  const handleFocus = useCallback(
    (value: string) => {
      setFocusedValue(value);
      if (!hasToggledEffort && effortValue === undefined) {
        setEffort(getDefaultEffortLevelForOption(value));
      }
    },
    [hasToggledEffort, effortValue],
  );

  // Effort level cycling keybindings (densable gbp / QOe).
  // densable: ←/→ only moves local cursor (IGe); N9 runs in Dan on confirm,
  // not here — Esc after cycle must leave launch pin intact.
  const handleCycleEffort = useCallback(
    (direction: 'left' | 'right') => {
      if (focusedDisabled || !focusedSupportsEffort || focusedEffortLevels.length === 0) return;
      setEffort(prev =>
        cyclePickerEffort(
          pinHoldsDisplay ? focusedDefaultEffort : (prev ?? focusedDefaultEffort),
          direction,
          focusedEffortLevels,
        ),
      );
      setHasToggledEffort(true);
    },
    [focusedDisabled, focusedSupportsEffort, focusedEffortLevels, focusedDefaultEffort, pinHoldsDisplay],
  );

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
      'modelPicker:thisSessionOnly': () => {
        if (!onSetDefault) return;
        const value = focusedValue;
        if (!value || focusedDisabled) return;
        commitSelection(value, false);
      },
    },
    { context: 'ModelPicker' },
  );

  function commitSelection(value: string, persistAsDefault: boolean): void {
    if (persistAsDefault) {
      onSetDefault?.(value === NO_PREFERENCE ? null : value);
    }
    const selectedModel = resolveOptionModel(value);
    const effortForModel: EffortLevel | undefined =
      effort !== undefined && selectedModel
        ? (() => {
            const c = clampEffortForModel(effort, selectedModel);
            return typeof c === 'string' && isEffortLevel(c) ? c : effort;
          })()
        : effort;

    logEvent('tengu_model_command_menu_effort', {
      effort: effortForModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    // densable Dan: only touch effort AppState when user cycled (IGe).
    // Model-only confirm leaves session effort / ultracode alone.
    // When deferEffortApply (Fable consent), N9 + writes run only after accept
    // via commitEffort — decline must not unpin or sticky-write.
    const commitEffort = (): void => {
      if (skipSettingsWrite || !hasToggledEffort) return;
      const effortLevel = resolvePickerEffortPersistence(
        effortForModel,
        getDefaultEffortLevelForOption(value),
        readUserSettingsEffortForModel(selectedModel ?? ''),
        hasToggledEffort,
      );
      const persistable = toPersistableEffort(effortLevel);
      if (persistable !== undefined) {
        // densable Dan / K — per-model like /effort, not top-level effortLevel.
        const model = selectedModel ?? '';
        const patch = model.length > 0 ? effortModelSettingsPatch(model, persistable) : { effortLevel: persistable };
        updateSettingsForSource('userSettings', patch);
      }
      unpinAllEffortLaunchPins();
      setAppState(prev => ({
        ...prev,
        effortValue: effortLevel,
      }));
    };

    if (!deferEffortApply) {
      commitEffort();
    }

    const selectedEffort =
      hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel) ? effortForModel : undefined;
    const deferredCommit = deferEffortApply ? commitEffort : undefined;
    const selected = value === NO_PREFERENCE ? null : value;
    onSelect(selected, selectedEffort, deferredCommit);
  }

  function handleSelect(value: string): void {
    commitSelection(value, true);
  }

  const selectSizingProps = {
    columnSizingOptions: selectOptions,
  } as unknown as Record<string, never>;

  const ultracodeActiveForFocused =
    focusedModel !== undefined && isUltracodeModeActive(focusedModel, effortValue, ultracodeFlag);
  const showMaxReminder = displayEffort === 'max' && isMaxEffortReminderEnabled();

  const content = (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select model
          </Text>
          <Text dimColor>
            {headerText ??
              'Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.'}
          </Text>
          {sessionModel && (
            <Text dimColor>
              Currently using {modelDisplayString(sessionModel)} for this session only (base model:{' '}
              {modelDisplayString(initial)}). Selecting a model here replaces both.
            </Text>
          )}
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Ratchet restartKey={maxVisible}>
            <Select
              defaultValue={initialValue}
              selectedValue={initialValue}
              defaultFocusValue={initialFocusValue}
              options={selectOptions}
              {...selectSizingProps}
              onChange={handleSelect}
              onFocus={handleFocus}
              onCancel={() => onCancel?.()}
              visibleOptionCount={visibleCount}
              hiddenBelowUnit="model"
            />
          </Ratchet>
        </Box>

        <Ratchet>
          {focusedValue !== undefined && !focusedDisabled && (
            <Box marginBottom={1} flexDirection="column">
              {focusedSupportsEffort ? (
                <>
                  <Text dimColor>
                    <EffortLevelIndicator effort={displayEffort} />{' '}
                    {displayEffort === 'xhigh' ? 'xHigh' : capitalize(displayEffort ?? 'high')} effort
                    {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
                    <Text color="subtle">← → to adjust</Text>
                    {ultracodeActiveForFocused ? ' · Ultracode on (/effort)' : ''}
                  </Text>
                  {displayEffort === 'max' ? (
                    showMaxReminder ? (
                      <Text color="warning">⚠ {MAX_EFFORT_WARNING}</Text>
                    ) : (
                      <Text color="subtle">{MAX_EFFORT_WARNING}</Text>
                    )
                  ) : null}
                </>
              ) : (
                <Text color="subtle">
                  <EffortLevelIndicator effort={undefined} /> Effort not supported
                  {focusedModelName ? ` for ${focusedModelName}` : ''}
                </Text>
              )}
            </Box>
          )}
        </Ratchet>

        {isFastModeEnabled() ? (
          showFastModeNotice ? (
            <Box marginBottom={1}>
              <Text dimColor>
                Fast mode is <Text bold>ON</Text> and available with {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching
                to other models turns off fast mode.
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
        <Ratchet>
          <Text dimColor>
            {exitState.pending ? (
              `Press ${exitState.keyName} again to ${onCancel ? 'cancel' : 'exit'}`
            ) : (
              <Byline>
                {focusedValue !== undefined && !focusedDisabled && (
                  <KeyboardShortcutHint shortcut="Enter" action={onSetDefault ? 'set as default' : 'confirm'} />
                )}
                {focusedValue !== undefined && !focusedDisabled && onSetDefault && (
                  <KeyboardShortcutHint shortcut="s" action="use this session only" />
                )}
                <ConfigurableShortcutHint action="select:cancel" context="Select" fallback="Esc" description="cancel" />
              </Byline>
            )}
          </Text>
        </Ratchet>
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
 * densable gbp-shaped cycle over the picker ladder (MDe levels).
 * When current isn't in the ladder (e.g. medium on DeepSeek),
 * snap to high if present else the last rung, then step.
 */
function cyclePickerEffort(
  current: EffortLevel,
  direction: 'left' | 'right',
  levels: readonly EffortLevel[],
): EffortLevel {
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
