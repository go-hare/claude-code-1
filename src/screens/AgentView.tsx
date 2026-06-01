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
import { createRoot, Box, Text, useInput, AlternateScreen } from '@anthropic/ink';
import type { Root } from '@anthropic/ink';
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
  type StatusBand,
} from './fleetView/helpers.js';

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
const REPL_HINT =
  'Press \u2190 to return to your session anytime. Type a task below to dispatch a session alongside it. Sessions keep running even after you close the terminal';

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

/**
 * Send a reply to a blocked session via UDS messaging.
 * The target session's onEnqueue callback will fire, enqueuing the reply
 * as a prompt into its message queue.
 */
async function sendReplyToSession(session: SessionEntry | undefined, text: string): Promise<void> {
  if (!session?.messagingSocketPath) return;
  try {
    const { sendToUdsSocket } = await import('../utils/udsClient.js');
    await sendToUdsSocket(session.messagingSocketPath, text);
  } catch (e) {
    // Best-effort — if UDS fails, the user can still attach and type directly
    const { logForDebugging } = await import('../utils/debug.js');
    logForDebugging(`[agentView] reply failed: ${(e as Error).message}`);
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
  isRenaming,
  isDeletePending,
  renameValue,
  labelWidth,
  onSelect,
  onOpen,
}: {
  session: SessionEntry;
  isSelected: boolean;
  isRenaming: boolean;
  isDeletePending: boolean;
  renameValue: string;
  labelWidth: number;
  onSelect?: () => void;
  onOpen?: () => void;
}): React.ReactElement {
  const band = deriveBand(session);
  const activity = deriveActivity(session);
  const { color, dim } = glyphColor(band, activity, session);
  const icon = pickIcon(band, activity, session.pinned);
  const name = isRenaming ? renameValue : jobLabel(session);
  const age = formatJobAge(session.startedAt);

  // Official: show detail for all bands (active shows last assistant message too)
  let detail = '';
  if (isDeletePending) {
    detail = 'ctrl+x again to delete';
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
    <Box
      width="100%"
      backgroundColor={isSelected ? ('#e8e8e8' as never) : undefined}
      onMouseEnter={onSelect}
      onClick={onOpen}
    >
      {/* Icon + Name column (fixed width) */}
      <Box width={labelWidth + 2} flexShrink={0}>
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
        <Text dimColor wrap={'truncate' as never}>
          {isSelected ? (detail ? `${detail} \u00b7 \u2192 to return` : '\u2192 to return') : detail}
        </Text>
      </Box>
      {/* Age column */}
      <Box flexShrink={0} paddingLeft={2}>
        <Text dimColor>{age}</Text>
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
  onAction,
}: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
  currentSessionId?: string;
  restoreSessionId?: string;
  onAction?: (action: { type: 'open'; sessionId: string; short: string; logPath?: string } | { type: 'done' }) => void;
}): React.ReactElement {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dispatchInput, setDispatchInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [focusArea, setFocusArea] = useState<FocusArea>('list');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [renameValue, setRenameValue] = useState('');
  // Per-group fold state
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(() => new Set());
  const [groupMode, setGroupMode] = useState<'state' | 'directory'>('state');
  const [replyInput, setReplyInput] = useState('');
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string | null>(null);
  const dispatchingRef = useRef(false);
  const lastRelaunchRef = useRef(0);
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
    try {
      // Official W1H: read job state files from ~/.claude/jobs/<short>/state.json
      const jobs = await listAllJobs();

      // Convert to SessionEntry (no stale detection on load — matches official)
      let entries: SessionEntry[] = jobs.map(({ short, state: job }) => ({
        pid: job.pid ?? 0,
        sessionId: job.sessionId,
        cwd: job.cwd,
        startedAt: Date.parse(job.createdAt),
        kind: 'bg',
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
        updatedAt: Date.parse(job.updatedAt),
        engine: 'detached' as const,
        lastMessage: job.detail || undefined,
        waitingFor: job.needs || job.block?.questions?.[0]?.question || undefined,
        pinned: job.pinned,
        gitBranch: job.worktreeBranch,
        prReviewState: undefined, // filled below from children PR status
      }));

      // Fetch PR review status for sessions with children (PR links)
      try {
        const { execFileNoThrow } = await import('../utils/execFileNoThrow.js');
        for (const entry of entries) {
          const job = jobs.find(j => j.state.sessionId === entry.sessionId);
          const children = job?.state.children;
          if (!children?.length) continue;
          for (const child of children) {
            if (!child.href?.includes('/pull/')) continue;
            // Extract PR number from href
            const prMatch = /\/pull\/(\d+)/.exec(child.href);
            if (!prMatch) continue;
            const prNum = prMatch[1];
            const repo = child.href.replace(/\/pull\/\d+.*$/, '').replace(/^https?:\/\/github\.com\//, '');
            try {
              const { stdout, code } = await execFileNoThrow(
                'gh',
                ['pr', 'view', prNum, '--repo', repo, '--json', 'reviewDecision,isDraft,state'],
                { timeout: 3000, preserveOutputOnError: false },
              );
              if (code === 0 && stdout.trim()) {
                const data = JSON.parse(stdout) as { reviewDecision: string; isDraft: boolean; state: string };
                if (data.state === 'OPEN') {
                  entry.prNumber = Number(prNum);
                  entry.prReviewState = data.isDraft
                    ? 'draft'
                    : data.reviewDecision === 'APPROVED'
                      ? 'approved'
                      : data.reviewDecision === 'CHANGES_REQUESTED'
                        ? 'changes_requested'
                        : 'pending';
                }
              }
            } catch {}
            break; // Only check first PR child
          }
        }
      } catch {}

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
            const short = entry.sessionId?.slice(0, 8);
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

      setSessions(sortSessions(entries));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cwdFilter]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
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
  const visibleDone = done;
  const hiddenDoneCount = 0;

  // Flat row list: headers are selectable (official behavior)
  type RowItem =
    | { kind: 'header'; group: string }
    | { kind: 'job'; session: SessionEntry }
    | { kind: 'fold'; hidden: number };
  const flatRows: RowItem[] = React.useMemo(() => {
    const rows: RowItem[] = [];
    if (active.length > 0) {
      rows.push({ kind: 'header', group: 'working' });
      if (!foldedGroups.has('working')) {
        for (const s of active) rows.push({ kind: 'job', session: s });
      }
    }
    if (blocked.length > 0) {
      rows.push({ kind: 'header', group: 'blocked' });
      if (!foldedGroups.has('blocked')) {
        for (const s of blocked) rows.push({ kind: 'job', session: s });
      }
    }
    if (done.length > 0) {
      rows.push({ kind: 'header', group: 'done' });
      if (!foldedGroups.has('done')) {
        for (const s of done) rows.push({ kind: 'job', session: s });
      }
    }
    return rows;
  }, [active, blocked, done, foldedGroups]);

  const currentRow = flatRows[selectedIndex] as RowItem | undefined;
  const selectedSession = currentRow?.kind === 'job' ? currentRow.session : undefined;
  const cwdDisplay = selectedSession?.cwd || getCwd();

  // Compute label column width (max name length across all sessions)
  const labelWidth = Math.max(
    ...sessions.map(s => jobLabel(s).length),
    8, // minimum width
  );

  // Restore selection after returning from an attached session
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !restoreSessionId || flatRows.length === 0) return;
    const idx = flatRows.findIndex(r => r.kind === 'job' && r.session.sessionId === restoreSessionId);
    if (idx >= 0) {
      setSelectedIndex(idx);
      setFocusArea('list');
      restoredRef.current = true;
    }
  }, [flatRows, restoreSessionId]);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= flatRows.length && flatRows.length > 0) {
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

  const handlePin = useCallback(async () => {
    const session = selectedSession;
    if (!session) return;
    const short = session.sessionId?.slice(0, 8) ?? '';
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
    const jobShort = session.sessionId?.slice(0, 8);
    if (jobShort) patchBgJobState(jobShort, { pinned: !session.pinned });
    await refresh();
  }, [sessions, selectedIndex, refresh]);

  const handleRenameStart = useCallback(() => {
    const session = selectedSession;
    if (!session) return;
    setRenameValue(session.name ?? '');
    setViewMode('rename');
  }, [sessions, selectedIndex]);

  const handleRenameConfirm = useCallback(async () => {
    const session = selectedSession;
    if (!session) return;
    const newName = renameValue.trim();
    if (newName) {
      await patchSessionByPid(session.pid, { name: newName });
    }
    setViewMode('list');
    await refresh();
  }, [sessions, selectedIndex, renameValue, refresh]);

  const handleDelete = useCallback(async () => {
    const session = selectedSession;
    if (!session) return;
    const short = session.sessionId?.slice(0, 8);
    if (!short) return;
    await removeJob(short);
    await refresh();
  }, [sessions, selectedIndex, refresh]);

  const handleDeleteAll = useCallback(async () => {
    for (const session of done) {
      const short = session.sessionId?.slice(0, 8);
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
        onActionCb({ type: 'open', sessionId: session.sessionId ?? '', short, logPath: session.logPath });
      }
    },
    [],
  );

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
        void sendReplyToSession(selectedSession, replyInput.trim());
        setReplyInput('');
        setViewMode('list');
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
          setSelectedIndex(Math.max(0, flatRows.length - 1));
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
      setSelectedIndex(i => Math.max(0, i - 1));
      setDeleteConfirmSessionId(null);
    } else if (key.downArrow) {
      if (selectedIndex >= maxVisibleIndex) {
        setFocusArea('dispatch');
      } else {
        setSelectedIndex(i => Math.min(maxVisibleIndex, i + 1));
      }
      setDeleteConfirmSessionId(null);
    } else if (key.tab) {
      setFocusArea('dispatch');
    } else if (key.rightArrow && sessions.length > 0) {
      // Right arrow: attach/resume the selected session
      const session = selectedSession;
      if (session) {
        const short = session.sessionId?.slice(0, 8) ?? '';
        void checkAndAttach(short, session, onAction, setError);
      }
    } else if (key.return && flatRows.length > 0) {
      if (currentRow?.kind === 'fold') {
        setFoldedGroups(s => {
          const n = new Set(s);
          n.delete('done');
          return n;
        });
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
      const session = selectedSession;
      if (session) {
        const short = session.sessionId?.slice(0, 8) ?? '';
        void checkAndAttach(short, session, onAction, setError);
      }
    } else if (input === ' ' && sessions.length > 0) {
      // Space to reply (for blocked sessions)
      const session = selectedSession;
      if (session && deriveBand(session) === 'blocked') {
        setViewMode('reply');
        setReplyInput('');
      }
    } else if (input === 'x' && key.ctrl && sessions.length > 0) {
      const session = selectedSession;
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
    } else if (input === 'f') {
      setFoldedGroups(s => {
        const n = new Set(s);
        if (n.has('done')) n.delete('done');
        else n.add('done');
        return n;
      });
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
  // Directory grouping
  // -------------------------------------------------------------------------

  const cwdGroups = React.useMemo(() => {
    if (groupMode !== 'directory') return null;
    const groups = new Map<string, SessionEntry[]>();
    const currentCwd = getCwd();
    for (const s of sessions) {
      const cwd = s.cwd || currentCwd;
      if (!groups.has(cwd)) groups.set(cwd, []);
      groups.get(cwd)!.push(s);
    }
    // Sort: current CWD first, then alphabetical
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === currentCwd) return -1;
      if (b === currentCwd) return 1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [sessions, groupMode]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const renderSessionRow = (session: SessionEntry) => {
    const index = flatRows.findIndex(r => r.kind === 'job' && r.session === session);
    return (
      <SessionRow
        key={`${session.sessionId}-${session.pid}`}
        session={session}
        isSelected={focusArea === 'list' && index === selectedIndex}
        isRenaming={viewMode === 'rename' && index === selectedIndex}
        isDeletePending={deleteConfirmSessionId === session.sessionId}
        renameValue={renameValue}
        labelWidth={labelWidth}
        onSelect={() => {
          setFocusArea('list');
          setSelectedIndex(index);
        }}
        onOpen={() => {
          const short = session.sessionId?.slice(0, 8) ?? '';
          void checkAndAttach(short, session, onAction, setError);
        }}
      />
    );
  };

  return (
    <AlternateScreen mouseTracking={!process.env.CLAUDE_CODE_DISABLE_MOUSE}>
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
                {blocked.length} awaiting input {'\u00b7'}{' '}
                {review.length > 0 ? `${review.length} in review \u00b7 ` : ''}
                {active.length} working {'\u00b7'} {done.length} completed
              </Text>
            </Box>
          </Box>

          {/* Empty state */}
          {sessions.length === 0 && !error && (
            <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
              <Text>{EMPTY_STATE_HINT}</Text>
              <Text dimColor>{EMPTY_STATE_EXAMPLES}</Text>
            </Box>
          )}

          {/* Error */}
          {error && (
            <Box marginBottom={1} paddingLeft={1}>
              <Text color={'error' as never}>{error}</Text>
            </Box>
          )}

          {/* Session list — state grouping mode */}
          {groupMode === 'state' && (
            <Box flexDirection="column" paddingLeft={1}>
              {flatRows.map((row, idx) => {
                const isRowSelected = focusArea === 'list' && idx === selectedIndex;
                if (row.kind === 'header') {
                  const groupLabels: Record<string, string> = {
                    working: 'Working',
                    blocked: 'Needs input',
                    done: 'Completed',
                  };
                  const label = groupLabels[row.group] ?? row.group;
                  const isFirst = idx === 0;
                  const isFolded = foldedGroups.has(row.group);
                  const count =
                    row.group === 'done' ? done.length : row.group === 'working' ? active.length : blocked.length;
                  return (
                    <Box
                      key={`h:${row.group}`}
                      marginTop={isFirst ? 0 : 1}
                      backgroundColor={isRowSelected ? ('#e8e8e8' as never) : undefined}
                      onMouseEnter={() => {
                        setFocusArea('list');
                        setSelectedIndex(idx);
                      }}
                      onClick={() => {
                        setSelectedIndex(idx);
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
                            : row.group === 'done' && done.some(s => deriveActivity(s) === 'failure')
                              ? ('error' as never)
                              : undefined
                        }
                      >
                        {label}
                        {isFolded ? ` ${count}` : ''}
                      </Text>
                    </Box>
                  );
                }
                if (row.kind === 'fold') {
                  return (
                    <Box
                      key="fold"
                      paddingLeft={2}
                      backgroundColor={isRowSelected ? ('#e8e8e8' as never) : undefined}
                      onMouseEnter={() => {
                        setFocusArea('list');
                        setSelectedIndex(idx);
                      }}
                      onClick={() => {
                        setSelectedIndex(idx);
                        setFoldedGroups(s => {
                          const n = new Set(s);
                          n.delete('done');
                          return n;
                        });
                      }}
                    >
                      <Text dimColor={!isRowSelected} bold={isRowSelected}>
                        {'\u2026'} {row.hidden} more
                      </Text>
                    </Box>
                  );
                }
                return renderSessionRow(row.session);
              })}
            </Box>
          )}

          {/* Session list — directory grouping mode */}
          {groupMode === 'directory' && cwdGroups && (
            <Box flexDirection="column" paddingLeft={1}>
              {cwdGroups.map(([cwd, groupSessions], gi) => (
                <Box key={cwd} flexDirection="column" marginTop={gi > 0 ? 1 : 0}>
                  <Text dimColor>{cwd.replace(process.env.HOME ?? '', '~')}</Text>
                  {groupSessions.map(renderSessionRow)}
                </Box>
              ))}
            </Box>
          )}
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
 * Pings control socket; if unreachable, spawns `claude daemon run --origin transient`.
 */
async function ensureDaemonRunning(): Promise<void> {
  const { sendControlRequest } = await import('../daemon/controlSocket.js');
  const resp = await sendControlRequest({ op: 'ping', proto: 1 }, { timeoutMs: 2000 });
  if (resp.ok) return; // Daemon already running

  // Spawn transient daemon (official: Ay6(["daemon","run","--origin","transient","--spawned-by",...]))
  const { buildCliLaunch, spawnCli } = await import('../utils/cliLaunch.js');
  const { jsonStringify } = await import('../utils/slowOperations.js');
  const spawnedBy = jsonStringify({ label: 'claude agents', cwd: process.cwd(), pid: process.pid });
  const launch = buildCliLaunch(['daemon', 'run', '--origin', 'transient', '--spawned-by', spawnedBy]);
  const child = spawnCli(launch, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: process.cwd(),
  });
  child.unref();

  // Wait for it to become reachable (up to 5s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    const check = await sendControlRequest({ op: 'ping', proto: 1 }, { timeoutMs: 1000 });
    if (check.ok) return;
  }
}

async function attachToPtySession(short: string): Promise<void> {
  const { attachToSession } = await import('../daemon/clientAttach.js');
  const { sendControlRequest } = await import('../daemon/controlSocket.js');
  const { listAllJobs } = await import('../daemon/jobState.js');

  // Official flow: try attach → if ENOJOB → respawn → retry attach
  let result = await attachToSession(short, { alreadyInAlt: true });

  if (result.outcome === 'error' && result.msg?.includes('ENOJOB')) {
    // Session not in daemon — respawn it (official: S8_ / respawnJob)
    const jobs = await listAllJobs();
    const job = jobs.find(j => j.short === short);
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

      const resp = await sendControlRequest(
        {
          proto: 1,
          op: 'dispatch',
          d: {
            short,
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
        // Wait for worker to become available, then retry attach
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 500));
          result = await attachToSession(short, { alreadyInAlt: true });
          if (result.outcome !== 'error' || !result.msg?.includes('ENOJOB')) break;
        }
      }
    }
  }

  // After detach/error: restore alt screen for FleetView re-render
  process.stdout.write('\x1B[?1049h\x1B[2J\x1B[H\x1B[r');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderAgentView(options?: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
  currentSessionId?: string;
}): Promise<void> {
  // Official: applyFleetViewHostWindowsEnv — force full repaint on Windows
  if (getPlatform() === 'windows') {
    process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT ??= '1';
  }

  // Ensure daemon is running (official: KF / ensureDaemonRunning)
  await ensureDaemonRunning();

  // Track last-selected session so we can restore position after attach
  let lastSelectedSessionId: string | undefined;

  // Create a Root instance (sync render, no race condition)
  // Official uses a persistent Root that survives across attach/detach cycles
  let root: Root = await createRoot({ exitOnCtrlC: false });

  // Loop: render FleetView → handle action → re-render
  for (;;) {
    const action = await new Promise<
      { type: 'open'; sessionId: string; short: string; logPath?: string } | { type: 'done' }
    >(resolve => {
      root.render(
        <VoiceProvider>
          <AgentViewApp
            enteredViaLeftArrow={options?.enteredViaLeftArrow}
            dispatchExtraArgs={options?.dispatchExtraArgs}
            cwdFilter={options?.cwdFilter}
            currentSessionId={options?.currentSessionId}
            restoreSessionId={lastSelectedSessionId}
            onAction={resolve}
          />
        </VoiceProvider>,
      );
    });

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
      await attachToPtySession(action.short);
    }

    // Re-create root for next iteration (official: cj_ / createRoot after detach)
    root = await createRoot({ exitOnCtrlC: false });
  }
}
