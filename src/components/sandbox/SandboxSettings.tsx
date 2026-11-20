import React from 'react';
import { Box, Link, Text, Pane, Tab, Tabs, useTabHeaderFocus } from '@anthropic/ink';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { CommandResultDisplay } from '../../types/command.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
import { clearSandboxRootMoveHold, SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettings_DEPRECATED, getSettingsFilePathForSource } from '../../utils/settings/settings.js';
import { getErrnoCode } from '../../utils/errors.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { Select } from '../CustomSelect/select.js';
import { SandboxConfigTab } from './SandboxConfigTab.js';
import { SandboxDependenciesTab } from './SandboxDependenciesTab.js';
import { SandboxOverridesTab } from './SandboxOverridesTab.js';

type Props = {
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  depCheck: SandboxDependencyCheck;
};

type SandboxMode = 'auto-allow' | 'regular' | 'disabled';

const UNWRITABLE_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

export function formatSandboxSaveResult(
  result: { error: Error | null },
  successMessage: string,
  settingsSource: 'localSettings' | 'userSettings' = 'localSettings',
): string {
  if (result.error === null) return successMessage;
  const err = result.error.cause instanceof Error ? result.error.cause : result.error;
  const code = getErrnoCode(err);
  const filePath = getSettingsFilePathForSource(settingsSource) ?? '.claude/settings.local.json';
  const hint =
    code !== undefined && UNWRITABLE_CODES.has(code) ? ' Start Claude Code in a project folder you can write to.' : '';
  return `✗ Sandbox settings not changed: ${filePath} couldn't be updated (${code ?? err.message}).${hint}`;
}

export function SandboxSettings({ onComplete, depCheck }: Props): React.ReactNode {
  const currentEnabled = SandboxManager.isSandboxingEnabled();
  const currentAutoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled();
  const hasWarnings = depCheck.warnings.length > 0;
  const settings = getSettings_DEPRECATED();
  const allowAllUnixSockets = settings.sandbox?.network?.allowAllUnixSockets;
  // Show warning if seccomp missing AND user hasn't allowed all unix sockets
  const showSocketWarning = hasWarnings && !allowAllUnixSockets;

  // Determine current mode
  const getCurrentMode = (): SandboxMode => {
    if (!currentEnabled) return 'disabled';
    if (currentAutoAllow) return 'auto-allow';
    return 'regular';
  };

  const currentMode = getCurrentMode();

  const options = [
    {
      label: 'Sandbox commands, with auto-allow',
      value: 'auto-allow',
    },
    {
      label: 'Sandbox commands, with regular permissions',
      value: 'regular',
    },
    {
      label: 'No Sandbox',
      value: 'disabled',
    },
  ];

  async function handleSelect(value: string) {
    const mode = value as SandboxMode;

    switch (mode) {
      case 'auto-allow': {
        const res = await SandboxManager.setSandboxSettings({
          enabled: true,
          autoAllowBashIfSandboxed: true,
        });
        onComplete(formatSandboxSaveResult(res, '✓ Sandbox enabled with auto-allow for bash commands'));
        break;
      }
      case 'regular': {
        const res = await SandboxManager.setSandboxSettings({
          enabled: true,
          autoAllowBashIfSandboxed: false,
        });
        onComplete(formatSandboxSaveResult(res, '✓ Sandbox enabled with regular bash permissions'));
        break;
      }
      case 'disabled': {
        // Official 2.1.326 #299: explicit /sandbox change clears any root-move sandbox hold.
        clearSandboxRootMoveHold();
        const res = await SandboxManager.setSandboxSettings({
          enabled: false,
          autoAllowBashIfSandboxed: false,
        });
        onComplete(formatSandboxSaveResult(res, '○ Sandbox disabled'));
        break;
      }
    }
  }

  const handleCancel = () => onComplete(undefined, { display: 'skip' });

  useKeybindings(
    {
      'confirm:no': handleCancel,
    },
    { context: 'Settings' },
  );

  const exitState = useExitOnCtrlCDWithKeybindings(handleCancel);

  const modeTab = (
    <Tab key="mode" title="Mode">
      <SandboxModeTab
        showSocketWarning={showSocketWarning}
        options={options}
        currentMode={currentMode}
        onSelect={handleSelect}
        onComplete={onComplete}
      />
    </Tab>
  );

  const overridesTab = (
    <Tab key="overrides" title="Overrides">
      <SandboxOverridesTab onComplete={onComplete} />
    </Tab>
  );

  const configTab = (
    <Tab key="config" title="Config">
      <SandboxConfigTab />
    </Tab>
  );

  const hasErrors = depCheck.errors.length > 0;

  // If required deps missing, only show Dependencies tab
  // If only optional deps missing, show all tabs
  const tabs = hasErrors
    ? [
        <Tab key="dependencies" title="Dependencies">
          <SandboxDependenciesTab depCheck={depCheck} />
        </Tab>,
      ]
    : [
        modeTab,
        ...(hasWarnings
          ? [
              <Tab key="dependencies" title="Dependencies">
                <SandboxDependenciesTab depCheck={depCheck} />
              </Tab>,
            ]
          : []),
        overridesTab,
        configTab,
      ];

  return (
    <Pane color="permission">
      <Tabs title="Sandbox" color="permission" defaultTab="Mode" navFromContent={true}>
        {tabs}
      </Tabs>
      <Box marginTop={1}>
        <Text dimColor italic>
          {exitState.pending
            ? `Press ${exitState.keyName} again to close`
            : '←/→ to switch · ↑/↓ to navigate · Enter to select · Esc to close'}
        </Text>
      </Box>
    </Pane>
  );
}

function SandboxModeTab({
  showSocketWarning,
  options,
  currentMode,
  onSelect,
  onComplete,
}: {
  showSocketWarning: boolean;
  options: Array<{ label: string; value: string }>;
  currentMode: SandboxMode;
  onSelect: (value: string) => void;
  onComplete: Props['onComplete'];
}): React.ReactNode {
  const { headerFocused, focusHeader } = useTabHeaderFocus();
  return (
    <Box flexDirection="column" paddingY={1}>
      {showSocketWarning && (
        <Box marginBottom={1}>
          <Text color="warning">Cannot block unix domain sockets (see Dependencies tab)</Text>
        </Box>
      )}
      <Box marginBottom={1}>
        <Text bold>Configure mode</Text>
      </Box>
      {/* Official 2.1.326 #29 & 2.1.327 #507: disable printable keybindings and hide indexes when screen reader is off. */}
      <Select
        options={options}
        defaultValue={currentMode}
        defaultFocusValue={currentMode}
        disablePrintableKeybindings
        hideIndexes={!isScreenReaderModeEnabled()}
        onChange={onSelect}
        onCancel={() => onComplete(undefined, { display: 'skip' })}
        onUpFromFirstItem={focusHeader}
        isDisabled={headerFocused}
      />
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text dimColor>
          <Text bold dimColor>
            Auto-allow mode:
          </Text>{' '}
          Commands will try to run in the sandbox automatically, and attempts to run outside of the sandbox fallback to
          regular permissions. Explicit ask/deny rules are always respected.
        </Text>
        <Text dimColor>
          Learn more: <Link url="https://code.claude.com/docs/en/sandboxing">code.claude.com/docs/en/sandboxing</Link>
        </Text>
      </Box>
    </Box>
  );
}
