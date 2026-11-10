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
  useTerminalSize,
} from '@anthropic/ink';
import { executeEffort } from '../../commands/effort/effort.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  isUltracodeOfferable,
  modelSupportsMaxEffort,
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
const MIN_TOGGLE_WIDTH = 14;
const DEFAULT_FALLBACK_INDEX = 2;
const SHIMMER_HIGHLIGHT_HEX: Color = '#d0b4ff';
const ULTRACODE_SR_TOGGLE_VALUE = 'ultracode-toggle';

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

function UltracodeToggle({ on, chord, width }: { on: boolean; chord: string; width: number }): React.ReactNode {
  return (
    <Box flexDirection="column" width={width}>
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
};

export function EffortPanel(props: Props): React.ReactNode {
  const srContext = React.useContext(AccessibilityContext);
  if (srContext || isScreenReaderModeEnabled()) {
    return <ScreenReaderEffortPanel {...props} />;
  }
  return <VisualEffortPanel {...props} />;
}

function VisualEffortPanel({ appStateEffort, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const ultracodeState = useAppState(s => s.ultracode);
  const model = useMainLoopModel();
  const { columns } = useTerminalSize();

  const geometry = React.useMemo(() => getSliderGeometry(model), [model]);
  const initialIdx = React.useMemo(
    () => getInitialSliderIndex(model, appStateEffort, geometry),
    [model, appStateEffort, geometry],
  );
  const [cursorIdx, setCursorIdx] = React.useState(initialIdx);
  const selectedIdx = Math.min(cursorIdx, geometry.levels.length - 1);

  const ultracodeOfferable = React.useMemo(() => isUltracodeOfferable(model), [model]);
  const initialUltracode = ultracodeState === true && ultracodeOfferable;
  const [ultracodeOn, setUltracodeOn] = React.useState(initialUltracode);

  const toggleChord = useShortcutDisplay('effortSlider:toggleUltracode', 'EffortSlider', 'tab');
  const toggleHintWidth = stringWidth(`${toggleChord} to toggle`);
  const toggleWidth = Math.max(MIN_TOGGLE_WIDTH, toggleHintWidth);
  const isWide = columns >= SIDE_BY_SIDE_MIN_COLS + toggleWidth - MIN_TOGGLE_WIDTH;

  const doneRef = React.useRef(false);

  const handleConfirm = React.useCallback(
    (persistAsDefault = true) => {
      if (doneRef.current) return;
      doneRef.current = true;

      const selectedLevel = geometry.levels[selectedIdx]!.value;
      const levelChanged = selectedIdx !== initialIdx;
      const ultracodeChanged = ultracodeOn !== initialUltracode;
      const shouldApplyLevel = levelChanged || !ultracodeChanged;

      const messages: string[] = [];
      let nextEffort = appStateEffort;
      let hasEffortUpdate = false;

      if (shouldApplyLevel) {
        const outcome = computeConfirmOutcome(selectedLevel, arg =>
          executeEffort(arg, model, undefined, persistAsDefault, appStateEffort),
        );
        messages.push(outcome.message);
        if (outcome.effortUpdate) {
          nextEffort = outcome.effortUpdate.value;
          hasEffortUpdate = true;
        }
      }

      if (ultracodeChanged) {
        const ultraOutcome = executeEffort(
          ultracodeOn ? 'ultracode on' : 'ultracode off',
          model,
          undefined,
          persistAsDefault,
          nextEffort,
        );
        messages.push(
          messages.length === 0 || !ultraOutcome.effortUpdate
            ? ultraOutcome.message
            : `Ultracode ${ultracodeOn ? 'on' : 'off'}`,
        );
        if (!shouldApplyLevel && ultraOutcome.effortUpdate) {
          nextEffort = ultraOutcome.effortUpdate.value;
          hasEffortUpdate = true;
        }
      }

      if (hasEffortUpdate || ultracodeChanged) {
        setAppState(prev => ({
          ...prev,
          ...(hasEffortUpdate ? { effortValue: nextEffort } : {}),
          ...(ultracodeChanged ? { ultracode: ultracodeOn } : {}),
        }));
      }

      onDone(messages.join(' · '));
    },
    [
      appStateEffort,
      geometry.levels,
      initialIdx,
      initialUltracode,
      model,
      onDone,
      selectedIdx,
      setAppState,
      ultracodeOn,
    ],
  );

  const handleCancel = React.useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(CANCEL_MESSAGE);
  }, [onDone]);

  const exitState = useExitOnCtrlCDWithKeybindings(handleCancel);

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

  useKeybindings(sliderBindings, { context: 'EffortSlider' });
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
    { context: 'EffortPanel' },
  );

  const leftChord = useShortcutDisplay('effortSlider:decreaseEffort', 'EffortSlider', 'left');
  const rightChord = useShortcutDisplay('effortSlider:increaseEffort', 'EffortSlider', 'right');
  const adjustShortcut = [leftChord, rightChord].filter(Boolean).join('/');
  const sessionOnlyShortcut = useShortcutDisplay('effortSlider:thisSessionOnly', 'EffortSlider', 's');

  const envOverride = getEffortEnvOverride();
  const envActive = envOverride !== null && envOverride !== undefined;
  const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;

  const triangleCol = geometry.trianglePositions[selectedIdx]!;
  const trackBefore = geometry.trackChars.slice(0, triangleCol);
  const trackAfter = geometry.trackChars.slice(triangleCol + 1);
  const headerGap = Math.max(1, geometry.width - 'Faster'.length - 'Smarter'.length);
  const lastStart = geometry.labelStarts[geometry.labelStarts.length - 1]!;
  const lastLabel = geometry.levels[geometry.levels.length - 1]!;
  const trailingCount = Math.max(0, geometry.width - (lastStart + lastLabel.label.length));

  const selectedLevel = geometry.levels[selectedIdx]!.value;
  const levelDescription = isEffortCostNoteEnabled(model) ? getEffortLevelDescription(model, selectedLevel) : null;
  const showMaxReminder = selectedLevel === 'max' && modelSupportsMaxEffort(model) && isMaxEffortReminderEnabled();

  const toggleNode = <UltracodeToggle on={ultracodeOn} chord={toggleChord} width={toggleWidth} />;

  return (
    <Pane>
      <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
        <Text bold color="suggestion">
          Effort
        </Text>
        {envActive && <Text color="warning">{`⚠ CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session`}</Text>}
        <Box height={1} />
        <Box flexDirection="column" alignItems="center" width="100%">
          <Box flexDirection="row" alignItems="flex-start">
            <Box flexDirection="column" width={geometry.width}>
              <Box>
                <Text>Faster</Text>
                <Text>{' '.repeat(headerGap)}</Text>
                <Text>Smarter</Text>
              </Box>
              <Box>
                <Text dimColor>{trackBefore}</Text>
                <Text bold>▲</Text>
                <Text dimColor>{trackAfter}</Text>
              </Box>
              <Box>
                {geometry.levels.map((lvl, idx) => (
                  <React.Fragment key={lvl.value}>
                    {idx > 0 && <Text>{' '.repeat(geometry.spacers[idx - 1]!)}</Text>}
                    <EffortLevelLabel level={lvl} selected={selectedIdx === idx} />
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
        {/* Footer: Enter to confirm · s for this session only · Esc to cancel */}
        <Text dimColor>
          {exitState.pending ? (
            `Press ${exitState.keyName} again to cancel`
          ) : (
            <Byline>
              {adjustShortcut ? <KeyboardShortcutHint shortcut={adjustShortcut} action="adjust" /> : null}
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              {sessionOnlyShortcut ? <Text>{sessionOnlyShortcut} for this session only</Text> : null}
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

function ScreenReaderEffortPanel({ appStateEffort, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const ultracodeState = useAppState(s => s.ultracode);
  const model = useMainLoopModel();
  const geometry = React.useMemo(() => getSliderGeometry(model), [model]);
  const initialIdx = React.useMemo(
    () => getInitialSliderIndex(model, appStateEffort, geometry),
    [model, appStateEffort, geometry],
  );
  const ultracodeOfferable = React.useMemo(() => isUltracodeOfferable(model), [model]);
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

  const handleSelect = React.useCallback(
    (selected: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const arg =
        selected === ULTRACODE_SR_TOGGLE_VALUE ? (ultracodeState ? 'ultracode off' : 'ultracode on') : selected;
      const result = executeEffort(arg, model, undefined, true, appStateEffort);
      if (result.effortUpdate) {
        setAppState(prev => ({
          ...prev,
          effortValue: result.effortUpdate!.value,
          ...(result.effortUpdate!.ultracode !== undefined ? { ultracode: result.effortUpdate!.ultracode } : {}),
        }));
      }
      onDone(result.message);
    },
    [appStateEffort, model, onDone, setAppState, ultracodeState],
  );

  const handleCancel = React.useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(CANCEL_MESSAGE);
  }, [onDone]);

  return (
    <Pane>
      <Box flexDirection="column">
        <Text bold color="suggestion">
          Effort
        </Text>
        {geometry.orgNote ? <Text>{geometry.orgNote}</Text> : null}
        <Select options={options} defaultValue={defaultValue} onChange={handleSelect} onCancel={handleCancel} />
      </Box>
    </Pane>
  );
}
