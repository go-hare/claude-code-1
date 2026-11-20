import figures from 'figures';
import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Byline,
  color,
  KeyboardShortcutHint,
  Pane,
  Ratchet,
  Text,
  useModalOrTerminalSize,
  useTheme,
} from '@anthropic/ink';
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
  type EffortValue,
  effortModelSettingsPatch,
  explicitSessionEffort,
  getDefaultEffortForModel,
  getEffortEnvOverride,
  getSupportedEffortLevels,
  isEffortLaunchPinned,
  isEffortLevel,
  isUltracodeModeActive,
  modelSupportsEffort,
  pdSessionEffort,
  readUserSettingsEffortForModel,
  resolvePickerEffortPersistence,
  teSettingsEffortTable,
  toPersistableEffort,
  unpinAllEffortLaunchPins,
} from '../utils/effort.js';
import { has1mContext } from '../utils/context.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isModelAlias } from '../utils/model/aliases.js';
import { isSameFablePickerRow } from '../utils/model/fablePicker.js';
import { isModelAllowed } from '../utils/model/modelAllowlist.js';
import {
  getCanonicalName,
  getDefaultMainLoopModel,
  isNonCustomOpusModel,
  isOpus1mMergeEnabled,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js';
import {
  computeModelPickerVisibleSlots,
  isModelPickerFastModeNoticeChrome,
} from '../utils/model/modelPickerVisible.js';
import { getModelOptions } from '../utils/model/modelOptions.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
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

function isAliasModelSpec(spec: string | null): boolean {
  if (spec === null) return false;
  const stripped = spec
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, '');
  return isModelAlias(stripped);
}

/** densable `jTe` (@189442462) — suppress session override when semantically identical to base model. */
export function resolveSessionModelOverride(
  sessionModel: string | null | undefined,
  initial: string | null,
): string | null {
  const trimmedSession = sessionModel?.trim() || null;
  if (trimmedSession === null) return null;
  if (initial !== null && trimmedSession.toLowerCase() === initial.trim().toLowerCase()) {
    return null;
  }
  const trimmedInitial = initial?.trim() || null;
  if (isAliasModelSpec(trimmedSession) || isAliasModelSpec(trimmedInitial)) {
    return trimmedSession;
  }
  const resolvedInitial = trimmedInitial === null ? getDefaultMainLoopModel() : parseUserSpecifiedModel(trimmedInitial);
  return parseUserSpecifiedModel(trimmedSession).toLowerCase() === resolvedInitial.toLowerCase()
    ? null
    : trimmedSession;
}

/** densable `cs` (@186193149) — semantic option identity (canonical model + 1M window / opus merge). */
export function isSameModelPickerOption(left: { value: string | null }, right: { value: string | null }): boolean {
  if (left.value === right.value) return true;
  if (typeof left.value !== 'string' || typeof right.value !== 'string') return false;
  if (isSameFablePickerRow(left, right)) return true;
  const resolvedLeft = parseUserSpecifiedModel(left.value);
  const resolvedRight = parseUserSpecifiedModel(right.value);
  if (getCanonicalName(resolvedLeft) !== getCanonicalName(resolvedRight)) return false;
  return (
    has1mContext(left.value) === has1mContext(right.value) ||
    (isNonCustomOpusModel(resolvedLeft) && isOpus1mMergeEnabled())
  );
}

/** densable `bfn` (@186191356) — map `--model claude-sonnet-4-6` etc. to matching built-in option value. */
export function findMatchingModelOptionValue(
  options: ReadonlyArray<{ value: string | null }>,
  model: string,
): string | undefined {
  if (options.some(opt => opt.value === model)) return model;
  const probe = { value: model };
  const hit = options.find(opt => isSameModelPickerOption(opt, probe));
  return typeof hit?.value === 'string' ? hit.value : undefined;
}

/** Official 2.1.323 (#2095): newest model highlighted in `/model` picker. */
export const NEWEST_MODEL_HIGHLIGHT_NAME = 'Fable 5.2';

/**
 * Official 2.1.323 `_ce` (#2093): apply `CLAUDE_CODE_EFFORT_LEVEL` env override
 * over a session/settings effort value so the model picker displays what the
 * environment will actually apply rather than a hidden picked value.
 */
export function applyEffortEnvOverride(
  effort: EffortValue | undefined,
  envOverride: EffortValue | null | undefined = getEffortEnvOverride(),
): EffortValue | undefined {
  if (envOverride === null) return undefined;
  return envOverride ?? effort;
}

/**
 * Official 2.1.323 `kr` (#2095): highlight the newest model (`Fable 5.2`) in
 * both label (`labelColor: 'claude'`) and description (claude brand ANSI color).
 */
export function highlightNewestModelOption<T extends { label: string; description?: string; labelColor?: string }>(
  opt: T,
  themeName: Parameters<typeof color>[1],
): T & { labelColor?: string } {
  const labelColor = opt.label?.includes(NEWEST_MODEL_HIGHLIGHT_NAME) ? 'claude' : opt.labelColor;
  const description = (opt.description ?? '').replaceAll(
    NEWEST_MODEL_HIGHLIGHT_NAME,
    color('claude', themeName)(NEWEST_MODEL_HIGHLIGHT_NAME),
  );
  return {
    ...opt,
    description,
    ...(labelColor !== undefined ? { labelColor } : {}),
  };
}

/** Official `jh` (2.1.319 #1801 / 2.1.321 #1920): unnumbered collapsible "More models" row. */
export const MORE_MODELS_OPTION_VALUE = '__more_models__';

export type ModelPickerRowOption = {
  value: string;
  label: string;
  description: string;
  disabled?: boolean;
  overflow?: boolean;
  marker?: string;
  labelColor?: string;
};

/**
 * Official 2.1.319 (#1801) & 2.1.321 (#1920): partition older (`overflow: true`)
 * models under an unnumbered "More models" row below every other option, opening
 * underneath without renumbering the primary options.
 */
export function buildVisibleModelPickerOptions<T extends ModelPickerRowOption>(
  options: readonly T[],
  opts: {
    currentValue: string;
    baseValue: string;
    expanded: boolean;
    screenReader?: boolean;
  },
): Array<T | ModelPickerRowOption> {
  const overflowOpts: T[] = [];
  const primaryOpts: T[] = [];
  for (const opt of options) {
    if (opt.overflow === true && opt.value !== opts.currentValue && opt.value !== opts.baseValue) {
      overflowOpts.push(opt);
    } else {
      primaryOpts.push(opt);
    }
  }
  const enabledPrimary = primaryOpts.filter(o => !o.disabled).length;
  const enabledOverflow = overflowOpts.filter(o => !o.disabled).length;
  if (enabledPrimary < 2 || enabledOverflow < 2) {
    return [...options];
  }
  const moreRow: ModelPickerRowOption = {
    value: MORE_MODELS_OPTION_VALUE,
    marker: opts.expanded ? figures.triangleDownSmall : figures.triangleRightSmall,
    disabled: false,
    label: opts.screenReader ? `More models, ${opts.expanded ? 'expanded' : 'collapsed'}` : 'More models',
    description: '',
  };
  return [...primaryOpts, moreRow, ...(opts.expanded ? overflowOpts : [])];
}

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
  const [theme] = useTheme();
  const exitState = useExitOnCtrlCDWithKeybindings(onCancel, undefined, isStandaloneCommand === true);
  // Official 2.1.326 #215: respect modal row budget in short fullscreen windows.
  const { rows, columns } = useModalOrTerminalSize(useTerminalSize());
  const isNarrow = columns <= 46;
  const isFastMode = useAppState(s => (isFastModeEnabled() ? s.fastMode : false));
  // Memoize all derived values to prevent re-renders
  const modelOptions = useMemo(() => getModelOptions(isFastMode ?? false), [isFastMode]);

  const sessionOverride = useMemo(() => resolveSessionModelOverride(sessionModel, initial), [sessionModel, initial]);
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
    sessionModelBanner: sessionOverride !== null,
  });

  const currentModel = sessionOverride ?? initial;
  const initialValue =
    currentModel === null ? NO_PREFERENCE : (findMatchingModelOptionValue(modelOptions, currentModel) ?? currentModel);
  const [focusedValue, setFocusedValue] = useState<string | undefined>(initialValue);

  // densable 2.1.289: no Space 1M toggle row; `[1m]` is on the option value.

  const [hasToggledEffort, setHasToggledEffort] = useState(false);
  const sessionEffort = useAppState(s => s.sessionEffort);
  const settingsEffortTable = useAppState(s => s.settingsEffortTable);
  const ultracodeFlag = useAppState(s => s.ultracode);
  const [effort, setEffort] = useState<EffortLevel | undefined>(() => {
    const pd = applyEffortEnvOverride(
      pdSessionEffort({ sessionEffort, settingsEffortTable }, resolveOptionModel(initialValue)),
    );
    return pd !== undefined ? convertEffortValueToLevel(pd) : undefined;
  });

  // Ensure the current / base model values are in the options list
  const optionsWithInitial = useMemo(() => {
    const withDefaultDesc =
      defaultOptionDescription === undefined
        ? modelOptions
        : modelOptions.map(opt => (opt.value === null ? { ...opt, description: defaultOptionDescription } : opt));
    const currentOptVal =
      currentModel === null
        ? NO_PREFERENCE
        : (findMatchingModelOptionValue(withDefaultDesc, currentModel) ?? currentModel);
    const baseOptVal =
      initial === null ? NO_PREFERENCE : (findMatchingModelOptionValue(withDefaultDesc, initial) ?? initial);
    const extra: typeof withDefaultDesc = [];
    const pairs: Array<[string | null, string, string]> = [
      [currentModel, currentOptVal, 'Current model'],
      [sessionOverride === null ? null : initial, baseOptVal, 'Base model'],
    ];
    for (const [modelVal, optVal, description] of pairs) {
      if (
        modelVal !== null &&
        !withDefaultDesc.some(opt => opt.value === optVal || opt.value === modelVal) &&
        !extra.some(opt => opt.value === modelVal) &&
        isModelAllowed(modelVal)
      ) {
        extra.push({
          value: modelVal,
          label: modelDisplayString(modelVal),
          description,
        });
      }
    }
    if (extra.length === 0) {
      return withDefaultDesc;
    }
    const disabledIdx = withDefaultDesc.findIndex(opt => 'disabled' in opt && opt.disabled === true);
    if (disabledIdx === -1) {
      return [...withDefaultDesc, ...extra];
    }
    return [...withDefaultDesc.slice(0, disabledIdx), ...extra, ...withDefaultDesc.slice(disabledIdx)];
  }, [modelOptions, currentModel, sessionOverride, initial, defaultOptionDescription]);

  const [moreModelsExpanded, setMoreModelsExpanded] = useState(false);
  const screenReader = isScreenReaderModeEnabled();

  const allSelectOptions = useMemo(
    () =>
      optionsWithInitial.map(opt =>
        highlightNewestModelOption(
          {
            ...opt,
            value: opt.value === null ? NO_PREFERENCE : opt.value,
          },
          theme,
        ),
      ),
    [optionsWithInitial, theme],
  );
  const baseOptionValue =
    initial === null ? NO_PREFERENCE : (findMatchingModelOptionValue(modelOptions, initial) ?? initial);
  const selectOptions = useMemo(
    () =>
      buildVisibleModelPickerOptions(allSelectOptions, {
        currentValue: initialValue,
        baseValue: baseOptionValue,
        expanded: moreModelsExpanded,
        screenReader,
      }),
    [allSelectOptions, initialValue, baseOptionValue, moreModelsExpanded, screenReader],
  );
  const initialFocusValue = useMemo(
    () => (selectOptions.some(_ => _.value === initialValue) ? initialValue : (selectOptions[0]?.value ?? undefined)),
    [selectOptions, initialValue],
  );
  const visibleCount = Math.min(maxVisible, selectOptions.length);

  const isMoreModelsFocused = focusedValue === MORE_MODELS_OPTION_VALUE;
  const effectiveFocusedValue = isMoreModelsFocused ? undefined : focusedValue;
  const focusedOption = allSelectOptions.find(opt => opt.value === effectiveFocusedValue);
  const focusedModelName = focusedOption?.label;
  const focusedDisabled = (focusedOption as { disabled?: boolean } | undefined)?.disabled === true;
  const focusedModel = resolveOptionModel(effectiveFocusedValue);
  const focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false;
  // densable MDe-shaped ladder (capability ∩ org). Exclusive catalog rows
  // (DeepSeek high|max, Grok low|medium|high, Kimi low|high|max) replace the
  // densable low/medium/high + max/xhigh flag filter.
  const focusedEffortLevels = focusedModel ? getSupportedEffortLevels(focusedModel) : [];
  const focusedDefaultEffort = getDefaultEffortLevelForOption(effectiveFocusedValue);
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
      if (value === MORE_MODELS_OPTION_VALUE) return;
      if (!hasToggledEffort) {
        const targetModel = resolveOptionModel(value);
        const pd = applyEffortEnvOverride(pdSessionEffort({ sessionEffort, settingsEffortTable }, targetModel));
        setEffort(pd !== undefined ? convertEffortValueToLevel(pd) : getDefaultEffortLevelForOption(value));
      }
    },
    [hasToggledEffort, sessionEffort, settingsEffortTable],
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
        const value = effectiveFocusedValue;
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
        sessionEffort: explicitSessionEffort(effortLevel),
        settingsEffortTable: teSettingsEffortTable(),
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
    if (value === MORE_MODELS_OPTION_VALUE) {
      setMoreModelsExpanded(prev => !prev);
      return;
    }
    commitSelection(value, true);
  }

  const selectSizingProps = {
    columnSizingOptions: selectOptions,
  } as unknown as Record<string, never>;

  const focusedPdEffort =
    focusedModel !== undefined ? pdSessionEffort({ sessionEffort, settingsEffortTable }, focusedModel) : undefined;
  const ultracodeActiveForFocused =
    focusedModel !== undefined && isUltracodeModeActive(focusedModel, focusedPdEffort, ultracodeFlag);
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
          {sessionOverride && (
            <Text dimColor>
              Currently using {modelDisplayString(sessionOverride)} for this session only (base model:{' '}
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
              overflowHint="count"
              hiddenBelowUnit="model"
            />
          </Ratchet>
        </Box>

        <Ratchet>
          {effectiveFocusedValue !== undefined && !focusedDisabled && (
            <Box marginBottom={1} flexDirection="column">
              {focusedSupportsEffort ? (
                <>
                  <Text dimColor wrap="wrap">
                    <EffortLevelIndicator effort={displayEffort} />{' '}
                    {displayEffort === 'xhigh' ? 'xHigh' : capitalize(displayEffort ?? 'high')} effort
                    {displayEffort === focusedDefaultEffort ? ' (default)' : ''}
                    {isNarrow ? '\n' : ' '}
                    <Text dimColor>←/→ to adjust</Text>
                    {ultracodeActiveForFocused ? ' · Ultracode on (/effort)' : ''}
                  </Text>
                  {displayEffort === 'max' ? (
                    showMaxReminder ? (
                      <Text color="warning">⚠ {MAX_EFFORT_WARNING}</Text>
                    ) : (
                      <Text dimColor>{MAX_EFFORT_WARNING}</Text>
                    )
                  ) : null}
                </>
              ) : (
                <Text dimColor>
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
                Fast mode is <Text bold>ON</Text> (/fast). Switching models can turn it off.
              </Text>
            </Box>
          ) : isFastModeAvailable() && !isFastModeCooldown() ? (
            <Box marginBottom={1}>
              <Text dimColor>
                Use <Text bold>/fast</Text> to turn on Fast mode (
                {currentModel ? modelDisplayString(currentModel) : FAST_MODE_MODEL_DISPLAY}).
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
 * Official 2.1.293 (#291) `NYe`: clamp effort ←/→ at the lowest/highest
 * level instead of wrapping around.
 * When current isn't in the ladder (e.g. medium on DeepSeek),
 * snap to high if present else the last rung, then step.
 */
export function cyclePickerEffort(
  current: EffortLevel,
  direction: 'left' | 'right',
  levels: readonly EffortLevel[],
): EffortLevel {
  if (levels.length === 0) return current;
  const idx = levels.indexOf(current);
  const highIdx = levels.indexOf('high');
  const currentIndex = idx !== -1 ? idx : highIdx !== -1 ? highIdx : levels.length - 1;
  if (direction === 'right') {
    return levels[Math.min(currentIndex + 1, levels.length - 1)]!;
  }
  return levels[Math.max(currentIndex - 1, 0)]!;
}

function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel();
  const defaultValue = getDefaultEffortForModel(resolved);
  return defaultValue !== undefined ? convertEffortValueToLevel(defaultValue) : 'high';
}
