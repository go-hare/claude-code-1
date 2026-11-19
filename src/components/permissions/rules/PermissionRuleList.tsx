import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { applyPermissionUpdate, persistPermissionUpdates } from 'src/utils/permissions/PermissionUpdate.js';
import type { PermissionUpdateDestination } from 'src/utils/permissions/PermissionUpdateSchema.js';
import type { CommandResultDisplay } from '../../../commands.js';
import { ConfirmSelect } from '../../../components/ConfirmSelect.js';
import { Select } from '../../../components/CustomSelect/select.js';
import { useExitOnCtrlCDWithKeybindings } from '../../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useSearchInput } from '@anthropic/ink';
import {
  type DOMElement,
  type KeyboardEvent,
  type PasteEvent,
  announceForScreenReader,
  Box,
  Byline,
  Dialog,
  KeyboardShortcutHint,
  Pane,
  Tab,
  Tabs,
  Text,
  useFocusReclaim,
  useTabHeaderFocus,
  useTabsWidth,
  useTerminalFocus,
} from '@anthropic/ink';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { type AutoModeDenial, getAutoModeDenials, markAutoModeDenialApproved } from '../../../utils/autoModeDenials.js';
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleValue,
} from '../../../utils/permissions/PermissionRule.js';
import { permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js';
import {
  deletePermissionRule,
  getAllowRules,
  getAskRules,
  getDenyRules,
  permissionRuleSourceDisplayString,
} from '../../../utils/permissions/permissions.js';
import type { UnreachableRule } from '../../../utils/permissions/shadowedRuleDetection.js';
import { isScreenReaderModeEnabled } from '../../../utils/screenReaderGate.js';
import { jsonStringify } from '../../../utils/slowOperations.js';
import { SearchBox } from '../../SearchBox.js';
import type { Option } from '../../ui/option.js';
import { AddPermissionRules } from './AddPermissionRules.js';
import { AddWorkspaceDirectory } from './AddWorkspaceDirectory.js';
import { PermissionRuleDescription } from './PermissionRuleDescription.js';
import { PermissionRuleInput } from './PermissionRuleInput.js';
import { RecentDenialsTab, type RecentDenialsState } from './RecentDenialsTab.js';
import { RemoveWorkspaceDirectory } from './RemoveWorkspaceDirectory.js';
import { WorkspaceTab } from './WorkspaceTab.js';
import { AutoModeRulesTab } from './AutoModeRulesTab.js';

export function getRecentlyBlockedEscHint(
  approvedCount: number,
  retryCount: number,
  isMidTurn = false,
): string | undefined {
  if (retryCount > 0) {
    return isMidTurn ? 'Esc to tell Claude next prompt' : `Esc to retry ${retryCount} blocked`;
  }
  if (approvedCount > 0) {
    return `Esc to approve ${approvedCount} blocked`;
  }
  return undefined;
}

type RuleSourceTextProps = {
  rule: PermissionRule;
};
function RuleSourceText({ rule }: RuleSourceTextProps): React.ReactNode {
  return <Text dimColor>{`From ${permissionRuleSourceDisplayString(rule.source)}`}</Text>;
}

// Helper function to get the appropriate label for rule behavior
function getRuleBehaviorLabel(ruleBehavior: PermissionBehavior): string {
  switch (ruleBehavior) {
    case 'allow':
      return 'allowed';
    case 'deny':
      return 'denied';
    case 'ask':
      return 'ask';
  }
}

const NON_ASCII_SPACE_OR_CONTROL_RE = /(?! )[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/gu;

function escapeControlChar(ch: string): string {
  return Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
}

function formatDenialApprovalMessage(denials: readonly AutoModeDenial[]): string {
  const formatted = denials.map(d =>
    JSON.stringify(d.command ?? d.display).replace(NON_ASCII_SPACE_OR_CONTROL_RE, escapeControlChar),
  );
  const allCommands = denials.every(d => d.command !== undefined);
  const noun = allCommands ? 'command' : 'call';
  const single = denials.length === 1;
  const target = single ? `this exact ${noun}` : `these exact ${noun}s`;
  return `Permission granted for ${target} only, ${single ? 'as one whole string' : 'each as one whole string'}: ${formatted.join(', ')}. This does not approve any other ${noun}, any part of ${single ? 'this one' : 'these'}, or running ${single ? 'it' : 'them'} with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry ${target} if you would like.`;
}

function formatDenialCommandsForRetry(denials: readonly AutoModeDenial[]): string[] {
  return denials.map(d => {
    const raw = (d.command ?? d.display).trim();
    return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  });
}

// Component for showing tool details and managing the interactive deletion workflow
function RuleDetails({
  rule,
  onDelete,
  onCancel,
}: {
  rule: PermissionRule;
  onDelete: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings();
  // Use configurable keybinding for ESC to cancel
  useKeybinding('confirm:no', onCancel, { context: 'Confirmation' });

  const ruleDescription = (
    <Box flexDirection="column" marginX={2}>
      <Text bold>{permissionRuleValueToString(rule.ruleValue)}</Text>
      <PermissionRuleDescription ruleValue={rule.ruleValue} />
      <RuleSourceText rule={rule} />
    </Box>
  );

  // Managed settings can't be edited
  if (rule.source === 'policySettings') {
    return (
      <Dialog
        title="Rule details"
        onCancel={onCancel}
        color="permission"
        inputGuide={<KeyboardShortcutHint shortcut="Esc" action="go back" />}
      >
        {ruleDescription}
        <Text italic>
          This rule is configured by managed settings and cannot be modified.
          {'\n'}
          Contact your system administrator for more information.
        </Text>
      </Dialog>
    );
  }

  if (rule.source === 'flagSettings' || rule.source === 'command') {
    const sourceDescription = rule.source === 'flagSettings' ? 'the --settings flag' : 'a slash command';
    return (
      <Dialog
        title="Rule details"
        onCancel={onCancel}
        color="permission"
        inputGuide={<KeyboardShortcutHint shortcut="Esc" action="go back" />}
      >
        {ruleDescription}
        <Text italic>
          {`This rule comes from a read-only source (${sourceDescription}) and cannot be modified here.`}
        </Text>
      </Dialog>
    );
  }

  return (
    <>
      <Box flexDirection="column" gap={1} borderStyle="round" paddingLeft={1} paddingRight={1} borderColor="error">
        <Text bold color="error">
          Delete {getRuleBehaviorLabel(rule.ruleBehavior)} tool?
        </Text>
        {ruleDescription}
        <Text>Are you sure you want to delete this permission rule?</Text>
        {/* Official 2.1.326 #29: disable printable keybindings on delete confirmation. */}
        <ConfirmSelect
          hideIndexes
          disablePrintableKeybindings
          focus="cancel"
          onConfirm={onDelete}
          onCancel={onCancel}
        />
      </Box>
      <Box marginLeft={3}>
        {exitState.pending ? (
          <Text dimColor>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <KeyboardShortcutHint shortcut="Esc" action="go back" />
            </Byline>
          </Text>
        )}
      </Box>
    </>
  );
}

type RulesTabContentProps = {
  options: Option[];
  searchQuery: string;
  isSearchMode: boolean;
  isFocused: boolean;
  onSelect: (value: string) => void;
  onCancel: () => void;
  lastFocusedRuleKey: string | undefined;
  cursorOffset?: number;
  onHeaderFocusChange?: (focused: boolean) => void;
};

// Component for rendering rules tab content with full width support
function RulesTabContent(props: RulesTabContentProps): React.ReactNode {
  const {
    options,
    searchQuery,
    isSearchMode,
    isFocused,
    onSelect,
    onCancel,
    lastFocusedRuleKey,
    cursorOffset,
    onHeaderFocusChange,
  } = props;
  const tabWidth = useTabsWidth();
  const { headerFocused, focusHeader, blurHeader } = useTabHeaderFocus();
  const containerRef = useRef<DOMElement | null>(null);
  useEffect(() => {
    if (isSearchMode && headerFocused) blurHeader(containerRef.current);
  }, [isSearchMode, headerFocused, blurHeader]);
  useFocusReclaim(containerRef, isSearchMode);
  useEffect(() => {
    onHeaderFocusChange?.(headerFocused);
  }, [headerFocused, onHeaderFocusChange]);
  return (
    <Box ref={containerRef} flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <SearchBox
          query={searchQuery}
          isFocused={isSearchMode && !headerFocused}
          isTerminalFocused={isFocused}
          width={tabWidth}
          cursorOffset={cursorOffset}
        />
      </Box>
      {searchQuery && options.length === 0 ? (
        <Box marginY={1}>
          <Text dimColor>No rules match &quot;{searchQuery}&quot;</Text>
        </Box>
      ) : (
        <Select
          options={options}
          onChange={value => {
            if (headerFocused) {
              blurHeader();
              onHeaderFocusChange?.(false);
            }
            onSelect(value);
          }}
          onCancel={onCancel}
          visibleOptionCount={Math.min(10, options.length)}
          overflowHint="count"
          isDisabled={isSearchMode || headerFocused}
          hidePromptWhileDisabled={true}
          pointerWhileDisabled={!isSearchMode}
          defaultFocusValue={lastFocusedRuleKey}
          onUpFromFirstItem={focusHeader}
        />
      )}
    </Box>
  );
}

type TabType = 'recent' | 'allow' | 'ask' | 'deny' | 'automode' | 'workspace';

// Composes the subtitle + search + Select for a single allow/ask/deny tab.
function PermissionRulesTab({
  tab,
  getRulesOptions,
  handleToolSelect,
  ...rulesProps
}: {
  tab: 'allow' | 'ask' | 'deny';
  getRulesOptions: (tab: TabType, query?: string) => { options: Option[] };
  handleToolSelect: (value: string, tab: TabType) => void;
} & Omit<RulesTabContentProps, 'options' | 'onSelect'>): React.ReactNode {
  return (
    <Box flexDirection="column" flexShrink={tab === 'allow' ? 0 : undefined}>
      <Text>
        {
          {
            allow: "Claude Code won't ask before using allowed tools.",
            ask: 'Claude Code will always ask for confirmation before using these tools.',
            deny: 'Claude Code will always reject requests to use denied tools.',
          }[tab]
        }
      </Text>
      <RulesTabContent
        options={getRulesOptions(tab, rulesProps.searchQuery).options}
        onSelect={v => handleToolSelect(v, tab)}
        {...rulesProps}
      />
    </Box>
  );
}

type Props = {
  onExit: (
    result?: string,
    options?: {
      display?: CommandResultDisplay;
      shouldQuery?: boolean;
      metaMessages?: string[];
    },
  ) => void;
  initialTab?: TabType;
  onRetryDenials?: (commands: string[]) => void;
};

export function PermissionRuleList({ onExit, initialTab, onRetryDenials }: Props): React.ReactNode {
  const hasDenials = getAutoModeDenials().length > 0;
  const defaultTab: TabType = initialTab ?? (hasDenials ? 'recent' : 'allow');
  const [selectedTab, setSelectedTab] = useState<TabType>(defaultTab);
  const [changes, setChanges] = useState<string[]>([]);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const setAppState = useSetAppState();
  const isTerminalFocused = useTerminalFocus();
  const isScreenReader = isScreenReaderModeEnabled();

  // Ref not state: RecentDenialsTab updates don't need to trigger parent
  // re-render (only read on exit), and re-renders trip the modal ScrollBox
  // collapse bug from #23592 in fullscreen.
  const denialStateRef = useRef<RecentDenialsState>({
    approved: new Set(),
    retry: new Set(),
    denials: [],
    canMark: true,
  });
  const [denialEscHint, setDenialEscHint] = useState<string | undefined>();
  const [canMarkDenial, setCanMarkDenial] = useState(true);
  const handleDenialStateChange = useCallback((s: RecentDenialsState) => {
    denialStateRef.current = s;
    setDenialEscHint(getRecentlyBlockedEscHint(s.approved.size, s.retry.size));
    setCanMarkDenial(s.canMark);
  }, []);

  const [selectedRule, setSelectedRule] = useState<PermissionRule | undefined>();
  // Track the key of the last focused rule to restore position after deletion
  const [lastFocusedRuleKey, setLastFocusedRuleKey] = useState<string | undefined>();
  const [addingRuleToTab, setAddingRuleToTab] = useState<TabType | null>(null);
  const [validatedRule, setValidatedRule] = useState<{
    ruleBehavior: PermissionBehavior;
    ruleValue: PermissionRuleValue;
  } | null>(null);
  const [isAddingWorkspaceDirectory, setIsAddingWorkspaceDirectory] = useState(false);
  const [removingDirectory, setRemovingDirectory] = useState<string | null>(null);
  const [isAutoModeSubdialogOpen, setIsAutoModeSubdialogOpen] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [headerFocused, setHeaderFocused] = useState(true);
  const handleHeaderFocusChange = useCallback((focused: boolean) => {
    setHeaderFocused(focused);
  }, []);

  const allowRulesByKey = useMemo(() => {
    const map = new Map<string, PermissionRule>();
    getAllowRules(toolPermissionContext).forEach(rule => {
      map.set(jsonStringify(rule), rule);
    });
    return map;
  }, [toolPermissionContext]);

  const denyRulesByKey = useMemo(() => {
    const map = new Map<string, PermissionRule>();
    getDenyRules(toolPermissionContext).forEach(rule => {
      map.set(jsonStringify(rule), rule);
    });
    return map;
  }, [toolPermissionContext]);

  const askRulesByKey = useMemo(() => {
    const map = new Map<string, PermissionRule>();
    getAskRules(toolPermissionContext).forEach(rule => {
      map.set(jsonStringify(rule), rule);
    });
    return map;
  }, [toolPermissionContext]);

  const getRulesOptions = useCallback(
    (tab: TabType, query: string = '') => {
      const rulesByKey = (() => {
        switch (tab) {
          case 'allow':
            return allowRulesByKey;
          case 'deny':
            return denyRulesByKey;
          case 'ask':
            return askRulesByKey;
          case 'workspace':
          case 'recent':
          case 'automode':
            return new Map<string, PermissionRule>();
        }
      })();

      const options: Option[] = [];

      // Only show "Add a new rule" for allow and deny tabs (and not when searching)
      if (tab !== 'workspace' && tab !== 'recent' && tab !== 'automode' && !query) {
        options.push({
          label: `Add a new rule${figures.ellipsis}`,
          value: 'add-new-rule',
        });
      }

      // Get all rule keys and sort them alphabetically based on rule's formatted value
      const sortedRuleKeys = Array.from(rulesByKey.keys()).sort((a, b) => {
        const ruleA = rulesByKey.get(a);
        const ruleB = rulesByKey.get(b);
        if (ruleA && ruleB) {
          const ruleAString = permissionRuleValueToString(ruleA.ruleValue).toLowerCase();
          const ruleBString = permissionRuleValueToString(ruleB.ruleValue).toLowerCase();
          return ruleAString.localeCompare(ruleBString);
        }
        return 0;
      });

      // Build options from sorted keys, filtering by search query
      const lowerQuery = query.toLowerCase();
      for (const ruleKey of sortedRuleKeys) {
        const rule = rulesByKey.get(ruleKey);
        if (rule) {
          const ruleString = permissionRuleValueToString(rule.ruleValue);
          // Filter by search query if provided
          if (query && !ruleString.toLowerCase().includes(lowerQuery)) {
            continue;
          }
          options.push({
            label: ruleString,
            value: ruleKey,
          });
        }
      }

      return { options, rulesByKey };
    },
    [allowRulesByKey, denyRulesByKey, askRulesByKey],
  );

  const exitState = useExitOnCtrlCDWithKeybindings();

  const isSearchModeActive =
    !selectedRule &&
    !addingRuleToTab &&
    !validatedRule &&
    !isAddingWorkspaceDirectory &&
    !removingDirectory &&
    !isAutoModeSubdialogOpen;

  const searchInput = useSearchInput({
    isActive: isSearchModeActive && isSearchMode,
    onExit: () => {
      setIsSearchMode(false);
      // Official 2.1.326 #230: clear stale screen-reader search hint cleanly on tall lists.
      if (isScreenReader) {
        announceForScreenReader('', false);
      }
    },
  });
  const { query: searchQuery, setQuery: setSearchQuery, cursorOffset: searchCursorOffset } = searchInput;

  const handlePaste = searchInput.handlePaste;

  // Handle entering search mode
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isSearchModeActive) return;
      if (isSearchMode) {
        searchInput.handleKeyDown(e);
        return;
      }
      if (e.ctrl || e.meta) return;

      // Enter search mode with '/' or any printable character/IME string (#125).
      // Reject named control/navigation keys so arrow/escape sequences never trigger search.
      const isNamedNonPrintable =
        e.name === 'up' ||
        e.name === 'down' ||
        e.name === 'left' ||
        e.name === 'right' ||
        e.name === 'return' ||
        e.name === 'escape' ||
        e.name === 'tab' ||
        e.name === 'backspace' ||
        e.name === 'delete' ||
        e.name === 'home' ||
        e.name === 'end' ||
        e.name === 'pageup' ||
        e.name === 'pagedown';
      const isPrintableSearchInput = e.key.length > 0 && !isNamedNonPrintable && !/\p{Cc}/u.test(e.key);
      if (e.key === '/') {
        e.preventDefault();
        setIsSearchMode(true);
        setSearchQuery('');
      } else if (
        !e.defaultPrevented &&
        isPrintableSearchInput &&
        // Don't enter search mode for single-key vim-nav / space / retry key
        e.key !== 'j' &&
        e.key !== 'k' &&
        e.key !== 'm' &&
        e.key !== 'i' &&
        e.key !== 'r' &&
        e.key !== ' '
      ) {
        e.preventDefault();
        setIsSearchMode(true);
        setSearchQuery(e.key);
      }
    },
    [isSearchModeActive, isSearchMode, setSearchQuery, searchInput.handleKeyDown],
  );

  const handleToolSelect = useCallback(
    (selectedValue: string, tab: TabType) => {
      const { rulesByKey } = getRulesOptions(tab);
      if (selectedValue === 'add-new-rule') {
        setAddingRuleToTab(tab);
        return;
      } else {
        setSelectedRule(rulesByKey.get(selectedValue));
        return;
      }
    },
    [getRulesOptions],
  );

  const handleRuleInputCancel = useCallback(() => {
    setAddingRuleToTab(null);
  }, []);

  const handleRuleInputSubmit = useCallback((ruleValue: PermissionRuleValue, ruleBehavior: PermissionBehavior) => {
    setValidatedRule({ ruleValue, ruleBehavior });
    setAddingRuleToTab(null);
  }, []);

  const handleAddRulesSuccess = useCallback((rules: PermissionRule[], unreachable?: UnreachableRule[]) => {
    setValidatedRule(null);
    for (const rule of rules) {
      setChanges(prev => [
        ...prev,
        `Added ${rule.ruleBehavior} rule ${chalk.bold(permissionRuleValueToString(rule.ruleValue))}`,
      ]);
    }

    // Show warnings for any unreachable rules we just added
    if (unreachable && unreachable.length > 0) {
      for (const u of unreachable) {
        const severity = u.shadowType === 'deny' ? 'blocked' : 'shadowed';
        setChanges(prev => [
          ...prev,
          chalk.yellow(`${figures.warning} Warning: ${permissionRuleValueToString(u.rule.ruleValue)} is ${severity}`),
          chalk.dim(`  ${u.reason}`),
          chalk.dim(`  Fix: ${u.fix}`),
        ]);
      }
    }
  }, []);

  const handleAddRuleCancel = useCallback(() => {
    setValidatedRule(null);
  }, []);

  // Official 2.1.326 #16: record settings persistence warnings so /permissions never silently drops saves.
  const handlePersistNotSaved = useCallback((warning: string) => {
    const line = chalk.yellow(`${figures.warning} ${warning}`);
    setChanges(prev => (prev.includes(line) ? prev : [...prev, line]));
  }, []);

  const handleRequestAddDirectory = useCallback(() => setIsAddingWorkspaceDirectory(true), []);
  const handleRequestRemoveDirectory = useCallback((path: string) => setRemovingDirectory(path), []);
  const handleRulesCancel = useCallback(() => {
    const s = denialStateRef.current;
    const denialsFor = (set: Set<number>) =>
      Array.from(set)
        .map(idx => s.denials[idx])
        .filter((d): d is AutoModeDenial => d !== undefined);

    const retryDenials = denialsFor(s.retry);
    if (retryDenials.length > 0) {
      for (const denial of retryDenials) {
        markAutoModeDenialApproved(denial);
      }
      onRetryDenials?.(formatDenialCommandsForRetry(retryDenials));
      onExit(undefined, {
        shouldQuery: true,
        metaMessages: [formatDenialApprovalMessage(retryDenials)],
      });
      return;
    }

    const approvedDenials = denialsFor(s.approved);
    if (approvedDenials.length > 0 || changes.length > 0) {
      for (const denial of approvedDenials) {
        markAutoModeDenialApproved(denial);
      }
      if (approvedDenials.length > 0) {
        onRetryDenials?.(formatDenialCommandsForRetry(approvedDenials));
      }
      onExit(
        changes.join('\n'),
        approvedDenials.length > 0
          ? {
              metaMessages: [formatDenialApprovalMessage(approvedDenials)],
            }
          : undefined,
      );
    } else {
      onExit('Permissions dialog dismissed', {
        display: 'system',
      });
    }
  }, [changes, onExit, onRetryDenials]);

  // Handle Escape at the top level so it works even when header is focused
  // (which disables the Select component and its select:cancel keybinding).
  // Mirrors the pattern in Settings.tsx.
  useKeybinding('confirm:no', handleRulesCancel, {
    context: 'Settings',
    isActive: isSearchModeActive && !isSearchMode,
  });

  const handleDeleteRule = () => {
    if (!selectedRule) return;

    // Find the adjacent rule to focus on after deletion
    const { options } = getRulesOptions(selectedRule.ruleBehavior as TabType);
    const selectedKey = jsonStringify(selectedRule);
    const ruleKeys = options.filter(opt => opt.value !== 'add-new-rule').map(opt => opt.value);
    const currentIndex = ruleKeys.indexOf(selectedKey);

    // Try to focus on the next rule, or the previous if deleting the last one
    let nextFocusKey: string | undefined;
    if (currentIndex !== -1) {
      if (currentIndex < ruleKeys.length - 1) {
        // Focus on the next rule
        nextFocusKey = ruleKeys[currentIndex + 1];
      } else if (currentIndex > 0) {
        // Focus on the previous rule (we're deleting the last one)
        nextFocusKey = ruleKeys[currentIndex - 1];
      }
    }
    setLastFocusedRuleKey(nextFocusKey);

    const deletedRuleText = permissionRuleValueToString(selectedRule.ruleValue);
    const deletedRuleBehavior = selectedRule.ruleBehavior;
    void deletePermissionRule({
      rule: selectedRule,
      initialContext: toolPermissionContext,
      setToolPermissionContext(toolPermissionContext) {
        setAppState(prev => ({
          ...prev,
          toolPermissionContext,
        }));
      },
    })
      .then(() => {
        setChanges(prev => [...prev, `Deleted ${deletedRuleBehavior} rule ${chalk.bold(deletedRuleText)}`]);
        announceForScreenReader(`[Deleted ${deletedRuleBehavior} rule ${deletedRuleText}]`, true);
      })
      .catch(() => {
        setChanges(prev => [...prev, `Could not delete ${chalk.bold(deletedRuleText)} — the rule is unchanged`]);
        announceForScreenReader(`[Could not delete ${deletedRuleText} — the rule is unchanged]`, true);
      });
    setSelectedRule(undefined);
  };

  if (selectedRule) {
    return <RuleDetails rule={selectedRule} onDelete={handleDeleteRule} onCancel={() => setSelectedRule(undefined)} />;
  }

  if (
    addingRuleToTab &&
    addingRuleToTab !== 'workspace' &&
    addingRuleToTab !== 'recent' &&
    addingRuleToTab !== 'automode'
  ) {
    return (
      <PermissionRuleInput
        onCancel={handleRuleInputCancel}
        onSubmit={handleRuleInputSubmit}
        ruleBehavior={addingRuleToTab}
      />
    );
  }

  if (validatedRule) {
    return (
      <AddPermissionRules
        onAddRules={handleAddRulesSuccess}
        onCancel={handleAddRuleCancel}
        onNotSaved={handlePersistNotSaved}
        ruleValues={[validatedRule.ruleValue]}
        ruleBehavior={validatedRule.ruleBehavior}
        initialContext={toolPermissionContext}
        setToolPermissionContext={toolPermissionContext => {
          setAppState(prev => ({
            ...prev,
            toolPermissionContext,
          }));
        }}
      />
    );
  }

  if (isAddingWorkspaceDirectory) {
    return (
      <AddWorkspaceDirectory
        onAddDirectory={(path, remember) => {
          // Apply the permission update to add the directory
          const destination: PermissionUpdateDestination = remember ? 'localSettings' : 'session';

          const permissionUpdate = {
            type: 'addDirectories' as const,
            directories: [path],
            destination,
          };

          const updatedContext = applyPermissionUpdate(toolPermissionContext, permissionUpdate);
          setAppState(prev => ({
            ...prev,
            toolPermissionContext: updatedContext,
          }));

          // Persist if remember is true (#16: surface persist error via onPersistError)
          if (remember) {
            persistPermissionUpdates([permissionUpdate], { onPersistError: handlePersistNotSaved });
          }

          setChanges(prev => [
            ...prev,
            `Added directory ${chalk.bold(path)} to workspace${remember ? ' and saved to local settings' : ' for this session'}`,
          ]);
          setIsAddingWorkspaceDirectory(false);
        }}
        onCancel={() => setIsAddingWorkspaceDirectory(false)}
        permissionContext={toolPermissionContext}
      />
    );
  }

  if (removingDirectory) {
    return (
      <RemoveWorkspaceDirectory
        directoryPath={removingDirectory}
        onRemove={() => {
          setChanges(prev => [...prev, `Removed directory ${chalk.bold(removingDirectory)} from workspace`]);
          setRemovingDirectory(null);
        }}
        onCancel={() => setRemovingDirectory(null)}
        permissionContext={toolPermissionContext}
        setPermissionContext={toolPermissionContext => {
          setAppState(prev => ({
            ...prev,
            toolPermissionContext,
          }));
        }}
      />
    );
  }

  const sharedRulesProps = {
    searchQuery,
    isSearchMode,
    isFocused: isTerminalFocused,
    onCancel: handleRulesCancel,
    lastFocusedRuleKey,
    cursorOffset: searchCursorOffset,
    getRulesOptions,
    handleToolSelect,
    onHeaderFocusChange: handleHeaderFocusChange,
  };

  const isHidden =
    !!selectedRule || !!addingRuleToTab || !!validatedRule || isAddingWorkspaceDirectory || !!removingDirectory;

  return (
    <Box flexDirection="column" onKeyDown={handleKeyDown} onPaste={handlePaste}>
      <Pane color="permission">
        <Tabs
          title="Permissions"
          color="permission"
          defaultTab={defaultTab}
          selectedTab={selectedTab}
          onTabChange={tabId => setSelectedTab(tabId as TabType)}
          hidden={isHidden}
          initialHeaderFocused={!hasDenials}
          navFromContent={!isSearchMode}
        >
          {[
            <Tab key="recent" id="recent" title="Recently blocked">
              <RecentDenialsTab onHeaderFocusChange={handleHeaderFocusChange} onStateChange={handleDenialStateChange} />
            </Tab>,
            <Tab key="allow" id="allow" title="Allow">
              <PermissionRulesTab tab="allow" {...sharedRulesProps} />
            </Tab>,
            <Tab key="ask" id="ask" title="Ask">
              <PermissionRulesTab tab="ask" {...sharedRulesProps} />
            </Tab>,
            <Tab key="deny" id="deny" title="Deny">
              <PermissionRulesTab tab="deny" {...sharedRulesProps} />
            </Tab>,
            ...(toolPermissionContext.isAutoModeAvailable !== false
              ? [
                  <Tab key="automode" id="automode" title="Auto mode">
                    <AutoModeRulesTab
                      searchQuery={searchQuery}
                      isSearchMode={isSearchMode}
                      isFocused={isTerminalFocused}
                      cursorOffset={searchCursorOffset}
                      onCancel={handleRulesCancel}
                      onHeaderFocusChange={handleHeaderFocusChange}
                      onSubdialogChange={setIsAutoModeSubdialogOpen}
                    />
                  </Tab>,
                ]
              : []),
            <Tab key="workspace" id="workspace" title="Workspace">
              <Box flexDirection="column">
                <Text>Claude Code can read files in the workspace, and make edits when auto-accept edits is on.</Text>
                <WorkspaceTab
                  onExit={onExit}
                  toolPermissionContext={toolPermissionContext}
                  onRequestAddDirectory={handleRequestAddDirectory}
                  onRequestRemoveDirectory={handleRequestRemoveDirectory}
                  onHeaderFocusChange={handleHeaderFocusChange}
                />
              </Box>
            </Tab>,
          ]}
        </Tabs>
        <Box marginTop={1}>
          <Text dimColor>
            {exitState.pending ? (
              <>Press {exitState.keyName} again to cancel</>
            ) : headerFocused ? (
              <>←/→ to switch · ↓ to select · {denialEscHint ?? 'Esc to cancel'}</>
            ) : isSearchMode ? (
              <>Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear</>
            ) : hasDenials && selectedTab === 'recent' ? (
              <>
                {canMarkDenial ? 'Enter to approve · r to retry · ' : ''}
                {denialEscHint ?? `${isScreenReader ? '' : '↑/↓ to navigate · '}Esc to close`}
              </>
            ) : (
              <>
                {isScreenReader ? '' : '↑/↓ to navigate · Enter to select · '}←/→ to switch ·{' '}
                {denialEscHint ?? 'Esc to cancel'}
              </>
            )}
          </Text>
        </Box>
      </Pane>
    </Box>
  );
}
