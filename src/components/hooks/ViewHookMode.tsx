/**
 * ViewHookMode shows read-only details for a single configured hook.
 */
import * as React from 'react';
import { Box, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { getDisplayPath } from '../../utils/file.js';
import { hookSourceDescriptionDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { getSettingsFilePathForSource } from '../../utils/settings/settings.js';

type Props = {
  selectedHook: IndividualHookConfig;
  eventSupportsMatcher: boolean;
  onCancel: () => void;
};

export function ViewHookMode({ selectedHook, eventSupportsMatcher, onCancel }: Props): React.ReactNode {
  const matcherLabel = selectedHook.matcher || 'matches everything';
  const title = getHookTypeTitle(selectedHook.config);
  const subtitle = eventSupportsMatcher ? `${selectedHook.event} · ${matcherLabel}` : selectedHook.event;

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onCancel={onCancel}
      inputGuide={<KeyboardShortcutHint shortcut="esc" action="go back" />}
    >
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            <Text bold>Source:</Text> <Text dimColor>{hookSourceDescriptionDisplayString(selectedHook.source)}</Text>
          </Text>
          {selectedHook.pluginName && (
            <Text>
              <Text bold>Plugin:</Text> <Text dimColor>{selectedHook.pluginName}</Text>
            </Text>
          )}
          {'statusMessage' in selectedHook.config && selectedHook.config.statusMessage && (
            <Text>
              <Text bold>Status message:</Text> <Text dimColor>{selectedHook.config.statusMessage}</Text>
            </Text>
          )}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>{getContentFieldLabel(selectedHook.config)}</Text>
          <Box borderStyle="round" borderDimColor paddingLeft={1} paddingRight={1}>
            <Text>{getContentFieldValue(selectedHook.config)}</Text>
          </Box>
        </Box>
        <Text dimColor>{getHookSourceFooter(selectedHook)}</Text>
      </Box>
    </Dialog>
  );
}

function getHookTypeTitle(config: IndividualHookConfig['config']): string {
  const rawType = (config as { type: string }).type;
  switch (rawType) {
    case 'command':
      return 'Command hook';
    case 'prompt':
      return 'Prompt hook';
    case 'agent':
      return 'Agent hook';
    case 'http':
      return 'HTTP hook';
    case 'mcp_tool':
      return 'MCP tool hook';
    case 'script':
      return 'Script hook';
    default:
      return 'Command hook';
  }
}

function getHookSourceFooter(hook: IndividualHookConfig): string {
  switch (hook.source) {
    case 'userSettings':
    case 'projectSettings':
    case 'localSettings': {
      const filePath = getSettingsFilePathForSource(hook.source);
      return `To change or remove this hook, edit ${filePath ? getDisplayPath(filePath) : 'settings.json'} or ask Claude.`;
    }
    case 'pluginHook':
      return hook.pluginName
        ? `This hook comes from the ${hook.pluginName} plugin and stops running when that plugin is disabled (/plugin).`
        : 'This hook comes from a plugin and stops running when that plugin is disabled (/plugin).';
    case 'builtinHook':
      return "This hook is built in to Claude Code and can't be changed or removed.";
    case 'sessionHook':
      return "This hook was registered while Claude Code was running (by /goal, an agent or a skill), not by a settings file, and can't be changed here.";
    case 'policySettings':
      return "This hook is set by your organization's managed settings and can't be changed here.";
  }
}

function getContentFieldLabel(config: IndividualHookConfig['config']): string {
  const raw = config as { type: string; file?: string };
  switch (raw.type) {
    case 'command':
      return 'Command';
    case 'prompt':
      return 'Prompt';
    case 'agent':
      return 'Prompt';
    case 'http':
      return 'URL';
    case 'mcp_tool':
      return 'MCP tool';
    case 'script':
      return raw.file !== undefined ? 'Script file' : 'Script';
    default:
      return 'Command';
  }
}

export function getContentFieldValue(config: IndividualHookConfig['config']): string {
  switch (config.type) {
    case 'command':
      return config.command;
    case 'prompt':
      return config.prompt;
    case 'agent':
      return config.prompt;
    case 'http':
      return config.url;
  }
}
