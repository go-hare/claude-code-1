import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import { useShortcutDisplay } from 'src/keybindings/useShortcutDisplay.js';
import { getFeedbackCommandDisabledReason } from 'src/utils/feedbackDrafts/gates.js';
import {
  builtInCommandNames,
  type Command,
  type CommandResultDisplay,
  INTERNAL_ONLY_COMMANDS,
} from '../../commands.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Link, Text, Tab, Tabs, Pane } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { Commands } from './Commands.js';
import { General } from './General.js';

type Props = {
  onClose: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  commands: Command[];
};

/** densable 2.1.289 Help `ee=44` — feedback footer when tall enough. */
const HELP_FEEDBACK_FOOTER_MIN_ROWS = 44;

export function HelpV2({ onClose, commands }: Props): React.ReactNode {
  const { rows, columns } = useTerminalSize();
  const maxHeight = Math.floor(rows / 2);
  // Inside the modal slot, FullscreenLayout already caps height and Pane/Tabs
  // use flexShrink=0 (see #23592) — our own height= constraint would clip the
  // footer since Tabs won't shrink to fit. Let the modal slot handle sizing.
  const insideModal = useIsInsideModal();

  const close = () => onClose('Help dialog dismissed', { display: 'system' });
  useKeybinding('help:dismiss', close, { context: 'Help' });
  const exitState = useExitOnCtrlCDWithKeybindings(close);
  const dismissShortcut = useShortcutDisplay('help:dismiss', 'Help', 'esc');
  // densable QA() — show /feedback line when the command is not disabled.
  const showFeedbackFooter = rows >= HELP_FEEDBACK_FOOTER_MIN_ROWS && getFeedbackCommandDisabledReason() === null;

  const builtinNames = builtInCommandNames();
  let builtinCommands = commands.filter(cmd => builtinNames.has(cmd.name) && !cmd.isHidden);
  let antOnlyCommands: Command[] = [];

  // We have to do this in an `if` to help treeshaking
  if (process.env.USER_TYPE === 'ant') {
    const internalOnlyNames = new Set(INTERNAL_ONLY_COMMANDS.map(_ => _.name));
    builtinCommands = builtinCommands.filter(cmd => !internalOnlyNames.has(cmd.name));
    antOnlyCommands = commands.filter(cmd => internalOnlyNames.has(cmd.name) && !cmd.isHidden);
  }

  const customCommands = commands.filter(cmd => !builtinNames.has(cmd.name) && !cmd.isHidden);

  const tabs = [
    <Tab key="general" id="general" title="General">
      <General />
    </Tab>,
  ];

  tabs.push(
    <Tab key="commands" id="commands" title="Commands">
      <Commands
        commands={builtinCommands}
        maxHeight={maxHeight}
        columns={columns}
        title="Browse default commands"
        onCancel={close}
      />
    </Tab>,
  );

  tabs.push(
    <Tab key="custom" id="custom" title="Custom commands">
      <Commands
        commands={customCommands}
        maxHeight={maxHeight}
        columns={columns}
        title="Browse custom commands"
        emptyMessage="No custom commands found"
        onCancel={close}
      />
    </Tab>,
  );

  if (process.env.USER_TYPE === 'ant' && antOnlyCommands.length > 0) {
    tabs.push(
      <Tab key="ant-only" id="ant-only" title="[ant-only]">
        <Commands
          commands={antOnlyCommands}
          maxHeight={maxHeight}
          columns={columns}
          title="Browse ant-only commands"
          onCancel={close}
        />
      </Tab>,
    );
  }

  return (
    <Box flexDirection="column" height={insideModal ? undefined : maxHeight}>
      <Pane color="professionalBlue">
        <Tabs title="Help" color="professionalBlue" defaultTab="general" navFromContent>
          {tabs}
        </Tabs>
        <Box marginTop={1} flexShrink={0}>
          <Text>
            For more help: <Link url="https://code.claude.com/docs/en/overview" />
          </Text>
        </Box>
        {showFeedbackFooter && (
          <Box marginTop={1} flexShrink={0}>
            <Text dimColor>Something else? Use /feedback to report bugs or request features.</Text>
          </Box>
        )}
        <Box marginTop={1} flexShrink={0}>
          <Text dimColor>
            {exitState.pending ? (
              <>Press {exitState.keyName} again to exit</>
            ) : (
              <Text italic>{dismissShortcut} to cancel</Text>
            )}
          </Text>
        </Box>
      </Pane>
    </Box>
  );
}
