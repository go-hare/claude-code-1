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
import { feature } from 'bun:bundle';
import { wrappedRender as render, Box, Text, useInput } from '@anthropic/ink';
import { listLiveSessions, handleBgStart, attachHandler, killHandler } from '../cli/bg.js';
import type { SessionEntry } from '../cli/bg/engine.js';
import { patchSessionByPid } from '../utils/concurrentSessions.js';
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
}: {
  session: SessionEntry;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
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
    <Box paddingLeft={1} width="100%" backgroundColor={isSelected ? ('secondaryBg' as never) : undefined}>
      <Text color={(color ?? undefined) as never} dimColor={dim && !isSelected}>
        {icon}{' '}
      </Text>
      <Text bold={isSelected}>{name}</Text>
      {detail && (
        <Text dimColor={!isSelected}>
          {'  '}
          {detail}
        </Text>
      )}
      {isSelected && band === 'blocked' && <Text dimColor>{' \u00b7 \u2192'}</Text>}
      <Box flexGrow={1} />
      <Text dimColor={!isSelected}>{age}</Text>
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
}: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
}): React.ReactElement {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dispatchInput, setDispatchInput] = useState('');
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

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleDispatch = useCallback(async () => {
    const prompt = dispatchInput.trim();
    if (!prompt || dispatchingRef.current) return;
    dispatchingRef.current = true;
    try {
      const args = ['-p', prompt, ...dispatchExtraArgs];
      await handleBgStart(args);
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

    // Dispatch input handling
    if (focusArea === 'dispatch') {
      if (key.return && dispatchInput.trim()) {
        void handleDispatch();
        return;
      }
      if (key.escape && !dispatchInput) {
        process.exit(0);
        return;
      }
      if (key.escape && dispatchInput) {
        setDispatchInput('');
        return;
      }
      if (key.backspace || key.delete) {
        setDispatchInput(v => v.slice(0, -1));
        return;
      }
      if (key.tab) {
        if (suggestions.length > 0) {
          const selected = suggestions[selectedSuggestion];
          if (selected) {
            setDispatchInput(selected.displayText + ' ');
            setSuggestions([]);
          }
          return;
        }
        if (sessions.length > 0) setFocusArea('list');
        return;
      }
      if (key.upArrow && sessions.length > 0) {
        if (suggestions.length > 0) {
          setSelectedSuggestion(i => Math.max(0, i - 1));
          return;
        }
        setFocusArea('list');
        setSelectedIndex(sessions.length - 1);
        return;
      }
      if (key.downArrow && suggestions.length > 0) {
        setSelectedSuggestion(i => Math.min(suggestions.length - 1, i + 1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setDispatchInput(v => v + input);
        return;
      }
      if (input === 'q' && !dispatchInput) {
        process.exit(0);
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
        void attachHandler(session.name ?? String(session.pid));
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
    }
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Box flexDirection="column" padding={1}>
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

      {/* Dispatch input — always at bottom */}
      {viewMode === 'list' && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor={focusArea !== 'dispatch'}>{'\u276f '}</Text>
            {dispatchInput ? (
              <Text>{dispatchInput}</Text>
            ) : (
              <Text dimColor>
                {focusArea === 'dispatch' ? 'start a task in the background' : 'start a task in the background'}
              </Text>
            )}
          </Box>
          {/* Autocomplete suggestions */}
          {suggestions.length > 0 && focusArea === 'dispatch' && (
            <Box flexDirection="column" paddingLeft={2}>
              {suggestions.map((item, i) => (
                <Box key={item.id}>
                  <Text inverse={i === selectedSuggestion}>{item.displayText}</Text>
                  {item.description && <Text dimColor> {item.description.slice(0, 50)}</Text>}
                </Box>
              ))}
              <Text dimColor>{'tab accept \u00b7 \u2191\u2193 navigate'}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Keyboard hints */}
      <Box marginTop={1}>
        <Text dimColor>
          {viewMode === 'rename'
            ? 'enter save \u00b7 escape cancel'
            : viewMode === 'reply'
              ? 'enter send \u00b7 escape cancel'
              : '\u2191\u2193 navigate \u00b7 enter attach/reply \u00b7 ctrl+x delete \u00b7 ctrl+t pin \u00b7 ctrl+r rename \u00b7 f fold \u00b7 tab switch'}
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderAgentView(options?: {
  enteredViaLeftArrow?: boolean;
  dispatchExtraArgs?: string[];
  cwdFilter?: string;
}): Promise<void> {
  const instance = await render(
    <VoiceProvider>
      <AgentViewApp
        enteredViaLeftArrow={options?.enteredViaLeftArrow}
        dispatchExtraArgs={options?.dispatchExtraArgs}
        cwdFilter={options?.cwdFilter}
      />
    </VoiceProvider>,
  );
  await instance.waitUntilExit();
}
