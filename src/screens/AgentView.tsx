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
 * - Soft-archive / Earlier, Shift+↑↓ reorder, Alt+1-9 open, Esc quit / double Ctrl+C exit
 * - Fold completed sessions beyond a cap
 * - Sorted: pinned first, then blocked > active > done
 * - Auto-relaunch detection
 * - Repo grouping labels
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { randomUUID } from 'crypto';
import { feature } from 'bun:bundle';
import {
  createRoot,
  Box,
  Text,
  useInput,
  useSelection,
  AlternateScreen,
  ThemeProvider,
  enterAltScreenSequence,
  supportsExtendedKeys,
} from '@anthropic/ink';
import { AppStateProvider } from '../state/AppState.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { useNotifications } from '../context/notifications.js';
import { useCopyOnSelect, useSelectionBgColor } from '../hooks/useCopyOnSelect.js';
import {
  useSelectionClearKeybinding,
  notifySelectionCopied,
  createSelectionClearKeyDownCapture,
} from '../components/ScrollKeybindingHandler.js';
import type { Root } from '@anthropic/ink';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { listLiveSessions, handleBgStart, attachHandler } from '../cli/bg.js';
import type { SessionEntry } from '../cli/bg/engine.js';
import { patchSessionByPid } from '../utils/concurrentSessions.js';
import { submitDispatch } from '../daemon/bgManager.js';
import { listAllJobs, patchBgJobState, type BgJobState } from '../daemon/jobState.js';
import { deleteJob, formatKeptWorktreeReason, type DeleteJobResult } from '../daemon/deleteJob.js';
import { killJobConfirmed } from '../daemon/xyrRespawn.js';
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
  decideOriginEscAction,
  normalizeFleetGroupName,
  partitionArchivedSessions,
  buildCwdBasenameMap,
  expandPastedTextRefs,
  shouldFleetViewVimHandleEscape,
  formatPastedTextPlaceholder,
  countNewlines,
  FLEET_MIN_INTENT_LEN,
  FLEET_PASTE_CHAR_THRESHOLD,
  FLEET_EXIT_ARM_MS,
  FLEET_DELETE_ARM_MS,
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
import { isVimModeEnabled } from '../components/PromptInput/utils.js';
import type { VimMode } from '../types/textInputTypes.js';
import { LineView } from '../components/LineView.js';
import { SuggestionList } from '../components/SuggestionList.js';
import { Clawd } from '../components/LogoV2/Clawd.js';
import { getMainLoopModel, renderModelName } from '../utils/model/model.js';
import { getCwd } from '../utils/cwd.js';
import { truncatePathMiddle } from '../utils/truncate.js';
import { stringWidth } from '@anthropic/ink';
import { formatRelativeTimeAgo } from '../utils/format.js';
import { listTemplates, type TemplateInfo } from '../jobs/templates.js';
import { listRoutines, type RoutineInfo } from '../jobs/routines.js';
import {
  FLEET_FORCE_RESTART_MSG,
  FORK_TRANSCRIPT_NEVER_MATERIALIZED,
  evaluateRespawnTranscriptGate,
} from '../daemon/transcriptProbe.js';

export { FLEET_FORCE_RESTART_MSG };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 3000;

/** Module-level arm for densable double-enter force fresh after tYo. */
let forceFreshNextShort: string | null = null;

type ResumePickerEntry = {
  sessionId: string;
  title: string;
  modified: Date;
};

type ResumePickerState = {
  entries: ResumePickerEntry[] | null;
  failed: boolean;
  selected: number;
};
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

/** densable eSo — prompt-composer quit tokens (not bash). */
const FLEET_QUIT_TOKENS = new Set(['exit', 'quit', ':q', ':q!', ':wq', ':wq!']);

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
  isJustKilled,
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
  /** densable cy.justKilled — first Ctrl+X ran stop; second deletes. */
  isJustKilled?: boolean;
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
  // densable Z3e: ungroup | justKilled → "stopped · ctrl+x again to delete" | delete.
  let detail = '';
  if (isUngroupPending) {
    detail = 'ctrl+x again to ungroup';
  } else if (isDeletePending) {
    detail = isJustKilled ? 'stopped \u00b7 ctrl+x again to delete' : 'ctrl+x again to delete';
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

/**
 * densable 2.1.234 FleetView selection chrome — y8i + _8i + h8i (+ toast via g8i).
 * `vvh` onKeyDownCapture is wired on AgentViewApp root Box (SEA E7=vvh(...)).
 * Must mount under AppStateProvider + KeybindingSetup (createRoot path).
 */
function AgentsSelectionChrome(): null {
  const selection = useSelection();
  const { addNotification } = useNotifications();
  useCopyOnSelect(selection, true, text => notifySelectionCopied(addNotification, text));
  useSelectionBgColor(selection);
  useSelectionClearKeybinding(selection, true);
  return null;
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
  onAction?: (
    action:
      | { type: 'open'; sessionId: string; short: string; logPath?: string }
      | { type: 'done'; resumeHintRequested?: boolean },
  ) => void;
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
  // densable: when remounted with tYo, keep force arm for next enter on same short
  useEffect(() => {
    if (initialError === FLEET_FORCE_RESTART_MSG && forceFreshNextShort) {
      // already armed by attachToPtySession
    }
  }, [initialError]);
  const [dispatchInput, setDispatchInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  /** densable /resume past-session overlay (Tt). */
  const [resumePicker, setResumePicker] = useState<ResumePickerState | null>(null);
  /** Official Ld / yp — prompt vs bash (`!`) composer mode. */
  const [dispatchMode, setDispatchMode] = useState<'prompt' | 'bash'>('prompt');
  /** Official JIy `vimMode:d` — undefined when vim is off (Esc still clears). */
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
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
  /**
   * densable cy.justKilled — first Ctrl+X on active/blocked ran stop; UI shows
   * "stopped · ctrl+x again to delete". Cleared with arm timeout / Esc / second X.
   */
  const [justKilledSessionId, setJustKilledSessionId] = useState<string | null>(null);
  /**
   * densable wL / yte — tombstone job shorts + full sessionIds while delete is
   * in flight so refresh cannot resurrect a row (zombie reappear when worker dead).
   */
  const deletedJobIdsRef = useRef(new Set<string>());
  const deletedSessionIdsRef = useRef(new Set<string>());
  /** densable bte — Esc cancelled arm; stop failure must not re-arm justKilled. */
  const escCancelledDeleteIdsRef = useRef(new Set<string>());
  /** densable Oc(() => cO(null), cy ? 2000 : null) */
  const deleteArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** densable Pk.current — latest arm target id (sessionId / group: / *done*). */
  const deleteArmIdRef = useRef<string | null>(null);
  // densable Mt — only Ctrl+C double-press (CJ) arms exit; Esc is one-shot Tt.
  const [exitArmed, setExitArmed] = useState(false);
  const exitArmedRef = useRef(false);
  const exitArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // densable Tt — leave FleetView immediately (defined early: handleDispatch + useInput).
  const forceExit = useCallback(
    (opts?: { resumeHintRequested?: boolean }) => {
      if (exitArmTimerRef.current) {
        clearTimeout(exitArmTimerRef.current);
        exitArmTimerRef.current = null;
      }
      exitArmedRef.current = false;
      setExitArmed(false);
      if (onAction)
        onAction({
          type: 'done',
          resumeHintRequested: opts?.resumeHintRequested,
        });
      else process.exit(0);
    },
    [onAction],
  );

  /**
   * densable CJ clear — only on second press (forceExit), timeout, or
   * forceExit from Esc cascade. densable does **not** disarm Mt on other keys;
   * Mt stays until fSg window elapses.
   */
  const disarmExitArm = useCallback(() => {
    if (!exitArmedRef.current) return;
    if (exitArmTimerRef.current) {
      clearTimeout(exitArmTimerRef.current);
      exitArmTimerRef.current = null;
    }
    exitArmedRef.current = false;
    setExitArmed(false);
  }, []);

  /**
   * densable ur = CJ(Et, Tt): Ctrl+C only double-press exit.
   * Esc is cascade then one-shot Tt() — never arms Mt (see densable 2.1.211:
   * ctrl+c → ur(); escape → … else Tt()).
   * densable fSg = 800ms arm window.
   */
  const handleCtrlCDoublePress = useCallback(() => {
    if (exitArmedRef.current) {
      forceExit();
      return;
    }
    exitArmedRef.current = true;
    setExitArmed(true);
    if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
    exitArmTimerRef.current = setTimeout(() => {
      exitArmedRef.current = false;
      setExitArmed(false);
      exitArmTimerRef.current = null;
    }, FLEET_EXIT_ARM_MS);
  }, [forceExit]);

  /** densable cO(null) — clear delete/ungroup arm + justKilled. */
  const clearDeleteArm = useCallback(() => {
    if (deleteArmTimerRef.current) {
      clearTimeout(deleteArmTimerRef.current);
      deleteArmTimerRef.current = null;
    }
    deleteArmIdRef.current = null;
    setDeleteConfirmSessionId(null);
    setUngroupConfirmSessionId(null);
    setJustKilledSessionId(null);
  }, []);

  /**
   * densable cO(id, justKilled, …) — arm second Ctrl+X; auto-clear after 2000ms.
   * densable also clears bte for that id on arm.
   */
  const armDeleteConfirm = useCallback((sessionId: string, opts?: { justKilled?: boolean; ungroup?: boolean }) => {
    if (deleteArmTimerRef.current) {
      clearTimeout(deleteArmTimerRef.current);
      deleteArmTimerRef.current = null;
    }
    escCancelledDeleteIdsRef.current.delete(sessionId);
    deleteArmIdRef.current = sessionId;
    if (opts?.ungroup) {
      setDeleteConfirmSessionId(null);
      setJustKilledSessionId(null);
      setUngroupConfirmSessionId(sessionId);
    } else {
      setUngroupConfirmSessionId(null);
      setDeleteConfirmSessionId(sessionId);
      setJustKilledSessionId(opts?.justKilled ? sessionId : null);
    }
    deleteArmTimerRef.current = setTimeout(() => {
      deleteArmTimerRef.current = null;
      deleteArmIdRef.current = null;
      setDeleteConfirmSessionId(null);
      setUngroupConfirmSessionId(null);
      setJustKilledSessionId(null);
    }, FLEET_DELETE_ARM_MS);
  }, []);

  const dispatchingRef = useRef(false);
  const lastRelaunchRef = useRef(0);
  /** Monotonic refresh generation — stale async passes must not clobber newer results. */
  const refreshGenerationRef = useRef(0);
  /** When a refresh is in flight, a trailing refresh is scheduled after it settles. */
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  /**
   * densable wL + yte + jF — mark job short / sessionIds as deleting so refresh
   * filters them out; returns release that removes the tombstone (on failure).
   */
  const tombstoneJob = useCallback((session: SessionEntry) => {
    const short = session.short ?? session.sessionId?.slice(0, 8) ?? '';
    if (!short) return () => {};
    deletedJobIdsRef.current.add(short);
    const sids = [session.sessionId].filter((id): id is string => typeof id === 'string' && id.length > 0);
    for (const id of sids) deletedSessionIdsRef.current.add(id);
    // Bump generation so any in-flight refresh cannot clobber after optimistic remove.
    refreshGenerationRef.current += 1;
    return () => {
      deletedJobIdsRef.current.delete(short);
      for (const id of sids) deletedSessionIdsRef.current.delete(id);
      refreshGenerationRef.current += 1;
    };
  }, []);

  useEffect(
    () => () => {
      if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
      if (deleteArmTimerRef.current) clearTimeout(deleteArmTimerRef.current);
    },
    [],
  );
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

      // densable wL / yte: hide jobs mid-delete so dead-worker refresh cannot resurrect them.
      if (deletedJobIdsRef.current.size > 0 || deletedSessionIdsRef.current.size > 0) {
        entries = entries.filter(s => {
          const short = s.short ?? s.sessionId?.slice(0, 8) ?? '';
          if (short && deletedJobIdsRef.current.has(short)) return false;
          if (s.sessionId && deletedSessionIdsRef.current.has(s.sessionId)) return false;
          return true;
        });
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
    justKilled: !!justKilledSessionId && justKilledSessionId === deleteConfirmSessionId,
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

  const openResumePicker = useCallback(async () => {
    setResumePicker({ entries: null, failed: false, selected: 0 });
    setDispatchInput('');
    setCursorOffset(0);
    try {
      // densable fWa(excludeSet, includeBg=true) + soft-deleted/list-hidden:
      // 1) enumerate past project sessions (B7b=200)
      // 2) exclude sessions already in the main (non-archived) Fleet list
      // 3) still include soft-archived / Earlier jobs (deleted from main list)
      const { listSessionsImpl } = await import('../utils/listSessionsImpl.js');
      const excludeIds = new Set<string>();
      for (const s of sessions) {
        if (s.archived || !s.sessionId) continue;
        excludeIds.add(s.sessionId);
        excludeIds.add(s.sessionId.slice(0, 8));
        if (s.pid) excludeIds.add(String(s.pid));
      }
      const listed = await listSessionsImpl({
        dir: getCwd(),
        limit: 200,
        includeWorktrees: true,
      });
      const byId = new Map<string, ResumePickerEntry>();
      for (const s of listed) {
        if (!s.sessionId) continue;
        if (excludeIds.has(s.sessionId) || excludeIds.has(s.sessionId.slice(0, 8))) {
          continue;
        }
        byId.set(s.sessionId, {
          sessionId: s.sessionId,
          title: s.customTitle || s.summary || s.sessionId.slice(0, 8),
          modified: new Date(s.lastModified),
        });
      }
      // Merge soft-archived Fleet jobs (Earlier) — densable "deleted from the list"
      for (const s of sessions) {
        if (!s.archived || !s.sessionId) continue;
        if (byId.has(s.sessionId)) continue;
        byId.set(s.sessionId, {
          sessionId: s.sessionId,
          title: s.name || s.sessionId.slice(0, 8),
          modified: new Date(s.updatedAt || s.startedAt || Date.now()),
        });
      }
      const entries = [...byId.values()].sort((a, b) => b.modified.getTime() - a.modified.getTime());
      setResumePicker({ entries, failed: false, selected: 0 });
    } catch {
      setResumePicker({ entries: [], failed: true, selected: 0 });
    }
  }, [sessions]);

  const resumePastAsBackground = useCallback(
    async (sessionId: string, title: string) => {
      setResumePicker(null);
      dispatchingRef.current = true;
      try {
        await submitDispatch({
          intent: title || 'resume',
          name: title.slice(0, 40) || undefined,
          resumeSessionId: sessionId,
          forkSession: true,
          cwd: getCwd(),
          extraArgs: dispatchExtraArgs,
          source: 'fleet-resume',
        });
        setError(null);
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        dispatchingRef.current = false;
      }
    },
    [dispatchExtraArgs, refresh],
  );

  const handleDispatch = useCallback(async () => {
    if (dispatchingRef.current) return;
    const rawForParse = dispatchMode === 'bash' ? `!${dispatchInput}` : dispatchInput;
    if (!rawForParse.trim()) return;

    // densable eSo: exit/quit/:q… from prompt composer exits FleetView (not bash).
    if (dispatchMode !== 'bash') {
      const quitToken = dispatchInput.trim().toLowerCase();
      if (FLEET_QUIT_TOKENS.has(quitToken)) {
        setDispatchInput('');
        setCursorOffset(0);
        setDispatchMode('prompt');
        forceExit();
        return;
      }
      // densable: bare /resume opens past-session picker → bg resume
      if (quitToken === '/resume' || quitToken.startsWith('/resume ')) {
        await openResumePicker();
        return;
      }
    }

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
      // densable: n?.exec → launch.mode exec via $F_; template → agent;
      // routine is a separate dispatch field (not agent).
      await submitDispatch({
        intent: expandedExec ? expandedExec : expandedIntent,
        name: expandedExec ? expandedExec.slice(0, 40) : (parsed.templateName ?? parsed.routine),
        agent: expandedExec ? undefined : parsed.templateName,
        routine: expandedExec ? undefined : parsed.routine,
        exec: expandedExec,
        cwd: parsed.cwd ?? getCwd(),
        extraArgs: dispatchExtraArgs,
        source: 'fleet',
      });
      setDispatchInput('');
      setCursorOffset(0);
      setDispatchMode('prompt');
      setVimMode('INSERT');
      pastesRef.current = {};
      pasteIdRef.current = 1;
      setError(null);
      await refresh();
    } finally {
      dispatchingRef.current = false;
    }
  }, [
    dispatchInput,
    dispatchMode,
    refresh,
    dispatchExtraArgs,
    sessions,
    fleetTemplates,
    fleetRoutines,
    forceExit,
    openResumePicker,
  ]);

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

  /**
   * densable FSS delete: optimistic filter via r(..., o.id); C2e force;
   * finally always releases tombstone then refresh (e()).
   */
  const handleDelete = useCallback(async () => {
    const session = getSelectedSession();
    if (!session) return;
    const short = session.short ?? session.sessionId?.slice(0, 8);
    if (!short) return;
    clearDeleteArm();
    const releaseTombstone = tombstoneJob(session);
    // densable optimistic remove from list while delete runs
    setSessions(prev =>
      prev.filter(s => {
        const sShort = s.short ?? s.sessionId?.slice(0, 8) ?? '';
        return sShort !== short && s.sessionId !== session.sessionId;
      }),
    );
    let result: DeleteJobResult | undefined;
    try {
      result = await deleteJob(short, { force: true });
      if (!result.removed && !result.keptWorktree) {
        throw new Error(result.error ?? 'worker may still be running');
      }
    } catch (err) {
      setError(`Couldn't delete \u2014 ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // densable finally: i?.() release wL, then e() refresh
      releaseTombstone();
      await refresh();
    }
    if (!result) return;
    if (result.removed) {
      if (result.leftWorktreeDir) {
        setError(
          `Worktree directory left at ${result.leftWorktreeDir} \u2014 git no longer recognized it; the session was deleted`,
        );
      } else {
        setError(null);
      }
      return;
    }
    if (result.keptWorktree) {
      const phrase = formatKeptWorktreeReason(result.keptReason, result.keptErrorSummary);
      setError(`Worktree kept at ${result.keptWorktree} \u2014 ${phrase}; the session was not deleted`);
    }
  }, [getSelectedSession, refresh, clearDeleteArm, tombstoneJob]);

  /**
   * densable FSS stop then cO(id, justKilled=true): first Ctrl+X on active/blocked.
   * Stop failure re-arms without justKilled unless Esc cancelled (bte).
   */
  const handleStopThenArmDelete = useCallback(
    async (session: SessionEntry) => {
      const short = session.short ?? session.sessionId?.slice(0, 8);
      if (!short) return;
      armDeleteConfirm(session.sessionId, { justKilled: true });
      // Optimistic UI: mark stopped like densable state patch
      const nowIso = new Date().toISOString();
      setSessions(prev =>
        prev.map(s => {
          if (s.sessionId !== session.sessionId && (s.short ?? '') !== short) {
            return s;
          }
          return {
            ...s,
            status: 'stopped',
            lastMessage: 'stopped',
            updatedAt: Date.now(),
          };
        }),
      );
      try {
        const kill = await killJobConfirmed(short, { force: true });
        if (!kill.confirmed) {
          throw new Error(kill.error ?? 'worker may still be running');
        }
        patchBgJobState(short, {
          state: 'stopped',
          detail: 'stopped',
          tempo: 'idle',
          updatedAt: nowIso,
        });
      } catch (err) {
        // densable: !wL && still listed && (Pk null|same id) && !bte → re-arm justKilled:false
        if (
          !deletedJobIdsRef.current.has(short) &&
          !escCancelledDeleteIdsRef.current.has(session.sessionId) &&
          (deleteArmIdRef.current === null || deleteArmIdRef.current === session.sessionId)
        ) {
          armDeleteConfirm(session.sessionId, { justKilled: false });
        }
        setError(`Couldn't stop \u2014 ${err instanceof Error ? err.message : String(err)}`);
        await refresh();
      }
    },
    [armDeleteConfirm, refresh],
  );

  const handleDeleteAll = useCallback(async () => {
    clearDeleteArm();
    for (const session of done) {
      // Prefer daemon short (attach correctness) over sessionId slice.
      const short = session.short ?? session.sessionId?.slice(0, 8);
      if (!short) continue;
      const releaseTombstone = tombstoneJob(session);
      try {
        // densable force:true for fleet delete (non-git / dirty still clears jobdir)
        await deleteJob(short, { force: true });
      } finally {
        releaseTombstone();
      }
    }
    await refresh();
  }, [done, refresh, clearDeleteArm, tombstoneJob]);

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
    // densable archive also clears pins.json so daemon retire is not blocked
    // by a stale pin entry (state.json alone is not enough — bgWorker reads pins).
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
      } catch {
        /* missing pins.json ok */
      }
      if (pins.includes(short)) {
        pins = pins.filter(s => s !== short);
        await mkdir(getClaudeConfigHomeDir(), { recursive: true }).catch(() => {});
        await writeFile(pinsPath, JSON.stringify(pins, null, 2));
      }
    } catch {
      /* best-effort pins clear */
    }
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

  /**
   * densable FleetView Esc terminal cascade after help/dispatch/bash/delete-arm:
   * densable JH = () => onAction({ type: "done" }) — one-shot exit, never open/attach.
   *
   * densable 2.1.153 escape path ends in JH() only (no attach-origin remount).
   * Gnm decideOriginEscAction remains for left-arrow resume-hint bookkeeping:
   * exit-with-hint when origin was left-arrow and row missing/failed spawn.
   * attach-origin must NOT run here — open→attach→2J remount blacks the list
   * for seconds when origin is dead (e.g. "exit 1 before init").
   */
  const handleEscExit = useCallback(() => {
    const decision = decideOriginEscAction({
      originJobId: enteredViaLeftArrow ? originSessionId : undefined,
      originRowPresent: originSessionPresent,
    });
    // densable JH: always done. Only resume-hint differs for left-arrow exit paths.
    if (decision.kind === 'exit-with-hint' || decision.kind === 'attach-origin') {
      // Left-arrow origin: exit fleet; user resumes via claude --resume (densable).
      // Do not attach-origin (would unmount + PTY attach + remount → multi-second black).
      forceExit({ resumeHintRequested: true });
      return;
    }
    if (decision.kind === 'wait-starting') {
      setError(formatAttachError('still starting'));
      return;
    }
    forceExit();
  }, [enteredViaLeftArrow, originSessionId, originSessionPresent, forceExit]);

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
      // densable Esc on armed: bte.add(id) then cO(null)
      if (deleteConfirmSessionId) {
        escCancelledDeleteIdsRef.current.add(deleteConfirmSessionId);
      }
      if (ungroupConfirmSessionId) {
        escCancelledDeleteIdsRef.current.add(ungroupConfirmSessionId);
      }
      clearDeleteArm();
    };

    // densable /resume past-session overlay key handling
    if (resumePicker) {
      if (key.escape) {
        setResumePicker(null);
        return;
      }
      const entries = resumePicker.entries;
      if (entries && entries.length > 0) {
        if (key.upArrow) {
          setResumePicker(p =>
            p
              ? {
                  ...p,
                  selected: Math.max(0, p.selected - 1),
                }
              : p,
          );
          return;
        }
        if (key.downArrow) {
          setResumePicker(p =>
            p
              ? {
                  ...p,
                  selected: Math.min((p.entries?.length ?? 1) - 1, p.selected + 1),
                }
              : p,
          );
          return;
        }
        if (key.return) {
          const pick = entries[resumePicker.selected];
          if (pick) void resumePastAsBackground(pick.sessionId, pick.title);
          return;
        }
      }
      return;
    }

    // densable: Ctrl+C cancels transient modes / clears dispatch, else ur() double-exit.
    // Esc never arms — only Ctrl+C uses double-press (Mt footer: Press Ctrl-C again).
    // Match both parsed form (input='c'+ctrl) and raw ETX (\x03) for robustness.
    if ((input === 'c' && key.ctrl) || input === '\x03') {
      // densable: Ctrl+C cancels transient modes without disarming Mt (exit arm).
      // Only timeout / 2nd Ctrl+C / forceExit clear arm — otherwise arm →
      // rename → Ctrl+C cancel rename → need arm again becomes triple Ctrl+C.
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
      if (deleteConfirmSessionId || ungroupConfirmSessionId) {
        clearPending();
        return;
      }
      // densable: clear composer then still ur() — first Ctrl+C arms, second exits.
      // densable does not disarm Mt on other keys; only timeout / 2nd press / forceExit.
      if (dispatchInput) {
        setDispatchInput('');
        setCursorOffset(0);
      }
      if (dispatchMode === 'bash') {
        setDispatchMode('prompt');
      }
      handleCtrlCDoublePress();
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
      // densable 2.1.212 #14: Ctrl+J inserts newline (extended key reporting);
      // Shift+Enter kept for terminals that map it to a return+shift event.
      if ((key.return && key.shift) || (input === 'j' && key.ctrl)) {
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
      // Official JIy Esc: vim INSERT/nonempty → NORMAL and keep text.
      if (key.escape) {
        const fleetVim = isVimModeEnabled() ? vimMode : undefined;
        if (shouldFleetViewVimHandleEscape(fleetVim, true, dispatchInput)) {
          if (deleteConfirmSessionId || ungroupConfirmSessionId) {
            clearPending();
          }
          if (vimMode === 'INSERT') {
            setVimMode('NORMAL');
          }
          return;
        }
        if (dispatchInput || dispatchMode === 'bash') {
          setDispatchInput('');
          setCursorOffset(0);
          setDispatchMode('prompt');
          setVimMode('INSERT');
        } else if (deleteConfirmSessionId || ungroupConfirmSessionId) {
          // densable MD.current → NO(null): cancel delete/ungroup arm first.
          clearPending();
        } else {
          handleEscExit();
        }
        return;
      }
      // Official JIy `u(t)`: NORMAL does not insert. `i` returns to INSERT.
      if (isVimModeEnabled() && vimMode === 'NORMAL') {
        if (input === 'i' && !key.ctrl && !key.meta) {
          setVimMode('INSERT');
          return;
        }
        if (input && !key.ctrl && !key.meta && !key.return && !key.tab && !key.escape) {
          return;
        }
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
      // densable R4e("x"): active/blocked first X = stop+arm justKilled; second X = delete.
      // completed first X = arm delete; second X = delete. Grouped jobs: ungroup arm first.
      if (currentRow?.kind === 'header' && currentRow.group.startsWith('group:')) {
        const gname = currentRow.group.slice(6);
        if (gname === UNGROUPED_LABEL) return;
        const token = `group:${gname}`;
        if (ungroupConfirmSessionId === token) {
          clearDeleteArm();
          void handleUngroupAll(gname);
        } else {
          armDeleteConfirm(token, { ungroup: true });
        }
        return;
      }
      const session = getSelectedSession();
      if (!session) {
        // Header/fold selected: only delete-all when focused on completed header,
        // and always require a second confirm via deleteConfirmSessionId='*done*'.
        if (currentRow?.kind === 'header' && currentRow.group === 'done' && done.length > 0) {
          if (deleteConfirmSessionId === '*done*') {
            clearDeleteArm();
            void handleDeleteAll();
          } else {
            armDeleteConfirm('*done*');
          }
        }
        return;
      }
      // Prefer ungroup when job is in a custom group and second press is ungroup-confirm
      if (session.group && ungroupConfirmSessionId === session.sessionId) {
        clearDeleteArm();
        void handleUngroup();
        return;
      }
      if (deleteConfirmSessionId === session.sessionId) {
        // densable second X → delete (works for justKilled arm too)
        clearDeleteArm();
        void handleDelete();
        return;
      }
      // First press: grouped jobs offer ungroup; active/blocked stop+arm; else arm delete.
      if (session.group) {
        armDeleteConfirm(session.sessionId, { ungroup: true });
      } else {
        const band = deriveBand(session);
        if (band === 'blocked' || band === 'active') {
          void handleStopThenArmDelete(session);
        } else {
          armDeleteConfirm(session.sessionId);
        }
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
    } else if (key.escape) {
      // densable list-focus Esc cascade: draft/bash → pending delete → Gnm/Tt.
      // Draft can remain after ↑ from dispatch without clearing.
      if (dispatchInput || dispatchMode === 'bash') {
        setDispatchInput('');
        setCursorOffset(0);
        setDispatchMode('prompt');
        setVimMode('INSERT');
      } else if (deleteConfirmSessionId || ungroupConfirmSessionId) {
        clearPending();
      } else {
        handleEscExit();
      }
    } else if (input === '!' && !key.ctrl && !key.meta) {
      // Official: "!" from list enters bash dispatch mode
      clearPending();
      setFocusArea('dispatch');
      setDispatchMode('bash');
      setDispatchInput('');
      setCursorOffset(0);
    } else if (input && !key.ctrl && !key.meta && input !== 'f' && input !== '?' && input !== 'a') {
      // Auto-switch to dispatch on any printable char (incl. q — densable types into composer)
      clearPending();
      setFocusArea('dispatch');
      setDispatchMode('prompt');
      setDispatchInput(input);
      setCursorOffset(input.length);
    }
  });

  // -------------------------------------------------------------------------
  // densable FleetView: let E7=vvh(yC,or().copyOnSelect??!0); onKeyDownCapture:E7
  const selectionForClear = useSelection();
  const copyOnSelect = getGlobalConfig().copyOnSelect ?? true;
  const selectionKeyDownCapture = useMemo(
    () => createSelectionClearKeyDownCapture(selectionForClear, copyOnSelect),
    [selectionForClear, copyOnSelect],
  );

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
      <Box flexDirection="column" flexGrow={1} onKeyDownCapture={selectionKeyDownCapture}>
        {/* Top: scrollable list area */}
        <Box flexDirection="column" flexGrow={1} paddingTop={1}>
          {/* Header — densable Od_/WB exact (2.1.211):
              gap:2 marginBottom:1; !wpe && Ys>=70 && <KB/>;
              text col = flexDirection column only.
              Host KB directly — never fixed host width (clips half-blocks).
              CRITICAL: flexShrink={0} on this row. Parent is a flexGrow column
              packing header + full session list into the viewport; Box default
              flexShrink:1 crushes the 3-row Clawd into solid orange bars and
              clips the "Claude Code" title (live 2026-07-20). densable hosts
              the header inside ScrollBox (WB) so natural height is preserved. */}
          <Box marginBottom={1} gap={2} flexShrink={0}>
            {!compactHeader && termWidth >= 70 && <Clawd />}
            <Box flexDirection="column" flexShrink={1} minWidth={0}>
              {!compactHeader && (
                <>
                  <Text>
                    <Text bold>Claude Code</Text> <Text dimColor>v{MACRO.VERSION}</Text>
                  </Text>
                  <Text dimColor wrap="truncate">
                    {[modelDisplay, cwdDisplay].filter(Boolean).join(' \u00b7 ')}
                  </Text>
                </>
              )}
              <Text dimColor wrap="truncate">
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
                  isJustKilled={justKilledSessionId === session.sessionId}
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
          {/* densable /resume past-session overlay (Tt) */}
          {resumePicker && (
            <Box flexDirection="column" borderStyle="round" paddingX={1} marginX={1} marginBottom={1}>
              <Text bold>Resume a past session</Text>
              {resumePicker.entries === null ? (
                <Text dimColor>Looking for past sessions…</Text>
              ) : resumePicker.failed ? (
                <Text dimColor>{"Couldn't load past sessions — press esc, then try /resume again"}</Text>
              ) : resumePicker.entries.length === 0 ? (
                <Text dimColor>No past sessions to resume</Text>
              ) : (
                <Box flexDirection="column">
                  {resumePicker.entries.map((entry, idx) => {
                    const selected = idx === resumePicker.selected;
                    return (
                      <Box key={entry.sessionId}>
                        <Text
                          bold={selected}
                          backgroundColor={selected ? 'userMessageBackground' : undefined}
                          wrap={'truncate' as never}
                        >
                          {entry.title}
                          <Text dimColor>
                            {' · '}
                            {formatRelativeTimeAgo(entry.modified, { style: 'short' })}
                          </Text>
                        </Text>
                      </Box>
                    );
                  })}
                </Box>
              )}
              <Text dimColor>↑/↓ to navigate · enter to resume as a background session · esc to close</Text>
            </Box>
          )}

          {/* Help overlay (official ? shortcuts) */}
          {helpOpen && !resumePicker && (
            <Box paddingLeft={2} flexDirection="column" marginBottom={1}>
              <Text bold>Agents View shortcuts</Text>
              <Text dimColor>enter open · space reply · ctrl+e group · ctrl+s views</Text>
              <Text dimColor>ctrl+t pin · ctrl+r rename · ctrl+x delete/ungroup · a archive</Text>
              <Text dimColor>! bash · @ mention · ctrl+j for newline · shift+↑↓ reorder · alt+1-9 open</Text>
              <Text dimColor>esc to quit · ctrl+c exit · ? close</Text>
            </Box>
          )}

          {/* Group assign mode */}
          {viewMode === 'group' && !resumePicker && (
            <Box paddingLeft={2} flexDirection="column">
              <Box>
                <Text bold>{'group \u276f '}</Text>
                <Text>{groupValue}</Text>
                {!groupValue && <Text dimColor> name (empty = ungroup)</Text>}
              </Box>
            </Box>
          )}

          {/* Reply mode */}
          {viewMode === 'reply' && !resumePicker && (
            <Box paddingLeft={2} flexDirection="column">
              <Box>
                <Text bold>{'reply \u276f '}</Text>
                <Text>{replyInput}</Text>
                {!replyInput && <Text dimColor> type a response</Text>}
              </Box>
            </Box>
          )}

          {/* Dispatch input */}
          {viewMode === 'list' && !helpOpen && !resumePicker && (
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

          {/* Keyboard hints — FleetView footer. Arm message stays prominent.
              densable: resume overlay owns its own footer line. */}
          {!resumePicker && (
            <Box paddingLeft={2} height={1} flexShrink={0}>
              <Text dimColor={!exitArmed} color={exitArmed ? 'warning' : undefined} wrap={'truncate' as never}>
                {footerHints}
              </Text>
            </Box>
          )}
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

  // densable tYo: second enter while force-armed → force fresh prompt
  const forceFresh = forceFreshNextShort === short;
  if (forceFresh) forceFreshNextShort = null;

  // Official flow: try attach → if ENOJOB → respawn → retry attach
  let result = await attachToSession(short, { alreadyInAlt: true });
  let respawned = false;

  if (result.outcome === 'error' && result.msg?.includes('ENOJOB')) {
    // Session not in daemon — respawn it (official: S8_ / densable Xyr)
    const jobs = await listAllJobs();
    const job = jobs.find(j => j.short === short || j.state.sessionId === short || j.state.sessionId.startsWith(short));
    if (job) {
      const resumeId = job.state.resumeSessionId ?? job.state.sessionId;
      const attachShort = job.short || short;
      // densable Xyr: hLp / D9e / gLp before IAe (Zxe after hasMessages)
      const { xyrPreflightBeforeRespawn, findResumeSessionConflict } = await import('../daemon/xyrRespawn.js');
      const preflightErr = await xyrPreflightBeforeRespawn({
        short: attachShort,
        resumeSessionId: resumeId,
        hasMessages: false,
        force: forceFresh,
        forceRefusalRetry: forceFresh,
      });
      if (preflightErr) {
        // densable remount restore: BwH (enterAlt + 2J + H [+ extended keys])
        process.stdout.write(enterAltScreenSequence(supportsExtendedKeys()));
        return { error: preflightErr };
      }
      // densable IAe/NPn/Xyr gate (client-side preflight + daemon re-check)
      const gate = await evaluateRespawnTranscriptGate({
        short: attachShort,
        sessionId: job.state.sessionId,
        resumeSessionId: resumeId,
        cwd: job.state.cwd,
        bgIsolation: job.state.bgIsolation ?? 'none',
        linkScanPath: job.state.linkScanPath,
        forceRefusalRetry: forceFresh,
        forceFreshPrompt: forceFresh,
      });
      const hasMessages = gate.allow && gate.probe.hasMessages;

      // densable tYo: refuse + arm when fork handoff never materialized
      if (!gate.allow) {
        forceFreshNextShort = short;
        process.stdout.write(enterAltScreenSequence(supportsExtendedKeys()));
        return { error: FLEET_FORCE_RESTART_MSG };
      }

      // densable R = hasMessages && !exec → Zxe resume_session_live_elsewhere
      if (hasMessages) {
        const conflict = await findResumeSessionConflict(resumeId);
        const ownJob = conflict?.jobId !== undefined && (conflict.jobId === short || conflict.jobId === attachShort);
        if (conflict && !ownJob) {
          process.stdout.write(enterAltScreenSequence(supportsExtendedKeys()));
          return {
            error:
              'This conversation is already open in another running Claude session — use that one, or close it and try again',
          };
        }
      }

      // densable Xyr `$`: initialPrompt ?? queuedPrompt ?? (w||N ? void : intent)
      // w = hasMessages; N = resumeSessionId points at a different session.
      // Daemon re-resolves and strips client args when $ is void 0.
      const { resolveRespawnLaunchPrompt } = await import('../daemon/transcriptProbe.js');
      const resumePointsElsewhere =
        job.state.resumeSessionId !== undefined && job.state.resumeSessionId !== job.state.sessionId;
      const skipIntentReplay = hasMessages || resumePointsElsewhere;
      const resolvedPrompt = resolveRespawnLaunchPrompt({
        queuedPrompt: job.state.queuedPrompt,
        intent: job.state.intent,
        skipIntentReplay,
      });
      const launch =
        hasMessages && !forceFresh
          ? {
              mode: 'resume' as const,
              sessionId: resumeId,
              fork: false,
              flagArgs: job.state.respawnFlags ?? [],
              // densable: only attach `-- $` when $ is defined
              args: resolvedPrompt ? ['--', resolvedPrompt] : [],
            }
          : {
              mode: 'prompt' as const,
              args: resolvedPrompt ? ['--', resolvedPrompt] : [],
            };

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
            isolation: job.state.bgIsolation === 'worktree' ? 'worktree' : 'none',
            respawnFlags: job.state.respawnFlags ?? [],
            cols: process.stdout.columns || 120,
            rows: process.stdout.rows || 30,
            // densable Xyr forceRefusalRetry on second enter
            ...(forceFresh ? { forceRefusalRetry: true, force: true } : {}),
          },
          timeoutMs: 10000,
        },
        { timeoutMs: 12000 },
      );

      if (resp.ok) {
        respawned = true;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 500));
          result = await attachToSession(attachShort, { alreadyInAlt: true });
          if (result.outcome !== 'error' || !result.msg?.includes('ENOJOB')) break;
        }
      } else {
        process.stdout.write(enterAltScreenSequence(supportsExtendedKeys()));
        const errMsg = (resp as { error?: string; errorCode?: string; code?: string }).error ?? 'respawn failed';
        const code = (resp as { errorCode?: string; code?: string }).errorCode ?? (resp as { code?: string }).code;
        if (
          code === FORK_TRANSCRIPT_NEVER_MATERIALIZED ||
          code === 'fork_transcript_never_materialized' ||
          errMsg.includes('no saved transcript')
        ) {
          forceFreshNextShort = short;
          return { error: FLEET_FORCE_RESTART_MSG };
        }
        return { error: formatAttachError(errMsg) };
      }
    }
  }

  // densable after detach: if(X) process.stdout.write(BwH()) then createRoot.
  // Local always remounts FleetView in alt — restore via densable BwH (not 1049h+r).
  process.stdout.write(enterAltScreenSequence(supportsExtendedKeys()));

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
}): Promise<{ resumeHintRequested?: boolean; forkSessionId?: string }> {
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
      return {};
    }
    inProcessManager = daemon.manager;
  }

  // Track last-selected session so we can restore position after attach.
  // Prefer explicit option, then env select (official initialJobId).
  let lastSelectedSessionId: string | undefined = options?.restoreSessionId ?? envSelect ?? undefined;
  const enteredViaLeftArrow = options?.enteredViaLeftArrow ?? !!(options?.restoreSessionId ?? envSelect);
  // Official J (initialError) — attach failure remounted into FleetView.
  let remountError: string | undefined;
  /** densable resumeHintRequested after Gnm exit-with-hint */
  let resumeHintRequested = false;

  // Create a Root instance (sync render, no race condition)
  // Official uses a persistent Root that survives across attach/detach cycles
  let root: Root = await createRoot({ exitOnCtrlC: false });

  // Loop: render FleetView → handle action → re-render
  for (;;) {
    const action = await new Promise<
      | { type: 'open'; sessionId: string; short: string; logPath?: string }
      | { type: 'done'; resumeHintRequested?: boolean }
    >(resolve => {
      // ThemeProvider required: without it useTheme() defaults to 'dark', so
      // selection userMessageBackground paints as rgb(55,55,55) on light terminals.
      root.render(
        <ThemeProvider
          initialState={getGlobalConfig().theme}
          onThemeSave={setting => saveGlobalConfig(current => ({ ...current, theme: setting }))}
        >
          <AppStateProvider>
            <KeybindingSetup>
              <AgentsSelectionChrome />
              <AgentViewApp
                enteredViaLeftArrow={enteredViaLeftArrow}
                dispatchExtraArgs={options?.dispatchExtraArgs}
                cwdFilter={options?.cwdFilter}
                currentSessionId={options?.currentSessionId}
                restoreSessionId={lastSelectedSessionId}
                initialError={remountError}
                onAction={resolve}
              />
            </KeybindingSetup>
          </AppStateProvider>
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

    if (action.type === 'done') {
      resumeHintRequested = !!action.resumeHintRequested;
      break;
    }

    if (action.type === 'open') {
      // Official (Windows only): re-enable raw mode + ref stdin after Ink unmount
      if (getPlatform() === 'windows' && process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.ref();
      }

      lastSelectedSessionId = action.sessionId;
      // Attach to PTY socket (same as official: raw terminal ↔ PTY host)
      // densable: after detach, if(X) process.stdout.write(BwH()) then cj_/createRoot.
      // BwH is emitted at end of attachToPtySession (enterAltScreenSequence).
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
      process.stdin.ref?.();
      process.stdin.unref?.();
    } catch {
      // ignore
    }
  }

  // Leave alt screen / restore cursor in case unmount raced with handoff.
  try {
    process.stdout.write('\x1b[?25h\x1b[0m');
  } catch {
    // ignore
  }

  return {
    resumeHintRequested,
    forkSessionId: options?.currentSessionId ?? options?.restoreSessionId ?? lastSelectedSessionId,
  };
}
