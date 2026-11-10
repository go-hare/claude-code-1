/**
 * densable 2.1.289 — `/permissions` Auto mode tab (`kn` / `Ce` / `gt` / `vt` / `Sn` / `Fm` / `Vn`).
 */
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useTabHeaderFocus, useTabsWidth } from '@anthropic/ink';
import { ConfirmSelect } from '../../../components/ConfirmSelect.js';
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
import { SearchBox } from '../../SearchBox.js';

const AUTO_MODE_SOURCES = ['userSettings', 'flagSettings', 'policySettings'] as const;
export type AutoModeRuleSource = (typeof AUTO_MODE_SOURCES)[number];

export type AutoModeRuleEntry = {
  section: AutoModeTabSection;
  text: string;
  index: number;
  source: AutoModeRuleSource;
  legacy?: boolean;
};

type Entry = AutoModeRuleEntry;

type Mode =
  | { kind: 'list' }
  | { kind: 'pick-section' }
  | { kind: 'env-first-confirm' }
  | { kind: 'input'; section: AutoModeTabSection; entry?: Entry }
  | { kind: 'env-editor' }
  | { kind: 'details'; entry: Entry }
  | { kind: 'delete'; entry: Entry };

function sourceTag(source: AutoModeRuleSource): 'flag' | 'org' | null {
  switch (source) {
    case 'userSettings':
      return null;
    case 'flagSettings':
      return 'flag';
    case 'policySettings':
      return 'org';
  }
}

function sourceDisplayName(source: AutoModeRuleSource): string {
  switch (source) {
    case 'userSettings':
      return 'user settings';
    case 'flagSettings':
      return 'the --settings flag';
    case 'policySettings':
      return 'managed settings';
  }
}

export function entryKey(entry: Entry): string {
  return `${entry.section}:${entry.source}:${entry.legacy ? 'legacy-' : ''}${entry.index}`;
}

export function formatAutoModeEntryLabel(entry: Entry): string {
  const label = sectionLabel(entry.section);
  const tag = entry.legacy ? 'legacy' : sourceTag(entry.source);
  const badge = tag ? ` · ${tag}` : '';
  return `${label}${badge}: ${entry.text}`;
}

export function readAutoModeEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const source of AUTO_MODE_SOURCES) {
    const autoMode = getSettingsForSource(source)?.autoMode;
    if (!autoMode || typeof autoMode !== 'object' || Array.isArray(autoMode)) {
      continue;
    }
    const block = autoMode as Record<string, unknown>;
    for (const section of AUTO_MODE_TAB_SECTIONS) {
      if (section === 'environment') continue;
      const rows = block[section];
      if (Array.isArray(rows)) {
        rows.forEach((text, index) => {
          if (typeof text === 'string') {
            entries.push({ section, text, index, source });
          }
        });
      }
      if (section === 'soft_deny' && Array.isArray(block.deny)) {
        block.deny.forEach((text, index) => {
          if (typeof text === 'string') {
            entries.push({ section: 'soft_deny', text, index, source, legacy: true });
          }
        });
      }
    }
  }
  return AUTO_MODE_TAB_SECTIONS.flatMap(section => {
    const inSection = entries.filter(e => e.section === section);
    return AUTO_MODE_SOURCES.flatMap(source => inSection.filter(e => e.source === source));
  });
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
  isSearchMode = false,
  isFocused,
  cursorOffset: searchCursorOffset,
  onCancel,
  onHeaderFocusChange,
}: {
  searchQuery?: string;
  isSearchMode?: boolean;
  isFocused: boolean;
  cursorOffset?: number;
  onCancel?: () => void;
  onHeaderFocusChange?: (focused: boolean) => void;
}): React.ReactNode {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [tick, setTick] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const exitState = useExitOnCtrlCDWithKeybindings();
  const { columns } = useTerminalSize();
  const tabWidth = useTabsWidth();
  const { headerFocused, focusHeader, blurHeader } = useTabHeaderFocus();

  useEffect(() => {
    if (isSearchMode && headerFocused) {
      blurHeader();
    }
  }, [isSearchMode, headerFocused, blurHeader]);

  useEffect(() => {
    onHeaderFocusChange?.(headerFocused);
  }, [headerFocused, onHeaderFocusChange]);

  const refresh = useCallback(() => {
    setTick(n => n + 1);
    setError(null);
  }, []);

  const entries = useMemo(() => {
    void tick;
    const all = readAutoModeEntries();
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

  useKeybinding('confirm:no', cancel, {
    context: 'Settings',
    isActive: mode.kind !== 'list',
  });

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
        <ConfirmSelect
          hideIndexes
          focus="cancel"
          confirmLabel="Replace built-in environment"
          cancelLabel="Cancel"
          onConfirm={() => {
            setInputValue(readEnvironmentDocument());
            setCursorOffset(0);
            setMode({ kind: 'env-editor' });
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
    const lastInSection =
      entries.filter(e => e.section === mode.entry.section && e.source === 'userSettings' && !e.legacy).length <= 1;
    return (
      <Box flexDirection="column">
        <Text bold color="error">
          Delete auto mode rule?
        </Text>
        <Text>{mode.entry.text}</Text>
        {lastInSection ? <Text italic>This is the last extra rule in {sectionLabel(mode.entry.section)}.</Text> : null}
        <ConfirmSelect
          hideIndexes
          focus="cancel"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => {
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
        <Text dimColor>
          {sectionLabel(entry.section)} · {sourceDisplayName(entry.source)}
        </Text>
        {entry.legacy ? (
          <Text italic>
            This rule comes from the legacy autoMode.deny key, which the classifier still enforces as a soft deny.{' '}
            {entry.source === 'userSettings'
              ? 'This editor writes only the modern keys — move the rule to autoMode.soft_deny in your settings file to manage it here.'
              : `It is delivered by ${sourceDisplayName(entry.source)} and cannot be modified here.`}
          </Text>
        ) : entry.source === 'policySettings' ? (
          <Text italic>
            This rule is configured by managed settings and cannot be modified.
            {'\n'}
            Contact your system administrator for more information.
          </Text>
        ) : entry.source === 'flagSettings' ? (
          <Text italic>This rule comes from a read-only source (the --settings flag) and cannot be modified here.</Text>
        ) : isSentinel ? (
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
    ...(searchQuery.trim()
      ? []
      : [
          { label: 'Add auto mode rule…', value: 'add' },
          { label: 'Edit environment…', value: 'env' },
        ]),
    ...entries.map(entry => ({
      label: formatAutoModeEntryLabel(entry),
      value: `entry:${entryKey(entry)}`,
    })),
  ];

  return (
    <Box flexDirection="column">
      <Text>
        Extra rules for the auto mode classifier. Rules are plain sentences; new rules are saved to your user settings.
      </Text>
      <Box marginBottom={1} marginTop={1} flexDirection="column">
        <SearchBox
          query={searchQuery}
          isFocused={isSearchMode && !headerFocused}
          isTerminalFocused={isFocused}
          width={tabWidth}
          cursorOffset={searchCursorOffset}
        />
      </Box>
      {error ? <Text color="error">{error}</Text> : null}
      <Select
        options={options}
        onChange={value => {
          if (headerFocused) {
            blurHeader();
            onHeaderFocusChange?.(false);
          }
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
            const key = value.slice('entry:'.length);
            const entry = entries.find(e => entryKey(e) === key);
            if (entry) setMode({ kind: 'details', entry });
          }
        }}
        onCancel={() => {
          onCancel?.();
        }}
        visibleOptionCount={Math.min(10, options.length)}
        isDisabled={!isFocused || isSearchMode || headerFocused}
        hidePromptWhileDisabled={true}
        pointerWhileDisabled={!isSearchMode}
        onUpFromFirstItem={focusHeader}
      />
    </Box>
  );
}
