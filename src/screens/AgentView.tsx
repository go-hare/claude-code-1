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
import { wrappedRender as render, Box, Text, useInput } from '@anthropic/ink';
import { listLiveSessions, handleBgStart, attachHandler, killHandler } from '../cli/bg.js';
import type { SessionEntry } from '../cli/bg/engine.js';
import { patchSessionByPid } from '../utils/concurrentSessions.js';
import { submitDispatch } from '../daemon/bgManager.js';
import { listAllJobs, type BgJobState } from '../daemon/jobState.js';
import { VoiceProvider } from '../context/voice.js';
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
// PR auto-detection (rate-limited)
// ---------------------------------------------------------------------------

const prCheckCache = new Map<number, number>(); // pid -> last check timestamp
const PR_CHECK_INTERVAL_MS = 60_000; // Only check once per minute per session

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

type ViewMode = 'list' | 'rename' | 'reply' | 'delete-confirm';
type FocusArea = 'list' | 'dispatch';

// ---------------------------------------------------------------------------
// Session row component
// ---------------------------------------------------------------------------

function SessionRow({
  session,
  isSelected,
  isRenaming,
  renameValue,
  labelWidth,
  onSelect,
  onOpen,
}: {
  session: SessionEntry;
  isSelected: boolean;
  isRenaming: boolean;
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

  // Detail: show waitingFor or last message from the session
  const detail = session.waitingFor ?? session.lastMessage ?? '';

  return (
    <Box
      width="100%"
      backgroundColor={isSelected ? ('secondaryBg' as never) : undefined}
      onMouseEnter={onSelect}
      onClick={onOpen}
    >
      {/* Icon + Name column (fixed width) */}
      <Box width={labelWidth + 2} flexShrink={0}>
        <Text color={(color ?? undefined) as never} dimColor={dim && !isSelected} wrap={'truncate' as never}>
          {icon}{' '}
          <Text bold={isSelected} dimColor={!isSelected && dim}>
            {name}
          </Text>
        </Text>
      </Box>
      {/* Detail column (flex) */}
      <Box flexGrow={1} width={0} paddingLeft={2}>
        <Text dimColor wrap={'truncate' as never}>
          {detail}
          {isSelected && band === 'blocked' ? ` \u00b7 \u2192` : ''}
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
  onAction,
}: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
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
  const [folded, setFolded] = useState(true);
  const [replyInput, setReplyInput] = useState('');
  const dispatchingRef = useRef(false);
  const lastRelaunchRef = useRef(0);
  const [commands, setCommands] = useState<Command[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [hoveredSuggestion, setHoveredSuggestion] = useState<string | null>(null);

  // Auto-focus dispatch when no sessions
  useEffect(() => {
    if (sessions.length === 0 && focusArea === 'list') {
      setFocusArea('dispatch');
    }
  }, [sessions.length, focusArea]);

  // Header display values
  const termWidth = process.stdout.columns ?? 80;
  const modelDisplay = getMainLoopModel();
  const cwdDisplay = getCwd();

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
      let live = await listLiveSessions();

      // Merge job state entries (sessions managed by bg manager)
      const jobs = await listAllJobs();
      for (const { short, state: job } of jobs) {
        // Skip jobs that already appear in live sessions (by sessionId)
        if (live.some(s => s.sessionId === job.sessionId)) continue;
        // Convert job state to SessionEntry for display
        live.push({
          pid: 0,
          sessionId: job.sessionId,
          cwd: job.cwd,
          startedAt: Date.parse(job.createdAt),
          kind: 'bg',
          name: job.name,
          status: job.state === 'working' ? 'busy' : job.state === 'blocked' ? 'waiting' : job.state,
          updatedAt: Date.parse(job.updatedAt),
          engine: 'detached',
          lastMessage: job.detail || undefined,
        });
      }

      // Filter by cwd if specified (--cwd flag)
      if (cwdFilter) {
        const normalized = cwdFilter.replace(/\\/g, '/').toLowerCase();
        live = live.filter(s => s.cwd?.replace(/\\/g, '/').toLowerCase().startsWith(normalized));
      }

      setSessions(sortSessions(live));

      // PR auto-detection: for sessions with gitBranch but no prNumber,
      // try to detect PR (rate-limited, fire-and-forget)
      for (const session of live) {
        if (session.gitBranch && !session.prNumber && session.status === 'running') {
          void detectPrForSession(session);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cwdFilter]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= sessions.length && sessions.length > 0) {
      setSelectedIndex(sessions.length - 1);
    }
  }, [sessions.length, selectedIndex]);

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

  const blocked = sessions.filter(s => deriveBand(s) === 'blocked');
  const active = sessions.filter(s => deriveBand(s) === 'active');
  const done = sessions.filter(s => deriveBand(s) === 'completed');
  const doneCap = doneCapForRows(sessions.length);
  const visibleDone = folded ? done.slice(0, doneCap) : done;
  const hiddenDoneCount = folded ? Math.max(0, done.length - doneCap) : 0;

  // Compute label column width (max name length across all sessions)
  const labelWidth = Math.max(
    ...sessions.map(s => jobLabel(s).length),
    8, // minimum width
  );

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
    const session = sessions[selectedIndex];
    if (!session) return;
    await patchSessionByPid(session.pid, { pinned: !session.pinned });
    await refresh();
  }, [sessions, selectedIndex, refresh]);

  const handleRenameStart = useCallback(() => {
    const session = sessions[selectedIndex];
    if (!session) return;
    setRenameValue(session.name ?? '');
    setViewMode('rename');
  }, [sessions, selectedIndex]);

  const handleRenameConfirm = useCallback(async () => {
    const session = sessions[selectedIndex];
    if (!session) return;
    const newName = renameValue.trim();
    if (newName) {
      await patchSessionByPid(session.pid, { name: newName });
    }
    setViewMode('list');
    await refresh();
  }, [sessions, selectedIndex, renameValue, refresh]);

  const handleDelete = useCallback(async () => {
    const session = sessions[selectedIndex];
    if (!session) return;
    await killHandler(session.name ?? String(session.pid));
    await refresh();
    setViewMode('list');
  }, [sessions, selectedIndex, refresh]);

  const handleDeleteAll = useCallback(async () => {
    for (const session of done) {
      await killHandler(session.name ?? String(session.pid));
    }
    await refresh();
    setViewMode('list');
  }, [done, refresh]);

  // -------------------------------------------------------------------------
  // Attach pre-check (verify PTY socket before exiting fleet view)
  // -------------------------------------------------------------------------

  const checkAndAttach = useCallback(
    async (short: string, session: SessionEntry, onActionCb: typeof onAction, setErr: (msg: string | null) => void) => {
      const net = require('net') as typeof import('net');
      const { join } = require('path') as typeof import('path');
      const { getClaudeConfigHomeDir } = require('../utils/envUtils.js') as typeof import('../utils/envUtils.js');

      let sockPath: string;
      if (process.platform === 'win32') {
        const user = process.env.USERNAME || process.env.USER || 'default';
        sockPath = `//./pipe/cc-pty-${user}-${short}`;
      } else {
        sockPath = join(getClaudeConfigHomeDir(), 'daemon', 'bg', 'pty', `${short}.sock`);
      }

      // Probe socket with retries (PTY host may be starting)
      let alive = false;
      for (let i = 0; i < 6; i++) {
        alive = await new Promise<boolean>(resolve => {
          const probe = new net.Socket();
          probe.on('error', () => resolve(false));
          probe.on('connect', () => {
            probe.destroy();
            resolve(true);
          });
          probe.connect(sockPath);
        });
        if (alive) break;
        await new Promise(r => setTimeout(r, [50, 100, 250, 500, 1000, 2000][i]));
      }

      if (alive) {
        if (onActionCb) {
          onActionCb({ type: 'open', sessionId: session.sessionId ?? '', short, logPath: session.logPath });
        }
        return;
      }

      // Session not reachable — try respawn via daemon
      try {
        const { sendControlRequest, isDaemonReachable } =
          require('../daemon/controlSocket.js') as typeof import('../daemon/controlSocket.js');
        const daemonUp = await isDaemonReachable();
        if (daemonUp) {
          const resp = await sendControlRequest(
            {
              op: 'dispatch',
              short,
              sessionId: session.sessionId ?? randomUUID(),
              intent: session.name ?? '',
              name: session.name ?? short,
              cwd: session.cwd ?? process.cwd(),
              respawnFlags: ['--resume', session.sessionId ?? ''],
              source: 'fleet_respawn',
              createdAt: Date.now(),
            },
            { timeoutMs: 5000 },
          );

          if (resp.ok) {
            // Wait for PTY to come up after respawn
            for (let i = 0; i < 8; i++) {
              await new Promise(r => setTimeout(r, [100, 200, 500, 500, 1000, 1000, 2000, 2000][i]));
              alive = await new Promise<boolean>(resolve => {
                const probe = new net.Socket();
                probe.on('error', () => resolve(false));
                probe.on('connect', () => {
                  probe.destroy();
                  resolve(true);
                });
                probe.connect(sockPath);
              });
              if (alive) break;
            }
            if (alive && onActionCb) {
              onActionCb({ type: 'open', sessionId: session.sessionId ?? '', short, logPath: session.logPath });
              return;
            }
          }
        }
      } catch {
        // Daemon not available — fall through to error
      }

      setErr('Session not reachable \u2014 it may have already exited');
      setTimeout(() => setErr(null), 3000);
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
        void sendReplyToSession(sessions[selectedIndex], replyInput.trim());
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

    // Delete confirmation
    if (viewMode === 'delete-confirm') {
      if (key.escape || input === 'n') {
        setViewMode('list');
        return;
      }
      if (input === 'y') {
        void handleDelete();
        return;
      }
      if (input === 'a') {
        void handleDeleteAll();
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
          setSelectedIndex(sessions.length - 1);
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
      if (input && !key.ctrl && !key.meta) {
        setDispatchInput(v => v.slice(0, cursorOffset) + input + v.slice(cursorOffset));
        setCursorOffset(o => o + input.length);
        return;
      }
      return;
    }

    // List navigation
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      if (selectedIndex >= sessions.length - 1) {
        setFocusArea('dispatch');
      } else {
        setSelectedIndex(i => Math.min(sessions.length - 1, i + 1));
      }
    } else if (key.tab) {
      setFocusArea('dispatch');
    } else if (key.return && sessions.length > 0) {
      const session = sessions[selectedIndex];
      if (session) {
        const short = session.sessionId?.slice(0, 8) ?? '';
        const band = deriveBand(session);
        if (band === 'completed') {
          // Completed sessions can't be attached — show inline error
          setError('That session ended \u2014 back to the list');
          setTimeout(() => setError(null), 3000);
        } else {
          // Check if PTY socket is reachable before exiting fleet view
          void checkAndAttach(short, session, onAction, setError);
        }
      }
    } else if (input === ' ' && sessions.length > 0) {
      // Space to reply (for blocked sessions)
      const session = sessions[selectedIndex];
      if (session && deriveBand(session) === 'blocked') {
        setViewMode('reply');
        setReplyInput('');
      }
    } else if (input === 'x' && key.ctrl && sessions.length > 0) {
      setViewMode('delete-confirm');
    } else if (input === 't' && key.ctrl) {
      void handlePin();
    } else if (input === 'r' && key.ctrl) {
      handleRenameStart();
    } else if (input === 'f') {
      setFolded(f => !f);
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
    <Box flexDirection="column" padding={1} height="100%">
      {/* Header */}
      <Box marginBottom={1} gap={2}>
        {termWidth >= 70 && <Clawd />}
        <Box flexDirection="column">
          <Text>
            <Text bold>Claude Code</Text> <Text dimColor>v{MACRO.VERSION}</Text>
          </Text>
          <Text dimColor>{[modelDisplay, cwdDisplay].filter(Boolean).join(' \u00b7 ')}</Text>
          <Text dimColor>
            {blocked.length} awaiting input {'\u00b7'} {active.length} working {'\u00b7'} {done.length} completed
          </Text>
        </Box>
      </Box>

      {/* Empty state */}
      {sessions.length === 0 && !error && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{EMPTY_STATE_HINT}</Text>
          <Text dimColor>{EMPTY_STATE_EXAMPLES}</Text>
        </Box>
      )}

      {/* Error */}
      {error && (
        <Box marginBottom={1}>
          <Text color={'error' as never}>{error}</Text>
        </Box>
      )}

      {/* Session list — grouped by status */}
      {blocked.length > 0 && (
        <Box flexDirection="column">
          <Text color={'warning' as never}>Needs input</Text>
          {blocked.map(session => {
            const index = sessions.indexOf(session);
            return (
              <SessionRow
                key={session.pid}
                session={session}
                isSelected={focusArea === 'list' && index === selectedIndex}
                isRenaming={viewMode === 'rename' && index === selectedIndex}
                renameValue={renameValue}
                labelWidth={labelWidth}
                onSelect={() => {
                  setFocusArea('list');
                  setSelectedIndex(index);
                }}
                onOpen={() => void attachHandler(session.name ?? String(session.pid))}
              />
            );
          })}
        </Box>
      )}
      {active.length > 0 && (
        <Box flexDirection="column" marginTop={blocked.length > 0 ? 1 : 0}>
          <Text dimColor>Working</Text>
          {active.map(session => {
            const index = sessions.indexOf(session);
            return (
              <SessionRow
                key={session.pid}
                session={session}
                isSelected={focusArea === 'list' && index === selectedIndex}
                isRenaming={viewMode === 'rename' && index === selectedIndex}
                renameValue={renameValue}
                labelWidth={labelWidth}
                onSelect={() => {
                  setFocusArea('list');
                  setSelectedIndex(index);
                }}
                onOpen={() => void attachHandler(session.name ?? String(session.pid))}
              />
            );
          })}
        </Box>
      )}
      {done.length > 0 && (
        <Box flexDirection="column" marginTop={blocked.length > 0 || active.length > 0 ? 1 : 0}>
          <Text dimColor>Completed</Text>
          {visibleDone.map(session => {
            const index = sessions.indexOf(session);
            return (
              <SessionRow
                key={session.pid}
                session={session}
                isSelected={focusArea === 'list' && index === selectedIndex}
                isRenaming={viewMode === 'rename' && index === selectedIndex}
                renameValue={renameValue}
                labelWidth={labelWidth}
                onSelect={() => {
                  setFocusArea('list');
                  setSelectedIndex(index);
                }}
                onOpen={() => void attachHandler(session.name ?? String(session.pid))}
              />
            );
          })}
        </Box>
      )}

      {/* Fold indicator */}
      {hiddenDoneCount > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {'\u2026'} {hiddenDoneCount} more completed (press f to show all)
          </Text>
        </Box>
      )}

      {/* Spacer to push input to bottom */}
      <Box flexGrow={1} />

      {/* Reply mode */}
      {viewMode === 'reply' && (
        <Box marginTop={1} paddingLeft={1} flexDirection="column">
          <Box>
            <Text bold>{'reply \u276f '}</Text>
            <Text>{replyInput}</Text>
            {!replyInput && voice.state === 'idle' && (
              <Text dimColor> type a response{voiceEnabled ? ' or hold space to speak' : ''}</Text>
            )}
            {voice.state === 'recording' && <Text color={'warning' as never}> \ud83c\udfa4 recording...</Text>}
            {voice.state === 'processing' && <Text dimColor> transcribing...</Text>}
          </Box>
        </Box>
      )}

      {/* Delete confirmation */}
      {viewMode === 'delete-confirm' && (
        <Box marginTop={1} paddingLeft={1}>
          <Text>Delete session? </Text>
          <Text dimColor>{'(y)es \u00b7 delete (a)ll done \u00b7 (n)o'}</Text>
        </Box>
      )}

      {/* Dispatch input — pinned to bottom */}
      {viewMode === 'list' && (
        <Box flexDirection="column">
          {/* Suggestions above input */}
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
          {/* Separator */}
          <Box
            borderStyle="round"
            borderLeft={false}
            borderRight={false}
            borderTop={true}
            borderBottom={false}
            borderDimColor
            height={1}
          />
          {/* Input line */}
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
          {/* Bottom separator */}
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
      <Box paddingLeft={1}>
        <Text dimColor>
          {viewMode === 'rename'
            ? 'enter save \u00b7 escape cancel'
            : viewMode === 'reply'
              ? 'enter send \u00b7 escape cancel'
              : focusArea === 'list'
                ? 'enter to open \u00b7 space to reply \u00b7 ctrl+x to delete \u00b7 ? for shortcuts'
                : '\u2191\u2193 navigate \u00b7 enter attach/reply \u00b7 ctrl+x delete \u00b7 ctrl+t pin \u00b7 ctrl+r rename \u00b7 f fold \u00b7 tab switch'}
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PTY Attach (connects to PTY host socket, raw terminal I/O)
// ---------------------------------------------------------------------------

const PTY_DATA_FRAME = 0x01;
const PTY_CTRL_FRAME = 0x02;
const PTY_HEADER_SIZE = 5;

function encodePtyDataFrame(data: Buffer): Buffer {
  const header = Buffer.alloc(PTY_HEADER_SIZE);
  header[0] = PTY_DATA_FRAME;
  header.writeUInt32LE(data.length, 1);
  return Buffer.concat([header, data]);
}

function encodePtyCtrlFrame(msg: Record<string, unknown>): Buffer {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8');
  const header = Buffer.alloc(PTY_HEADER_SIZE);
  header[0] = PTY_CTRL_FRAME;
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

const RETRY_DELAYS = [50, 100, 250, 500, 1000, 2000];
const MAX_RETRIES = 30;

async function attachToPtySession(short: string): Promise<void> {
  const net = require('net') as typeof import('net');
  const { getClaudeConfigHomeDir } = require('../utils/envUtils.js') as typeof import('../utils/envUtils.js');
  const { join } = require('path') as typeof import('path');

  let sockPath: string;
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER || 'default';
    sockPath = `//./pipe/cc-pty-${user}-${short}`;
  } else {
    sockPath = join(getClaudeConfigHomeDir(), 'daemon', 'bg', 'pty', `${short}.sock`);
  }

  // Retry connect with backoff (matches official py6 logic)
  let attempt = 0;
  const tryConnect = (): Promise<import('net').Socket | null> => {
    return new Promise(resolve => {
      const sock = new net.Socket();
      sock.on('error', () => resolve(null));
      sock.on('connect', () => resolve(sock));
      sock.connect(sockPath);
    });
  };

  let sock: import('net').Socket | null = null;
  while (attempt < MAX_RETRIES) {
    sock = await tryConnect();
    if (sock) break;
    const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]!;
    await new Promise(r => setTimeout(r, delay));
    attempt++;
  }

  if (!sock) return; // Can't connect — silently return to fleet view

  // Connected — enter raw terminal mode
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  await new Promise<void>(resolve => {
    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeAllListeners('data');
      process.stdout.removeAllListeners('resize');
      resolve();
    };

    sock!.on('error', cleanup);
    sock!.on('close', cleanup);

    // Forward stdin → PTY host
    process.stdin.on('data', (raw: Buffer | string) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (chunk.length === 1 && chunk[0] === 0x1a) {
        sock!.destroy();
        return;
      }
      if (!sock!.destroyed) {
        sock!.write(encodePtyDataFrame(chunk));
      }
    });

    // Resize
    const onResize = () => {
      if (!sock!.destroyed) {
        sock!.write(
          encodePtyCtrlFrame({
            t: 'resize',
            cols: process.stdout.columns,
            rows: process.stdout.rows,
          }),
        );
      }
    };
    process.stdout.on('resize', onResize);
    onResize();

    // Parse incoming frames
    let buf: Buffer<ArrayBuffer> = Buffer.alloc(0);
    sock!.on('data', (chunk: Buffer<ArrayBuffer>) => {
      buf = buf.length ? (Buffer.concat([buf, chunk]) as Buffer<ArrayBuffer>) : chunk;
      while (buf.length >= PTY_HEADER_SIZE) {
        const type = buf[0];
        const len = buf.readUInt32LE(1);
        if (buf.length < PTY_HEADER_SIZE + len) break;
        const payload = buf.subarray(PTY_HEADER_SIZE, PTY_HEADER_SIZE + len);
        buf = buf.subarray(PTY_HEADER_SIZE + len);

        if (type === PTY_DATA_FRAME) {
          process.stdout.write(payload);
        } else if (type === PTY_CTRL_FRAME) {
          try {
            const msg = JSON.parse(payload.toString()) as Record<string, unknown>;
            if (msg.t === 'exit') {
              const code = msg.code as number;
              const status = code === 0 ? 'done' : `exited (${code})`;
              process.stdout.write(`\r\n\x1b[2m\u2014 ${status} \xb7 Ctrl+Z to return \u2014\x1b[0m\r\n`);
            }
          } catch {}
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderAgentView(options?: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
}): Promise<void> {
  // Loop: render FleetView → handle action → re-render
  for (;;) {
    let instance: Awaited<ReturnType<typeof render>> | null = null;

    const action = await new Promise<
      { type: 'open'; sessionId: string; short: string; logPath?: string } | { type: 'done' }
    >(resolve => {
      void render(
        <VoiceProvider>
          <AgentViewApp
            enteredViaLeftArrow={options?.enteredViaLeftArrow}
            dispatchExtraArgs={options?.dispatchExtraArgs}
            cwdFilter={options?.cwdFilter}
            onAction={resolve}
          />
        </VoiceProvider>,
      ).then(inst => {
        instance = inst;
      });
    });

    // Unmount Ink before doing anything else
    if (instance) {
      (instance as { unmount: () => void }).unmount();
    }

    if (action.type === 'done') break;

    if (action.type === 'open') {
      // Attach to PTY socket (same as official: raw terminal ↔ PTY host)
      await attachToPtySession(action.short);
    }
  }
}
