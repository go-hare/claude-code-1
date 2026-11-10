import chalk from 'chalk';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Byline, Dialog, KeyboardShortcutHint, LoadingState, StatusIcon, Text } from '@anthropic/ink';
import { toError } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { getSettingSourceName, type SettingSource } from '../utils/settings/constants.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { getEnvironmentSelectionInfo } from '../utils/teleport/environmentSelection.js';
import type { EnvironmentResource } from '../utils/teleport/environments.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { ItemList } from './ItemList.js';

const DIALOG_TITLE = 'Select remote environment';
const SETUP_HINT = `Configure environments at: https://claude.ai/code`;

type Props = {
  onDone: (message?: string) => void;
};

type LoadingState = 'loading' | 'updating' | null;

export function RemoteEnvironmentDialog({ onDone }: Props): React.ReactNode {
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [environments, setEnvironments] = useState<EnvironmentResource[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentResource | null>(null);
  const [selectedEnvironmentSource, setSelectedEnvironmentSource] = useState<SettingSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchInfo(): Promise<void> {
      try {
        const result = await getEnvironmentSelectionInfo();
        if (cancelled) return;
        setEnvironments(result.availableEnvironments);
        setSelectedEnvironment(result.selectedEnvironment);
        setSelectedEnvironmentSource(result.selectedEnvironmentSource);
        setLoadingState(null);
      } catch (err) {
        if (cancelled) return;
        const fetchError = toError(err);
        logError(fetchError);
        setError(fetchError.message);
        setLoadingState(null);
      }
    }
    void fetchInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelect(value: string): void {
    if (value === 'cancel') {
      onDone();
      return;
    }

    setLoadingState('updating');

    const selectedEnv = environments.find(env => env.environment_id === value);

    if (!selectedEnv) {
      onDone('Error: Selected environment not found');
      return;
    }

    updateSettingsForSource('localSettings', {
      remote: {
        defaultEnvironmentId: selectedEnv.environment_id,
      },
    });

    onDone(`Set default remote environment to ${chalk.bold(selectedEnv.name)} (${selectedEnv.environment_id})`);
  }

  // Loading state
  if (loadingState === 'loading') {
    return (
      <Dialog title={DIALOG_TITLE} onCancel={onDone} hideInputGuide>
        <LoadingState message="Loading environments…" />
      </Dialog>
    );
  }

  // Error state
  if (error) {
    return (
      <Dialog title={DIALOG_TITLE} onCancel={onDone}>
        <Text color="error">Error: {error}</Text>
      </Dialog>
    );
  }

  // No environments available
  if (!selectedEnvironment) {
    return (
      <Dialog title={DIALOG_TITLE} subtitle={SETUP_HINT} onCancel={onDone}>
        <Text>No remote environments available.</Text>
      </Dialog>
    );
  }

  // Show environment selection list (densable ce)
  return (
    <MultipleEnvironmentsContent
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      selectedEnvironmentSource={selectedEnvironmentSource}
      loadingState={loadingState}
      onSelect={handleSelect}
      onCancel={onDone}
    />
  );
}

function MultipleEnvironmentsContent({
  environments,
  selectedEnvironment,
  selectedEnvironmentSource,
  loadingState,
  onSelect,
  onCancel,
}: {
  environments: EnvironmentResource[];
  selectedEnvironment: EnvironmentResource;
  selectedEnvironmentSource: SettingSource | null;
  loadingState: LoadingState;
  onSelect: (value: string) => void;
  onCancel: () => void;
}): React.ReactNode {
  const sourceSuffix =
    selectedEnvironmentSource &&
    selectedEnvironmentSource !== 'localSettings' &&
    selectedEnvironmentSource !== 'userSettings'
      ? ` (from ${getSettingSourceName(selectedEnvironmentSource)} settings)`
      : '';

  const subtitle = selectedEnvironmentSource ? (
    <Text>
      Currently using: <Text bold>{selectedEnvironment.name}</Text>
      {sourceSuffix}
    </Text>
  ) : undefined;

  return (
    <Dialog title={DIALOG_TITLE} subtitle={subtitle} onCancel={onCancel} hideInputGuide>
      <Text dimColor>{SETUP_HINT}</Text>
      {loadingState === 'updating' ? (
        <LoadingState message="Updating…" />
      ) : (
        <ItemList
          options={environments.map(env => ({
            label: env.name,
            value: env.environment_id,
            icon:
              env.environment_id === selectedEnvironment.environment_id ? (
                <StatusIcon status="success" aria-label="current:" />
              ) : undefined,
            facts: [env.environment_id],
          }))}
          onSelect={index => {
            const env = environments[index];
            if (env) {
              onSelect(env.environment_id);
            }
          }}
        />
      )}
      <Text dimColor>
        <Byline>
          <KeyboardShortcutHint shortcut="enter" action="select" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
        </Byline>
      </Text>
    </Dialog>
  );
}
