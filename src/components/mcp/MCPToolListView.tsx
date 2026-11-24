import React from 'react';
import { Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { extractMcpToolDisplayName, getMcpDisplayName } from '../../services/mcp/mcpStringUtils.js';
import { filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import type { Tool } from '../../Tool.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import type { ServerInfo } from './types.js';

type Props = {
  server: ServerInfo;
  /** Official 2.1.328 #462: Tool name to focus initially when returning from detail view. */
  startOn?: string;
  /** Official 2.1.328 #462: Fallback index to focus initially when returning from detail view. */
  defaultFocusIndex?: number;
  onSelectTool: (tool: Tool, index: number) => void;
  onBack: () => void;
};

export function resolveInitialMcpToolFocusIndex(
  orderedTools: readonly Pick<Tool, 'name'>[],
  startOn?: string,
  defaultFocusIndex?: number,
): number {
  if (orderedTools.length === 0) return 0;
  if (startOn) {
    const byName = orderedTools.findIndex(tool => tool.name === startOn);
    if (byName >= 0) return byName;
  }
  if (typeof defaultFocusIndex === 'number' && Number.isFinite(defaultFocusIndex)) {
    return Math.max(0, Math.min(orderedTools.length - 1, Math.trunc(defaultFocusIndex)));
  }
  return 0;
}

export function MCPToolListView({ server, startOn, defaultFocusIndex, onSelectTool, onBack }: Props): React.ReactNode {
  const mcpTools = useAppState(s => s.mcp.tools);
  const [showBlockedWarning, setShowBlockedWarning] = React.useState(false);

  const serverTools = React.useMemo(() => {
    if (server.client.type !== 'connected') return [];
    return filterToolsByServer(mcpTools, server.name);
  }, [server, mcpTools]);

  // Official: blocked tools sort last and show disabled by org policy.
  const orderedTools = React.useMemo(
    () =>
      [...serverTools].sort((a, b) => {
        const aBlocked = a.mcpInfo?.effectiveMaxPermission === 'blocked' ? 1 : 0;
        const bBlocked = b.mcpInfo?.effectiveMaxPermission === 'blocked' ? 1 : 0;
        return aBlocked - bBlocked;
      }),
    [serverTools],
  );

  const initialFocusIndex = React.useMemo(
    () => resolveInitialMcpToolFocusIndex(orderedTools, startOn, defaultFocusIndex),
    [orderedTools, startOn, defaultFocusIndex],
  );
  const [focusedIndex, setFocusedIndex] = React.useState(initialFocusIndex);

  const blockedCount = orderedTools.filter(tool => tool.mcpInfo?.effectiveMaxPermission === 'blocked').length;
  const enabledCount = orderedTools.length - blockedCount;

  const toolOptions = orderedTools.map(tool => {
    const toolName = getMcpDisplayName(tool.name, server.name);
    const fullDisplayName = tool.userFacingName ? tool.userFacingName({}) : toolName;
    // Extract just the tool display name without server prefix
    const displayName = extractMcpToolDisplayName(fullDisplayName);

    const permission = tool.mcpInfo?.effectiveMaxPermission;
    const isBlocked = permission === 'blocked';
    if (isBlocked) {
      return {
        label: displayName,
        value: tool.name,
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
      value: tool.name,
      blocked: false,
      description: annotations.length > 0 ? annotations.join(', ') : undefined,
      descriptionColor: isDestructive ? 'error' : isReadOnly ? 'success' : undefined,
    };
  });

  const initialFocusValue = orderedTools[initialFocusIndex]?.name;

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
          defaultFocusValue={initialFocusValue}
          hideIndexes={!isScreenReaderModeEnabled()}
          disablePrintableKeybindings={!isScreenReaderModeEnabled()}
          onFocus={value => {
            const index = orderedTools.findIndex(t => t.name === value);
            if (index >= 0) {
              setFocusedIndex(index);
            }
            setShowBlockedWarning(false);
          }}
          onChange={value => {
            const index = orderedTools.findIndex(t => t.name === value);
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
