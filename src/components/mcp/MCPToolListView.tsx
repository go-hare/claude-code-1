import React from 'react';
import { Text } from '@anthropic/ink';
import { extractMcpToolDisplayName, getMcpDisplayName } from '../../services/mcp/mcpStringUtils.js';
import { filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import type { Tool } from '../../Tool.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';
import type { ServerInfo } from './types.js';

type Props = {
  server: ServerInfo;
  onSelectTool: (tool: Tool, index: number) => void;
  onBack: () => void;
};

export function MCPToolListView({ server, onSelectTool, onBack }: Props): React.ReactNode {
  const mcpTools = useAppState(s => s.mcp.tools);
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const [showBlockedWarning, setShowBlockedWarning] = React.useState(false);

  const serverTools = React.useMemo(() => {
    if (server.client.type !== 'connected') return [];
    return filterToolsByServer(mcpTools, server.name);
  }, [server, mcpTools]);

  // Official: blocked tools sort last and show disabled by org policy.
  const orderedTools = [...serverTools].sort((a, b) => {
    const aBlocked = a.mcpInfo?.effectiveMaxPermission === 'blocked' ? 1 : 0;
    const bBlocked = b.mcpInfo?.effectiveMaxPermission === 'blocked' ? 1 : 0;
    return aBlocked - bBlocked;
  });

  const blockedCount = orderedTools.filter(tool => tool.mcpInfo?.effectiveMaxPermission === 'blocked').length;
  const enabledCount = orderedTools.length - blockedCount;

  const toolOptions = orderedTools.map((tool, index) => {
    const toolName = getMcpDisplayName(tool.name, server.name);
    const fullDisplayName = tool.userFacingName ? tool.userFacingName({}) : toolName;
    // Extract just the tool display name without server prefix
    const displayName = extractMcpToolDisplayName(fullDisplayName);

    const permission = tool.mcpInfo?.effectiveMaxPermission;
    const isBlocked = permission === 'blocked';
    if (isBlocked) {
      return {
        label: displayName,
        value: index.toString(),
        blocked: true,
        description: 'disabled by your organization',
        descriptionColor: 'error' as const,
      };
    }

    const isReadOnly = tool.isReadOnly?.({}) ?? false;
    const isDestructive = tool.isDestructive?.({}) ?? false;
    const isOpenWorld = tool.isOpenWorld?.({}) ?? false;

    const annotations = permission === 'ask' ? ['ask-only'] : [];
    if (isReadOnly) annotations.push('read-only');
    if (isDestructive) annotations.push('destructive');
    if (isOpenWorld) annotations.push('open-world');

    return {
      label: displayName,
      value: index.toString(),
      blocked: false,
      description: annotations.length > 0 ? annotations.join(', ') : undefined,
      descriptionColor: isDestructive ? 'error' : isReadOnly ? 'success' : undefined,
    };
  });

  const focusedItem = showBlockedWarning ? toolOptions[focusedIndex] : undefined;
  const subtitle = focusedItem?.blocked ? (
    <Text color="warning">{focusedItem.label} is disabled by your organization</Text>
  ) : blockedCount > 0 ? (
    `${enabledCount} ${plural(enabledCount, 'tool')} · ${blockedCount} disabled by your organization`
  ) : (
    `${orderedTools.length} ${plural(orderedTools.length, 'tool')}`
  );

  return (
    <Dialog
      title={`Tools for ${server.name}`}
      subtitle={subtitle}
      onCancel={onBack}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
            {!toolOptions[focusedIndex]?.blocked && <KeyboardShortcutHint shortcut="Enter" action="select" />}
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Byline>
        )
      }
    >
      {serverTools.length === 0 ? (
        <Text dimColor>No tools available</Text>
      ) : (
        <Select
          options={toolOptions}
          onFocus={value => {
            setFocusedIndex(parseInt(value, 10));
            setShowBlockedWarning(false);
          }}
          onChange={value => {
            const index = parseInt(value, 10);
            const item = toolOptions[index];
            const tool = orderedTools[index];
            if (!item || !tool) return;
            if (item.blocked) {
              setShowBlockedWarning(true);
              return;
            }
            onSelectTool(tool, index);
          }}
          onCancel={onBack}
        />
      )}
    </Dialog>
  );
}
