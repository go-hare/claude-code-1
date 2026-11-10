import chalk from 'chalk';
import Fuse from 'fuse.js';
import { basename, sep } from 'path';
import React from 'react';
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js';
import { useModalOrTerminalSize } from '../context/modalContext.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useSearchInput } from '../hooks/useSearchInput.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  applyColor,
  Box,
  Byline,
  type Color,
  type KeyboardEvent,
  KeyboardShortcutHint,
  Pane,
  PANE_PADDING_X_INLINE,
  type PasteEvent,
  stringWidth,
  Text,
  useInput,
  useTerminalFocus,
  useTheme,
} from '@anthropic/ink';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { logEvent } from '../services/analytics/index.js';
import type { LogOption, SerializedMessage } from '../types/logs.js';
import { formatLogMetadata, truncateToWidth } from '../utils/format.js';
import { getWorktreePaths } from '../utils/getWorktreePaths.js';
import { getBranch } from '../utils/git.js';
import { getLogDisplayTitle } from '../utils/log.js';
import {
  getFirstMeaningfulUserMessageTextContent,
  getSessionIdFromLog,
  isCustomTitleEnabled,
  saveCustomTitle,
} from '../utils/sessionStorage.js';
import { sanitizeSessionTitle } from '../utils/sessionTitleSanitize.js';
import { getTheme } from '../utils/theme.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { EmptyState } from './EmptyState.js';
import { SearchBox } from './SearchBox.js';
import { SessionPreview } from './SessionPreview.js';
import TextInput from './TextInput.js';
import { type TreeNode, TreeSelect } from './ui/TreeSelect.js';

export type LogSelectorProps = {
  logs: LogOption[];
  maxHeight?: number;
  forceWidth?: number;
  onCancel?: () => void;
  onSelect: (log: LogOption) => void;
  onLogsChanged?: () => void;
  onLoadMore?: (count: number) => void;
  initialSearchQuery?: string;
  showAllProjects?: boolean;
  onToggleAllProjects?: () => void;
  onAgenticSearch?: (query: string, logs: LogOption[], signal?: AbortSignal) => Promise<LogOption[]>;
  /** densable iYt `F`. Empty copy is withheld while a reload is in flight. */
  isLoading?: boolean;
  reloadGeneration?: number;
  currentSessionId?: string;
};

type LogTreeNode = TreeNode<{ log: LogOption; indexInFiltered: number }>;

function normalizeAndTruncateToWidth(text: string, maxWidth: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return truncateToWidth(normalized, maxWidth);
}

// Width of prefixes that TreeSelect will add
const PARENT_PREFIX_WIDTH = 2; // '▼ ' or '▶ '
const CHILD_PREFIX_WIDTH = 4; // '  ▸ '
const ARTIFACT_GLYPH = '⬡';

// Deep search constants
const DEEP_SEARCH_MAX_MESSAGES = 2000;
const DEEP_SEARCH_CROP_SIZE = 1000;
const DEEP_SEARCH_MAX_TEXT_LENGTH = 50000; // Cap searchable text per session
const FUSE_THRESHOLD = 0.3;
const DATE_TIE_THRESHOLD_MS = 60 * 1000; // 1 minute - use relevance as tie-breaker within this window
const SNIPPET_CONTEXT_CHARS = 50; // Characters to show before/after match
const LOAD_MORE_EMPTY_CAP = 5;

const PR_URL_QUERY_RE =
  /https?:\/\/[^\s/"]+\/([^\s/"]+\/[^\s/"]+)\/(?:pull|merge_requests|pull-requests)\/(\d+)[^\s,"]*/gi;

function normalizePrUrlSearchQuery(query: string): string {
  return query.replace(PR_URL_QUERY_RE, (_full, repo: string, num: string) => `PR #${parseInt(num, 10)} ${repo}`);
}

type Snippet = { before: string; match: string; after: string };

function formatSnippet({ before, match, after }: Snippet, highlightColor: (text: string) => string): string {
  return chalk.dim(before) + highlightColor(match) + chalk.dim(after);
}

function extractSnippet(text: string, query: string, contextChars: number): Snippet | null {
  const matchIndex = text.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex === -1) return null;

  const matchEnd = matchIndex + query.length;
  const snippetStart = Math.max(0, matchIndex - contextChars);
  const snippetEnd = Math.min(text.length, matchEnd + contextChars);

  const beforeRaw = text.slice(snippetStart, matchIndex);
  const matchText = text.slice(matchIndex, matchEnd);
  const afterRaw = text.slice(matchEnd, snippetEnd);

  return {
    before: (snippetStart > 0 ? '…' : '') + beforeRaw.replace(/\s+/g, ' ').trimStart(),
    match: matchText.trim(),
    after: afterRaw.replace(/\s+/g, ' ').trimEnd() + (snippetEnd < text.length ? '…' : ''),
  };
}

function buildLogLabel(
  log: LogOption,
  maxLabelWidth: number,
  options?: {
    isGroupHeader?: boolean;
    isChild?: boolean;
    forkCount?: number;
  },
): string {
  const { isGroupHeader = false, isChild = false, forkCount = 0 } = options || {};

  // TreeSelect will add the prefix, so we just need to account for its width
  const prefixWidth = isGroupHeader && forkCount > 0 ? PARENT_PREFIX_WIDTH : isChild ? CHILD_PREFIX_WIDTH : 0;

  const sessionCountSuffix =
    isGroupHeader && forkCount > 0 ? ` (+${forkCount} other ${forkCount === 1 ? 'session' : 'sessions'})` : '';

  const sidechainSuffix = log.isSidechain ? ' (sidechain)' : '';
  const artifactSuffix =
    log.artifactCount !== undefined && log.artifactCount > 0 ? `  ${ARTIFACT_GLYPH} ${log.artifactCount}` : '';

  const maxSummaryWidth =
    maxLabelWidth - prefixWidth - sidechainSuffix.length - sessionCountSuffix.length - stringWidth(artifactSuffix);
  const truncatedSummary = normalizeAndTruncateToWidth(getLogDisplayTitle(log), maxSummaryWidth);
  return `${truncatedSummary}${sidechainSuffix}${sessionCountSuffix}${artifactSuffix}`;
}

function buildLogMetadata(log: LogOption, options?: { isChild?: boolean; showProjectPath?: boolean }): string {
  const { isChild = false, showProjectPath = false } = options || {};
  // Match the child prefix width for proper alignment
  const childPadding = isChild ? '    ' : ''; // 4 spaces to match '  ▸ '
  const baseMetadata = formatLogMetadata(log);
  const projectSuffix = showProjectPath && log.projectPath ? ` · ${log.projectPath}` : '';
  return childPadding + baseMetadata + projectSuffix;
}

export function LogSelector({
  logs,
  maxHeight = Infinity,
  forceWidth,
  onCancel,
  onSelect,
  onLogsChanged,
  onLoadMore,
  initialSearchQuery,
  showAllProjects = false,
  onToggleAllProjects,
  isLoading = false,
  reloadGeneration = 0,
  currentSessionId: currentSessionIdProp,
}: LogSelectorProps): React.ReactNode {
  const terminalSize = useTerminalSize();
  // Prefer modal inner size when hosted in FullscreenLayout's bottom pane so
  // labels/footers respect the modal's horizontal padding (columns - 4).
  const modalOrTerm = useModalOrTerminalSize(terminalSize);
  const columns = forceWidth === undefined ? modalOrTerm.columns : forceWidth;
  const exitState = useExitOnCtrlCDWithKeybindings(onCancel);
  const isTerminalFocused = useTerminalFocus();
  const isResumeWithRenameEnabled = isCustomTitleEnabled();
  const isDeepSearchEnabled = process.env.USER_TYPE === 'ant';
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  const highlightColor = React.useMemo(
    () => (text: string) => applyColor(text, theme.warning as Color),
    [theme.warning],
  );

  const [currentBranch, setCurrentBranch] = React.useState<string | null>(null);
  const [branchFilterEnabled, setBranchFilterEnabled] = React.useState(false);
  const [showAllWorktrees, setShowAllWorktrees] = React.useState(false);
  const [hasMultipleWorktrees, setHasMultipleWorktrees] = React.useState(false);
  const [repoRootPath, setRepoRootPath] = React.useState<string | null>(null);
  const [currentWorktreeRoot, setCurrentWorktreeRoot] = React.useState<string | null>(null);
  const [allWorktreePaths, setAllWorktreePaths] = React.useState<string[]>([]);
  const [worktreesLoaded, setWorktreesLoaded] = React.useState(false);
  const [currentCwd] = React.useState(() => getOriginalCwd());
  const [renameValue, setRenameValue] = React.useState('');
  const [renameCursorOffset, setRenameCursorOffset] = React.useState(0);
  const [expandedGroupSessionIds, setExpandedGroupSessionIds] = React.useState<Set<string>>(new Set());
  const [focusedNode, setFocusedNode] = React.useState<LogTreeNode | null>(null);
  // Track focused index for scroll position display in title
  const [focusedIndex, setFocusedIndex] = React.useState(1);
  const [viewMode, setViewMode] = React.useState<'list' | 'preview' | 'rename' | 'search'>(
    initialSearchQuery ? 'search' : 'list',
  );
  const [previewLog, setPreviewLog] = React.useState<LogOption | null>(null);
  const prevFocusedIdRef = React.useRef<string | null>(null);

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset,
    handlePaste: handleSearchPaste,
  } = useSearchInput({
    isActive: viewMode === 'search',
    onExit: () => {
      setViewMode('list');
      logEvent('tengu_session_search_toggled', { enabled: false });
    },
    onExitUp: () => {
      setViewMode('list');
      logEvent('tengu_session_search_toggled', { enabled: false });
    },
    passthroughCtrlKeys: logs.length === 0 ? ['n', 'a'] : ['n'],
    initialQuery: initialSearchQuery || '',
  });

  const normalizedSearchQuery = React.useMemo(() => normalizePrUrlSearchQuery(searchQuery), [searchQuery]);

  // Debounce transcript search for performance (title search is instant)
  const deferredSearchQuery = React.useDeferredValue(normalizedSearchQuery);

  // Additional debounce for deep search - wait 300ms after typing stops
  const [debouncedDeepSearchQuery, setDebouncedDeepSearchQuery] = React.useState('');
  React.useEffect(() => {
    if (!deferredSearchQuery) {
      setDebouncedDeepSearchQuery('');
      return;
    }
    const timeoutId = setTimeout(setDebouncedDeepSearchQuery, 300, deferredSearchQuery);
    return () => clearTimeout(timeoutId);
  }, [deferredSearchQuery]);

  // State for async deep search results
  const [deepSearchResults, setDeepSearchResults] = React.useState<{
    results: Array<{ log: LogOption; score?: number; searchableText: string }>;
    query: string;
  } | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);

  React.useEffect(() => {
    void getBranch().then(branch => setCurrentBranch(branch));
    const startTime = Date.now();
    void getWorktreePaths(currentCwd)
      .then(paths => {
        logEvent('tengu_worktree_detection', {
          duration_ms: Date.now() - startTime,
          worktree_count: paths.length,
          success: true,
        });
        setHasMultipleWorktrees(paths.length > 1);
        setAllWorktreePaths(paths);
        setRepoRootPath(paths[0] ?? null);
        const matches = paths.filter(wt => currentCwd === wt || currentCwd.startsWith(wt + sep));
        matches.sort((a, b) => b.length - a.length);
        setCurrentWorktreeRoot(matches[0] ?? null);
        setWorktreesLoaded(true);
      })
      .catch(() => {
        logEvent('tengu_worktree_detection', {
          duration_ms: Date.now() - startTime,
          worktree_count: 0,
          success: false,
        });
        setWorktreesLoaded(true);
      });
  }, [currentCwd]);

  React.useEffect(() => {
    if (reloadGeneration === 0) return;
    setDeepSearchResults(null);
  }, [reloadGeneration]);

  // Memoize searchable text extraction - only recompute when logs change
  const searchableTextByLog = React.useMemo(() => new Map(logs.map(log => [log, buildSearchableText(log)])), [logs]);

  // Pre-build Fuse index once when logs change (not on every search query)
  const fuseIndex = React.useMemo(() => {
    if (!isDeepSearchEnabled) return null;

    const logsWithText = logs
      .map(log => ({
        log,
        searchableText: searchableTextByLog.get(log) ?? '',
      }))
      .filter(item => item.searchableText);

    return new Fuse(logsWithText, {
      keys: ['searchableText'],
      threshold: FUSE_THRESHOLD,
      ignoreLocation: true,
      includeScore: true,
    });
  }, [logs, searchableTextByLog, isDeepSearchEnabled]);

  const effectiveCurrentSessionId = currentSessionIdProp ?? getSessionId();

  // Base filtering (instant) - applies branch, worktree, and resume filters
  const baseFilteredLogs = React.useMemo(() => {
    let filtered = logs;
    if (isResumeWithRenameEnabled) {
      filtered = logs.filter(log => {
        const logSessionId = getSessionIdFromLog(log);
        const isCurrentSession = effectiveCurrentSessionId && logSessionId === effectiveCurrentSessionId;
        // Always show current session
        if (isCurrentSession) {
          return true;
        }
        // Always show sessions with custom or AI titles (e.g., loop mode sessions)
        if (log.customTitle ?? log.aiTitle) {
          return true;
        }
        // For full logs, check messages array
        const fromMessages = getFirstMeaningfulUserMessageTextContent(log.messages);
        if (fromMessages) {
          return true;
        }
        // All logs reaching this component are enriched — include if
        // they have a prompt or custom title
        if (log.firstPrompt || log.customTitle || log.aiTitle) {
          return true;
        }
        return false;
      });
    }

    if (branchFilterEnabled && currentBranch) {
      filtered = filtered.filter(log => log.gitBranch === currentBranch);
    }

    if (hasMultipleWorktrees && !showAllWorktrees && !showAllProjects) {
      const targetRoot = currentWorktreeRoot ?? currentCwd;
      filtered = filtered.filter(log => {
        if ((log as { isAlias?: boolean }).isAlias) return true;
        const projectPath = log.projectPath;
        if (projectPath === undefined) return false;
        let longestMatch: string | null = null;
        for (const wt of allWorktreePaths) {
          if (projectPath === wt || projectPath.startsWith(wt + sep)) {
            if (longestMatch === null || wt.length > longestMatch.length) {
              longestMatch = wt;
            }
          }
        }
        if (longestMatch === null) {
          return projectPath === targetRoot;
        }
        return longestMatch === targetRoot;
      });
    }

    return filtered;
  }, [
    logs,
    isResumeWithRenameEnabled,
    effectiveCurrentSessionId,
    branchFilterEnabled,
    currentBranch,
    hasMultipleWorktrees,
    showAllWorktrees,
    showAllProjects,
    currentWorktreeRoot,
    currentCwd,
    allWorktreePaths,
  ]);

  // Instant title/branch/tag/PR filtering (runs on every keystroke, but is fast)
  const titleFilteredLogs = React.useMemo(() => {
    if (!normalizedSearchQuery) {
      return baseFilteredLogs;
    }
    const query = normalizedSearchQuery.toLowerCase();
    return baseFilteredLogs.filter(log => {
      const displayedTitle = getLogDisplayTitle(log).toLowerCase();
      const branch = (log.gitBranch || '').toLowerCase();
      const tag = (log.tag || '').toLowerCase();
      const prInfo = log.prNumber ? `pr #${log.prNumber} ${log.prRepository || ''}`.toLowerCase() : '';
      return displayedTitle.includes(query) || branch.includes(query) || tag.includes(query) || prInfo.includes(query);
    });
  }, [baseFilteredLogs, normalizedSearchQuery]);

  // Show searching indicator when query is pending debounce
  React.useEffect(() => {
    if (isDeepSearchEnabled && deferredSearchQuery && deferredSearchQuery !== debouncedDeepSearchQuery) {
      setIsSearching(true);
    }
  }, [deferredSearchQuery, debouncedDeepSearchQuery, isDeepSearchEnabled]);

  // Async deep search effect - runs after 300ms debounce
  React.useEffect(() => {
    if (!isDeepSearchEnabled || !debouncedDeepSearchQuery || !fuseIndex) {
      setDeepSearchResults(null);
      setIsSearching(false);
      return;
    }

    // Use setTimeout(0) to yield to the event loop - prevents UI freeze
    const timeoutId = setTimeout(
      (fuseIndex, debouncedDeepSearchQuery, setDeepSearchResults, setIsSearching) => {
        const results = fuseIndex.search(debouncedDeepSearchQuery);

        // Sort by date (newest first), with relevance as tie-breaker within same minute
        results.sort((a, b) => {
          const aTime = new Date(a.item.log.modified).getTime();
          const bTime = new Date(b.item.log.modified).getTime();
          const timeDiff = bTime - aTime;
          if (Math.abs(timeDiff) > DATE_TIE_THRESHOLD_MS) {
            return timeDiff;
          }
          // Within same minute window, use relevance score (lower is better)
          return (a.score ?? 1) - (b.score ?? 1);
        });

        setDeepSearchResults({
          results: results.map(r => ({
            log: r.item.log,
            score: r.score,
            searchableText: r.item.searchableText,
          })),
          query: debouncedDeepSearchQuery,
        });
        setIsSearching(false);
      },
      0,
      fuseIndex,
      debouncedDeepSearchQuery,
      setDeepSearchResults,
      setIsSearching,
    );

    return () => {
      clearTimeout(timeoutId);
    };
  }, [debouncedDeepSearchQuery, fuseIndex, isDeepSearchEnabled]);

  // Merge title matches with async deep search results
  const { filteredLogs, snippets } = React.useMemo(() => {
    const snippetMap = new Map<LogOption, Snippet>();

    // Start with instant title matches
    let filtered = titleFilteredLogs;

    // Merge in deep search results if available and query matches
    if (deepSearchResults && debouncedDeepSearchQuery && deepSearchResults.query === debouncedDeepSearchQuery) {
      // Extract snippets from deep search results
      for (const result of deepSearchResults.results) {
        if (result.searchableText) {
          const snippet = extractSnippet(result.searchableText, debouncedDeepSearchQuery, SNIPPET_CONTEXT_CHARS);
          if (snippet) {
            snippetMap.set(result.log, snippet);
          }
        }
      }

      // Add transcript-only matches (not already in title matches)
      const titleMatchIds = new Set(filtered.map(log => log.messages[0]?.uuid));
      const baseSet = new Set(baseFilteredLogs);
      const transcriptOnlyMatches = deepSearchResults.results
        .map(r => r.log)
        .filter(log => !titleMatchIds.has(log.messages[0]?.uuid) && baseSet.has(log));
      filtered = [...filtered, ...transcriptOnlyMatches];
    }

    return { filteredLogs: filtered, snippets: snippetMap };
  }, [titleFilteredLogs, deepSearchResults, debouncedDeepSearchQuery, baseFilteredLogs]);

  const displayedLogs = filteredLogs;

  // Calculate available width inside Pane (`xt = Le - 2 * zb`, `we = max(30, xt - 4)`)
  const innerPaneWidth = columns - 2 * PANE_PADDING_X_INLINE;
  const maxLabelWidth = Math.max(30, innerPaneWidth - 4);

  // Build tree nodes for grouped view
  const treeNodes = React.useMemo<LogTreeNode[]>(() => {
    if (!isResumeWithRenameEnabled) {
      return [];
    }

    const sessionGroups = groupLogsBySessionId(displayedLogs);

    return Array.from(sessionGroups.entries()).map(([sessionId, groupLogs]): LogTreeNode => {
      const latestLog = groupLogs[0]!;
      const indexInFiltered = displayedLogs.indexOf(latestLog);
      const snippet = snippets.get(latestLog);
      const snippetStr = snippet ? formatSnippet(snippet, highlightColor) : null;

      if (groupLogs.length === 1) {
        // Single log - no children
        const metadata = buildLogMetadata(latestLog, {
          showProjectPath: showAllProjects,
        });
        return {
          id: `log:${sessionId}:0`,
          value: { log: latestLog, indexInFiltered },
          label: buildLogLabel(latestLog, maxLabelWidth),
          description: snippetStr ? `${metadata}\n  ${snippetStr}` : metadata,
          dimDescription: true,
        };
      }

      // Multiple logs - parent with children
      const forkCount = groupLogs.length - 1;
      const children: LogTreeNode[] = groupLogs.slice(1).map((log, index) => {
        const childIndexInFiltered = displayedLogs.indexOf(log);
        const childSnippet = snippets.get(log);
        const childSnippetStr = childSnippet ? formatSnippet(childSnippet, highlightColor) : null;
        const childMetadata = buildLogMetadata(log, {
          isChild: true,
          showProjectPath: showAllProjects,
        });
        return {
          id: `log:${sessionId}:${index + 1}`,
          value: { log, indexInFiltered: childIndexInFiltered },
          label: buildLogLabel(log, maxLabelWidth, { isChild: true }),
          description: childSnippetStr ? `${childMetadata}\n      ${childSnippetStr}` : childMetadata,
          dimDescription: true,
        };
      });

      const parentMetadata = buildLogMetadata(latestLog, {
        showProjectPath: showAllProjects,
      });
      return {
        id: `group:${sessionId}`,
        value: { log: latestLog, indexInFiltered },
        label: buildLogLabel(latestLog, maxLabelWidth, {
          isGroupHeader: true,
          forkCount,
        }),
        description: snippetStr ? `${parentMetadata}\n  ${snippetStr}` : parentMetadata,
        dimDescription: true,
        children,
      };
    });
  }, [isResumeWithRenameEnabled, displayedLogs, maxLabelWidth, showAllProjects, snippets, highlightColor]);

  // Build options for old flat list view
  const flatOptions = React.useMemo(() => {
    if (isResumeWithRenameEnabled) {
      return [];
    }

    return displayedLogs.map((log, index) => {
      const rawSummary = getLogDisplayTitle(log);
      const summaryWithSidechain = rawSummary + (log.isSidechain ? ' (sidechain)' : '');
      const summary = normalizeAndTruncateToWidth(summaryWithSidechain, maxLabelWidth);

      const baseDescription = formatLogMetadata(log);
      const projectSuffix = showAllProjects && log.projectPath ? ` · ${log.projectPath}` : '';
      const snippet = snippets.get(log);
      const snippetStr = snippet ? formatSnippet(snippet, highlightColor) : null;

      return {
        label: summary,
        description: snippetStr
          ? `${baseDescription}${projectSuffix}\n  ${snippetStr}`
          : baseDescription + projectSuffix,
        dimDescription: true,
        value: index.toString(),
      };
    });
  }, [isResumeWithRenameEnabled, displayedLogs, highlightColor, maxLabelWidth, showAllProjects, snippets]);

  // Derive the focused log from focusedNode
  const focusedLog = focusedNode?.value.log ?? null;

  const renderExpandCollapseHint = (): React.ReactNode => {
    if (!isResumeWithRenameEnabled || !focusedLog) return '';
    const sessionId = getSessionIdFromLog(focusedLog);
    if (!sessionId) return '';

    const sessionLogs = displayedLogs.filter(log => getSessionIdFromLog(log) === sessionId);
    if (!(sessionLogs.length > 1)) return '';

    const isExpanded = expandedGroupSessionIds.has(sessionId);
    const isChildNode = sessionLogs.indexOf(focusedLog) > 0;

    if (isChildNode || isExpanded) {
      return <KeyboardShortcutHint shortcut="←" action="collapse" />;
    }

    return <KeyboardShortcutHint shortcut="→" action="expand" />;
  };

  const handleRenameSubmit = React.useCallback(async () => {
    const sessionId = focusedLog ? getSessionIdFromLog(focusedLog) : undefined;
    if (!focusedLog || !sessionId) {
      setViewMode('list');
      setRenameValue('');
      return;
    }

    // densable 2.1.221: same uge sanitize as /rename (ly/vhn).
    const sanitized = sanitizeSessionTitle(renameValue);
    if (sanitized) {
      // Pass fullPath for cross-project sessions (different worktrees)
      await saveCustomTitle(sessionId, sanitized, focusedLog.fullPath);
      if (isResumeWithRenameEnabled && onLogsChanged) {
        onLogsChanged();
      }
    }
    setViewMode('list');
    setRenameValue('');
  }, [focusedLog, renameValue, onLogsChanged, isResumeWithRenameEnabled]);

  const exitSearchMode = React.useCallback(() => {
    setViewMode('list');
    setSearchQuery('');
    logEvent('tengu_session_search_toggled', { enabled: false });
  }, [setSearchQuery]);

  const enterSearchMode = React.useCallback(() => {
    setViewMode('search');
    logEvent('tengu_session_search_toggled', { enabled: true });
  }, []);

  const handleFlatOptionsSelectFocus = React.useCallback(
    (value: string) => {
      const index = parseInt(value, 10);
      const log = displayedLogs[index];
      if (!log || prevFocusedIdRef.current === index.toString()) {
        return;
      }
      prevFocusedIdRef.current = index.toString();
      setFocusedNode({
        id: index.toString(),
        value: { log, indexInFiltered: index },
        label: '',
      });
      setFocusedIndex(index + 1);
    },
    [displayedLogs],
  );

  const handleTreeSelectFocus = React.useCallback(
    (node: LogTreeNode) => {
      setFocusedNode(node);
      // Update focused index for scroll position display
      const index = displayedLogs.findIndex(log => getSessionIdFromLog(log) === getSessionIdFromLog(node.value.log));
      if (index >= 0) {
        setFocusedIndex(index + 1);
      }
    },
    [displayedLogs],
  );

  // Escape in rename mode - exit rename mode
  // Use Settings context so 'n' key doesn't exit (allows typing 'n' in rename input)
  useKeybinding(
    'confirm:no',
    () => {
      setViewMode('list');
      setRenameValue('');
    },
    {
      context: 'Settings',
      isActive: viewMode === 'rename',
    },
  );

  // Handle non-escape input
  useInput(
    (input, key) => {
      if (viewMode === 'preview') {
        // Preview mode handles its own input
        return;
      }

      if (viewMode === 'rename') {
        // Rename mode escape is handled via keybinding; text input via TextInput
      } else if (viewMode === 'search') {
        // Text input and Enter/Down/Esc are handled by useSearchInput hook
        if (input.toLowerCase() === 'n' && key.ctrl) {
          exitSearchMode();
        } else if (input.toLowerCase() === 'a' && key.ctrl && onToggleAllProjects && logs.length === 0) {
          onToggleAllProjects();
          logEvent('tengu_session_all_projects_toggled', {
            enabled: showAllProjects,
          });
        }
      } else {
        if (displayedLogs.length === 0 && (key.upArrow || key.downArrow || key.return)) {
          setViewMode('search');
          return;
        }

        const keyIsNotCtrlOrMeta = !key.ctrl && !key.meta;
        const lowerInput = input.toLowerCase();
        // Ctrl+letter shortcuts for actions (freeing up plain letters for type-to-search)
        if (lowerInput === 'a' && key.ctrl && onToggleAllProjects) {
          onToggleAllProjects();
          logEvent('tengu_session_all_projects_toggled', {
            enabled: showAllProjects,
          });
        } else if (lowerInput === 'b' && key.ctrl) {
          const newEnabled = !branchFilterEnabled;
          setBranchFilterEnabled(newEnabled);
          logEvent('tengu_session_branch_filter_toggled', {
            enabled: newEnabled,
          });
        } else if (lowerInput === 'w' && key.ctrl && hasMultipleWorktrees) {
          const newValue = !showAllWorktrees;
          setShowAllWorktrees(newValue);
          logEvent('tengu_session_worktree_filter_toggled', {
            enabled: !newValue,
          });
        } else if (lowerInput === '/' && keyIsNotCtrlOrMeta) {
          setViewMode('search');
          logEvent('tengu_session_search_toggled', { enabled: true });
        } else if (lowerInput === 'r' && key.ctrl && focusedLog) {
          setViewMode('rename');
          setRenameValue('');
          logEvent('tengu_session_rename_started', {});
        } else if (((input === ' ' && keyIsNotCtrlOrMeta) || (lowerInput === 'v' && key.ctrl)) && focusedLog) {
          setPreviewLog(focusedLog);
          setViewMode('preview');
          logEvent('tengu_session_preview_opened', {
            messageCount: focusedLog.messageCount,
          });
        } else if (keyIsNotCtrlOrMeta && input.length === 1 && input !== ' ') {
          // Any printable character enters search mode and starts typing
          setViewMode('search');
          setSearchQuery(input);
          logEvent('tengu_session_search_toggled', { enabled: true });
        }
      }
    },
    { isActive: true },
  );

  const handlePaste = React.useCallback(
    (event: PasteEvent) => {
      if (viewMode === 'search') {
        handleSearchPaste(event);
        return;
      }
      const firstLine = (event.text.split(/\r\n|\r|\n/, 2)[0] ?? '').trim();
      if (viewMode === 'preview' || viewMode === 'rename' || !focusedLog || !firstLine) {
        return;
      }
      event.preventDefault();
      setViewMode('search');
      setSearchQuery(firstLine);
      logEvent('tengu_session_search_toggled', { enabled: true });
    },
    [viewMode, focusedLog, handleSearchPaste, setSearchQuery],
  );

  const handleEmptyListKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      if (viewMode === 'preview' || viewMode === 'rename') {
        return;
      }
      if (viewMode === 'search') {
        if (event.ctrl && event.key === 'n') {
          event.preventDefault();
        } else if (event.ctrl && event.key === 'a' && onToggleAllProjects && logs.length === 0) {
          event.preventDefault();
        }
        return;
      }
      if (displayedLogs.length === 0 && (event.key === 'up' || event.key === 'down' || event.key === 'return')) {
        event.preventDefault();
        setViewMode('search');
        return;
      }
      const keyIsNotCtrlOrMeta = !event.ctrl && !event.meta;
      const lowerKey = event.key.toLowerCase();
      if (
        (event.ctrl && lowerKey === 'a' && onToggleAllProjects) ||
        (event.ctrl && lowerKey === 'b') ||
        (event.ctrl && lowerKey === 'w' && hasMultipleWorktrees) ||
        (lowerKey === '/' && keyIsNotCtrlOrMeta) ||
        (event.ctrl && lowerKey === 'r' && focusedLog) ||
        (((event.key === ' ' && keyIsNotCtrlOrMeta) || (event.ctrl && lowerKey === 'v')) && focusedLog) ||
        (!event.defaultPrevented && keyIsNotCtrlOrMeta && event.key.length === 1 && event.key !== ' ')
      ) {
        event.preventDefault();
      }
    },
    [viewMode, displayedLogs.length, onToggleAllProjects, logs.length, hasMultipleWorktrees, focusedLog],
  );

  // densable iYt Pe / Rt / Mt / Tn / Ot
  const filterIndicators: string[] = [];
  const showRepoIndicator = Boolean(onToggleAllProjects) && !showAllProjects && worktreesLoaded;
  const repoDisplayPath = repoRootPath ?? currentCwd;
  if (showRepoIndicator) {
    filterIndicators.push(basename(repoDisplayPath));
  }
  if (branchFilterEnabled && currentBranch) {
    filterIndicators.push(currentBranch);
  }
  if (hasMultipleWorktrees && !showAllWorktrees && !showAllProjects) {
    const wtDisplayPath = currentWorktreeRoot ?? currentCwd;
    if (!(showRepoIndicator && repoDisplayPath === wtDisplayPath)) {
      filterIndicators.push(basename(wtDisplayPath));
    }
  }

  const waitingForWorktreeIndicator = Boolean(onToggleAllProjects) && !showAllProjects && !worktreesLoaded;
  const showAdditionalFilterLine =
    (filterIndicators.length > 0 || waitingForWorktreeIndicator) && viewMode !== 'search';

  const headerLines = 8 + (showAdditionalFilterLine ? 1 : 0);
  const footerLines = 2;
  const visibleCount = Math.max(1, Math.floor((maxHeight - headerLines - footerLines) / 3));

  const totalLogCount = logs.length;
  const loadMoreTrackerRef = React.useRef({ focusedIndex: -1, visible: -1, empty: 0 });

  // Progressive loading: request more logs when user scrolls near the end
  React.useEffect(() => {
    if (!onLoadMore) return;
    const tracker = loadMoreTrackerRef.current;
    if (tracker.focusedIndex !== focusedIndex || tracker.visible !== displayedLogs.length) {
      loadMoreTrackerRef.current = { focusedIndex, visible: displayedLogs.length, empty: 0 };
    }
    const buffer = visibleCount * 2;
    if (focusedIndex + buffer >= displayedLogs.length && loadMoreTrackerRef.current.empty < LOAD_MORE_EMPTY_CAP) {
      loadMoreTrackerRef.current.empty++;
      onLoadMore(visibleCount * 3);
    }
  }, [focusedIndex, visibleCount, displayedLogs.length, totalLogCount, onLoadMore]);

  // Gold: no toggle and nothing loaded → nothing to draw. With a toggle
  // (ctrl+a) the frame stays so the empty copy and the hint can paint.
  if (logs.length === 0 && !onToggleAllProjects) {
    return null;
  }

  // Show preview mode if active
  if (viewMode === 'preview' && previewLog && isResumeWithRenameEnabled) {
    return (
      <SessionPreview
        log={previewLog}
        onExit={() => {
          setViewMode('list');
          setPreviewLog(null);
        }}
        onSelect={onSelect}
      />
    );
  }

  const expandCollapseHintNode = renderExpandCollapseHint();

  const body = (
    <Pane color="suggestion">
      <Box flexShrink={0}>
        <Text bold color="suggestion">
          Resume session
          {viewMode === 'list' && displayedLogs.length > visibleCount && (
            <Text dimColor>
              {' '}
              ({focusedIndex} of {displayedLogs.length})
            </Text>
          )}
        </Text>
      </Box>
      <SearchBox
        query={searchQuery}
        isFocused={viewMode === 'search'}
        isTerminalFocused={isTerminalFocused}
        cursorOffset={searchCursorOffset}
      />
      {showAdditionalFilterLine &&
        (filterIndicators.length > 0 ? (
          <Box flexShrink={0} paddingLeft={2}>
            <Text dimColor>
              <Byline>{filterIndicators}</Byline>
            </Text>
          </Box>
        ) : (
          <Box flexShrink={0} height={1} />
        ))}
      <Box flexShrink={0}>
        <Text> </Text>
      </Box>
      {(viewMode === 'search' || viewMode === 'list') &&
        Boolean(searchQuery.trim()) &&
        displayedLogs.length === 0 &&
        !isSearching &&
        !isLoading && (
          <Box paddingLeft={1} marginBottom={1} flexShrink={0}>
            <EmptyState>No sessions match &quot;{searchQuery}&quot;.</EmptyState>
          </Box>
        )}
      {logs.length === 0 && viewMode === 'list' && !isLoading && !searchQuery.trim() && (
        <Box paddingLeft={1} marginBottom={1} flexShrink={0}>
          <EmptyState
            hint={
              showAllProjects ? undefined : (
                <KeyboardShortcutHint
                  shortcut="ctrl+a"
                  action="show all projects"
                  format={{ modCase: 'title', charCase: 'upper' }}
                />
              )
            }
          >
            {showAllProjects ? 'No conversations found.' : 'No conversations found in this project.'}
          </EmptyState>
        </Box>
      )}
      {viewMode === 'rename' && focusedLog ? (
        <Box paddingLeft={2} flexDirection="column">
          <Text bold>Rename session:</Text>
          <Box paddingTop={1}>
            <TextInput
              value={renameValue}
              onChange={setRenameValue}
              onSubmit={handleRenameSubmit}
              placeholder={getLogDisplayTitle(focusedLog, 'Enter new session name')}
              columns={Math.max(1, innerPaneWidth - 2)}
              cursorOffset={renameCursorOffset}
              onChangeCursorOffset={setRenameCursorOffset}
              showCursor={true}
              focus={true}
            />
          </Box>
        </Box>
      ) : isResumeWithRenameEnabled ? (
        <TreeSelect
          nodes={treeNodes}
          onSelect={node => {
            onSelect(node.value.log);
          }}
          onFocus={handleTreeSelectFocus}
          onCancel={onCancel}
          focusNodeId={focusedNode?.id}
          visibleOptionCount={visibleCount}
          layout="expanded"
          isDisabled={viewMode === 'search'}
          hidePromptWhileDisabled={true}
          hideIndexes={false}
          isNodeExpanded={nodeId => {
            // Always expand if in search or branch filter mode
            if (viewMode === 'search' || branchFilterEnabled) {
              return true;
            }
            // Extract sessionId from node ID (format: "group:sessionId")
            const sessionId = typeof nodeId === 'string' && nodeId.startsWith('group:') ? nodeId.substring(6) : null;
            return sessionId ? expandedGroupSessionIds.has(sessionId) : false;
          }}
          onExpand={nodeId => {
            const sessionId = typeof nodeId === 'string' && nodeId.startsWith('group:') ? nodeId.substring(6) : null;
            if (sessionId) {
              setExpandedGroupSessionIds(prev => new Set(prev).add(sessionId));
              logEvent('tengu_session_group_expanded', {});
            }
          }}
          onCollapse={nodeId => {
            const sessionId = typeof nodeId === 'string' && nodeId.startsWith('group:') ? nodeId.substring(6) : null;
            if (sessionId) {
              setExpandedGroupSessionIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(sessionId);
                return newSet;
              });
            }
          }}
          onUpFromFirstItem={enterSearchMode}
        />
      ) : (
        <Select
          options={flatOptions}
          onChange={value => {
            // Old flat list mode - index directly maps to displayedLogs
            const itemIndex = parseInt(value, 10);
            const log = displayedLogs[itemIndex];
            if (log) {
              onSelect(log);
            }
          }}
          visibleOptionCount={visibleCount}
          onCancel={onCancel}
          onFocus={handleFlatOptionsSelectFocus}
          defaultFocusValue={focusedNode?.id.toString()}
          layout="expanded"
          isDisabled={viewMode === 'search'}
          hidePromptWhileDisabled={true}
          onUpFromFirstItem={enterSearchMode}
        />
      )}
      <Box paddingLeft={2} flexShrink={0}>
        {exitState.pending ? (
          <Text dimColor>Press {exitState.keyName} again to exit</Text>
        ) : viewMode === 'rename' ? (
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="enter" action="save" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
            </Byline>
          </Text>
        ) : viewMode === 'search' ? (
          <Text dimColor>
            <Byline>
              <Text>{isSearching && isDeepSearchEnabled ? 'Searching…' : 'Type to Search'}</Text>
              {logs.length === 0 && onToggleAllProjects && (
                <KeyboardShortcutHint
                  shortcut="ctrl+a"
                  action={showAllProjects ? 'only show current repo' : 'show all projects'}
                  format={{ modCase: 'title', charCase: 'upper' }}
                />
              )}
              <KeyboardShortcutHint shortcut="enter" action="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="clear" />
            </Byline>
          </Text>
        ) : (
          <Text dimColor>
            <Byline>
              {onToggleAllProjects && (
                <KeyboardShortcutHint
                  shortcut="ctrl+a"
                  action={showAllProjects ? 'only show current repo' : 'show all projects'}
                  format={{ modCase: 'title', charCase: 'upper' }}
                />
              )}
              {currentBranch && (
                <KeyboardShortcutHint
                  shortcut="ctrl+b"
                  action={branchFilterEnabled ? 'show all branches' : 'only show current branch'}
                  format={{ modCase: 'title', charCase: 'upper' }}
                />
              )}
              {hasMultipleWorktrees && (
                <KeyboardShortcutHint
                  shortcut="ctrl+w"
                  action={showAllWorktrees ? 'only show current worktree' : 'show all worktrees'}
                  format={{ modCase: 'title', charCase: 'upper' }}
                />
              )}
              {focusedLog && <KeyboardShortcutHint shortcut="space" action="preview" />}
              {focusedLog && (
                <KeyboardShortcutHint
                  shortcut="ctrl+r"
                  action="rename"
                  format={{ modCase: 'title', charCase: 'upper' }}
                />
              )}
              <Text>Type to search</Text>
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
              {expandCollapseHintNode}
            </Byline>
          </Text>
        )}
      </Box>
    </Pane>
  );

  if (Number.isFinite(maxHeight)) {
    return (
      <Box
        flexDirection="column"
        maxHeight={Math.max(1, maxHeight - 1)}
        onKeyDown={handleEmptyListKeyDown}
        onPaste={handlePaste}
      >
        {body}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" onKeyDown={handleEmptyListKeyDown} onPaste={handlePaste}>
      {body}
    </Box>
  );
}

/**
 * Extracts searchable text content from a message.
 * Handles both string content and structured content blocks.
 */
function extractSearchableText(message: SerializedMessage): string {
  // Only extract from user and assistant messages that have content
  if (message.type !== 'user' && message.type !== 'assistant') {
    return '';
  }

  const content = 'message' in message ? message.message?.content : undefined;
  if (!content) return '';

  // Handle string content (simple messages)
  if (typeof content === 'string') {
    return content;
  }

  // Handle array of content blocks
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (typeof block === 'string') return block;
        if ('text' in block && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

/**
 * Builds searchable text for a log including messages, titles, summaries, and metadata.
 * Crops long transcripts to first/last N messages for performance.
 */
function buildSearchableText(log: LogOption): string {
  const searchableMessages =
    log.messages.length <= DEEP_SEARCH_MAX_MESSAGES
      ? log.messages
      : [...log.messages.slice(0, DEEP_SEARCH_CROP_SIZE), ...log.messages.slice(-DEEP_SEARCH_CROP_SIZE)];
  const messageText = searchableMessages.map(extractSearchableText).filter(Boolean).join(' ');

  const metadata = [
    log.customTitle,
    log.aiTitle,
    log.summary,
    log.firstPrompt,
    log.gitBranch,
    log.tag,
    log.prNumber ? `PR #${log.prNumber}` : undefined,
    log.prRepository,
  ]
    .filter(Boolean)
    .join(' ');

  const fullText = `${metadata} ${messageText}`.trim();
  return fullText.length > DEEP_SEARCH_MAX_TEXT_LENGTH ? fullText.slice(0, DEEP_SEARCH_MAX_TEXT_LENGTH) : fullText;
}

function groupLogsBySessionId(filteredLogs: LogOption[]): Map<string, LogOption[]> {
  const groups = new Map<string, LogOption[]>();

  for (const log of filteredLogs) {
    const sessionId = getSessionIdFromLog(log);
    if (sessionId) {
      const existing = groups.get(sessionId);
      if (existing) {
        existing.push(log);
      } else {
        groups.set(sessionId, [log]);
      }
    }
  }

  // Sort logs within each group by modified date (newest first)
  groups.forEach(logs => logs.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()));

  return groups;
}
