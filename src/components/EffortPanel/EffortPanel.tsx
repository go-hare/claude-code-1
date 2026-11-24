import * as React from 'react';
import {
  AccessibilityContext,
  Box,
  Byline,
  type Color,
  type KeyboardEvent,
  KeyboardShortcutHint,
  Pane,
  Text,
  type Theme,
  stringWidth,
  useAnimationFrame,
  useModalOrTerminalSize,
  useTerminalSize,
} from '@anthropic/ink';
import { executeEffort } from '../../commands/effort/effort.js';
import { CacheMissConfirmDialog } from '../../commands/model/model.js';
import { getTotalOutputTokens } from '../../cost-tracker.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import {
  type EffortLevel,
  type EffortValue,
  explicitSessionEffort,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  isUltracodeOfferable,
  modelSupportsMaxEffort,
  pdSessionEffort,
  readUserSettingsEffortForModel,
  shouldWarnEffortCacheMiss,
  teSettingsEffortTable,
} from '../../utils/effort.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/index.js';
import {
  CANCEL_MESSAGE,
  MAX_EFFORT_WARNING,
  type SliderGeometry,
  type SliderLevelSpec,
  ULTRACODE_BLURB,
  computeConfirmOutcome,
  getEffortLevelDescription,
  getSliderGeometry,
  isEffortCostNoteEnabled,
} from './effortPanelState.js';

const SIDE_BY_SIDE_MIN_COLS = 70;
const TOGGLE_GAP = 6;
/** Official 2.1.328 `yn = 2 * (Fk + vQ) = 4`: horizontal chrome inset for full slider fit check. */
const NARROW_CHROME_INSET = 4;
const MIN_TOGGLE_WIDTH = 14;
const DEFAULT_FALLBACK_INDEX = 2;
const SHIMMER_HIGHLIGHT_HEX: Color = '#d0b4ff';
const ULTRACODE_SR_TOGGLE_VALUE = 'ultracode-toggle';
const CAROUSEL_LEFT_CHEVRON = '\u2039';
const CAROUSEL_RIGHT_CHEVRON = '\u203A';

let effortCacheMissAckedAtOutputTokens = -1;

/** @internal Reset warm-cache acknowledgement state between unit tests. */
export function resetEffortCacheMissAckForTest(): void {
  effortCacheMissAckedAtOutputTokens = -1;
}

const RAINBOW_THEME_KEYS: readonly (keyof Theme)[] = [
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
];

function isMaxEffortReminderEnabled(): boolean {
  if (process.env.CLAUDE_CODE_MAX_EFFORT_REMINDER !== undefined) {
    return isEnvTruthy(process.env.CLAUDE_CODE_MAX_EFFORT_REMINDER);
  }
  return Boolean(getFeatureValue_CACHED_MAY_BE_STALE('tengu_proud_clover', false));
}

function getInitialSliderIndex(
  model: string,
  appStateEffort: EffortValue | undefined,
  geometry: SliderGeometry,
): number {
  const envOverride = getEffortEnvOverride();
  const effective = envOverride === null ? undefined : (envOverride ?? appStateEffort);
  if (effective !== undefined && typeof effective === 'string') {
    const found = geometry.levels.findIndex(lvl => lvl.value === effective);
    if (found !== -1) return found;
  }
  const displayed = getDisplayedEffortLevel(model, effective);
  const idx = geometry.levels.findIndex(lvl => lvl.value === displayed);
  return idx === -1 ? Math.min(DEFAULT_FALLBACK_INDEX, geometry.levels.length - 1) : idx;
}

function RainbowLabel({ text }: { text: string }): React.ReactNode {
  const [reducedMotion] = React.useState(() => Boolean(getInitialSettings().prefersReducedMotion));
  const [ref, timeMs] = useAnimationFrame(reducedMotion ? null : 100);
  const tick = Math.floor(timeMs / 100);
  const chars = [...text];
  return (
    <Box ref={ref}>
      <Text bold>
        {chars.map((ch, idx) => (
          <Text key={idx} color={RAINBOW_THEME_KEYS[(idx + tick) % RAINBOW_THEME_KEYS.length]}>
            {ch}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function ShimmerLabel({ text, color = 'autoAccept' }: { text: string; color?: keyof Theme }): React.ReactNode {
  const [reducedMotion] = React.useState(() => Boolean(getInitialSettings().prefersReducedMotion));
  const [ref, timeMs] = useAnimationFrame(reducedMotion ? null : 100);
  const chars = [...text];
  const period = chars.length + 4;
  const sweepPos = reducedMotion ? -10 : Math.floor(timeMs / 100) % period;
  return (
    <Box ref={ref}>
      <Text bold>
        {chars.map((ch, idx) => {
          const isCrest = idx === sweepPos;
          const isShoulder = idx === sweepPos - 1 || idx === sweepPos + 1;
          return (
            <Text key={idx} color={isCrest ? SHIMMER_HIGHLIGHT_HEX : color} bold={isCrest || isShoulder}>
              {ch}
            </Text>
          );
        })}
      </Text>
    </Box>
  );
}

function EffortLevelLabel({ level, selected }: { level: SliderLevelSpec; selected: boolean }): React.ReactNode {
  if (!selected) {
    return <Text dimColor>{level.label}</Text>;
  }
  if (level.color === 'rainbow-animated') {
    return <RainbowLabel text={level.label} />;
  }
  if (level.color === 'autoAccept-shimmer') {
    return <ShimmerLabel text={level.label} />;
  }
  return (
    <Text bold color={level.color}>
      {level.label}
    </Text>
  );
}

/**
 * Official 2.1.326 #221: map a mouse click column relative to the slider box to
 * the nearest effort stop index so `/effort` responds to clicks in fullscreen.
 */
export function findNearestSliderStopIndex(localCol: number, stopPositions: readonly number[]): number {
  if (stopPositions.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < stopPositions.length; i++) {
    const dist = Math.abs(localCol - stopPositions[i]!);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function UltracodeToggle({
  on,
  chord,
  width,
  onToggle,
}: {
  on: boolean;
  chord: string;
  width: number;
  onToggle?: () => void;
}): React.ReactNode {
  return (
    <Box
      flexDirection="column"
      width={width}
      onClick={
        onToggle
          ? e => {
              e.stopImmediatePropagation();
              onToggle();
            }
          : undefined
      }
    >
      <Box>
        {on ? (
          <ShimmerLabel text="Ultracode  on" color="effortUltra" />
        ) : (
          <>
            <Text bold>Ultracode</Text>
            <Text>{'  '}</Text>
            <Text dimColor>off</Text>
          </>
        )}
      </Box>
      {chord ? (
        <Text dimColor>
          <KeyboardShortcutHint shortcut={chord} action="toggle" />
        </Text>
      ) : null}
    </Box>
  );
}

type Props = {
  appStateEffort: EffortValue | undefined;
  onDone: (message: string) => void;
  /** Optional override for prompt cache warmth (defaults to `getTotalOutputTokens() > 0`). */
  promptCacheMayBeWarm?: boolean;
};

type PendingEffortConfirm = {
  selectedLevel: EffortLevel;
  levelChanged: boolean;
  ultracodeOn: boolean;
  ultracodeChanged: boolean;
  persistAsDefault: boolean;
};

export function EffortPanel(props: Props): React.ReactNode {
  const srContext = React.useContext(AccessibilityContext);
  if (srContext || isScreenReaderModeEnabled()) {
    return <ScreenReaderEffortPanel {...props} />;
  }
  return <VisualEffortPanel {...props} />;
}

function VisualEffortPanel({ appStateEffort, onDone, promptCacheMayBeWarm }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const ultracodeState = useAppState(s => s.ultracode);
  const sessionEffort = useAppState(s => s.sessionEffort);
  const settingsEffortTable = useAppState(s => s.settingsEffortTable);
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const model = useMainLoopModel();
  const { columns } = useModalOrTerminalSize(useTerminalSize());

  const resolvedSessionEffort = React.useMemo(
    () => pdSessionEffort({ sessionEffort, effortValue: appStateEffort, settingsEffortTable }, model),
    [sessionEffort, appStateEffort, settingsEffortTable, model],
  );
  const geometry = React.useMemo(() => getSliderGeometry(model), [model]);
  const initialIdx = React.useMemo(
    () => getInitialSliderIndex(model, resolvedSessionEffort, geometry),
    [model, resolvedSessionEffort, geometry],
  );
  const [cursorIdx, setCursorIdx] = React.useState(initialIdx);
  const selectedIdx = Math.min(cursorIdx, geometry.levels.length - 1);

  const ultracodeOfferable = React.useMemo(() => isUltracodeOfferable(model), [model]);
  const initialUltracode = ultracodeState === true && ultracodeOfferable;
  const [ultracodeOn, setUltracodeOn] = React.useState(initialUltracode);
  const [pendingConfirm, setPendingConfirm] = React.useState<PendingEffortConfirm | null>(null);

  const toggleChord = useShortcutDisplay('effortSlider:toggleUltracode', 'EffortSlider', 'tab');
  const toggleHintWidth = stringWidth(`${toggleChord} to toggle`);
  const toggleWidth = Math.max(MIN_TOGGLE_WIDTH, toggleHintWidth);
  const isWide = columns >= SIDE_BY_SIDE_MIN_COLS + toggleWidth - MIN_TOGGLE_WIDTH;
  const fitsFullSlider = columns >= geometry.width + NARROW_CHROME_INSET;

  const envOverride = getEffortEnvOverride();
  const envActive = envOverride !== null && envOverride !== undefined;
  const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;

  const selectedLevel = geometry.levels[selectedIdx]!.value;
  const levelChanged = selectedIdx !== initialIdx;
  const ultracodeChanged = ultracodeOn !== initialUltracode;
  // Official 2.1.328 `Qe` (chunk@339097697.js @37800): suppress `s` and label
  // Enter as "use this session only" when on max, env override, ultracode-only toggle,
  // or confirming unchanged default when settings already has a persisted value.
  const isSessionOnlyConfirm =
    selectedLevel === 'max' ||
    envActive ||
    (!levelChanged && ultracodeChanged) ||
    (!levelChanged && resolvedSessionEffort === undefined && readUserSettingsEffortForModel(model) !== undefined);

  const doneRef = React.useRef(false);

  const commitConfirm = React.useCallback(
    (choice: PendingEffortConfirm) => {
      if (doneRef.current) return;
      doneRef.current = true;

      const shouldApplyLevel = choice.levelChanged || !choice.ultracodeChanged;
      const messages: string[] = [];
      let nextEffort = resolvedSessionEffort;
      let hasEffortUpdate = false;

      if (shouldApplyLevel) {
        const outcome = computeConfirmOutcome(choice.selectedLevel, arg =>
          executeEffort(arg, model, undefined, choice.persistAsDefault, resolvedSessionEffort),
        );
        messages.push(outcome.message);
        if (outcome.effortUpdate) {
          nextEffort = outcome.effortUpdate.value;
          hasEffortUpdate = true;
        }
      }

      if (choice.ultracodeChanged) {
        const ultraOutcome = executeEffort(
          choice.ultracodeOn ? 'ultracode on' : 'ultracode off',
          model,
          undefined,
          choice.persistAsDefault,
          nextEffort,
        );
        messages.push(
          messages.length === 0 || !ultraOutcome.effortUpdate
            ? ultraOutcome.message
            : `Ultracode ${choice.ultracodeOn ? 'on' : 'off'}`,
        );
        if (!shouldApplyLevel && ultraOutcome.effortUpdate && ultraOutcome.effortUpdate.ultracode === undefined) {
          nextEffort = ultraOutcome.effortUpdate.value;
          hasEffortUpdate = true;
        }
      }

      if (hasEffortUpdate || choice.ultracodeChanged) {
        setAppState(prev => ({
          ...prev,
          ...(hasEffortUpdate
            ? {
                sessionEffort: explicitSessionEffort(nextEffort),
                settingsEffortTable: teSettingsEffortTable(),
              }
            : {}),
          ...(choice.ultracodeChanged ? { ultracode: choice.ultracodeOn } : {}),
        }));
      }

      onDone(messages.join(' · '));
    },
    [resolvedSessionEffort, model, onDone, setAppState],
  );

  const handleConfirm = React.useCallback(
    (persistAsDefault = true) => {
      if (doneRef.current) return;
      const shouldApplyLevel = levelChanged || !ultracodeChanged;
      const choice: PendingEffortConfirm = {
        selectedLevel,
        levelChanged,
        ultracodeOn,
        ultracodeChanged,
        persistAsDefault: persistAsDefault && !isSessionOnlyConfirm,
      };
      const totalOutputTokens = getTotalOutputTokens();
      const cacheWarm = promptCacheMayBeWarm ?? totalOutputTokens > 0;
      if (
        shouldApplyLevel &&
        shouldWarnEffortCacheMiss({
          target: selectedLevel,
          current: resolvedSessionEffort,
          mainLoopModel: model,
          permissionMode,
          totalOutputTokens,
          ackedAtOutputTokens: effortCacheMissAckedAtOutputTokens,
          promptCacheMayBeWarm: cacheWarm,
        })
      ) {
        setPendingConfirm(choice);
        return;
      }
      commitConfirm(choice);
    },
    [
      commitConfirm,
      isSessionOnlyConfirm,
      levelChanged,
      model,
      permissionMode,
      promptCacheMayBeWarm,
      resolvedSessionEffort,
      selectedLevel,
      ultracodeChanged,
      ultracodeOn,
    ],
  );

  const handleCancel = React.useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(CANCEL_MESSAGE);
  }, [onDone]);

  const isSliderActive = pendingConfirm === null;
  const exitState = useExitOnCtrlCDWithKeybindings(handleCancel, undefined, isSliderActive);

  const handleKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'return') {
        e.preventDefault();
        handleConfirm(true);
      } else if (e.key === 'escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleConfirm, handleCancel],
  );

  const decrease = React.useCallback(() => {
    setCursorIdx(i => Math.max(0, i - 1));
  }, []);
  const increase = React.useCallback(() => {
    setCursorIdx(i => Math.min(geometry.levels.length - 1, i + 1));
  }, [geometry.levels.length]);
  const toggleUltracode = React.useCallback(() => {
    if (!ultracodeOfferable) return false;
    setUltracodeOn(prev => !prev);
  }, [ultracodeOfferable]);
  const confirmSessionOnly = React.useCallback(() => {
    handleConfirm(false);
  }, [handleConfirm]);

  const sliderBindings = {
    'effortSlider:decreaseEffort': decrease,
    'effortSlider:increaseEffort': increase,
    'effortSlider:toggleUltracode': toggleUltracode,
    'effortSlider:thisSessionOnly': confirmSessionOnly,
  };

  useKeybindings(sliderBindings, { context: 'EffortSlider', isActive: isSliderActive });
  useKeybindings(
    {
      'effortPanel:decrease': decrease,
      'effortPanel:increase': increase,
      'effortPanel:home': () => setCursorIdx(0),
      'effortPanel:end': () => setCursorIdx(geometry.levels.length - 1),
      'effortPanel:confirm': () => handleConfirm(true),
      'effortPanel:thisSessionOnly': confirmSessionOnly,
      'effortPanel:cancel': handleCancel,
    },
    { context: 'EffortPanel', isActive: isSliderActive },
  );

  const leftChord = useShortcutDisplay('effortSlider:decreaseEffort', 'EffortSlider', 'left');
  const rightChord = useShortcutDisplay('effortSlider:increaseEffort', 'EffortSlider', 'right');
  const adjustShortcut = [leftChord, rightChord].filter(Boolean).join('/');
  const sessionOnlyShortcut = useShortcutDisplay('effortSlider:thisSessionOnly', 'EffortSlider', 's');

  if (pendingConfirm !== null) {
    return (
      <CacheMissConfirmDialog
        kind="effort"
        targetLabel={pendingConfirm.selectedLevel}
        onConfirm={() => {
          effortCacheMissAckedAtOutputTokens = getTotalOutputTokens();
          commitConfirm(pendingConfirm);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    );
  }

  const triangleCol = geometry.trianglePositions[selectedIdx]!;
  const trackBefore = geometry.trackChars.slice(0, triangleCol);
  const trackAfter = geometry.trackChars.slice(triangleCol + 1);
  const headerGap = Math.max(1, geometry.width - 'Faster'.length - 'Smarter'.length);
  const lastStart = geometry.labelStarts[geometry.labelStarts.length - 1]!;
  const lastLabel = geometry.levels[geometry.levels.length - 1]!;
  const trailingCount = Math.max(0, geometry.width - (lastStart + lastLabel.label.length));

  const levelDescription = isEffortCostNoteEnabled(model) ? getEffortLevelDescription(model, selectedLevel) : null;
  const showMaxReminder = selectedLevel === 'max' && modelSupportsMaxEffort(model) && isMaxEffortReminderEnabled();

  const toggleNode = (
    <UltracodeToggle
      on={ultracodeOn}
      chord={toggleChord}
      width={toggleWidth}
      onToggle={ultracodeOfferable ? () => setUltracodeOn(prev => !prev) : undefined}
    />
  );

  return (
    <Pane>
      <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
        <Text bold color="permission">
          Effort
        </Text>
        {envActive && <Text color="warning">{`⚠ CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session`}</Text>}
        <Box height={1} />
        <Box flexDirection="column" alignItems="center" width="100%">
          <Box flexDirection="row" alignItems="flex-start" justifyContent={fitsFullSlider ? undefined : 'center'}>
            {!fitsFullSlider && (
              <Box>
                <Text dimColor>{selectedIdx === 0 ? ' ' : CAROUSEL_LEFT_CHEVRON} </Text>
                <EffortLevelLabel level={geometry.levels[selectedIdx]!} selected={true} />
                <Text dimColor> {selectedIdx === geometry.levels.length - 1 ? ' ' : CAROUSEL_RIGHT_CHEVRON}</Text>
              </Box>
            )}
            <Box flexDirection="column" width={geometry.width} display={fitsFullSlider ? 'flex' : 'none'}>
              <Box>
                <Text>Faster</Text>
                <Text>{' '.repeat(headerGap)}</Text>
                <Text>Smarter</Text>
              </Box>
              {/* Official 2.1.326 #221: handle mouse clicks on track & labels in fullscreen mode. */}
              <Box
                onClick={e => {
                  e.stopImmediatePropagation();
                  setCursorIdx(findNearestSliderStopIndex(e.localCol, geometry.trianglePositions));
                }}
              >
                <Text dimColor>{trackBefore}</Text>
                <Text bold>▲</Text>
                <Text dimColor>{trackAfter}</Text>
              </Box>
              <Box>
                {geometry.levels.map((lvl, idx) => (
                  <React.Fragment key={lvl.value}>
                    {idx > 0 && <Text>{' '.repeat(geometry.spacers[idx - 1]!)}</Text>}
                    <Box
                      onClick={e => {
                        e.stopImmediatePropagation();
                        setCursorIdx(idx);
                      }}
                    >
                      <EffortLevelLabel level={lvl} selected={selectedIdx === idx} />
                    </Box>
                  </React.Fragment>
                ))}
                {trailingCount > 0 ? <Text>{' '.repeat(trailingCount)}</Text> : null}
              </Box>
            </Box>
            {ultracodeOfferable && isWide ? (
              <Box marginLeft={TOGGLE_GAP} marginTop={1}>
                {toggleNode}
              </Box>
            ) : null}
          </Box>
          {ultracodeOfferable ? (
            <Box height={1} width={geometry.width + (isWide ? TOGGLE_GAP + toggleWidth : 0)}>
              {ultracodeOn ? (
                <Text dimColor wrap="truncate-end">
                  Ultracode: {ULTRACODE_BLURB}
                </Text>
              ) : null}
            </Box>
          ) : null}
          {levelDescription !== null ? (
            <Box minHeight={2}>
              {showMaxReminder ? (
                <Text color="warning">{levelDescription}</Text>
              ) : (
                <Text dimColor>{levelDescription}</Text>
              )}
            </Box>
          ) : selectedLevel === 'max' ? (
            <Box>
              {showMaxReminder ? (
                <Text color="warning">⚠ {MAX_EFFORT_WARNING}</Text>
              ) : (
                <Text dimColor>{MAX_EFFORT_WARNING}</Text>
              )}
            </Box>
          ) : null}
          {geometry.orgNote ? (
            <Box>
              <Text dimColor>{geometry.orgNote}</Text>
            </Box>
          ) : null}
          {ultracodeOfferable && !isWide ? (
            <>
              <Box height={1} />
              {toggleNode}
            </>
          ) : null}
        </Box>
        <Box height={1} />
        {/* Official 2.1.328 footer: ←/→ to adjust · s to use this session only · Enter to save · Esc to cancel */}
        <Text dimColor italic>
          {exitState.pending ? (
            `Press ${exitState.keyName} again to cancel`
          ) : (
            <Byline>
              {adjustShortcut ? <KeyboardShortcutHint shortcut={adjustShortcut} action="adjust" /> : null}
              {sessionOnlyShortcut && !isSessionOnlyConfirm ? (
                <KeyboardShortcutHint shortcut={sessionOnlyShortcut} action="use this session only" />
              ) : null}
              <KeyboardShortcutHint shortcut="Enter" action={isSessionOnlyConfirm ? 'use this session only' : 'save'} />
              <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            </Byline>
          )}
        </Text>
      </Box>
    </Pane>
  );
}

function getScreenReaderLevelNote(model: string, level: EffortLevel): string {
  if (isEffortCostNoteEnabled(model)) {
    return getEffortLevelDescription(model, level);
  }
  return level === 'max' ? MAX_EFFORT_WARNING : '';
}

function ScreenReaderEffortPanel({ appStateEffort, onDone, promptCacheMayBeWarm }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const ultracodeState = useAppState(s => s.ultracode);
  const sessionEffort = useAppState(s => s.sessionEffort);
  const settingsEffortTable = useAppState(s => s.settingsEffortTable);
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const model = useMainLoopModel();
  const resolvedSessionEffort = React.useMemo(
    () => pdSessionEffort({ sessionEffort, effortValue: appStateEffort, settingsEffortTable }, model),
    [sessionEffort, appStateEffort, settingsEffortTable, model],
  );
  const geometry = React.useMemo(() => getSliderGeometry(model), [model]);
  const initialIdx = React.useMemo(
    () => getInitialSliderIndex(model, resolvedSessionEffort, geometry),
    [model, resolvedSessionEffort, geometry],
  );
  const ultracodeOfferable = React.useMemo(() => isUltracodeOfferable(model), [model]);
  const [pendingLevel, setPendingLevel] = React.useState<EffortLevel | null>(null);
  const doneRef = React.useRef(false);

  const options = React.useMemo(() => {
    const items = geometry.levels.map(lvl => {
      const note = getScreenReaderLevelNote(model, lvl.value);
      return {
        label: note === '' ? lvl.label : `${lvl.label} (${note})`,
        value: lvl.value as string,
      };
    });
    if (ultracodeOfferable) {
      items.push({
        label: `Ultracode: ${ultracodeState ? 'on' : 'off'} (select to turn it ${ultracodeState ? 'off' : 'on'}; ${ULTRACODE_BLURB})`,
        value: ULTRACODE_SR_TOGGLE_VALUE,
      });
    }
    return items;
  }, [geometry.levels, model, ultracodeOfferable, ultracodeState]);

  const defaultValue = geometry.levels[Math.min(initialIdx, geometry.levels.length - 1)]!.value;

  const commitSelected = React.useCallback(
    (selected: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const arg =
        selected === ULTRACODE_SR_TOGGLE_VALUE ? (ultracodeState ? 'ultracode off' : 'ultracode on') : selected;
      const result = executeEffort(arg, model, undefined, true, resolvedSessionEffort);
      if (result.effortUpdate) {
        setAppState(prev => ({
          ...prev,
          ...(result.effortUpdate!.ultracode === undefined
            ? {
                sessionEffort: explicitSessionEffort(result.effortUpdate!.value),
              }
            : {}),
          settingsEffortTable: teSettingsEffortTable(),
          ...(result.effortUpdate!.ultracode !== undefined ? { ultracode: result.effortUpdate!.ultracode } : {}),
        }));
      }
      onDone(result.message);
    },
    [resolvedSessionEffort, model, onDone, setAppState, ultracodeState],
  );

  const handleSelect = React.useCallback(
    (selected: string) => {
      if (doneRef.current) return;
      if (selected !== ULTRACODE_SR_TOGGLE_VALUE) {
        const level = selected as EffortLevel;
        const totalOutputTokens = getTotalOutputTokens();
        const cacheWarm = promptCacheMayBeWarm ?? totalOutputTokens > 0;
        if (
          shouldWarnEffortCacheMiss({
            target: level,
            current: resolvedSessionEffort,
            mainLoopModel: model,
            permissionMode,
            totalOutputTokens,
            ackedAtOutputTokens: effortCacheMissAckedAtOutputTokens,
            promptCacheMayBeWarm: cacheWarm,
          })
        ) {
          setPendingLevel(level);
          return;
        }
      }
      commitSelected(selected);
    },
    [commitSelected, model, permissionMode, promptCacheMayBeWarm, resolvedSessionEffort],
  );

  const handleCancel = React.useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(CANCEL_MESSAGE);
  }, [onDone]);

  if (pendingLevel !== null) {
    return (
      <CacheMissConfirmDialog
        kind="effort"
        targetLabel={pendingLevel}
        onConfirm={() => {
          effortCacheMissAckedAtOutputTokens = getTotalOutputTokens();
          commitSelected(pendingLevel);
        }}
        onCancel={() => setPendingLevel(null)}
      />
    );
  }

  return (
    <Pane>
      <Box flexDirection="column">
        <Text bold color="permission">
          Effort
        </Text>
        {geometry.orgNote ? <Text>{geometry.orgNote}</Text> : null}
        <Select options={options} defaultValue={defaultValue} onChange={handleSelect} onCancel={handleCancel} />
      </Box>
    </Pane>
  );
}
