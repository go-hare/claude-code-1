/**
 * AgentView (FleetView) — Full-screen Ink dashboard for managing background sessions.
 *
 * Upstream equivalent: FleetView (Od_) in the official Claude Code binary.
 *
 * Features:
 * - Session list with status icons, age, branch, PR column
 * - Dispatch input to start new background sessions
 * - Pin (Ctrl+T), Rename (Ctrl+R), Kill (Ctrl+X), Attach (Enter)
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
  glyphColor,
  sortSessions,
  jobLabel,
  formatJobAge,
  pickIcon,
  doneCapForRows,
  parseDispatch,
  parsePrRef,
  buildStateModeFlatRows,
  buildDirectoryModeFlatRows,
  computeFleetColumnWidths,
  sessionArtifactLabel,
  formatAttachError,
  isOriginSessionId,
  FLEET_STATE_GROUP_LABELS,
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
import { getMainLoopModel } from '../utils/model/model.js';
import { getCwd } from '../utils/cwd.js';

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

type ViewMode = 'list' | 'rename' | 'reply';
type FocusArea = 'list' | 'dispatch';

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
  if (isDeletePending) {
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
          dimColor={!isDeletePending}
          color={isDeletePending ? ('error' as never) : undefined}
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
  const [focusArea, setFocusArea] = useState<FocusArea>('list');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [renameValue, setRenameValue] = useState('');
  // Per-group fold state
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(() => new Set());
  /** When true, show all completed rows (past doneCap fold). */
  const [doneCapExpanded, setDoneCapExpanded] = useState(false);
  const [groupMode, setGroupMode] = useState<'state' | 'directory'>('state');
  const [replyInput, setReplyInput] = useState('');
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string | null>(null);
  const dispatchingRef = useRef(false);
  const lastRelaunchRef = useRef(0);
  /** Monotonic refresh generation — stale async passes must not clobber newer results. */
  const refreshGenerationRef = useRef(0);
  /** When a refresh is in flight, a trailing refresh is scheduled after it settles. */
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const [commands, setCommands] = useState<Command[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [hoveredSuggestion, setHoveredSuggestion] = useState<string | null>(null);

  // Auto-focus dispatch when no sessions (skip if we're restoring position)
  useEffect(() => {
    if (sessions.length === 0 && focusArea === 'list' && !restoreSessionId) {
      setFocusArea('dispatch');
    }
  }, [sessions.length, focusArea, restoreSessionId]);

  // Header display values
  const termWidth = process.stdout.columns ?? 80;
  const modelDisplay = getMainLoopModel();

  // -------------------------------------------------------------------------
  // Voice integration (push-to-talk in reply mode)
  // Note: Voice requires VoiceProvider context which is only available in the
  // full REPL tree. In standalone AgentView, voice is not available — users
  // should attach to the session for voice input.
  // -------------------------------------------------------------------------

  // Load commands for dispatch autocomplete
  useEffect(() => {
    void import('../commands.js').then(({ getCommands }) => {
      void getCommands(process.cwd()).then(setCommands);
    });
  }, []);

  // Compute suggestions when dispatch input changes
  useEffect(() => {
    if (focusArea === 'dispatch' && dispatchInput.startsWith('/')) {
      const items = generateCommandSuggestions(dispatchInput, commands);
      setSuggestions(items.slice(0, 8));
      setSelectedSuggestion(0);
    } else {
      setSuggestions([]);
    }
  }, [dispatchInput, commands, focusArea]);

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

  const pinned = sessions.filter(s => s.pinned);
  const unpinned = sessions.filter(s => !s.pinned);
  const blocked = unpinned.filter(s => deriveBand(s) === 'blocked');
  const review = unpinned.filter(s => deriveBand(s) === 'review');
  const active = unpinned.filter(s => deriveBand(s) === 'active');
  const done = unpinned.filter(s => deriveBand(s) === 'completed');
  const doneCap = doneCapForRows(process.stdout.rows || 54);

  // Directory groups (current CWD first) — used for directory-mode flat rows.
  const cwdGroups = React.useMemo(() => {
    if (groupMode !== 'directory') return null;
    const groups = new Map<string, SessionEntry[]>();
    const currentCwd = getCwd();
    for (const s of sessions) {
      const cwd = s.cwd || currentCwd;
      if (!groups.has(cwd)) groups.set(cwd, []);
      groups.get(cwd)!.push(s);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === currentCwd) return -1;
      if (b === currentCwd) return 1;
      return a.localeCompare(b);
    });
  }, [sessions, groupMode]);

  // Flat row list: headers selectable; official state order + doneCap fold.
  const flatRows: FleetFlatRow[] = React.useMemo(() => {
    if (groupMode === 'directory' && cwdGroups) {
      return buildDirectoryModeFlatRows({ groups: cwdGroups, foldedGroups });
    }
    return buildStateModeFlatRows({
      pinned,
      review,
      blocked,
      working: active,
      done,
      foldedGroups,
      doneCap,
      doneCapExpanded,
    });
  }, [groupMode, cwdGroups, pinned, review, blocked, active, done, foldedGroups, doneCap, doneCapExpanded]);

  const currentRow = flatRows[selectedIndex] as FleetFlatRow | undefined;
  const selectedSession = currentRow?.kind === 'job' ? currentRow.session : undefined;
  const cwdDisplay = selectedSession?.cwd || getCwd();

  const groupSessionCount = (group: string): number => {
    if (group === 'pinned') return pinned.length;
    if (group === 'review') return review.length;
    if (group === 'blocked') return blocked.length;
    if (group === 'working') return active.length;
    if (group === 'done') return done.length;
    if (group.startsWith('dir:')) {
      const cwd = group.slice(4);
      return cwdGroups?.find(([c]) => c === cwd)?.[1].length ?? 0;
    }
    return 0;
  };

  const groupHeaderLabel = (group: string): string => {
    if (group in FLEET_STATE_GROUP_LABELS) {
      return FLEET_STATE_GROUP_LABELS[group as FleetStateGroup];
    }
    if (group.startsWith('dir:')) {
      const cwd = group.slice(4);
      return cwd.replace(process.env.HOME ?? '', '~');
    }
    return group;
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
    const prompt = dispatchInput.trim();
    if (!prompt || dispatchingRef.current) return;
    dispatchingRef.current = true;
    try {
      await submitDispatch({
        intent: prompt,
        cwd: getCwd(),
        extraArgs: dispatchExtraArgs,
        source: 'fleet',
      });
      setDispatchInput('');
      await refresh();
    } finally {
      dispatchingRef.current = false;
    }
  }, [dispatchInput, refresh, dispatchExtraArgs]);

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

    // Dispatch input handling (with cursor support)
    if (focusArea === 'dispatch') {
      if (key.return && dispatchInput.trim()) {
        void handleDispatch();
        return;
      }
      if (key.escape) {
        if (dispatchInput) {
          setDispatchInput('');
          setCursorOffset(0);
        } else if (sessions.length > 0) {
          setFocusArea('list');
        } else {
          process.exit(0);
        }
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
            const text = selected.displayText + ' ';
            setDispatchInput(text);
            setCursorOffset(text.length);
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
      setDeleteConfirmSessionId(null);
    } else if (key.downArrow) {
      if (selectedIndex >= maxVisibleIndex) {
        setFocusArea('dispatch');
        setMouseSelectedIndex(null);
      } else {
        selectRowByKeyboard(i => Math.min(maxVisibleIndex, i + 1));
      }
      setDeleteConfirmSessionId(null);
    } else if (key.tab) {
      setFocusArea('dispatch');
      setMouseSelectedIndex(null);
    } else if (key.rightArrow && sessions.length > 0) {
      // Right arrow: attach/resume the selected session
      const session = getSelectedSession();
      if (session) {
        const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
        void checkAndAttach(short, session, onAction, setError);
      }
    } else if (key.return && flatRows.length > 0) {
      if (currentRow?.kind === 'fold') {
        // Official fold expand: show all completed rows past doneCap.
        setDoneCapExpanded(true);
        return;
      }
      if (currentRow?.kind === 'header') {
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
        setViewMode('reply');
        setReplyInput('');
      }
    } else if (input === 'x' && key.ctrl && sessions.length > 0) {
      const session = getSelectedSession();
      if (session && deleteConfirmSessionId === session.sessionId) {
        // Second press — actually delete
        setDeleteConfirmSessionId(null);
        void handleDelete();
      } else if (session) {
        // First press — mark for confirmation
        setDeleteConfirmSessionId(session.sessionId);
      }
    } else if (input === 't' && key.ctrl) {
      void handlePin();
    } else if (input === 'r' && key.ctrl) {
      handleRenameStart();
    } else if (input === 's' && key.ctrl) {
      setGroupMode(m => (m === 'state' ? 'directory' : 'state'));
      setDoneCapExpanded(false);
      // Clear mouse-hover selection so keyboard bg paints after mode switch.
      selectRowByKeyboard(0);
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
      process.exit(0);
    } else if (input && !key.ctrl && !key.meta && input !== 'q' && input !== 'f') {
      // Auto-switch to dispatch on any printable char
      setFocusArea('dispatch');
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
          const { isMouseTrackingEnabled } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../utils/fullscreen.js') as typeof import('../utils/fullscreen.js');
          return isMouseTrackingEnabled();
        } catch {
          return !process.env.CLAUDE_CODE_DISABLE_MOUSE;
        }
      })()}
    >
      <Box flexDirection="column" flexGrow={1}>
        {/* Top: scrollable list area */}
        <Box flexDirection="column" flexGrow={1} paddingTop={1}>
          {/* Header */}
          <Box marginBottom={1} gap={2} paddingLeft={1}>
            {termWidth >= 70 && <Clawd />}
            <Box flexDirection="column">
              <Text>
                <Text bold>Claude Code</Text> <Text dimColor>v{MACRO.VERSION}</Text>
              </Text>
              <Text dimColor>{[modelDisplay, cwdDisplay].filter(Boolean).join(' \u00b7 ')}</Text>
              <Text dimColor>
                {[
                  pinned.length > 0 ? `${pinned.length} pinned` : null,
                  `${blocked.length} awaiting input`,
                  review.length > 0 ? `${review.length} ready for review` : null,
                  `${active.length} working`,
                  `${done.length} completed`,
                ]
                  .filter(Boolean)
                  .join(' \u00b7 ')}
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
                // marginTop only between groups (skip if previous row was same group's job — headers always start group)
                return (
                  <Box
                    key={`h:${row.group}`}
                    marginTop={isFirst ? 0 : 1}
                    backgroundColor={showSelectionBg ? 'userMessageBackground' : undefined}
                    onMouseEnter={() => {
                      selectRowByMouse(idx);
                    }}
                    onClick={() => {
                      selectRowByMouse(idx);
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
                    </Text>
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
                      setDoneCapExpanded(true);
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
          {viewMode === 'list' && (
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
                      const text = item.displayText + ' ';
                      setDispatchInput(text);
                      setCursorOffset(text.length);
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
                placeholder="start a task in the background"
                prefix={'\u276f'}
                prefixDim={focusArea !== 'dispatch'}
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

          {/* Keyboard hints */}
          <Box paddingLeft={2} height={1}>
            <Text dimColor>
              {focusArea === 'dispatch'
                ? done.length > 0
                  ? 'ctrl+x to delete all \u00b7 ? for shortcuts'
                  : '\u2191\u2193 navigate \u00b7 enter dispatch \u00b7 tab switch'
                : deleteConfirmSessionId
                  ? 'ctrl+x to confirm'
                  : currentRow?.kind === 'fold'
                    ? 'enter to show all \u00b7 ? for shortcuts'
                    : currentRow?.kind === 'header'
                      ? `enter to ${currentRow?.kind === 'header' && foldedGroups.has(currentRow.group) ? 'expand' : 'collapse'} \u00b7 ctrl+x to delete all \u00b7 ? for shortcuts`
                      : selectedSession && deriveBand(selectedSession) === 'completed'
                        ? 'enter to collapse \u00b7 ctrl+x to delete \u00b7 ? for shortcuts'
                        : 'enter to resume \u00b7 space to reply \u00b7 ctrl+x to delete \u00b7 ? for shortcuts'}
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
    await inProcessManager.close();
  }
}
