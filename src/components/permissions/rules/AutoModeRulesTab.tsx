/**
 * densable 2.1.246 #2 — `/permissions` Auto mode tab (`Ur` / `Kr` / `Hr` / `Xr` / `Vr`).
 */
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../../components/CustomSelect/select.js';
import TextInput from '../../../components/TextInput.js';
import { useExitOnCtrlCDWithKeybindings } from '../../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { AUTO_MODE_DEFAULTS_SENTINEL } from '../../../services/autoModeSetup/write.js';
import {
  type AutoModeTabSection,
  AUTO_MODE_TAB_SECTIONS,
  addAutoModeRule,
  deleteAutoModeRule,
  parseEnvironmentDocument,
  sectionLabel,
  updateAutoModeRule,
  validateAutoModeRuleInput,
  writeEnvironmentDocument,
} from '../../../services/autoModeSetup/permissionTabWrite.js';
import { getSettingsForSource } from '../../../utils/settings/settings.js';

type Entry = {
  section: AutoModeTabSection;
  text: string;
  index: number;
};

type Mode =
  | { kind: 'list' }
  | { kind: 'pick-section' }
  | { kind: 'env-first-confirm' }
  | { kind: 'input'; section: AutoModeTabSection; entry?: Entry }
  | { kind: 'env-editor' }
  | { kind: 'details'; entry: Entry }
  | { kind: 'delete'; entry: Entry };

function readUserEntries(): Entry[] {
  const autoMode = getSettingsForSource('userSettings')?.autoMode;
  if (!autoMode || typeof autoMode !== 'object' || Array.isArray(autoMode)) {
    return [];
  }
  const block = autoMode as Record<string, unknown>;
  const entries: Entry[] = [];
  for (const section of AUTO_MODE_TAB_SECTIONS) {
    if (section === 'environment') continue;
    const rows = block[section];
    if (!Array.isArray(rows)) continue;
    rows.forEach((text, index) => {
      if (typeof text === 'string') {
        entries.push({ section, text, index });
      }
    });
  }
  return entries;
}

function readEnvironmentDocument(): string {
  const autoMode = getSettingsForSource('userSettings')?.autoMode;
  const rows =
    autoMode && typeof autoMode === 'object' && !Array.isArray(autoMode)
      ? (autoMode as Record<string, unknown>).environment
      : undefined;
  if (!Array.isArray(rows)) return '';
  return rows.filter((row): row is string => typeof row === 'string').join('\n');
}

function sectionPlaceholder(section: AutoModeTabSection): string {
  if (section === 'environment') {
    return 'Deploys from this machine are production.';
  }
  return 'Database Writes: UPDATE statements against prod.';
}

export function AutoModeRulesTab({
  searchQuery = '',
  isFocused,
}: {
  searchQuery?: string;
  isFocused: boolean;
}): React.ReactNode {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [tick, setTick] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const exitState = useExitOnCtrlCDWithKeybindings();
  const { columns } = useTerminalSize();

  const refresh = useCallback(() => {
    setTick(n => n + 1);
    setError(null);
  }, []);

  const entries = useMemo(() => {
    void tick;
    const all = readUserEntries();
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter(entry => entry.text.toLowerCase().includes(q));
  }, [searchQuery, tick]);

  const cancel = useCallback(() => {
    setMode({ kind: 'list' });
    setInputValue('');
    setCursorOffset(0);
    setError(null);
  }, []);

  useKeybinding('confirm:no', cancel, { context: 'Settings' });

  if (mode.kind === 'pick-section') {
    return (
      <Box flexDirection="column">
        <Text bold color="permission">
          Add auto mode rule
        </Text>
        <Text>What kind of rule is this?</Text>
        <Select
          options={AUTO_MODE_TAB_SECTIONS.filter(s => s !== 'environment').map(section => ({
            label: sectionLabel(section),
            value: section,
          }))}
          onChange={value => {
            setInputValue('');
            setCursorOffset(0);
            setMode({ kind: 'input', section: value as AutoModeTabSection });
          }}
          onCancel={cancel}
        />
      </Box>
    );
  }

  if (mode.kind === 'env-first-confirm') {
    return (
      <Box flexDirection="column">
        <Text bold color="permission">
          Replace the built-in environment?
        </Text>
        <Text>
          Writing your own environment replaces the built-in default document. You can restore it later with
          /auto-mode-setup.
        </Text>
        <Select
          options={[
            { label: 'Replace built-in environment', value: 'replace' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={value => {
            if (value === 'replace') {
              setInputValue(readEnvironmentDocument());
              setCursorOffset(0);
              setMode({ kind: 'env-editor' });
              return;
            }
            cancel();
          }}
          onCancel={cancel}
        />
      </Box>
    );
  }

  if (mode.kind === 'input' || mode.kind === 'env-editor') {
    const section = mode.kind === 'input' ? mode.section : 'environment';
    const title = mode.kind === 'env-editor' ? 'Edit environment' : `Add ${sectionLabel(section).toLowerCase()} rule`;
    const onSubmit = async () => {
      const problem =
        mode.kind === 'env-editor'
          ? parseEnvironmentDocument(inputValue).problem
          : validateAutoModeRuleInput(section, inputValue);
      if (problem) {
        setError(problem);
        return;
      }
      try {
        if (mode.kind === 'env-editor') {
          await writeEnvironmentDocument(inputValue);
        } else if (mode.entry) {
          await updateAutoModeRule(section, mode.entry.index, mode.entry.text, inputValue);
        } else {
          await addAutoModeRule(section, inputValue);
        }
        refresh();
        cancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    return (
      <Box flexDirection="column">
        <Text bold color="permission">
          {title}
        </Text>
        {error ? <Text color="error">{error}</Text> : null}
        <Box borderDimColor borderStyle="round" marginY={1} paddingLeft={1}>
          <TextInput
            showCursor
            multiline
            value={inputValue}
            onChange={setInputValue}
            onSubmit={() => void onSubmit()}
            placeholder={sectionPlaceholder(section)}
            columns={Math.max(20, columns - 6)}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
          />
        </Box>
        <Text dimColor>Saved to your user settings file</Text>
        <Text dimColor>
          {exitState.pending ? `Press ${exitState.keyName} again to exit` : 'Enter save · Esc cancel'}
        </Text>
      </Box>
    );
  }

  if (mode.kind === 'delete') {
    const lastInSection = entries.filter(e => e.section === mode.entry.section).length <= 1;
    return (
      <Box flexDirection="column">
        <Text bold color="error">
          Delete auto mode rule?
        </Text>
        <Text>{mode.entry.text}</Text>
        {lastInSection ? <Text italic>This is the last extra rule in {sectionLabel(mode.entry.section)}.</Text> : null}
        <Select
          options={[
            { label: 'Delete', value: 'delete' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={value => {
            if (value !== 'delete') {
              cancel();
              return;
            }
            void deleteAutoModeRule(mode.entry.section, mode.entry.index, mode.entry.text)
              .then(() => {
                refresh();
                cancel();
              })
              .catch(e => setError(e instanceof Error ? e.message : String(e)));
          }}
          onCancel={cancel}
        />
      </Box>
    );
  }

  if (mode.kind === 'details') {
    const entry = mode.entry;
    const isSentinel = entry.text === AUTO_MODE_DEFAULTS_SENTINEL;
    return (
      <Box flexDirection="column" gap={1} borderStyle="round" paddingLeft={1} paddingRight={1} borderColor="permission">
        <Text bold color="permission">
          Rule details
        </Text>
        <Text bold>{entry.text}</Text>
        <Text dimColor>{sectionLabel(entry.section)} · user settings</Text>
        {isSentinel ? (
          <Text italic>{`"${AUTO_MODE_DEFAULTS_SENTINEL}" is splice plumbing, not an editable rule.`}</Text>
        ) : (
          <Select
            options={[
              { label: 'Edit', value: 'edit' },
              { label: 'Delete', value: 'delete' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onChange={value => {
              if (value === 'edit') {
                setInputValue(entry.text);
                setCursorOffset(entry.text.length);
                setMode({ kind: 'input', section: entry.section, entry });
                return;
              }
              if (value === 'delete') {
                setMode({ kind: 'delete', entry });
                return;
              }
              cancel();
            }}
            onCancel={cancel}
          />
        )}
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    );
  }

  const options = [
    { label: 'Add auto mode rule…', value: 'add' },
    { label: 'Edit environment…', value: 'env' },
    ...entries.map(entry => ({
      label: `${sectionLabel(entry.section)}: ${entry.text}`,
      value: `entry:${entry.section}:${entry.index}`,
    })),
  ];

  return (
    <Box flexDirection="column">
      <Text>
        Extra rules for the auto mode classifier. Rules are plain sentences; new rules are saved to your user settings.
      </Text>
      {error ? <Text color="error">{error}</Text> : null}
      <Select
        options={options}
        onChange={value => {
          if (value === 'add') {
            setMode({ kind: 'pick-section' });
            return;
          }
          if (value === 'env') {
            const existing = readEnvironmentDocument();
            if (!existing) {
              setMode({ kind: 'env-first-confirm' });
              return;
            }
            setInputValue(existing);
            setCursorOffset(existing.length);
            setMode({ kind: 'env-editor' });
            return;
          }
          if (value.startsWith('entry:')) {
            const [, section, indexRaw] = value.split(':');
            const index = Number(indexRaw);
            const entry = entries.find(e => e.section === section && e.index === index);
            if (entry) setMode({ kind: 'details', entry });
          }
        }}
        onCancel={() => {
          /* parent Esc */
        }}
        isDisabled={!isFocused}
      />
    </Box>
  );
}
