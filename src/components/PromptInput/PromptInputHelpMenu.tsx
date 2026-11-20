import { feature } from 'bun:bundle';
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { Box, formatShortcutString, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { getPlatform } from 'src/utils/platform.js';
import { useOptionalKeybindingContext } from '../../keybindings/KeybindingContext.js';
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { modelSupportsEffort } from '../../utils/effort.js';
import { isFastModeAvailable, isFastModeEnabled } from '../../utils/fastMode.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { getPanesState, subscribePanes } from '../../utils/plugins/functionHooksModules.js';
import { getNewlineInstructions } from './utils.js';

/** Official 2.1.328 `gln`: `var ep = { keyCase: "lower" }, B9 = 2`. */
const HELP_SHORTCUT_FORMAT = { keyCase: 'lower' as const };
const HELP_COLUMN_PADDING_RIGHT = 2;

/**
 * Official 2.1.328 `a_e`: collapse shared multi-keystroke chord prefix across
 * increase/decrease effort shortcuts (e.g. `ctrl+x =` + `ctrl+x -` → `ctrl+x =/-`;
 * `shift+up` + `shift+down` → `shift+↑/↓`).
 */
export function formatEffortShortcutPair(increaseShortcut: string, decreaseShortcut: string): string {
  const sharedChordPrefix =
    / \S$/.test(increaseShortcut) &&
    / \S$/.test(decreaseShortcut) &&
    increaseShortcut.slice(0, -1) === decreaseShortcut.slice(0, -1);
  const chords = [increaseShortcut, sharedChordPrefix ? decreaseShortcut.slice(-1) : decreaseShortcut];
  return formatShortcutString(chords, HELP_SHORTCUT_FORMAT);
}

function EffortShortcutHint({ dimColor }: { dimColor?: boolean }): React.ReactNode {
  const kbCtx = useOptionalKeybindingContext();
  const increaseShortcut = kbCtx?.getDisplayText('chat:increaseEffort', 'Chat') ?? 'shift+up';
  const decreaseShortcut = kbCtx?.getDisplayText('chat:decreaseEffort', 'Chat') ?? 'shift+down';
  const formatted = formatEffortShortcutPair(increaseShortcut, decreaseShortcut);
  if (!formatted) return null;
  return (
    <Box>
      <Text dimColor={dimColor}>
        <KeyboardShortcutHint shortcut={formatted} action="change effort" />
      </Text>
    </Box>
  );
}

type Props = {
  dimColor?: boolean;
  fixedWidth?: boolean;
  gap?: number;
  paddingX?: number;
  /** Official 2.1.328 #602: show exit warning (e.g. Press Ctrl-C again to exit) while `?` help is open. */
  exitMessage?: {
    show: boolean;
    key?: string;
  };
};

export function PromptInputHelpMenu(props: Props): React.ReactNode {
  const { dimColor, fixedWidth, gap, paddingX, exitMessage } = props;

  const transcriptShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const todosShortcut = useShortcutDisplay('app:toggleTodos', 'Global', 'ctrl+t');
  const undoShortcut = useShortcutDisplay('chat:undo', 'Chat', 'ctrl+_');
  const stashShortcut = useShortcutDisplay('chat:stash', 'Chat', 'ctrl+s');
  const cycleModeShortcut = useShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab');
  const modelPickerShortcut = useShortcutDisplay('chat:modelPicker', 'Chat', 'alt+p');
  const fastModeShortcut = useShortcutDisplay('chat:fastMode', 'Chat', 'alt+o');
  const externalEditorShortcut = useShortcutDisplay('chat:externalEditor', 'Chat', 'ctrl+g');
  const terminalShortcut = useShortcutDisplay('app:toggleTerminal', 'Global', 'meta+j');
  const imagePasteShortcut = useShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v');
  const focusPanelShortcut = useShortcutDisplay('abovePrompt:focus', 'Chat', 'ctrl+x tab');
  const closePanelShortcut = useShortcutDisplay('pane:close', 'Pane', 'ctrl+x x');
  // Official 2.1.328 `gln`: `Ot = Hp(aq)` where `aq = h => h.open.length > 0`.
  const hasOpenPanels = useSyncExternalStore(subscribePanes, () => getPanesState().open.length > 0);
  // Official 2.1.328 `gln`: `qet(dt()) ? <a_e dimColor={C} /> : null`.
  const showEffortRow = modelSupportsEffort(getMainLoopModel());
  const exitWarningText = exitMessage?.show ? `Press ${exitMessage.key ?? 'Ctrl-C'} again to exit` : null;

  const terminalShortcutElement = feature('TERMINAL_PANEL') ? (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_panel', false) ? (
      <Box>
        <Text dimColor={dimColor}>{formatShortcutString(terminalShortcut, HELP_SHORTCUT_FORMAT)} for terminal</Text>
      </Box>
    ) : null
  ) : null;

  return (
    <Box paddingX={paddingX} flexDirection="column">
      <Box flexDirection="row" gap={gap}>
        <Box flexDirection="column" width={fixedWidth ? 24 : undefined} paddingRight={HELP_COLUMN_PADDING_RIGHT}>
          <Box>
            <Text dimColor={dimColor}>! for shell mode</Text>
          </Box>
          <Box>
            <Text dimColor={dimColor}>/ for commands</Text>
          </Box>
          <Box>
            <Text dimColor={dimColor}>@ for file paths</Text>
          </Box>
          <Box>
            <Text dimColor={dimColor}>/btw for side question</Text>
          </Box>
        </Box>
        <Box flexDirection="column" width={fixedWidth ? 35 : undefined} paddingRight={HELP_COLUMN_PADDING_RIGHT}>
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut="escape escape" action="clear input" format={HELP_SHORTCUT_FORMAT} />
            </Text>
          </Box>
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut={cycleModeShortcut} action="cycle modes" format={HELP_SHORTCUT_FORMAT} />
            </Text>
          </Box>
          {showEffortRow ? <EffortShortcutHint dimColor={dimColor} /> : null}
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint
                shortcut={transcriptShortcut}
                action="see full transcript"
                format={HELP_SHORTCUT_FORMAT}
              />
            </Text>
          </Box>
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut={todosShortcut} action="toggle tasks" format={HELP_SHORTCUT_FORMAT} />
            </Text>
          </Box>
          {hasOpenPanels && (
            <>
              <Box>
                <Text dimColor={dimColor}>
                  <KeyboardShortcutHint
                    shortcut={focusPanelShortcut}
                    action="focus next panel"
                    format={HELP_SHORTCUT_FORMAT}
                  />
                </Text>
              </Box>
              <Box>
                <Text dimColor={dimColor}>
                  <KeyboardShortcutHint
                    shortcut={closePanelShortcut}
                    action="close focused panel"
                    format={HELP_SHORTCUT_FORMAT}
                  />
                </Text>
              </Box>
            </>
          )}
          {terminalShortcutElement}
          <Box>
            <Text dimColor={dimColor}>{getNewlineInstructions()}</Text>
          </Box>
        </Box>
        <Box flexDirection="column">
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut={undoShortcut} action="undo" format={HELP_SHORTCUT_FORMAT} />
            </Text>
          </Box>
          {getPlatform() !== 'windows' && (
            <Box>
              <Text dimColor={dimColor}>
                <KeyboardShortcutHint shortcut="ctrl+z" action="suspend" format={HELP_SHORTCUT_FORMAT} />
              </Text>
            </Box>
          )}
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut={imagePasteShortcut} action="paste images" format={HELP_SHORTCUT_FORMAT} />
            </Text>
          </Box>
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint
                shortcut={modelPickerShortcut}
                action="switch model"
                format={HELP_SHORTCUT_FORMAT}
              />
            </Text>
          </Box>
          {isFastModeEnabled() && isFastModeAvailable() && (
            <Box>
              <Text dimColor={dimColor}>
                <KeyboardShortcutHint
                  shortcut={fastModeShortcut}
                  action="toggle fast mode"
                  format={HELP_SHORTCUT_FORMAT}
                />
              </Text>
            </Box>
          )}
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut={stashShortcut} action="stash prompt" format={HELP_SHORTCUT_FORMAT} />
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint
                shortcut={externalEditorShortcut}
                action="edit in $EDITOR"
                format={HELP_SHORTCUT_FORMAT}
              />
            </Text>
          </Box>
          {isKeybindingCustomizationEnabled() && (
            <Box>
              <Text dimColor={dimColor}>/keybindings to customize</Text>
            </Box>
          )}
        </Box>
      </Box>
      {exitWarningText && (
        <Box flexShrink={0}>
          <Text dimColor>{exitWarningText}</Text>
        </Box>
      )}
    </Box>
  );
}
