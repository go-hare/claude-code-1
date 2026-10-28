import { feature } from 'bun:bundle';
import * as React from 'react';
import { Box, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { getPlatform } from 'src/utils/platform.js';
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { isFastModeAvailable, isFastModeEnabled } from '../../utils/fastMode.js';
import { getNewlineInstructions } from './utils.js';

/** densable LK / em: keyCase lower, modSep " + ". */
function formatHelpShortcut(shortcut: string): string {
  let s = shortcut.replace(/\+/g, ' + ');
  // densable U.alt.lower(macos) → opt. Model picker is alt/opt, not meta.
  if (getPlatform() === 'macos') {
    s = s.replace(/\balt\b/g, 'opt').replace(/\bmeta\b/g, 'opt');
  }
  // densable undo chord ctrl+shift+- paints as underscore (shift + minus).
  if (s.endsWith(' + -')) {
    s = `${s.slice(0, -3)}_`;
  }
  return s;
}

type Props = {
  dimColor?: boolean;
  fixedWidth?: boolean;
  gap?: number;
  paddingX?: number;
};

export function PromptInputHelpMenu(props: Props): React.ReactNode {
  const { dimColor, fixedWidth, gap, paddingX } = props;

  const transcriptShortcut = formatHelpShortcut(useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o'));
  const todosShortcut = formatHelpShortcut(useShortcutDisplay('app:toggleTodos', 'Global', 'ctrl+t'));
  const undoShortcut = formatHelpShortcut(useShortcutDisplay('chat:undo', 'Chat', 'ctrl+_'));
  const stashShortcut = formatHelpShortcut(useShortcutDisplay('chat:stash', 'Chat', 'ctrl+s'));
  const cycleModeShortcut = formatHelpShortcut(useShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab'));
  const modelPickerShortcut = formatHelpShortcut(useShortcutDisplay('chat:modelPicker', 'Chat', 'alt+p'));
  const fastModeShortcut = formatHelpShortcut(useShortcutDisplay('chat:fastMode', 'Chat', 'alt+o'));
  const externalEditorShortcut = formatHelpShortcut(useShortcutDisplay('chat:externalEditor', 'Chat', 'ctrl+g'));
  const terminalShortcut = formatHelpShortcut(useShortcutDisplay('app:toggleTerminal', 'Global', 'meta+j'));
  const imagePasteShortcut = formatHelpShortcut(useShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v'));

  const terminalShortcutElement = feature('TERMINAL_PANEL') ? (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_panel', false) ? (
      <Box>
        <Text dimColor={dimColor}>{terminalShortcut} for terminal</Text>
      </Box>
    ) : null
  ) : null;

  return (
    <Box paddingX={paddingX} flexDirection="row" gap={gap}>
      <Box flexDirection="column" width={fixedWidth ? 24 : undefined}>
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
      <Box flexDirection="column" width={fixedWidth ? 35 : undefined}>
        <Box>
          <Text dimColor={dimColor}>double tap esc to clear input</Text>
        </Box>
        <Box>
          <Text dimColor={dimColor}>
            <KeyboardShortcutHint shortcut={cycleModeShortcut} action="auto-accept edits" />
          </Text>
        </Box>
        <Box>
          <Text dimColor={dimColor}>{transcriptShortcut} for verbose output</Text>
        </Box>
        <Box>
          <Text dimColor={dimColor}>
            <KeyboardShortcutHint shortcut={todosShortcut} action="toggle tasks" />
          </Text>
        </Box>
        {terminalShortcutElement}
        <Box>
          <Text dimColor={dimColor}>{getNewlineInstructions()}</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Box>
          <Text dimColor={dimColor}>
            <KeyboardShortcutHint shortcut={undoShortcut} action="undo" />
          </Text>
        </Box>
        {getPlatform() !== 'windows' && (
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut="ctrl + z" action="suspend" />
            </Text>
          </Box>
        )}
        <Box>
          <Text dimColor={dimColor}>
            <KeyboardShortcutHint shortcut={imagePasteShortcut} action="paste images" />
          </Text>
        </Box>
        <Box>
          <Text dimColor={dimColor}>
            <KeyboardShortcutHint shortcut={modelPickerShortcut} action="switch model" />
          </Text>
        </Box>
        {isFastModeEnabled() && isFastModeAvailable() && (
          <Box>
            <Text dimColor={dimColor}>
              <KeyboardShortcutHint shortcut={fastModeShortcut} action="toggle fast mode" />
            </Text>
          </Box>
        )}
        <Box>
          <Text dimColor={dimColor}>
            <KeyboardShortcutHint shortcut={stashShortcut} action="stash prompt" />
          </Text>
        </Box>
        <Box>
          <Text dimColor={dimColor}>{externalEditorShortcut} to edit in $EDITOR</Text>
        </Box>
        {isKeybindingCustomizationEnabled() && (
          <Box>
            <Text dimColor={dimColor}>/keybindings to customize</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
