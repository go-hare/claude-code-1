import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProjectRoot, getSessionId } from '../bootstrap/state.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
import { getTimestampedHistory, type TimestampedHistoryEntry } from '../history.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, FuzzyPicker, Text, stringWidth, wrapAnsi } from '@anthropic/ink';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { logEvent } from '../services/analytics/index.js';
import type { HistoryEntry } from '../utils/config.js';
import { formatRelativeTimeAgo, truncateToWidth } from '../utils/format.js';

type Props = {
  initialQuery?: string;
  onSelect: (entry: HistoryEntry) => void;
  onCancel: () => void;
};

const PREVIEW_ROWS = 6;
const AGE_WIDTH = 8;
/** densable uxt — picker scan page; also our generator's MAX_HISTORY_ITEMS. */
const HISTORY_SCAN_PAGE = 100;

/** densable l5n. */
const HISTORY_SEARCH_SCOPES = ['session', 'project', 'everywhere'] as const;
type HistorySearchScope = (typeof HISTORY_SEARCH_SCOPES)[number];

type Item = {
  entry: TimestampedHistoryEntry;
  display: string;
  lower: string;
  firstLine: string;
  age: string;
  sessionId?: string;
  project?: string;
};

type ScanStatus = 'scanning' | 'complete' | 'truncated' | 'failed';
type Scan = {
  items: Item[];
  status: ScanStatus;
};

export function HistorySearchDialog({ initialQuery, onSelect, onCancel }: Props): React.ReactNode {
  useRegisterOverlay('history-search');
  useRegisterKeybindingContext('HistorySearch');
  const { columns } = useTerminalSize();

  const [scope, setScope] = useState<HistorySearchScope>('everywhere');
  const [scan, setScan] = useState<Scan | null>(null);
  const [query, setQuery] = useState(initialQuery ?? '');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded: Item[] = [];
      try {
        const reader = getTimestampedHistory();
        for await (const entry of reader) {
          if (cancelled) {
            void reader.return(undefined);
            return;
          }
          const display = entry.display;
          const nl = display.indexOf('\n');
          const age = formatRelativeTimeAgo(new Date(entry.timestamp));
          const raw = entry as TimestampedHistoryEntry & {
            sessionId?: string;
            project?: string;
          };
          loaded.push({
            entry,
            display,
            lower: display.toLowerCase(),
            firstLine: nl === -1 ? display : display.slice(0, nl),
            age: age + ' '.repeat(Math.max(0, AGE_WIDTH - stringWidth(age))),
            sessionId: raw.sessionId,
            project: raw.project,
          });
        }
        if (!cancelled) {
          setScan({
            items: loaded,
            status: loaded.length >= HISTORY_SCAN_PAGE ? 'truncated' : 'complete',
          });
        }
      } catch {
        if (!cancelled) {
          setScan({
            items: loaded,
            status: loaded.length > 0 ? 'truncated' : 'failed',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cycleScope = useCallback(() => {
    const i = HISTORY_SEARCH_SCOPES.indexOf(scope);
    const next = HISTORY_SEARCH_SCOPES[(i + 1) % HISTORY_SEARCH_SCOPES.length]!;
    setScope(next);
    logEvent('tengu_history_picker_scope', {
      from: scope,
      to: next,
    });
  }, [scope]);

  useKeybinding('historySearch:cycleScope', cycleScope, { context: 'HistorySearch' });

  const filtered = useMemo(() => {
    if (!scan) return [];
    const scoped = scan.items.filter(item => matchesScope(item, scope));
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    const scanning = scan.status === 'scanning';
    const exact: Item[] = [];
    const fuzzy: Item[] = [];
    for (const item of scoped) {
      if (item.lower.includes(q)) {
        exact.push(item);
      } else if (!scanning && isSubsequence(item.lower, q)) {
        fuzzy.push(item);
      }
    }
    return exact.concat(fuzzy);
  }, [scan, query, scope]);

  const previewOnRight = columns >= 100;
  const listWidth = previewOnRight ? Math.floor((columns - 6) * 0.5) : columns - 6;
  const rowWidth = Math.max(20, listWidth - AGE_WIDTH - 1);
  const previewWidth = previewOnRight ? Math.max(20, columns - listWidth - 12) : Math.max(20, columns - 10);

  const truncatedSuffix = scan?.status === 'truncated' ? ` · newest ${scan.items.length.toLocaleString()} only` : '';
  const title = `Search prompts · ${scope}${truncatedSuffix}`;

  return (
    <FuzzyPicker
      title={title}
      placeholder="Filter history…"
      initialQuery={initialQuery}
      items={filtered}
      getKey={item => String(item.entry.timestamp)}
      onQueryChange={setQuery}
      onSelect={item => {
        logEvent('tengu_history_picker_select', {
          result_count: filtered.length,
          query_length: query.length,
        });
        void item.entry.resolve().then(onSelect);
      }}
      onCancel={onCancel}
      extraHints={
        <ConfigurableShortcutHint
          action="historySearch:cycleScope"
          context="HistorySearch"
          fallback="ctrl+s"
          description="scope"
        />
      }
      emptyMessage={q => emptyHistoryMessage(scan, q)}
      selectAction="use"
      direction="up"
      previewPosition={previewOnRight ? 'right' : 'bottom'}
      renderItem={(item, isFocused) => (
        <Text>
          <Text dimColor>{item.age}</Text>
          <Text color={isFocused ? 'suggestion' : undefined}> {truncateToWidth(item.firstLine, rowWidth)}</Text>
        </Text>
      )}
      renderPreview={item => {
        const wrapped = wrapAnsi(item.display, previewWidth, { hard: true })
          .split('\n')
          .filter(l => l.trim() !== '');
        const overflow = wrapped.length > PREVIEW_ROWS;
        const shown = wrapped.slice(0, overflow ? PREVIEW_ROWS - 1 : PREVIEW_ROWS);
        const more = wrapped.length - shown.length;
        return (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={PREVIEW_ROWS + 2}>
            {shown.map((row, i) => (
              <Text key={i} dimColor>
                {row}
              </Text>
            ))}
            {more > 0 && <Text dimColor>{`… +${more} more lines`}</Text>}
          </Box>
        );
      }}
    />
  );
}

function matchesScope(item: Item, scope: HistorySearchScope): boolean {
  if (scope === 'everywhere') return true;
  if (scope === 'session') {
    if (item.sessionId === undefined) return true;
    return item.sessionId === getSessionId();
  }
  if (item.project === undefined) return true;
  return item.project === getProjectRoot();
}

function emptyHistoryMessage(scan: Scan | null, query: string): string {
  if (!scan) return 'Loading…';
  const q = query.trim();
  switch (scan.status) {
    case 'failed':
      return "Couldn't read prompt history";
    case 'scanning':
      return q ? 'Searching older prompts…' : 'No history yet';
    case 'complete':
    case 'truncated':
      return q ? 'No matching prompts' : 'No history yet';
  }
}

function isSubsequence(text: string, query: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < query.length; i++) {
    if (text[i] === query[j]) j++;
  }
  return j === query.length;
}
