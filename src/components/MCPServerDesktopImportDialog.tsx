import React, { useCallback, useEffect, useState } from 'react';
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js';
import { writeToStdout } from 'src/utils/process.js';
import {
  Box,
  Byline,
  color,
  Dialog,
  type KeyboardEvent,
  KeyboardShortcutHint,
  StatusIcon,
  Text,
  useTheme,
} from '@anthropic/ink';
import { addMcpConfig, getAllMcpConfigs } from '../services/mcp/config.js';
import type { ConfigScope, McpServerConfig, ScopedMcpServerConfig } from '../services/mcp/types.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { plural } from '../utils/stringUtils.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { ItemList } from './ItemList.js';

type Props = {
  servers: Record<string, McpServerConfig>;
  scope: ConfigScope;
  onDone(): void;
};

type ImportFailure = {
  serverName: string;
  reason: string;
};

export function MCPServerDesktopImportDialog({ servers, scope, onDone }: Props): React.ReactNode {
  const serverNames = Object.keys(servers);
  const [existingServers, setExistingServers] = useState<Record<string, ScopedMcpServerConfig>>({});
  const [theme] = useTheme();
  const screenReader = isScreenReaderModeEnabled();

  useEffect(() => {
    void getAllMcpConfigs()
      .then(({ servers: loaded }) => setExistingServers(loaded))
      .catch(err => {
        logForDebugging(`Failed to read existing MCP configs for Desktop import: ${errorMessage(err)}`, {
          level: 'error',
        });
      });
  }, []);

  const collisions = serverNames.filter(name => existingServers[name] !== undefined);
  const collisionsKey = collisions.join('\n');
  const [selectionState, setSelectionState] = useState<{ collisionsKey: string; names: string[] } | null>(null);
  const selectedNames =
    selectionState?.collisionsKey === collisionsKey
      ? selectionState.names
      : serverNames.filter(name => !collisions.includes(name));
  const [submitting, setSubmitting] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const toggleServer = (serverName: string): void => {
    setSelectionState({
      collisionsKey,
      names: selectedNames.includes(serverName)
        ? selectedNames.filter(name => name !== serverName)
        : [...selectedNames, serverName],
    });
  };

  const resolveFinalName = useCallback(
    (serverName: string): string => {
      if (existingServers[serverName] === undefined) {
        return serverName;
      }
      let counter = 1;
      while (existingServers[`${serverName}_${counter}`] !== undefined) {
        counter++;
      }
      return `${serverName}_${counter}`;
    },
    [existingServers],
  );

  const finishImport = useCallback(
    ({ importedCount, failures }: { importedCount: number; failures: ImportFailure[] }) => {
      if (importedCount > 0) {
        writeToStdout(
          `\n${color('success', theme)(`Successfully imported ${importedCount} MCP ${plural(importedCount, 'server')} to ${scope} config.`)}\n`,
        );
      } else {
        writeToStdout('\nNo servers were imported.');
      }
      for (const { serverName, reason } of failures) {
        writeToStdout(`\n${color('error', theme)(`Could not import ${serverName}: ${reason}`)}\n`);
      }
      onDone();
      void gracefulShutdown();
    },
    [theme, scope, onDone],
  );

  async function onSubmit(selectedServers: string[]) {
    const failures: ImportFailure[] = [];
    let importedCount = 0;

    for (const serverName of selectedServers) {
      const serverConfig = servers[serverName];
      if (!serverConfig) continue;
      try {
        await addMcpConfig(resolveFinalName(serverName), serverConfig, scope);
        importedCount++;
      } catch (err) {
        failures.push({ serverName, reason: errorMessage(err) });
      }
    }

    finishImport({ importedCount, failures });
  }

  const handleEscCancel = useCallback(() => {
    finishImport({ importedCount: 0, failures: [] });
  }, [finishImport]);

  const handleSelect = (index: number): void => {
    if (submitting) return;
    const serverName = serverNames[index];
    if (serverName === undefined) {
      setSubmitting(true);
      onSubmit(serverNames.filter(name => selectedNames.includes(name))).catch(err => {
        writeToStdout(`\n${color('error', theme)(errorMessage(err))}\n`);
        onDone();
        void gracefulShutdown();
      });
      return;
    }
    toggleServer(serverName);
  };

  const handleRowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== ' ') return;
    event.preventDefault();
    const serverName = serverNames[focusedIndex];
    if (serverName !== undefined && !submitting) {
      toggleServer(serverName);
    }
  };

  const options = [
    ...serverNames.map(serverName => {
      const isChecked = selectedNames.includes(serverName);
      return {
        label: serverName,
        value: serverName,
        icon: <StatusIcon status={isChecked ? 'on' : 'off'} aria-label={isChecked ? 'checked:' : 'unchecked:'} />,
        facts: collisions.includes(serverName) ? ['already exists'] : [],
      };
    }),
    {
      label: 'Import selected',
      value: '__import__',
    },
  ];

  return (
    <>
      <Dialog
        title="Import MCP Servers from Claude Desktop"
        subtitle={`Found ${serverNames.length} MCP ${plural(serverNames.length, 'server')} in Claude Desktop.`}
        color="success"
        onCancel={handleEscCancel}
        hideInputGuide
      >
        {collisions.length > 0 && (
          <Text color="warning">
            Note: Some servers already exist with the same name. If selected, they will be imported with a numbered
            suffix.
          </Text>
        )}
        <Text>Please select the servers you want to import:</Text>

        <Box flexDirection="column" onKeyDown={handleRowKeyDown}>
          <ItemList options={options} onSelect={handleSelect} onFocus={setFocusedIndex} />
        </Box>
      </Dialog>
      <Box paddingX={1}>
        <Text dimColor italic>
          <Byline>
            {!screenReader && <KeyboardShortcutHint shortcut="space" action="toggle" />}
            {!screenReader && <KeyboardShortcutHint shortcut="enter" action="select" />}
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    </>
  );
}
