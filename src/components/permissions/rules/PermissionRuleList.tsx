import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { applyPermissionUpdate, persistPermissionUpdate } from 'src/utils/permissions/PermissionUpdate.js';
import type { PermissionUpdateDestination } from 'src/utils/permissions/PermissionUpdateSchema.js';
import type { CommandResultDisplay } from '../../../commands.js';
import { ConfirmSelect } from '../../../components/ConfirmSelect.js';
import { Select } from '../../../components/CustomSelect/select.js';
import { useExitOnCtrlCDWithKeybindings } from '../../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useSearchInput } from '../../../hooks/useSearchInput.js';
import {
  type KeyboardEvent,
  type PasteEvent,
  Box,
  Byline,
  Dialog,
  KeyboardShortcutHint,
  Pane,
  Tab,
  Tabs,
  Text,
  useTabHeaderFocus,
  useTabsWidth,
  useTerminalFocus,
} from '@anthropic/ink';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import * as autoModeDenialsModule from '../../../utils/autoModeDenials.js';
import { type AutoModeDenial, getAutoModeDenials } from '../../../utils/autoModeDenials.js';
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
import { RecentDenialsTab } from './RecentDenialsTab.js';
import { RemoveWorkspaceDirectory } from './RemoveWorkspaceDirectory.js';
import { WorkspaceTab } from './WorkspaceTab.js';
import { AutoModeRulesTab } from './AutoModeRulesTab.js';

type TabType = 'recent' | 'allow' | 'ask' | 'deny' | 'automode' | 'workspace';

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

function removeDenial(denial: AutoModeDenial): void {
  const mod = autoModeDenialsModule as {
    removeDenial?: (d: AutoModeDenial) => void;
    removeAutoModeDenial?: (d: AutoModeDenial) => void;
  };
  if (typeof mod.removeDenial === 'function') {
    mod.removeDenial(denial);
    return;
  }
  if (typeof mod.removeAutoModeDenial === 'function') {
    mod.removeAutoModeDenial(denial);
    return;
  }
  const current = getAutoModeDenials() as AutoModeDenial[];
  const idx = current.indexOf(denial);
  if (idx !== -1) {
    current.splice(idx, 1);
  }
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
        inputGuide={<KeyboardShortcutHint shortcut="Esc" action="cancel" />}
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
        inputGuide={<KeyboardShortcutHint shortcut="Esc" action="cancel" />}
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
        <ConfirmSelect hideIndexes focus="cancel" onConfirm={onDelete} onCancel={onCancel} />
      </Box>
      <Box marginLeft={3}>
        {exitState.pending ? (
          <Text dimColor>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <KeyboardShortcutHint shortcut="Esc" action="cancel" />
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
  useEffect(() => {
    if (isSearchMode && headerFocused) blurHeader();
  }, [isSearchMode, headerFocused, blurHeader]);
  useEffect(() => {
    onHeaderFocusChange?.(headerFocused);
  }, [headerFocused, onHeaderFocusChange]);
  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <SearchBox
          query={searchQuery}
          isFocused={isSearchMode && !headerFocused}
          isTerminalFocused={isFocused}
          width={tabWidth}
          cursorOffset={cursorOffset}
        />
      </Box>
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
        isDisabled={isSearchMode || headerFocused}
        hidePromptWhileDisabled={true}
        pointerWhileDisabled={!isSearchMode}
        defaultFocusValue={lastFocusedRuleKey}
        onUpFromFirstItem={focusHeader}
      />
    </Box>
  );
}

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
  const denialStateRef = useRef<{
    approved: Set<number>;
    retry: Set<number>;
    denials: readonly AutoModeDenial[];
  }>({ approved: new Set(), retry: new Set(), denials: [] });
  const handleDenialStateChange = useCallback((s: typeof denialStateRef.current) => {
    denialStateRef.current = s;
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
    !selectedRule && !addingRuleToTab && !validatedRule && !isAddingWorkspaceDirectory && !removingDirectory;

  const searchInput = useSearchInput({
    isActive: isSearchModeActive && isSearchMode,
    onExit: () => {
      setIsSearchMode(false);
    },
  });
  const { query: searchQuery, setQuery: setSearchQuery, cursorOffset: searchCursorOffset } = searchInput;

  const handlePaste = useCallback(
    (e: PasteEvent) => {
      const upstreamHandlePaste = (searchInput as { handlePaste?: (e: PasteEvent) => void }).handlePaste;
      if (upstreamHandlePaste) {
        upstreamHandlePaste(e);
        return;
      }
      if (!isSearchModeActive || !isSearchMode || e.text.length === 0) return;
      e.preventDefault();
      const firstLine = e.text.split(/\r\n|\r|\n/, 2)[0] ?? '';
      if (firstLine.length === 0) return;
      setSearchQuery(searchQuery.slice(0, searchCursorOffset) + firstLine + searchQuery.slice(searchCursorOffset));
    },
    [searchInput, isSearchModeActive, isSearchMode, searchQuery, searchCursorOffset, setSearchQuery],
  );

  // Handle entering search mode
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isSearchModeActive) return;
      if (isSearchMode) return;
      if (e.ctrl || e.meta) return;

      // Enter search mode with '/' or any printable character.
      // e.key.length === 1 filters out special keys (down, return, escape,
      // etc.) — previously the raw escape sequence leaked through and
      // triggered search mode with garbage on arrow-key press.
      if (e.key === '/') {
        e.preventDefault();
        setIsSearchMode(true);
        setSearchQuery('');
      } else if (
        !e.defaultPrevented &&
        e.key.length === 1 &&
        // Don't enter search mode for vim-nav / space / retry key
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
    [isSearchModeActive, isSearchMode, setSearchQuery],
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
      const commands = retryDenials.map(d => d.display);
      onRetryDenials?.(commands);
      onExit(undefined, {
        shouldQuery: true,
        metaMessages: [
          `Permission granted for: ${commands.join(', ')}. You may now retry ${commands.length === 1 ? 'this command' : 'these commands'} if you would like.`,
        ],
      });
      return;
    }

    const approvedDenials = denialsFor(s.approved);
    if (approvedDenials.length > 0 || changes.length > 0) {
      for (const denial of approvedDenials) {
        removeDenial(denial);
      }
      const commands = approvedDenials.map(d => d.display);
      const approvedMsg = commands.length > 0 ? [`Approved ${commands.map(cmd => chalk.bold(cmd)).join(', ')}`] : [];
      onExit(
        [...approvedMsg, ...changes].join('\n'),
        commands.length > 0
          ? {
              metaMessages: [
                `Permission granted for: ${commands.join(', ')}. You may now retry ${commands.length === 1 ? 'this command' : 'these commands'} if you would like.`,
              ],
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

    void deletePermissionRule({
      rule: selectedRule,
      initialContext: toolPermissionContext,
      setToolPermissionContext(toolPermissionContext) {
        setAppState(prev => ({
          ...prev,
          toolPermissionContext,
        }));
      },
    });

    setChanges(prev => [
      ...prev,
      `Deleted ${selectedRule.ruleBehavior} rule ${chalk.bold(permissionRuleValueToString(selectedRule.ruleValue))}`,
    ]);
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

          // Persist if remember is true
          if (remember) {
            persistPermissionUpdate(permissionUpdate);
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
            <Tab key="recent" id="recent" title="Recently denied">
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
              <>←/→ to switch · ↓ to select · Esc to cancel</>
            ) : isSearchMode ? (
              <>Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear</>
            ) : hasDenials && selectedTab === 'recent' ? (
              <>Enter to approve · r to retry · {isScreenReader ? '' : '↑/↓ to navigate · '}Esc to cancel</>
            ) : (
              <>{isScreenReader ? '' : '↑/↓ to navigate · Enter to select · '}←/→ to switch · Esc to cancel</>
            )}
          </Text>
        </Box>
      </Pane>
    </Box>
  );
}
