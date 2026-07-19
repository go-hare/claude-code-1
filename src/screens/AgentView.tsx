/**
 * AgentView (FleetView) — Full-screen Ink dashboard for managing background sessions.
 *
 * Upstream equivalent: FleetView (Od_) in the official Claude Code binary.
 *
 * Features:
 * - Session list with status icons, age, branch, PR column
 * - Dispatch input to start new background sessions
 * - Pin (Ctrl+T), Rename (Ctrl+R), Kill (Ctrl+X), Attach (Enter)
 * - Custom group (Ctrl+E), group modes state|directory|group (Ctrl+S)
 * - Soft-archive / Earlier, Shift+↑↓ reorder, Alt+1-9 open, double Ctrl+C exit
 * - Fold completed sessions beyond a cap
 * - Sorted: pinned first, then blocked > active > done
 * - Auto-relaunch detection
 * - Repo grouping labels
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { randomUUID } from 'crypto';
import { feature } from 'bun:bundle';
import { createRoot, Box, Text, useInput, AlternateScreen, ThemeProvider } from '@anthropic/ink';
import type { Root } from '@anthropic/ink';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { listLiveSessions, handleBgStart, attachHandler } from '../cli/bg.js';
import type { SessionEntry } from '../cli/bg/engine.js';
import { patchSessionByPid } from '../utils/concurrentSessions.js';
import { submitDispatch } from '../daemon/bgManager.js';
import { listAllJobs, removeJob, type BgJobState } from '../daemon/jobState.js';
import { VoiceProvider } from '../context/voice.js';
import { getPlatform } from '../utils/platform.js';
import {
  deriveBand,
  deriveActivity,
  deriveStatsBand,
  glyphColor,
  sortSessions,
  jobLabel,
  formatJobAge,
  pickIcon,
  fleetHeaderBudget,
  fleetXfaListEstimate,
  fleetDoneFoldAt,
  parseDispatch,
  parsePrRef,
  buildStateModeFlatRows,
  buildDirectoryModeFlatRows,
  buildCustomGroupModeFlatRows,
  buildFleetFooterHints,
  computeFleetColumnWidths,
  sessionArtifactLabel,
  formatAttachError,
  isOriginSessionId,
  normalizeFleetGroupName,
  partitionArchivedSessions,
  buildCwdBasenameMap,
  expandPastedTextRefs,
  formatPastedTextPlaceholder,
  countNewlines,
  FLEET_MIN_INTENT_LEN,
  FLEET_PASTE_CHAR_THRESHOLD,
  FLEET_STATE_GROUP_LABELS,
  FLEET_STATE_GROUP_DESCRIPTIONS,
  type FleetColumnWidths,
  type FleetFlatRow,
  type FleetStateGroup,
  type StatusBand,
} from './fleetView/helpers.js';
import { PrBadge } from '../components/PrBadge.js';
import { isFleetPastSessionsEnabled } from '../utils/permissions/autoModeFlags.js';

// Conditional voice import (dead code eliminated when VOICE_MODE is off)
/* eslint-disable @typescript-eslint/no-require-imports */
const voiceModule: { useVoice: typeof import('../hooks/useVoice.js').useVoice } | null = feature('VOICE_MODE')
  ? require('../hooks/useVoice.js')
  : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------------------
// Dispatch autocomplete
// ---------------------------------------------------------------------------

import { generateCommandSuggestions } from '../utils/suggestions/commandSuggestions.js';
import type { Command } from '../types/command.js';
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js';
import { LineView } from '../components/LineView.js';
import { SuggestionList } from '../components/SuggestionList.js';
import { Clawd } from '../components/LogoV2/Clawd.js';
import { getMainLoopModel, renderModelName } from '../utils/model/model.js';
import { getCwd } from '../utils/cwd.js';
import { truncatePathMiddle } from '../utils/truncate.js';
import { stringWidth } from '@anthropic/ink';
import { listTemplates, type TemplateInfo } from '../jobs/templates.js';
import { listRoutines, type RoutineInfo } from '../jobs/routines.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 3000;
const AUTO_RELAUNCH_MIN_INTERVAL_MS = 30_000;

const EMPTY_STATE_HINT =
  'Type a task below to start a background session. It keeps running even after you close this terminal.';
const EMPTY_STATE_EXAMPLES =
  'Try: paste a PR or issue URL \u00b7 "investigate why test/auth.test.ts is flaky" \u00b7 "address the review comments on #1234"';
/** Official P9H when origin session is in the list (arrowRight, not left). */
const REPL_HINT =
  'Press \u2192 to return to your session anytime. Type a task below to dispatch a session alongside it. Sessions keep running even after you close the terminal';
const REPL_HINT_VIA_LEFT_SUFFIX = ' \u2014 run `claude agents` to manage them';
const DISPATCH_PLACEHOLDER = 'describe a task for a new session';
/** Official Hre — custom-group bucket for jobs with no group. */
const UNGROUPED_LABEL = '(ungrouped)';

// ---------------------------------------------------------------------------
// Job label — official DC6 (jobLabel)
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars
const CONTROL_CHAR_RE = /[\x00-\x1f]/g;

function computeJobLabel(job: BgJobState, currentSessionId?: string): string {
  if (job.name) return job.name.replace(CONTROL_CHAR_RE, '').replace(/\s+/g, ' ').trim();

  const intent = (job.intent || '').replace(CONTROL_CHAR_RE, '').replace(/\s+/g, ' ').trim();
  const words = intent.split(' ').filter(Boolean);
  if (words.length === 0) {
    if (currentSessionId && (job.sessionId === currentSessionId || job.resumeSessionId === currentSessionId)) {
      return 'current session';
    }
    if (job.template === 'bg' && job.state === 'working') return 'new session';
    return job.template.replace(CONTROL_CHAR_RE, '').replace(/\s+/g, ' ').trim() || 'new session';
  }

  const maxLen = 25;
  const short = words.length > 3 ? `${words.slice(0, 3).join(' ')}\u2026` : words.join(' ');
  if (short.length <= maxLen) return short;
  return `${short.slice(0, maxLen - 1)}\u2026`;
}

// ---------------------------------------------------------------------------
// PR auto-detection (rate-limited)
// ---------------------------------------------------------------------------

const prCheckCache = new Map<number, number>(); // pid -> last check timestamp
const PR_CHECK_INTERVAL_MS = 60_000; // Only check once per minute per session

/** Cached `gh pr view` results keyed by `repo#prNum` — throttle refresh probes. */
type PrViewCacheEntry = {
  at: number;
  prReviewState?: SessionEntry['prReviewState'];
};
const prViewCache = new Map<string, PrViewCacheEntry>();
const PR_VIEW_INTERVAL_MS = 60_000;
/** Cap concurrent `gh pr view` spawns per refresh pass. */
const PR_VIEW_CONCURRENCY = 3;
/** Bound process-lifetime cache so long-lived fleets do not grow unbounded. */
const PR_VIEW_CACHE_MAX = 200;

function prViewCacheSet(key: string, entry: PrViewCacheEntry): void {
  // Refresh insertion order for LRU-ish eviction (Map preserves set order).
  if (prViewCache.has(key)) prViewCache.delete(key);
  prViewCache.set(key, entry);
  while (prViewCache.size > PR_VIEW_CACHE_MAX) {
    const oldest = prViewCache.keys().next().value;
    if (oldest === undefined) break;
    prViewCache.delete(oldest);
  }
}

/**
 * Derive a display name from the intent string (official: DC6).
 * Takes first 3 words, truncates to 25 chars.
 */
function deriveNameFromIntent(intent: string): string {
  if (!intent) return 'new session';
  const cleaned = intent
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length === 0) return 'new session';
  const name = words.length > 3 ? `${words.slice(0, 3).join(' ')}\u2026` : words.join(' ');
  return name.length > 25 ? `${name.slice(0, 24)}\u2026` : name;
}

async function detectPrForSession(session: SessionEntry): Promise<void> {
  const lastCheck = prCheckCache.get(session.pid) ?? 0;
  if (Date.now() - lastCheck < PR_CHECK_INTERVAL_MS) return;
  prCheckCache.set(session.pid, Date.now());

  try {
    const { fetchPrStatus } = await import('../utils/ghPrStatus.js');
    const pr = await fetchPrStatus();
    if (pr) {
      await patchSessionByPid(session.pid, {
        prNumber: pr.number,
      });
    }
  } catch {
    // Silently ignore — PR detection is best-effort
  }
}

function prViewCacheKey(repo: string, prNum: string): string {
  return `${repo}#${prNum}`;
}

/**
 * Severity for multi-PR review aggregation (higher = worse / more attention).
 * Used so a fleet row with several PRs surfaces the worst review band, not only
 * the first child's state.
 */
export function prReviewStateSeverity(state: SessionEntry['prReviewState'] | undefined): number {
  switch (state) {
    case 'changes_requested':
      return 4;
    case 'pending':
      return 3;
    case 'draft':
      return 2;
    case 'approved':
      return 1;
    default:
      return 0;
  }
}

/** Pick the worst review state among a list (undefined loses to any known). */
export function worstPrReviewState(
  states: ReadonlyArray<SessionEntry['prReviewState'] | undefined>,
): SessionEntry['prReviewState'] | undefined {
  let best: SessionEntry['prReviewState'] | undefined;
  let bestScore = 0;
  for (const s of states) {
    const score = prReviewStateSeverity(s);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

/**
 * Send a reply to a blocked session via UDS messaging.
 * The target session's onEnqueue callback will fire, enqueuing the reply
 * as a prompt into its message queue.
 */
async function sendReplyToSession(
  session: SessionEntry | undefined,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!session) {
    return { ok: false, error: 'No session selected' };
  }
  if (!session.messagingSocketPath) {
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '?';
    return {
      ok: false,
      error: `Cannot reply to ${short}: no messaging socket (attach with Enter and type there)`,
    };
  }
  try {
    const { sendToUdsSocket } = await import('../utils/udsClient.js');
    await sendToUdsSocket(session.messagingSocketPath, text);
    return { ok: true };
  } catch (e) {
    const { logForDebugging } = await import('../utils/debug.js');
    const msg = (e as Error).message;
    logForDebugging(`[agentView] reply failed: ${msg}`);
    return { ok: false, error: `Reply failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = 'list' | 'rename' | 'reply' | 'group';
type FocusArea = 'list' | 'dispatch';
type GroupMode = 'state' | 'directory' | 'group';

// ---------------------------------------------------------------------------
// Session row component
// ---------------------------------------------------------------------------

function SessionRow({
  session,
  isSelected,
  isOrigin,
  showSelectionBg,
  isRenaming,
  isDeletePending,
  isUngroupPending,
  renameValue,
  cols,
  onSelect,
  onOpen,
}: {
  session: SessionEntry;
  isSelected: boolean;
  /** Official isOrigin: session is the REPL/left-arrow origin (`initialJobId`). */
  isOrigin?: boolean;
  /**
   * Official pq: keyboard selection paints userMessageBackground; mouse-hover
   * selection (jH === index) skips the bg so the row is focused without fill.
   */
  showSelectionBg?: boolean;
  isRenaming: boolean;
  isDeletePending: boolean;
  isUngroupPending?: boolean;
  renameValue: string;
  cols: FleetColumnWidths;
  onSelect?: () => void;
  onOpen?: () => void;
}): React.ReactElement {
  const band = deriveBand(session);
  const activity = deriveActivity(session);
  const { color, dim } = glyphColor(band, activity, session);
  const icon = pickIcon(band, activity, session.pinned);
  const name = isRenaming ? renameValue : jobLabel(session);
  const age = formatJobAge(session.startedAt);
  const artifact = sessionArtifactLabel(session);

  // Official xhO detail: "→ to return" only when origin session is focused.
  let detail = '';
  if (isUngroupPending) {
    detail = 'ctrl+x again to ungroup';
  } else if (isDeletePending) {
    detail = 'ctrl+x again to delete';
  } else if (isOrigin && isSelected) {
    if (band === 'blocked') {
      const needs = session.waitingFor ?? session.lastMessage ?? '';
      detail = needs ? `${needs} \u00b7 \u2192` : '\u2192 to return';
    } else if (band === 'completed' && session.lastMessage) {
      detail = `${session.lastMessage} \u00b7 \u2192 to return`;
    } else {
      detail = '\u2192 to return';
    }
  } else if (band === 'blocked') {
    detail = session.waitingFor ?? session.lastMessage ?? '';
  } else {
    detail = session.lastMessage ?? '';
  }
  // Strip any ANSI escape sequences from detail
  detail = detail
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
      /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b\[[0-9;]*m|\x1b[>?][0-9]*[a-z]/g,
      '',
    )
    .trim();

  return (
    // Official xhO root is an un-sized flex row (no width="100%"). A 100% width
    // inside a padded list parent can overflow the terminal by 1 col and clip
    // the rightmost age unit ("19s" → "19", "1s" wraps to "s1").
    <Box
      backgroundColor={isSelected && showSelectionBg ? 'userMessageBackground' : undefined}
      onMouseEnter={onSelect}
      onClick={onOpen}
    >
      {/* Icon + Name column (fixed width — official $hO.label + 2) */}
      <Box width={cols.label + 2} flexShrink={0}>
        <Text wrap={'truncate' as never}>
          <Text color={(color ?? undefined) as never} dimColor={dim && !isSelected}>
            {icon}
          </Text>{' '}
          <Text bold={isSelected} dimColor={!isSelected && dim}>
            {name}
          </Text>
        </Text>
      </Box>
      {/* Detail column (flex) */}
      <Box flexGrow={1} width={0} paddingLeft={2}>
        <Text
          dimColor={!isDeletePending && !isUngroupPending}
          color={isDeletePending || isUngroupPending ? ('error' as never) : undefined}
          wrap={'truncate' as never}
        >
          {detail}
        </Text>
      </Box>
      {/* Artifact / PR column (official zhO; hidden when no PRs in list) */}
      {cols.artifact > 0 && (
        <Box width={cols.artifact + 2} flexShrink={0} paddingLeft={2}>
          {(session.prCount ?? 0) > 1 ? (
            <Text>
              <Text dimColor={!isSelected}>{session.prCount}</Text>
              <Text dimColor> PRs</Text>
            </Text>
          ) : session.prNumber !== undefined && session.prUrl ? (
            <PrBadge
              number={session.prNumber}
              url={session.prUrl}
              reviewState={session.prReviewState === 'draft' ? undefined : session.prReviewState}
            />
          ) : artifact ? (
            <Text dimColor={!isSelected}>{artifact}</Text>
          ) : null}
        </Box>
      )}
      {/* Age column (official $hO.age + 2, right-aligned) */}
      <Box width={cols.age + 2} flexShrink={0} paddingLeft={2} justifyContent="flex-end">
        <Text dimColor wrap={'truncate' as never}>
          {age}
        </Text>
      </Box>
      {isRenaming && <Text>{' \u2588'}</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function AgentViewApp({
  enteredViaLeftArrow,
  dispatchExtraArgs = [],
  cwdFilter,
  currentSessionId,
  restoreSessionId,
  initialError,
  onAction,
}: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
  currentSessionId?: string;
  restoreSessionId?: string;
  /** Official initialError (J) — attach failure shown after remount. */
  initialError?: string | null;
  onAction?: (action: { type: 'open'; sessionId: string; short: string; logPath?: string } | { type: 'done' }) => void;
}): React.ReactElement {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  /**
   * Official jH/KH: index last focused via mouse. When selectedIndex === jH,
   * selection background is suppressed (hover focus without fill). Keyboard
   * nav clears jH so bg paints again.
   */
  const [mouseSelectedIndex, setMouseSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [dispatchInput, setDispatchInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  /** Official Ld / yp — prompt vs bash (`!`) composer mode. */
  const [dispatchMode, setDispatchMode] = useState<'prompt' | 'bash'>('prompt');
  /** Official paste map for `[Pasted text #N]` expand on submit. */
  const pastesRef = useRef<Record<number, string>>({});
  const pasteIdRef = useRef(1);
  const [focusArea, setFocusArea] = useState<FocusArea>('list');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [renameValue, setRenameValue] = useState('');
  const [groupValue, setGroupValue] = useState('');
  // Per-group fold state
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(() => new Set());
  /** When true, show all completed rows (past doneCap fold). */
  const [doneCapExpanded, setDoneCapExpanded] = useState(false);
  /** Expand soft-archived "Earlier" section (official earlier load). */
  const [earlierExpanded, setEarlierExpanded] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    const m = getGlobalConfig().fleetViewGroupMode;
    return m === 'directory' || m === 'group' || m === 'state' ? m : 'state';
  });
  const [replyInput, setReplyInput] = useState('');
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string | null>(null);
  /**
   * Second Ctrl+X confirmation:
   * - sessionId → ungroup single job
   * - `group:<name>` → ungroup entire custom group header (official Lyt)
   */
  const [ungroupConfirmSessionId, setUngroupConfirmSessionId] = useState<string | null>(null);
  const [exitArmed, setExitArmed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const exitArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
    },
    [],
  );
  const dispatchingRef = useRef(false);
  const lastRelaunchRef = useRef(0);
  /** Monotonic refresh generation — stale async passes must not clobber newer results. */
  const refreshGenerationRef = useRef(0);
  /** When a refresh is in flight, a trailing refresh is scheduled after it settles. */
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const [commands, setCommands] = useState<Command[]>([]);
  /** Official fleet templates list (e$a `t` arg) for @mention / leading token. */
  const [fleetTemplates, setFleetTemplates] = useState<TemplateInfo[]>([]);
  /** Local routines list (e$a `n` arg) — cloud routines not wired. */
  const [fleetRoutines, setFleetRoutines] = useState<RoutineInfo[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [hoveredSuggestion, setHoveredSuggestion] = useState<string | null>(null);

  // Auto-focus dispatch when no sessions (skip if we're restoring position)
  useEffect(() => {
    if (sessions.length === 0 && focusArea === 'list' && !restoreSessionId) {
      setFocusArea('dispatch');
    }
  }, [sessions.length, focusArea, restoreSessionId]);

  // Header display values (densable: XG model label + hxe path truncate)
  const termWidth = process.stdout.columns ?? 80;
  const modelDisplay = renderModelName(getMainLoopModel());

  // -------------------------------------------------------------------------
  // Voice integration (push-to-talk in reply mode)
  // Note: Voice requires VoiceProvider context which is only available in the
  // full REPL tree. In standalone AgentView, voice is not available — users
  // should attach to the session for voice input.
  // -------------------------------------------------------------------------

  // Load commands + fleet templates/routines for dispatch autocomplete
  useEffect(() => {
    void import('../commands.js').then(({ getCommands }) => {
      void getCommands(process.cwd()).then(setCommands);
    });
    try {
      setFleetTemplates(listTemplates());
    } catch {
      setFleetTemplates([]);
    }
    try {
      setFleetRoutines(listRoutines());
    } catch {
      setFleetRoutines([]);
    }
  }, []);

  // Compute suggestions when dispatch input changes
  // (slash commands + @ templates/cwd + leading template token)
  useEffect(() => {
    if (focusArea !== 'dispatch' || dispatchMode === 'bash') {
      setSuggestions([]);
      return;
    }
    if (dispatchInput.startsWith('/')) {
      const items = generateCommandSuggestions(dispatchInput, commands);
      setSuggestions(items.slice(0, 8));
      setSelectedSuggestion(0);
      return;
    }
    // @mention candidates: templates first, then cwd basenames
    const at = dispatchInput.lastIndexOf('@');
    if (at >= 0 && (at === 0 || /\s/.test(dispatchInput[at - 1] ?? ' '))) {
      const partial = dispatchInput.slice(at + 1);
      if (!/\s/.test(partial)) {
        const map = buildCwdBasenameMap(sessions);
        const q = partial.toLowerCase();
        const items: SuggestionItem[] = [];
        for (const t of fleetTemplates) {
          if (q && !t.name.toLowerCase().startsWith(q)) continue;
          items.push({
            id: `tpl:${t.name}`,
            displayText: `@${t.name}`,
            description: t.description || 'template',
          });
        }
        for (const r of fleetRoutines) {
          if (q && !r.name.toLowerCase().startsWith(q)) continue;
          if (items.some(i => i.displayText === `@${r.name}`)) continue;
          items.push({
            id: `rtn:${r.name}`,
            displayText: `@${r.name}`,
            description: r.description || 'routine',
          });
        }
        for (const name of Object.keys(map)) {
          if (q && !name.toLowerCase().startsWith(q)) continue;
          if (items.some(i => i.displayText === `@${name}`)) continue;
          items.push({
            id: `cwd:${name}`,
            displayText: `@${name}`,
            description: map[name] ?? '',
          });
        }
        setSuggestions(items.slice(0, 8));
        setSelectedSuggestion(0);
        return;
      }
    }
    // Leading token template suggestions (no @) while typing first word
    if (!/\s/.test(dispatchInput) && dispatchInput.length > 0 && !dispatchInput.startsWith('!')) {
      const q = dispatchInput.toLowerCase();
      const items = fleetTemplates
        .filter(t => t.name.toLowerCase().startsWith(q))
        .slice(0, 8)
        .map(t => ({
          id: `tpl-lead:${t.name}`,
          displayText: t.name,
          description: t.description || 'template',
        }));
      setSuggestions(items);
      setSelectedSuggestion(0);
      return;
    }
    setSuggestions([]);
  }, [dispatchInput, commands, focusArea, dispatchMode, sessions, fleetTemplates, fleetRoutines]);

  const voiceEnabled = feature('VOICE_MODE') ? viewMode === 'reply' : false;
  const handleVoiceTranscript = useCallback(
    (text: string) => {
      if (viewMode === 'reply') {
        setReplyInput(prev => (prev ? `${prev} ${text}` : text));
      }
    },
    [viewMode],
  );

  const voice = voiceModule?.useVoice({
    onTranscript: handleVoiceTranscript,
    enabled: voiceEnabled,
    focusMode: false,
  }) ?? { state: 'idle' as const, handleKeyEvent: () => {} };

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    // Coalesce overlapping 3s ticks + manual refreshes: only one pass at a time,
    // and a single trailing pass if another was requested while in flight.
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    const generation = ++refreshGenerationRef.current;
    try {
      // Official W1H: read job state files from ~/.claude/jobs/<short>/state.json
      const jobs = await listAllJobs();
      if (generation !== refreshGenerationRef.current) return;

      // Convert to SessionEntry (no stale detection on load — matches official)
      let entries: SessionEntry[] = jobs.map(({ short, state: job }) => {
        const createdMs = Date.parse(job.createdAt);
        const updatedMs = Date.parse(job.updatedAt);
        return {
          pid: job.pid ?? 0,
          sessionId: job.sessionId,
          short,
          cwd: job.cwd,
          // Guard NaN — invalid createdAt would render as "NaNd" / overflow age col.
          startedAt: Number.isFinite(createdMs) ? createdMs : Date.now(),
          kind: 'bg' as const,
          name: computeJobLabel(job, currentSessionId),
          status:
            job.state === 'working'
              ? job.tempo === 'active'
                ? 'busy'
                : job.tempo === 'blocked'
                  ? 'waiting'
                  : 'busy'
              : job.state === 'blocked'
                ? 'waiting'
                : job.state,
          updatedAt: Number.isFinite(updatedMs) ? updatedMs : Date.now(),
          engine: 'detached' as const,
          lastMessage: job.detail || undefined,
          waitingFor: job.needs || job.block?.questions?.[0]?.question || undefined,
          pinned: job.pinned,
          gitBranch: job.worktreeBranch,
          prReviewState: undefined, // filled below from children PR status
          prUrl: undefined,
          prCount: undefined,
          group: job.group,
          archived: job.archived,
          sortOrder: job.sortOrder,
        };
      });

      // Seed PR artifact fields from job children (official zhO / $hO).
      // Probe ALL PR children for reviewDecision via gh (best-effort), then
      // aggregate worst review state onto the row. Rate-limited + concurrency-
      // capped so multi-PR fleets don't spawn unbounded `gh` every 3s refresh.
      try {
        const { execFileNoThrow } = await import('../utils/execFileNoThrow.js');
        type PrProbe = {
          entry: SessionEntry;
          prNum: string;
          repo: string;
          cacheKey: string;
        };
        const probes: PrProbe[] = [];
        /** Per-entry collected review states (cached + freshly probed). */
        const entryReviewStates = new Map<SessionEntry, Array<SessionEntry['prReviewState'] | undefined>>();
        const now = Date.now();
        for (const entry of entries) {
          const job = jobs.find(j => j.state.sessionId === entry.sessionId);
          const children = (job?.state.children ?? []).filter(c => c.kind !== 'frame' && c.href?.includes('/pull/'));
          if (!children.length) continue;
          entry.prCount = children.length;
          const first = children[0]!;
          entry.prUrl = first.href;
          const firstMatch = /\/pull\/(\d+)/.exec(first.href);
          if (firstMatch) entry.prNumber = Number(firstMatch[1]);

          const states: Array<SessionEntry['prReviewState'] | undefined> = [];
          entryReviewStates.set(entry, states);

          for (const child of children) {
            const prMatch = /\/pull\/(\d+)/.exec(child.href ?? '');
            if (!prMatch) continue;
            const prNum = prMatch[1]!;
            const repo = (child.href ?? '').replace(/\/pull\/\d+.*$/, '').replace(/^https?:\/\/github\.com\//, '');
            const cacheKey = prViewCacheKey(repo, prNum);
            const cached = prViewCache.get(cacheKey);
            if (cached && now - cached.at < PR_VIEW_INTERVAL_MS) {
              // Reuse last successful / empty probe within the throttle window.
              if (cached.prReviewState !== undefined) {
                states.push(cached.prReviewState);
              }
              continue;
            }
            probes.push({ entry, prNum, repo, cacheKey });
          }
        }
        await mapPool(probes, PR_VIEW_CONCURRENCY, async ({ entry, prNum, repo, cacheKey }) => {
          if (generation !== refreshGenerationRef.current) return;
          try {
            const { stdout, code } = await execFileNoThrow(
              'gh',
              ['pr', 'view', prNum, '--repo', repo, '--json', 'reviewDecision,isDraft,state'],
              { timeout: 3000, preserveOutputOnError: false },
            );
            let prReviewState: SessionEntry['prReviewState'] | undefined;
            if (code === 0 && stdout.trim()) {
              const data = JSON.parse(stdout) as {
                reviewDecision: string;
                isDraft: boolean;
                state: string;
              };
              if (data.state === 'OPEN') {
                prReviewState = data.isDraft
                  ? 'draft'
                  : data.reviewDecision === 'APPROVED'
                    ? 'approved'
                    : data.reviewDecision === 'CHANGES_REQUESTED'
                      ? 'changes_requested'
                      : 'pending';
              }
            }
            prViewCacheSet(cacheKey, { at: Date.now(), prReviewState });
            if (prReviewState !== undefined) {
              const states = entryReviewStates.get(entry);
              if (states) states.push(prReviewState);
            }
          } catch {
            // Still stamp the cache so a failing gh does not thrash every 3s.
            prViewCacheSet(cacheKey, { at: Date.now() });
          }
        });
        if (generation !== refreshGenerationRef.current) return;
        // Aggregate worst review state across all PRs for the fleet band.
        for (const [entry, states] of entryReviewStates) {
          const worst = worstPrReviewState(states);
          if (worst !== undefined) entry.prReviewState = worst;
        }
      } catch {
        // best-effort
      }

      // Official W1H: only uses job state files. No listLiveSessions merge.

      // Get live detail from daemon subscribe (official: streamTail → last line)
      try {
        const { getControlSocketPath } = await import('../daemon/controlSocket.js');
        const { jsonParse } = await import('../utils/slowOperations.js');
        const net = require('net') as typeof import('net');
        const socketPath = getControlSocketPath();

        await Promise.all(
          entries.map(async entry => {
            if (entry.lastMessage) return; // Already has detail
            // Prefer daemon short (attach correctness) over sessionId slice.
            const short = entry.short ?? entry.sessionId?.slice(0, 8);
            if (!short) return;
            try {
              const detail = await new Promise<string | undefined>(resolve => {
                const sock = new net.Socket();
                const timer = setTimeout(() => {
                  sock.destroy();
                  resolve(undefined);
                }, 500);
                sock.on('error', () => {
                  clearTimeout(timer);
                  resolve(undefined);
                });
                sock.on('connect', () => {
                  sock.write(JSON.stringify({ proto: 1, op: 'subscribe', short, tail: 200 }) + '\n');
                });
                let buf = '';
                sock.on('data', (chunk: Buffer) => {
                  buf += chunk.toString();
                  const nl = buf.indexOf('\n');
                  if (nl < 0) return;
                  sock.destroy();
                  clearTimeout(timer);
                  try {
                    const msg = jsonParse(buf.slice(0, nl)) as Record<string, unknown>;
                    if (msg.type === 'snapshot' && Array.isArray(msg.streamTail)) {
                      const allText = (msg.streamTail as string[]).join('');
                      // Strip ANSI escapes to get readable text
                      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
                      const stripped = allText.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()].|\r/g, '');
                      const lines = stripped
                        .split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 3);
                      for (let i = lines.length - 1; i >= 0; i--) {
                        const l = lines[i]!;
                        if (!l.startsWith('─') && !l.startsWith('❯') && !l.startsWith('←') && !l.startsWith('↑')) {
                          resolve(l.slice(0, 120));
                          return;
                        }
                      }
                    }
                    resolve(undefined);
                  } catch {
                    resolve(undefined);
                  }
                });
                sock.connect(socketPath);
              });
              if (detail) entry.lastMessage = detail;
            } catch {}
          }),
        );
      } catch {}

      if (cwdFilter) {
        const normalized = cwdFilter.replace(/\\/g, '/').toLowerCase();
        entries = entries.filter(s => s.cwd?.replace(/\\/g, '/').toLowerCase().startsWith(normalized));
      }

      // Drop stale results if a newer generation was started (or we were
      // superseded while awaiting listAllJobs / gh probes).
      if (generation !== refreshGenerationRef.current) return;
      setSessions(sortSessions(entries));
    } catch (e) {
      if (generation === refreshGenerationRef.current) {
        setError((e as Error).message);
      }
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        // Trailing refresh after coalesced requests.
        void refresh();
      }
    }
  }, [cwdFilter, currentSessionId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      // Invalidate any in-flight refresh so it cannot setState after unmount /
      // after deps change that recreated `refresh`.
      refreshGenerationRef.current += 1;
      refreshQueuedRef.current = false;
    };
  }, [refresh]);

  // Tab title: show awaiting-input count
  useEffect(() => {
    const awaitingCount = sessions.filter(s => deriveBand(s) === 'blocked').length;
    const title = awaitingCount > 0 ? `Claude agents (${awaitingCount} awaiting)` : 'Claude agents';
    process.stdout.write(`\x1b]0;${title}\x07`);
    return () => {
      process.stdout.write('\x1b]0;\x07');
    };
  }, [sessions]);

  // Auto-relaunch: if a pinned session disappears, respawn it
  const pinnedSessionsRef = useRef<Map<number, SessionEntry>>(new Map());
  useEffect(() => {
    if (!sessions.length) return;
    const now = Date.now();
    if (now - lastRelaunchRef.current < AUTO_RELAUNCH_MIN_INTERVAL_MS) return;

    const currentPids = new Set(sessions.map(s => s.pid));
    const previousPinned = pinnedSessionsRef.current;

    // Check if any previously-pinned session has disappeared
    for (const [pid, prevSession] of previousPinned) {
      if (!currentPids.has(pid) && prevSession.pinned) {
        // Pinned session disappeared — respawn it
        lastRelaunchRef.current = now;
        const name = prevSession.name ?? `respawn-${pid}`;
        void handleBgStart([
          '-p',
          `Continue the previous task (session "${name}" was restarted)`,
          '--name',
          name,
          ...dispatchExtraArgs,
        ]).then(refresh);
        break; // One relaunch per cycle
      }
    }

    // Update tracked pinned sessions
    const newPinned = new Map<number, SessionEntry>();
    for (const s of sessions) {
      if (s.pinned) newPinned.set(s.pid, s);
    }
    pinnedSessionsRef.current = newPinned;
  }, [sessions, refresh, dispatchExtraArgs]);

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  // Soft-archived sessions live under Earlier; main bands exclude them.
  const { active: mainSessions, earlier: earlierSessions } = React.useMemo(
    () => partitionArchivedSessions(sessions),
    [sessions],
  );
  const pinned = mainSessions.filter(s => s.pinned);
  const unpinned = mainSessions.filter(s => !s.pinned);
  const blocked = unpinned.filter(s => deriveBand(s) === 'blocked');
  const review = unpinned.filter(s => deriveBand(s) === 'review');
  const active = unpinned.filter(s => deriveBand(s) === 'active');
  const done = unpinned.filter(s => deriveBand(s) === 'completed');
  const termRows = process.stdout.rows || 54;
  const runningCount = mainSessions.filter(s => {
    const band = deriveBand(s);
    return band === 'active' || band === 'blocked' || band === 'review';
  }).length;

  // Directory groups (current CWD first) — used for directory-mode flat rows.
  const cwdGroups = React.useMemo(() => {
    if (groupMode !== 'directory') return null;
    const groups = new Map<string, SessionEntry[]>();
    const currentCwd = getCwd();
    for (const s of mainSessions) {
      const cwd = s.cwd || currentCwd;
      if (!groups.has(cwd)) groups.set(cwd, []);
      groups.get(cwd)!.push(s);
    }
    for (const [, items] of groups) {
      items.sort((a, b) => {
        const soA = a.sortOrder;
        const soB = b.sortOrder;
        if (soA !== undefined && soB !== undefined && soA !== soB) return soA - soB;
        if (soA !== undefined && soB === undefined) return -1;
        if (soA === undefined && soB !== undefined) return 1;
        return a.startedAt - b.startedAt;
      });
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === currentCwd) return -1;
      if (b === currentCwd) return 1;
      return a.localeCompare(b);
    });
  }, [mainSessions, groupMode]);

  // Custom group mode (official fleetViewGroupMode === 'group').
  // Within each group, sort by sortOrder then startedAt so Shift+↑↓ reorder sticks.
  const customGroups = React.useMemo(() => {
    if (groupMode !== 'group') return null;
    const groups = new Map<string, SessionEntry[]>();
    for (const s of mainSessions) {
      const name = s.group?.trim() || UNGROUPED_LABEL;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(s);
    }
    for (const [, items] of groups) {
      items.sort((a, b) => {
        const soA = a.sortOrder;
        const soB = b.sortOrder;
        if (soA !== undefined && soB !== undefined && soA !== soB) return soA - soB;
        if (soA !== undefined && soB === undefined) return -1;
        if (soA === undefined && soB !== undefined) return 1;
        return a.startedAt - b.startedAt;
      });
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === UNGROUPED_LABEL) return 1;
      if (b === UNGROUPED_LABEL) return -1;
      return a.localeCompare(b);
    });
  }, [mainSessions, groupMode]);

  // densable XFa(rows, t) → doneCap + wpe(compactHeader). t matches densable call sites.
  const { doneCap: xfaDoneCap, compactHeader } = React.useMemo(() => {
    if (groupMode === 'directory' && cwdGroups) {
      const t = fleetXfaListEstimate({
        mode: 'other',
        distinctGroupCount: cwdGroups.length,
        allJobs: mainSessions.length,
      });
      return fleetHeaderBudget(termRows, t);
    }
    if (groupMode === 'group' && customGroups) {
      const t = fleetXfaListEstimate({
        mode: 'other',
        distinctGroupCount: customGroups.length,
        allJobs: mainSessions.length,
      });
      return fleetHeaderBudget(termRows, t);
    }
    // state mode densable: non-done non-folded jobs + max(0, groups*2-1)
    // BF groups include pinned + eGo bands (review/blocked/working/done).
    const distinctGroupCount = [
      pinned.length > 0,
      review.length > 0,
      blocked.length > 0,
      active.length > 0,
      done.length > 0 || earlierSessions.length > 0,
    ].filter(Boolean).length;
    const visibleNonDoneJobs =
      (foldedGroups.has('pinned') ? 0 : pinned.length) +
      (foldedGroups.has('review') ? 0 : review.length) +
      (foldedGroups.has('blocked') ? 0 : blocked.length) +
      (foldedGroups.has('working') ? 0 : active.length);
    const t = fleetXfaListEstimate({
      mode: 'state',
      distinctGroupCount,
      visibleNonDoneJobs,
    });
    return fleetHeaderBudget(termRows, t);
  }, [
    groupMode,
    cwdGroups,
    customGroups,
    mainSessions.length,
    termRows,
    pinned.length,
    review.length,
    blocked.length,
    active.length,
    done.length,
    earlierSessions.length,
    foldedGroups,
  ]);

  // densable zwf: only fold when done+earlier >= doneCap+JFa(3); else Infinity.
  const doneCap = fleetDoneFoldAt(done.length, earlierSessions.length, xfaDoneCap);

  // densable RU stats via O7e (not list-band): pinned busy → active, PR-done → completed.
  const statsBlocked = mainSessions.filter(s => deriveStatsBand(s) === 'blocked').length;
  const statsActive = mainSessions.filter(s => deriveStatsBand(s) === 'active').length;
  const statsCompleted = mainSessions.filter(s => deriveStatsBand(s) === 'completed').length + earlierSessions.length;

  // Flat row list: headers selectable; official state order + doneCap fold.
  const flatRows: FleetFlatRow[] = React.useMemo(() => {
    const appendEarlier = (rows: FleetFlatRow[]): FleetFlatRow[] => {
      if (earlierSessions.length === 0) return rows;
      rows.push({ kind: 'header', group: 'earlier' });
      if (!foldedGroups.has('earlier')) {
        if (earlierExpanded) {
          for (const session of earlierSessions) rows.push({ kind: 'job', session });
        } else {
          rows.push({ kind: 'fold', group: 'earlier', hidden: earlierSessions.length });
        }
      }
      return rows;
    };

    if (groupMode === 'directory' && cwdGroups) {
      return appendEarlier(buildDirectoryModeFlatRows({ groups: cwdGroups, foldedGroups }));
    }
    if (groupMode === 'group' && customGroups) {
      return buildCustomGroupModeFlatRows({
        groups: customGroups,
        foldedGroups,
        earlier: earlierSessions,
        earlierExpanded,
      });
    }
    return appendEarlier(
      buildStateModeFlatRows({
        pinned,
        review,
        blocked,
        working: active,
        done,
        foldedGroups,
        doneCap,
        doneCapExpanded,
      }),
    );
  }, [
    groupMode,
    cwdGroups,
    customGroups,
    pinned,
    review,
    blocked,
    active,
    done,
    foldedGroups,
    doneCap,
    doneCapExpanded,
    earlierSessions,
    earlierExpanded,
  ]);

  const currentRow = flatRows[selectedIndex] as FleetFlatRow | undefined;
  const selectedSession = currentRow?.kind === 'job' ? currentRow.session : undefined;
  // densable LUt: hxe(path, max(Ys-11-(model?width+3:0), 10))
  const rawCwd = selectedSession?.cwd || getCwd();
  const modelWidth = stringWidth(modelDisplay);
  const pathBudget = Math.max(termWidth - 11 - (modelWidth > 0 ? modelWidth + 3 : 0), 10);
  const cwdDisplay = truncatePathMiddle(rawCwd, pathBudget);
  const openableJobs = flatRows.filter(r => r.kind === 'job').map(r => r.session);
  const footerHints = buildFleetFooterHints({
    focusArea,
    viewMode,
    deletePending: !!deleteConfirmSessionId || !!ungroupConfirmSessionId,
    ungroupPending: !!ungroupConfirmSessionId,
    rowKind: currentRow?.kind,
    band: selectedSession ? deriveBand(selectedSession) : undefined,
    canPin: !!selectedSession,
    canGroup: !!selectedSession,
    canRename: !!selectedSession,
    canMention: mainSessions.length > 0 || fleetTemplates.length > 0 || fleetRoutines.length > 0,
    bashMode: dispatchMode === 'bash',
    pinned: selectedSession?.pinned,
    openSlots: Math.min(9, openableJobs.length),
    exitArmed,
    runningCount,
    helpOpen,
  });

  const groupSessionCount = (group: string): number => {
    if (group === 'pinned') return pinned.length;
    if (group === 'review') return review.length;
    if (group === 'blocked') return blocked.length;
    if (group === 'working') return active.length;
    if (group === 'done') return done.length;
    if (group === 'earlier') return earlierSessions.length;
    if (group.startsWith('dir:')) {
      const cwd = group.slice(4);
      return cwdGroups?.find(([c]) => c === cwd)?.[1].length ?? 0;
    }
    if (group.startsWith('group:')) {
      const name = group.slice(6);
      return customGroups?.find(([c]) => c === name)?.[1].length ?? 0;
    }
    return 0;
  };

  const groupHeaderLabel = (group: string): string => {
    if (group === 'earlier') return 'Earlier';
    if (group.startsWith('dir:')) return group.slice(4);
    if (group.startsWith('group:')) return group.slice(6);
    return FLEET_STATE_GROUP_LABELS[group as FleetStateGroup] ?? group;
  };

  // Official $hO column widths across all sessions (label / age / artifact).
  const cols = React.useMemo(() => computeFleetColumnWidths(sessions, jobLabel), [sessions]);

  // Official isOrigin: job.id === initialJobId (`_`). Prefer currentSessionId
  // (REPL left-arrow), then restoreSessionId / CLAUDE_AGENTS_SELECT.
  const originSessionId = currentSessionId ?? restoreSessionId;
  const isOriginSession = useCallback(
    (s: SessionEntry): boolean => isOriginSessionId(s, originSessionId),
    [originSessionId],
  );
  // Official VF = Bj.some(Z_ => Z_.id === _)
  const originSessionPresent = React.useMemo(
    () => !!originSessionId && sessions.some(isOriginSession),
    [originSessionId, sessions, isOriginSession],
  );

  // Restore selection after returning from an attached session
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !restoreSessionId || flatRows.length === 0) return;
    const idx = flatRows.findIndex(
      r =>
        r.kind === 'job' &&
        (r.session.sessionId === restoreSessionId ||
          r.session.short === restoreSessionId ||
          r.session.sessionId?.startsWith(restoreSessionId) ||
          r.session.short?.startsWith(restoreSessionId)),
    );
    if (idx >= 0) {
      setMouseSelectedIndex(null);
      setSelectedIndex(idx);
      setFocusArea('list');
      restoredRef.current = true;
    }
  }, [flatRows, restoreSessionId]);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= flatRows.length && flatRows.length > 0) {
      setMouseSelectedIndex(null);
      setSelectedIndex(flatRows.length - 1);
    }
  }, [flatRows.length, selectedIndex]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleDispatch = useCallback(async () => {
    if (dispatchingRef.current) return;
    const rawForParse = dispatchMode === 'bash' ? `!${dispatchInput}` : dispatchInput;
    if (!rawForParse.trim()) return;

    const cwdMap = buildCwdBasenameMap(sessions);
    const templateTargets = fleetTemplates.map(t => ({ name: t.name }));
    const routineTargets = fleetRoutines.map(r => ({ name: r.name }));
    const parsed = parseDispatch(rawForParse, templateTargets, cwdMap, routineTargets);
    // Expand paste placeholders before submit (official jye).
    // Use !== undefined so empty bash (`!` / `!   `) is not collapsed to free-form.
    const expandedIntent = expandPastedTextRefs(parsed.intent, pastesRef.current);
    const expandedExec = parsed.exec !== undefined ? expandPastedTextRefs(parsed.exec, pastesRef.current) : undefined;

    // Bash path: empty / whitespace-only command
    if (expandedExec !== undefined && !expandedExec.trim()) {
      setError('Empty bash command');
      return;
    }
    // Official H5b short-prompt guard for free-form (not bash/matched/template/routine)
    if (
      expandedExec === undefined &&
      !parsed.matched &&
      !parsed.routine &&
      expandedIntent.trim().length < FLEET_MIN_INTENT_LEN
    ) {
      setError('Too short \u2014 describe the task');
      return;
    }

    dispatchingRef.current = true;
    try {
      // Bash `!` mode: spawn a session whose intent is the shell command prefixed
      // so the worker treats it as an executable prompt (local stand-in for exec template).
      // Matched template → agent name (official template → cxe/agent flag).
      const intent = expandedExec ? `!${expandedExec}` : expandedIntent;
      const agent = expandedExec ? undefined : (parsed.templateName ?? parsed.routine);
      await submitDispatch({
        intent,
        name: expandedExec ? expandedExec.slice(0, 40) : (parsed.templateName ?? parsed.routine),
        agent,
        cwd: parsed.cwd ?? getCwd(),
        extraArgs: dispatchExtraArgs,
        source: 'fleet',
      });
      setDispatchInput('');
      setCursorOffset(0);
      setDispatchMode('prompt');
      pastesRef.current = {};
      pasteIdRef.current = 1;
      setError(null);
      await refresh();
    } finally {
      dispatchingRef.current = false;
    }
  }, [dispatchInput, dispatchMode, refresh, dispatchExtraArgs, sessions, fleetTemplates, fleetRoutines]);

  /** Resolve the currently selected job from flatRows at call time (not a stale closure). */
  const getSelectedSession = useCallback((): SessionEntry | undefined => {
    const row = flatRows[selectedIndex];
    return row?.kind === 'job' ? row.session : undefined;
  }, [flatRows, selectedIndex]);

  const handlePin = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
    if (!short) return;
    // Toggle pin in pins.json (official: LH7 writes array of short IDs)
    try {
      const { join } = await import('path');
      const { readFile, writeFile, mkdir } = await import('fs/promises');
      const { getClaudeConfigHomeDir } = await import('../utils/envUtils.js');
      const pinsPath = join(getClaudeConfigHomeDir(), 'pins.json');
      let pins: string[] = [];
      try {
        const raw = await readFile(pinsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) pins = parsed.filter((s: unknown) => typeof s === 'string');
      } catch {}
      if (pins.includes(short)) {
        pins = pins.filter(s => s !== short);
      } else {
        pins.push(short);
      }
      await mkdir(join(getClaudeConfigHomeDir()), { recursive: true }).catch(() => {});
      await writeFile(pinsPath, JSON.stringify(pins, null, 2));
    } catch {}
    // Also patch job state for immediate UI update
    const { patchBgJobState } = await import('../daemon/jobState.js');
    patchBgJobState(short, { pinned: !session.pinned });
    await refresh();
  }, [getSelectedSession, refresh]);

  const handleRenameStart = useCallback(() => {
    const session = getSelectedSession();
    if (!session) return;
    setRenameValue(session.name ?? '');
    setViewMode('rename');
  }, [getSelectedSession]);

  const handleRenameConfirm = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const newName = renameValue.trim();
    if (newName) {
      await patchSessionByPid(session.pid, { name: newName });
    }
    setViewMode('list');
    await refresh();
  }, [getSelectedSession, renameValue, refresh]);

  const handleDelete = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8);
    if (!short) return;
    await removeJob(short);
    await refresh();
  }, [getSelectedSession, refresh]);

  const handleDeleteAll = useCallback(async () => {
    for (const session of done) {
      // Prefer daemon short (attach correctness) over sessionId slice.
      const short = session.short ?? session.sessionId?.slice(0, 8);
      if (!short) continue;
      await removeJob(short);
    }
    await refresh();
  }, [done, refresh]);

  const armExit = useCallback(() => {
    if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
    setExitArmed(true);
    exitArmTimerRef.current = setTimeout(() => {
      setExitArmed(false);
      exitArmTimerRef.current = null;
    }, 2000);
  }, []);

  const requestExit = useCallback(() => {
    if (exitArmed) {
      if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
      if (onAction) onAction({ type: 'done' });
      else process.exit(0);
      return;
    }
    armExit();
  }, [exitArmed, armExit, onAction]);

  const handleGroupStart = useCallback(() => {
    const session = getSelectedSession();
    if (!session) return;
    setGroupValue(session.group ?? '');
    setViewMode('group');
  }, [getSelectedSession]);

  const handleGroupConfirm = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
    if (!short) return;
    const { patchBgJobState } = await import('../daemon/jobState.js');
    const next = normalizeFleetGroupName(groupValue);
    patchBgJobState(short, { group: next });
    setViewMode('list');
    setGroupValue('');
    await refresh();
  }, [getSelectedSession, groupValue, refresh]);

  const handleUngroup = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
    if (!short) return;
    const { patchBgJobState } = await import('../daemon/jobState.js');
    patchBgJobState(short, { group: undefined });
    setUngroupConfirmSessionId(null);
    await refresh();
  }, [getSelectedSession, refresh]);

  /** Official Lyt — clear custom group on every daemon job in the named group. */
  const handleUngroupAll = useCallback(
    async (groupName: string) => {
      const { patchBgJobState } = await import('../daemon/jobState.js');
      const members = mainSessions.filter(s => (s.group?.trim() || UNGROUPED_LABEL) === groupName);
      for (const session of members) {
        const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
        if (!short) continue;
        patchBgJobState(short, { group: undefined });
      }
      setUngroupConfirmSessionId(null);
      await refresh();
    },
    [mainSessions, refresh],
  );

  const handleArchive = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
    if (!short) return;
    const { patchBgJobState } = await import('../daemon/jobState.js');
    patchBgJobState(short, { archived: true, pinned: false });
    setDeleteConfirmSessionId(null);
    setUngroupConfirmSessionId(null);
    await refresh();
  }, [getSelectedSession, refresh]);

  const handleUnarchive = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
    if (!short) return;
    const { patchBgJobState } = await import('../daemon/jobState.js');
    patchBgJobState(short, { archived: false });
    await refresh();
  }, [getSelectedSession, refresh]);

  const handleReorder = useCallback(
    async (direction: -1 | 1) => {
      const session = getSelectedSession();
      if (!session || currentRow?.kind !== 'job') return;
      // Find neighbor job in flatRows before crossing a header boundary.
      let neighborIdx = selectedIndex + direction;
      while (neighborIdx >= 0 && neighborIdx < flatRows.length) {
        const row = flatRows[neighborIdx];
        if (row?.kind === 'job') break;
        if (row?.kind === 'header') return; // crossed group boundary
        neighborIdx += direction;
      }
      const neighbor = flatRows[neighborIdx];
      if (!neighbor || neighbor.kind !== 'job') return;

      // Official CE: assign dense sortOrder within the visible sibling group so
      // swaps always move even when both sortOrder fields were previously unset.
      const siblings: Array<{ short: string; idx: number }> = [];
      // Walk left to group start
      let start = selectedIndex;
      while (start > 0) {
        const prev = flatRows[start - 1];
        if (prev?.kind === 'header') break;
        if (prev?.kind === 'job') start -= 1;
        else start -= 1;
      }
      for (let i = start; i < flatRows.length; i++) {
        const row = flatRows[i];
        if (row?.kind === 'header' && i !== start) break;
        if (row?.kind !== 'job') continue;
        const short = row.session.short ?? row.session.sessionId?.slice(0, 8) ?? '';
        if (!short) continue;
        siblings.push({ short, idx: i });
      }
      if (siblings.length < 2) return;
      const orders = siblings.map((_, i) => i);
      const from = siblings.findIndex(s => s.idx === selectedIndex);
      const to = siblings.findIndex(s => s.idx === neighborIdx);
      if (from < 0 || to < 0) return;
      const tmp = orders[from]!;
      orders[from] = orders[to]!;
      orders[to] = tmp;

      const { patchBgJobState } = await import('../daemon/jobState.js');
      for (let i = 0; i < siblings.length; i++) {
        patchBgJobState(siblings[i]!.short, { sortOrder: orders[i]! });
      }
      setSelectedIndex(neighborIdx);
      await refresh();
    },
    [getSelectedSession, currentRow, selectedIndex, flatRows, refresh],
  );

  const cycleGroupMode = useCallback(() => {
    setGroupMode(m => {
      const order: GroupMode[] = ['state', 'directory', 'group'];
      const next = order[(order.indexOf(m) + 1) % order.length] ?? 'state';
      saveGlobalConfig(c => (c.fleetViewGroupMode === next ? c : { ...c, fleetViewGroupMode: next }));
      return next;
    });
    setDoneCapExpanded(false);
    setMouseSelectedIndex(null);
    setSelectedIndex(0);
  }, []);

  // -------------------------------------------------------------------------
  // Attach pre-check (verify PTY socket before exiting fleet view)
  // -------------------------------------------------------------------------

  const checkAndAttach = useCallback(
    async (
      short: string,
      session: SessionEntry,
      onActionCb: typeof onAction,
      _setErr: (msg: string | null) => void,
    ) => {
      // Official: Enter → respawnJob → onAction({type:'open'})
      // Attach goes through daemon control socket, no need to probe PTY socket directly
      if (onActionCb) {
        onActionCb({
          type: 'open',
          sessionId: session.sessionId ?? '',
          short: session.short ?? short,
          logPath: session.logPath,
        });
      }
    },
    [],
  );

  const openJobBySlot = useCallback(
    (slot: number) => {
      // alt+1..9 — 1-based index into currently visible jobs
      const job = openableJobs[slot - 1];
      if (!job) return;
      const short = job.short ?? job.sessionId?.slice(0, 8) ?? '';
      void checkAndAttach(short, job, onAction, setError);
    },
    [openableJobs, onAction, checkAndAttach],
  );

  const selectRowByMouse = useCallback((idx: number) => {
    setFocusArea('list');
    setMouseSelectedIndex(idx);
    setSelectedIndex(idx);
  }, []);

  const selectRowByKeyboard = useCallback((idx: number | ((prev: number) => number)) => {
    // Official KH(null) on keyboard nav — restore selection bg.
    setMouseSelectedIndex(null);
    setSelectedIndex(idx);
  }, []);

  // -------------------------------------------------------------------------
  // Input handling
  // -------------------------------------------------------------------------

  useInput((input, key) => {
    const clearPending = () => {
      setDeleteConfirmSessionId(null);
      setUngroupConfirmSessionId(null);
      if (exitArmed) {
        if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
        setExitArmed(false);
      }
    };

    // Official double Ctrl+C exit (works in all modes when exitOnCtrlC is false).
    if (input === 'c' && key.ctrl) {
      if (viewMode === 'rename' || viewMode === 'group') {
        setViewMode('list');
        setGroupValue('');
        setRenameValue('');
        return;
      }
      if (viewMode === 'reply') {
        setViewMode('list');
        return;
      }
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (dispatchInput) {
        setDispatchInput('');
        setCursorOffset(0);
      }
      requestExit();
      return;
    }

    // Help overlay
    if (helpOpen) {
      if (key.escape || input === '?' || input === 'q') {
        setHelpOpen(false);
      }
      return;
    }

    // Group assign mode (official ct.kind === 'assign')
    if (viewMode === 'group') {
      if (key.escape) {
        setViewMode('list');
        setGroupValue('');
        return;
      }
      if (key.return) {
        void handleGroupConfirm();
        return;
      }
      if (key.backspace || key.delete) {
        setGroupValue(v => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setGroupValue(v => v + input);
        return;
      }
      return;
    }

    // Rename mode
    if (viewMode === 'rename') {
      if (key.escape) {
        setViewMode('list');
        return;
      }
      if (key.return) {
        void handleRenameConfirm();
        return;
      }
      if (key.backspace || key.delete) {
        setRenameValue(v => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setRenameValue(v => v + input);
        return;
      }
      return;
    }

    // Reply mode (for blocked sessions)
    if (viewMode === 'reply') {
      if (key.escape) {
        setViewMode('list');
        return;
      }
      if (key.return && replyInput.trim()) {
        const text = replyInput.trim();
        void (async () => {
          const result = await sendReplyToSession(getSelectedSession(), text);
          if (result.ok) {
            setReplyInput('');
            setError(null);
            setViewMode('list');
          } else {
            // Keep reply draft so the user can retry or attach instead.
            setError(result.error);
          }
        })();
        return;
      }
      if (key.backspace || key.delete) {
        setReplyInput(v => v.slice(0, -1));
        return;
      }
      // Voice: hold space to record (when voice is enabled)
      if (input === ' ' && voiceEnabled && voice.state !== 'idle') {
        voice.handleKeyEvent();
        return;
      }
      if (input === ' ' && voiceEnabled) {
        voice.handleKeyEvent();
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setReplyInput(v => v + input);
        return;
      }
      return;
    }

    // Shift+↑/↓ reorder (list or empty dispatch — official CE)
    if (key.shift && (key.upArrow || key.downArrow) && focusArea === 'list') {
      clearPending();
      void handleReorder(key.upArrow ? -1 : 1);
      return;
    }

    // Global chords available from list or dispatch
    if (input === 'e' && key.ctrl && focusArea === 'list') {
      clearPending();
      handleGroupStart();
      return;
    }
    if (input === 's' && key.ctrl) {
      clearPending();
      cycleGroupMode();
      return;
    }
    if (input === 't' && key.ctrl) {
      clearPending();
      void handlePin();
      return;
    }
    if (input === 'r' && key.ctrl && focusArea === 'list') {
      clearPending();
      handleRenameStart();
      return;
    }
    // Official alt/meta+1..9 open slot
    if (key.meta && input >= '1' && input <= '9') {
      clearPending();
      openJobBySlot(Number(input));
      return;
    }
    if (input === '?' && focusArea === 'list' && !key.ctrl && !key.meta) {
      clearPending();
      setHelpOpen(true);
      return;
    }

    // Dispatch input handling (with cursor / bash / paste / multiline support)
    if (focusArea === 'dispatch') {
      // Shift+Enter → newline (official dw multiline)
      if (key.return && key.shift) {
        setDispatchInput(v => v.slice(0, cursorOffset) + '\n' + v.slice(cursorOffset));
        setCursorOffset(o => o + 1);
        return;
      }
      if (key.return) {
        if (suggestions.length > 0) {
          const selected = suggestions[selectedSuggestion];
          if (selected) {
            // Replace trailing @partial or whole query with suggestion
            const at = dispatchInput.lastIndexOf('@');
            if (selected.displayText.startsWith('@') && at >= 0) {
              const next = dispatchInput.slice(0, at) + selected.displayText + ' ';
              setDispatchInput(next);
              setCursorOffset(next.length);
            } else {
              const text = selected.displayText + ' ';
              setDispatchInput(text);
              setCursorOffset(text.length);
            }
            setSuggestions([]);
            return;
          }
        }
        if (dispatchInput.trim() || dispatchMode === 'bash') {
          void handleDispatch();
        }
        return;
      }
      if (key.escape) {
        if (dispatchInput || dispatchMode === 'bash') {
          setDispatchInput('');
          setCursorOffset(0);
          setDispatchMode('prompt');
        } else if (sessions.length > 0) {
          setFocusArea('list');
        } else {
          requestExit();
        }
        return;
      }
      // Official: empty bash + backspace → exit bash mode
      if (key.backspace && !dispatchInput && dispatchMode === 'bash') {
        setDispatchMode('prompt');
        return;
      }
      if (key.backspace && cursorOffset > 0) {
        setDispatchInput(v => v.slice(0, cursorOffset - 1) + v.slice(cursorOffset));
        setCursorOffset(o => o - 1);
        return;
      }
      if (key.leftArrow) {
        setCursorOffset(o => Math.max(0, o - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorOffset(o => Math.min(dispatchInput.length, o + 1));
        return;
      }
      if (key.upArrow) {
        if (suggestions.length > 0) {
          setSelectedSuggestion(i => Math.max(0, i - 1));
        } else if (sessions.length > 0) {
          setFocusArea('list');
          selectRowByKeyboard(Math.max(0, flatRows.length - 1));
        }
        return;
      }
      if (key.downArrow && suggestions.length > 0) {
        setSelectedSuggestion(i => Math.min(suggestions.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        if (suggestions.length > 0) {
          const selected = suggestions[selectedSuggestion];
          if (selected) {
            const at = dispatchInput.lastIndexOf('@');
            if (selected.displayText.startsWith('@') && at >= 0) {
              const next = dispatchInput.slice(0, at) + selected.displayText + ' ';
              setDispatchInput(next);
              setCursorOffset(next.length);
            } else {
              const text = selected.displayText + ' ';
              setDispatchInput(text);
              setCursorOffset(text.length);
            }
            setSuggestions([]);
          }
        } else if (sessions.length > 0) {
          setFocusArea('list');
        }
        return;
      }
      if (input === 'x' && key.ctrl && done.length > 0) {
        void handleDeleteAll();
        return;
      }
      if (input === '?' && !key.ctrl && !key.meta && !dispatchInput) {
        setHelpOpen(true);
        return;
      }
      // Official dcn: empty prompt + "!" → bash mode
      if (input === '!' && !key.ctrl && !key.meta && !dispatchInput && dispatchMode === 'prompt') {
        setDispatchMode('bash');
        return;
      }
      // Large / multi-line paste → placeholder (official paste map)
      if (input && !key.ctrl && !key.meta && input.length > 1) {
        const normalized = input.replace(/\r\n|\r/g, '\n');
        const nl = countNewlines(normalized);
        if (normalized.length > FLEET_PASTE_CHAR_THRESHOLD || nl > 2) {
          const id = pasteIdRef.current++;
          pastesRef.current[id] = normalized;
          const ph = formatPastedTextPlaceholder(id, nl);
          setDispatchInput(v => v.slice(0, cursorOffset) + ph + v.slice(cursorOffset));
          setCursorOffset(o => o + ph.length);
          return;
        }
        setDispatchInput(v => v.slice(0, cursorOffset) + normalized + v.slice(cursorOffset));
        setCursorOffset(o => o + normalized.length);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setDispatchInput(v => v.slice(0, cursorOffset) + input + v.slice(cursorOffset));
        setCursorOffset(o => o + input.length);
        return;
      }
      return;
    }

    // List navigation
    const maxVisibleIndex = flatRows.length - 1;
    if (key.upArrow) {
      selectRowByKeyboard(i => Math.max(0, i - 1));
      clearPending();
    } else if (key.downArrow) {
      if (selectedIndex >= maxVisibleIndex) {
        setFocusArea('dispatch');
        setMouseSelectedIndex(null);
      } else {
        selectRowByKeyboard(i => Math.min(maxVisibleIndex, i + 1));
      }
      clearPending();
    } else if (key.tab) {
      setFocusArea('dispatch');
      setMouseSelectedIndex(null);
      clearPending();
    } else if (key.rightArrow && sessions.length > 0) {
      // Right arrow: attach/resume the selected session
      const session = getSelectedSession();
      if (session) {
        const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
        void checkAndAttach(short, session, onAction, setError);
      }
    } else if (key.return && flatRows.length > 0) {
      if (currentRow?.kind === 'fold') {
        // Official fold expand: show all completed / earlier rows.
        if (currentRow.group === 'earlier') {
          setEarlierExpanded(true);
          setFoldedGroups(s => {
            const n = new Set(s);
            n.delete('earlier');
            return n;
          });
        } else {
          setDoneCapExpanded(true);
        }
        return;
      }
      if (currentRow?.kind === 'header') {
        if (currentRow.group === 'earlier' && !earlierExpanded) {
          // First enter on Earlier expands the soft-archive fold.
          setEarlierExpanded(true);
          setFoldedGroups(s => {
            const n = new Set(s);
            n.delete('earlier');
            return n;
          });
          return;
        }
        setFoldedGroups(s => {
          const n = new Set(s);
          if (n.has(currentRow.group)) n.delete(currentRow.group);
          else n.add(currentRow.group);
          return n;
        });
        return;
      }
      const session = getSelectedSession();
      if (session) {
        const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
        void checkAndAttach(short, session, onAction, setError);
      }
    } else if (input === ' ' && sessions.length > 0) {
      // Space to reply (for blocked sessions)
      const session = getSelectedSession();
      if (session && deriveBand(session) === 'blocked') {
        clearPending();
        setViewMode('reply');
        setReplyInput('');
      }
    } else if (input === 'x' && key.ctrl) {
      // Official: job → delete (2x); custom group header → ungroup all (2x);
      // grouped job may ungroup first when already confirmed for ungroup.
      if (currentRow?.kind === 'header' && currentRow.group.startsWith('group:')) {
        const gname = currentRow.group.slice(6);
        if (gname === UNGROUPED_LABEL) return;
        const token = `group:${gname}`;
        if (ungroupConfirmSessionId === token) {
          void handleUngroupAll(gname);
        } else {
          setDeleteConfirmSessionId(null);
          setUngroupConfirmSessionId(token);
        }
        return;
      }
      const session = getSelectedSession();
      if (!session) {
        // Header/fold selected: only delete-all when focused on completed header,
        // and always require a second confirm via deleteConfirmSessionId='*done*'.
        if (currentRow?.kind === 'header' && currentRow.group === 'done' && done.length > 0) {
          if (deleteConfirmSessionId === '*done*') {
            setDeleteConfirmSessionId(null);
            void handleDeleteAll();
          } else {
            setUngroupConfirmSessionId(null);
            setDeleteConfirmSessionId('*done*');
          }
        }
        return;
      }
      // Prefer ungroup when job is in a custom group and second press is ungroup-confirm
      if (session.group && ungroupConfirmSessionId === session.sessionId) {
        void handleUngroup();
        return;
      }
      if (deleteConfirmSessionId === session.sessionId) {
        setDeleteConfirmSessionId(null);
        void handleDelete();
        return;
      }
      // First press: grouped jobs offer ungroup; otherwise arm delete.
      if (session.group) {
        setDeleteConfirmSessionId(null);
        setUngroupConfirmSessionId(session.sessionId);
      } else {
        setUngroupConfirmSessionId(null);
        setDeleteConfirmSessionId(session.sessionId);
      }
    } else if (input === 'a' && !key.ctrl && !key.meta && sessions.length > 0) {
      // Soft-archive / unarchive (local product surface for official archive)
      const session = getSelectedSession();
      if (!session) return;
      clearPending();
      if (session.archived) void handleUnarchive();
      else void handleArchive();
    } else if (input === 'f') {
      setFoldedGroups(s => {
        const n = new Set(s);
        if (n.has('done')) n.delete('done');
        else n.add('done');
        return n;
      });
      // Collapsing done resets doneCap expand so re-open still folds.
      setDoneCapExpanded(false);
    } else if (input === 'q' || key.escape) {
      requestExit();
    } else if (input === '!' && !key.ctrl && !key.meta) {
      // Official: "!" from list enters bash dispatch mode
      clearPending();
      setFocusArea('dispatch');
      setDispatchMode('bash');
      setDispatchInput('');
      setCursorOffset(0);
    } else if (input && !key.ctrl && !key.meta && input !== 'q' && input !== 'f' && input !== '?' && input !== 'a') {
      // Auto-switch to dispatch on any printable char
      clearPending();
      setFocusArea('dispatch');
      setDispatchMode('prompt');
      setDispatchInput(input);
      setCursorOffset(input.length);
    }
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <AlternateScreen
      mouseTracking={(() => {
        try {
          const { mouseTrackingProp } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../utils/fullscreen.js') as typeof import('../utils/fullscreen.js');
          return mouseTrackingProp();
        } catch {
          return process.env.CLAUDE_CODE_DISABLE_MOUSE ? 'off' : 'full';
        }
      })()}
    >
      <Box flexDirection="column" flexGrow={1}>
        {/* Top: scrollable list area */}
        <Box flexDirection="column" flexGrow={1} paddingTop={1}>
          {/* Header — densable Od_/WB:
              gap:2 marginBottom:1; !wpe && Ys>=70 && <KB/>; text col no minWidth;
              !wpe → title + model·path; always stats awaiting/working/completed. */}
          <Box marginBottom={1} gap={2}>
            {!compactHeader && termWidth >= 70 && <Clawd />}
            <Box flexDirection="column">
              {!compactHeader && (
                <>
                  <Text>
                    <Text bold>Claude Code</Text> <Text dimColor>v{MACRO.VERSION}</Text>
                  </Text>
                  <Text dimColor>{[modelDisplay, cwdDisplay].filter(Boolean).join(' \u00b7 ')}</Text>
                </>
              )}
              <Text dimColor>
                {[`${statsBlocked} awaiting input`, `${statsActive} working`, `${statsCompleted} completed`].join(
                  ' \u00b7 ',
                )}
              </Text>
            </Box>
          </Box>

          {/* Empty state (official P9H when Bj empty / every-origin) */}
          {sessions.length === 0 && !error && (
            <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
              <Text dimColor>
                {originSessionPresent
                  ? `${REPL_HINT}${enteredViaLeftArrow ? REPL_HINT_VIA_LEFT_SUFFIX : ''}`
                  : EMPTY_STATE_HINT}
              </Text>
              <Text dimColor>{EMPTY_STATE_EXAMPLES}</Text>
            </Box>
          )}

          {/* Error */}
          {error && (
            <Box marginBottom={1} paddingLeft={1}>
              <Text color={'error' as never}>{error}</Text>
            </Box>
          )}

          {/* Session list — flat rows (state: pinned/review/blocked/working/done; directory: cwd headers) */}
          <Box flexDirection="column" paddingLeft={1}>
            {flatRows.map((row, idx) => {
              const isRowSelected = focusArea === 'list' && idx === selectedIndex;
              // Official pq: skip bg when selection came from mouse hover (jH === index).
              const showSelectionBg = isRowSelected && mouseSelectedIndex !== idx;
              if (row.kind === 'header') {
                const label = groupHeaderLabel(row.group);
                const isFirst = idx === 0;
                const isFolded = foldedGroups.has(row.group);
                const count = groupSessionCount(row.group);
                const stateDesc =
                  (row.group === 'blocked' ||
                    row.group === 'working' ||
                    row.group === 'done' ||
                    row.group === 'review') &&
                  !isFolded &&
                  count > 0
                    ? FLEET_STATE_GROUP_DESCRIPTIONS[row.group as Exclude<FleetStateGroup, 'pinned'>]
                    : '';
                // marginTop only between groups (skip if previous row was same group's job — headers always start group)
                return (
                  <Box key={`h:${row.group}`} flexDirection="column" marginTop={isFirst ? 0 : 1}>
                    <Box
                      backgroundColor={showSelectionBg ? 'userMessageBackground' : undefined}
                      onMouseEnter={() => {
                        selectRowByMouse(idx);
                      }}
                      onClick={() => {
                        selectRowByMouse(idx);
                        if (row.group === 'earlier' && !earlierExpanded) {
                          setEarlierExpanded(true);
                          setFoldedGroups(s => {
                            const n = new Set(s);
                            n.delete('earlier');
                            return n;
                          });
                          return;
                        }
                        setFoldedGroups(s => {
                          const n = new Set(s);
                          if (n.has(row.group)) n.delete(row.group);
                          else n.add(row.group);
                          return n;
                        });
                      }}
                    >
                      <Text
                        bold={isRowSelected}
                        dimColor={!isRowSelected}
                        color={
                          row.group === 'blocked'
                            ? ('warning' as never)
                            : row.group === 'review'
                              ? ('success' as never)
                              : row.group === 'done' && done.some(s => deriveActivity(s) === 'failure')
                                ? ('error' as never)
                                : undefined
                        }
                      >
                        {label}
                        {isFolded ? ` ${count}` : ''}
                        {row.group === 'done' && isFleetPastSessionsEnabled() && count === 0
                          ? ' · looking for past sessions…'
                          : ''}
                        {ungroupConfirmSessionId === `group:${row.group.slice(6)}` && row.group.startsWith('group:')
                          ? ' · ctrl+x again to ungroup'
                          : ''}
                      </Text>
                    </Box>
                    {!!stateDesc && groupMode === 'state' && (
                      <Text dimColor wrap={'truncate' as never}>
                        {stateDesc}
                      </Text>
                    )}
                  </Box>
                );
              }
              if (row.kind === 'fold') {
                return (
                  <Box
                    key={`fold:${row.group}`}
                    paddingLeft={2}
                    backgroundColor={showSelectionBg ? 'userMessageBackground' : undefined}
                    onMouseEnter={() => {
                      selectRowByMouse(idx);
                    }}
                    onClick={() => {
                      selectRowByMouse(idx);
                      if (row.group === 'earlier') {
                        setEarlierExpanded(true);
                        setFoldedGroups(s => {
                          const n = new Set(s);
                          n.delete('earlier');
                          return n;
                        });
                      } else {
                        setDoneCapExpanded(true);
                      }
                    }}
                  >
                    <Text dimColor={!isRowSelected} bold={isRowSelected}>
                      {'\u2026'} {row.hidden} more
                    </Text>
                  </Box>
                );
              }
              const session = row.session;
              return (
                <SessionRow
                  key={`${session.sessionId}-${session.pid}`}
                  session={session}
                  isSelected={isRowSelected}
                  isOrigin={isOriginSession(session)}
                  showSelectionBg={showSelectionBg}
                  isRenaming={viewMode === 'rename' && isRowSelected}
                  isDeletePending={deleteConfirmSessionId === session.sessionId}
                  isUngroupPending={ungroupConfirmSessionId === session.sessionId}
                  renameValue={renameValue}
                  cols={cols}
                  onSelect={() => {
                    selectRowByMouse(idx);
                  }}
                  onOpen={() => {
                    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
                    void checkAndAttach(short, session, onAction, setError);
                  }}
                />
              );
            })}
            {/* Official P9H under list when every visible job is the origin session */}
            {originSessionPresent && sessions.length > 0 && sessions.every(s => isOriginSession(s)) && !error && (
              <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                <Text dimColor>{`${REPL_HINT}${enteredViaLeftArrow ? REPL_HINT_VIA_LEFT_SUFFIX : ''}`}</Text>
                <Text dimColor>{EMPTY_STATE_EXAMPLES}</Text>
              </Box>
            )}
          </Box>
        </Box>

        {/* Bottom: fixed input area */}
        <Box flexShrink={0} flexDirection="column">
          {/* Help overlay (official ? shortcuts) */}
          {helpOpen && (
            <Box paddingLeft={2} flexDirection="column" marginBottom={1}>
              <Text bold>Agents View shortcuts</Text>
              <Text dimColor>enter open · space reply · ctrl+e group · ctrl+s views</Text>
              <Text dimColor>ctrl+t pin · ctrl+r rename · ctrl+x delete/ungroup · a archive</Text>
              <Text dimColor>! bash · @ mention · shift+enter newline · shift+↑↓ reorder · alt+1-9 open</Text>
              <Text dimColor>ctrl+c exit · ? close</Text>
            </Box>
          )}

          {/* Group assign mode */}
          {viewMode === 'group' && (
            <Box paddingLeft={2} flexDirection="column">
              <Box>
                <Text bold>{'group \u276f '}</Text>
                <Text>{groupValue}</Text>
                {!groupValue && <Text dimColor> name (empty = ungroup)</Text>}
              </Box>
            </Box>
          )}

          {/* Reply mode */}
          {viewMode === 'reply' && (
            <Box paddingLeft={2} flexDirection="column">
              <Box>
                <Text bold>{'reply \u276f '}</Text>
                <Text>{replyInput}</Text>
                {!replyInput && <Text dimColor> type a response</Text>}
              </Box>
            </Box>
          )}

          {/* Dispatch input */}
          {viewMode === 'list' && !helpOpen && (
            <Box flexDirection="column">
              {suggestions.length > 0 && focusArea === 'dispatch' && (
                <SuggestionList
                  suggestions={suggestions.map(item => ({
                    id: item.id,
                    displayText: item.displayText,
                    description: item.description ?? '',
                  }))}
                  selectedSuggestion={selectedSuggestion}
                  maxColumnWidth={35}
                  hoveredId={hoveredSuggestion}
                  onHoverChange={setHoveredSuggestion}
                  onSelect={index => {
                    const item = suggestions[index];
                    if (item) {
                      const at = dispatchInput.lastIndexOf('@');
                      if (item.displayText.startsWith('@') && at >= 0) {
                        const next = dispatchInput.slice(0, at) + item.displayText + ' ';
                        setDispatchInput(next);
                        setCursorOffset(next.length);
                      } else {
                        const text = item.displayText + ' ';
                        setDispatchInput(text);
                        setCursorOffset(text.length);
                      }
                      setSuggestions([]);
                    }
                  }}
                />
              )}
              <Box
                borderStyle="round"
                borderLeft={false}
                borderRight={false}
                borderTop={true}
                borderBottom={false}
                borderDimColor
                height={1}
              />
              <LineView
                query={dispatchInput}
                cursorOffset={cursorOffset}
                placeholder={dispatchMode === 'bash' ? 'run a bash command in a new session' : DISPATCH_PLACEHOLDER}
                prefix={dispatchMode === 'bash' ? '!' : '\u276f'}
                prefixDim={focusArea !== 'dispatch'}
                prefixColor={dispatchMode === 'bash' ? 'bashBorder' : undefined}
                isFocused={focusArea === 'dispatch'}
                width="100%"
                borderless
              />
              <Box
                borderStyle="round"
                borderLeft={false}
                borderRight={false}
                borderTop={true}
                borderBottom={false}
                borderDimColor
                height={1}
              />
            </Box>
          )}

          {/* Keyboard hints — official FleetView footer chords */}
          <Box paddingLeft={2} height={1}>
            <Text dimColor wrap={'truncate' as never}>
              {footerHints}
            </Text>
          </Box>
        </Box>
      </Box>
    </AlternateScreen>
  );
}

// ---------------------------------------------------------------------------
// PTY Attach (via daemon control socket — official protocol)
// ---------------------------------------------------------------------------

/**
 * Ensure daemon is running (official: KF / ensureDaemonRunning).
 * Delegates to daemon/installPrompt denser: GPo plan, install Dialog/readline,
 * or in-process bgManager transient spawn.
 */
async function ensureDaemonRunning(opts?: { forceTransient?: boolean }): Promise<{
  ok: boolean;
  reason?: string;
  askInstall?: boolean;
  manager: { close(): Promise<void> } | null;
}> {
  const { ensureDaemonRunning: ensure } = await import('../daemon/installPrompt.js');
  return ensure(opts);
}

async function attachToPtySession(short: string): Promise<{ error?: string }> {
  const { attachToSession } = await import('../daemon/clientAttach.js');
  const { sendControlRequest } = await import('../daemon/controlSocket.js');
  const { listAllJobs } = await import('../daemon/jobState.js');

  // Official flow: try attach → if ENOJOB → respawn → retry attach
  let result = await attachToSession(short, { alreadyInAlt: true });
  let respawned = false;

  if (result.outcome === 'error' && result.msg?.includes('ENOJOB')) {
    // Session not in daemon — respawn it (official: S8_ / respawnJob)
    const jobs = await listAllJobs();
    const job = jobs.find(j => j.short === short || j.state.sessionId === short || j.state.sessionId.startsWith(short));
    if (job) {
      // Official: check if transcript exists before deciding resume vs fresh start
      const { existsSync } = await import('fs');
      const { join } = await import('path');
      const { getProjectDir } = await import('../utils/sessionStorage.js');
      const transcriptPath = join(getProjectDir(job.state.cwd), `${job.state.sessionId}.jsonl`);
      const transcriptExists = existsSync(transcriptPath);

      // Build launch config: resume if transcript exists, fresh prompt otherwise
      const launch = transcriptExists
        ? {
            mode: 'resume' as const,
            sessionId: job.state.sessionId,
            fork: false,
            flagArgs: job.state.respawnFlags ?? [],
          }
        : {
            mode: 'prompt' as const,
            args: job.state.intent ? ['--', job.state.intent] : [],
          };

      const attachShort = job.short || short;
      const resp = await sendControlRequest(
        {
          proto: 1,
          op: 'dispatch',
          d: {
            short: attachShort,
            sessionId: job.state.sessionId,
            intent: job.state.intent,
            source: 'respawn',
            cwd: job.state.cwd,
            launch,
            env: {},
            isolation: 'none',
            respawnFlags: job.state.respawnFlags ?? [],
            cols: process.stdout.columns || 120,
            rows: process.stdout.rows || 30,
          },
          timeoutMs: 10000,
        },
        { timeoutMs: 12000 },
      );

      if (resp.ok) {
        respawned = true;
        // Wait for worker to become available, then retry attach
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 500));
          result = await attachToSession(attachShort, { alreadyInAlt: true });
          if (result.outcome !== 'error' || !result.msg?.includes('ENOJOB')) break;
        }
      } else {
        // After detach/error: restore alt screen for FleetView re-render
        process.stdout.write('\x1B[?1049h\x1B[2J\x1B[H\x1B[r');
        return {
          error: formatAttachError((resp as { error?: string }).error ?? 'respawn failed'),
        };
      }
    }
  }

  // After detach/error: restore alt screen for FleetView re-render
  process.stdout.write('\x1B[?1049h\x1B[2J\x1B[H\x1B[r');

  // Clean detach / disconnect after successful attach — no remount error.
  if (result.outcome === 'detached' || result.outcome === 'disconnected') {
    return {};
  }
  if (result.outcome === 'error') {
    // Official: after respawn retries still ENOJOB → still-starting settle copy.
    if (respawned && result.msg?.includes('ENOJOB')) {
      return { error: 'Session is still starting \u2014 try again in a moment' };
    }
    return { error: formatAttachError(result.msg) };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderAgentView(options?: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
  currentSessionId?: string;
  /** Official CLAUDE_AGENTS_SELECT — pre-select this session on first mount. */
  restoreSessionId?: string;
  /**
   * When true, caller already ran ensureDaemonRunning (e.g. agentsMain) and
   * owns the in-process manager lifecycle. Skip a second ping/cold-start and
   * do not close any manager on exit.
   */
  daemonAlreadyEnsured?: boolean;
}): Promise<void> {
  // Official: applyFleetViewHostWindowsEnv — force full repaint on Windows
  if (getPlatform() === 'windows') {
    process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT ??= '1';
  }

  // Official chO: also accept CLAUDE_AGENTS_SELECT here if not already consumed
  // by agentsMain (in-process remount / left-arrow path).
  let envSelect = process.env.CLAUDE_AGENTS_SELECT;
  if (envSelect) {
    delete process.env.CLAUDE_AGENTS_SELECT;
  }

  // Official KF: ping → GPo cold-start plan → ask_install | in-process transient.
  // CLI agentsMain already ensures before mount — skip dual ensure there.
  let inProcessManager: { close(): Promise<void> } | null = null;
  if (!options?.daemonAlreadyEnsured) {
    const daemon = await ensureDaemonRunning();
    if (!daemon.ok) {
      const msg =
        daemon.reason ??
        "No background daemon is running. Run 'claude daemon install' to set it up as a persistent service.";
      process.stderr.write(`${msg}\n`);
      return;
    }
    inProcessManager = daemon.manager;
  }

  // Track last-selected session so we can restore position after attach.
  // Prefer explicit option, then env select (official initialJobId).
  let lastSelectedSessionId: string | undefined = options?.restoreSessionId ?? envSelect ?? undefined;
  const enteredViaLeftArrow = options?.enteredViaLeftArrow ?? !!(options?.restoreSessionId ?? envSelect);
  // Official J (initialError) — attach failure remounted into FleetView.
  let remountError: string | undefined;

  // Create a Root instance (sync render, no race condition)
  // Official uses a persistent Root that survives across attach/detach cycles
  let root: Root = await createRoot({ exitOnCtrlC: false });

  // Loop: render FleetView → handle action → re-render
  for (;;) {
    const action = await new Promise<
      { type: 'open'; sessionId: string; short: string; logPath?: string } | { type: 'done' }
    >(resolve => {
      // ThemeProvider required: without it useTheme() defaults to 'dark', so
      // selection userMessageBackground paints as rgb(55,55,55) on light terminals.
      root.render(
        <ThemeProvider
          initialState={getGlobalConfig().theme}
          onThemeSave={setting => saveGlobalConfig(current => ({ ...current, theme: setting }))}
        >
          <VoiceProvider>
            <AgentViewApp
              enteredViaLeftArrow={enteredViaLeftArrow}
              dispatchExtraArgs={options?.dispatchExtraArgs}
              cwdFilter={options?.cwdFilter}
              currentSessionId={options?.currentSessionId}
              restoreSessionId={lastSelectedSessionId}
              initialError={remountError}
              onAction={resolve}
            />
          </VoiceProvider>
        </ThemeProvider>,
      );
    });

    // Consume remount error after first paint of this iteration.
    remountError = undefined;

    if (action.type === 'open') {
      // Official: handoffAltScreen prevents unmount from exiting alt screen
      root.handoffAltScreen();
      // Official (Windows only): handoffRawMode prevents unmount from disabling raw mode
      if (getPlatform() === 'windows') {
        root.handoffRawMode();
      }
    }

    root.unmount();

    if (action.type === 'done') break;

    if (action.type === 'open') {
      // Official (Windows only): re-enable raw mode + ref stdin after Ink unmount
      if (getPlatform() === 'windows' && process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.ref();
      }

      lastSelectedSessionId = action.sessionId;
      // Attach to PTY socket (same as official: raw terminal ↔ PTY host)
      const attachResult = await attachToPtySession(action.short);
      // Official: (J = k.msg) on attach_failed / still-starting settle.
      remountError = attachResult.error;
    }

    // Re-create root for next iteration (official: cj_ / createRoot after detach)
    root = await createRoot({ exitOnCtrlC: false });
  }

  // Cleanup in-process bgManager if we started one
  if (inProcessManager) {
    try {
      await inProcessManager.close();
    } catch {
      // ignore close errors on exit path
    }
  }

  // Hard-disable raw mode if still on (Windows handoff / partial teardown).
  // Prevents blank TTY where shell never regains cooked mode after hang.
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
    try {
      process.stdin.unref?.();
    } catch {
      // ignore
    }
  }
}
