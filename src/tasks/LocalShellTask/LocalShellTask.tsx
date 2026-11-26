import { feature } from 'bun:bundle';
import { stat } from 'fs/promises';
import stripAnsi from 'strip-ansi';
import {
  getIsInteractive,
  getLastInteractionTime,
  getMainLoopBusy,
  getMainThreadAgentId,
} from '../../bootstrap/state.js';
import {
  NOTE_TAG,
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js';
import type { AppState } from '../../state/AppState.js';
import type { LocalShellSpawnInput, SetAppState, Task, TaskContext, TaskHandle } from '../../Task.js';
import { createTaskStateBase } from '../../Task.js';
import type { AgentId } from '../../types/ids.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { tailFile } from '../../utils/fsOperations.js';
import { logForDebugging } from '../../utils/debug.js';
import { logError } from '../../utils/log.js';
import {
  enqueuePendingNotification,
  getActiveMessageQueue,
  type MessageQueueInstance,
  type QueuedCommand,
} from '../../utils/messageQueueManager.js';
import {
  backgroundShellDeadlineMs,
  buildBashTaskDeliverySnapshot,
  isBackgroundShellDeadlineEnabled,
  isBashTaskGetDeliveryEnabled,
  readBashTaskSnapshotOutput,
  STOP_CAUSE_LONG,
  STOP_CAUSE_SHORT,
  type BashTaskStopCause,
} from '../../utils/bashTaskDelivery.js';
import { leftoverM, leftoverY } from '../../utils/leftoverOt.js';
import {
  getBashTaskDeliveryBag,
  rememberBashTaskSnapshot,
  withdrawQueuedBashTaskNotification,
} from '../../utils/bashTaskDeliveryOutcomes.js';
import type { ShellCommand } from '../../utils/ShellCommand.js';
import {
  appendTaskOutput,
  evictTaskOutput,
  getTaskOutputPath,
  getTaskOutputSize,
} from '../../utils/task/diskOutput.js';
import { formatLocalShellExitFooter, shouldAppendLocalShellExitFooter } from './exitFooter.js';
import {
  addKeepaliveReason,
  bashKeepaliveReason,
  monitorKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
} from '../../utils/task/framework.js';
import { createTaskRegistry, type TaskRegistry } from '../../utils/taskRegistry.js';
import { escapeXml } from '../../utils/xml.js';
import { backgroundAgentTask, isLocalAgentTask } from '../LocalAgentTask/LocalAgentTask.js';
import { isMainSessionTask } from '../LocalMainSessionTask.js';
import { type BashTaskKind, isLocalShellTask, type LocalShellFlavor, type LocalShellTaskState } from './guards.js';
import { killTask } from './killShellTasks.js';
import {
  evaluateMemoryPressureReap,
  getLastPressureReapAt,
  hasActiveAgentishTasks,
  setLastPressureReapAt,
  SHELL_PRESSURE_SKIP_LOG_THROTTLE_MS,
  shouldRegisterShellPressureReap,
} from './shellPressureReap.js';
import {
  exitSessionContext,
  getActiveSessionFromAls,
  getActiveSubconversationFromAls,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
  runWithSession,
  runWithSubconversationContext,
  type Session,
  type SubconversationAlsContext,
} from '../../utils/sessionRoot.js';

type CapturedShellAls = {
  session: Session | undefined;
  subconversation: SubconversationAlsContext | undefined;
};

const shellAlsByCommand = new WeakMap<object, CapturedShellAls>();

function captureCurrentShellAls(): CapturedShellAls {
  return {
    session: getActiveSessionFromAls(),
    subconversation: getActiveSubconversationFromAls(),
  };
}

function withCapturedShellAls<T>(captured: CapturedShellAls | undefined, fn: () => T): T {
  if (captured === undefined) {
    return fn();
  }
  const { session, subconversation } = captured;
  if (session === undefined && subconversation === undefined) {
    if (hasActiveSessionAls()) {
      return exitSessionContext(fn);
    }
    return fn();
  }
  if (getActiveSessionFromAls() === session && getActiveSubconversationFromAls() === subconversation) {
    return fn();
  }
  if (session === undefined) {
    return exitSessionContext(() => runWithSubconversationContext(subconversation!, fn));
  }
  return runWithSession(session, () =>
    subconversation !== undefined ? runWithSubconversationContext(subconversation, fn) : fn(),
  );
}

/** Prefix that identifies a LocalShellTask summary to the UI collapse transform. */
export const BACKGROUND_BASH_SUMMARY_PREFIX = 'Background command ';

/**
 * Official `E7` / `SU(text, 500, 300, JYn)` (2.1.321 #1956):
 * Truncate notification summaries over 1,000 characters by keeping the first
 * 500 chars and last 300 chars (preserving UTF-16 surrogate pairs).
 */
export const NOTIFICATION_SUMMARY_MAX_CHARS = 1000;
const NOTIFICATION_SUMMARY_HEAD_CHARS = 500;
const NOTIFICATION_SUMMARY_TAIL_CHARS = 300;

function sliceHeadSurrogateSafe(text: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastCode = slice.charCodeAt(maxLen - 1);
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? slice.slice(0, -1) : slice;
}

function sliceTailSurrogateSafe(text: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (text.length <= maxLen) return text;
  const slice = text.slice(-maxLen);
  const firstCode = slice.charCodeAt(0);
  return firstCode >= 0xdc00 && firstCode <= 0xdfff ? slice.slice(1) : slice;
}

export function truncateNotificationSummary(text: string): string {
  if (text.length <= NOTIFICATION_SUMMARY_MAX_CHARS) return text;
  const head = sliceHeadSurrogateSafe(text, NOTIFICATION_SUMMARY_HEAD_CHARS);
  const tail = sliceTailSurrogateSafe(text, NOTIFICATION_SUMMARY_TAIL_CHARS);
  const omitted = text.length - head.length - tail.length;
  return `${head}\n\n... [${omitted} characters truncated] ...\n\n${tail}`;
}

/**
 * densable ZV_ — default wall-clock cap for agent-scoped background shells (1h).
 * Main-session shells (agentId undefined) get no cap.
 */
export const DEFAULT_SUBAGENT_BG_SHELL_MAX_MS = 3_600_000;

/**
 * densable fkd(agentId) — resolve capMs for agent-scoped background shells.
 * - agentId undefined (main-thread FG→BG / Ctrl+B on main): no cap
 * - agent-scoped: CLAUDE_SUBAGENT_BG_SHELL_MAX_MS || 3600000
 */
function isMainThreadShellAgent(agentId: AgentId | undefined): boolean {
  if (agentId === undefined) return true;
  return agentId === getMainThreadAgentId();
}

/**
 * densable `KMt` — `innerCall===!0` → inner; `agentId===void 0` → turn; else agent.
 * Does not treat getMainThreadAgentId() as turn (gold compares undefined).
 */
export function shellCallerFromContext(ctx: { innerCall?: boolean; agentId?: AgentId }): 'inner' | 'turn' | 'agent' {
  if (ctx.innerCall === true) return 'inner';
  if (ctx.agentId === undefined) return 'turn';
  return 'agent';
}

export function resolveSubagentBgShellCapMs(agentId: AgentId | undefined): number | undefined {
  if (isMainThreadShellAgent(agentId)) return undefined;
  const raw = process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS;
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_SUBAGENT_BG_SHELL_MAX_MS;
}

const STALL_CHECK_INTERVAL_MS = 5_000;
const STALL_THRESHOLD_MS = 45_000;
const STALL_TAIL_BYTES = 1024;

// Last-line patterns that suggest a command is blocked waiting for keyboard
// input. Used to gate the stall notification — we stay silent on commands that
// are merely slow (git log -S, long builds) and only notify when the tail
// looks like an interactive prompt the model can act on. See CC-1175.
const PROMPT_PATTERNS = [
  /\(y\/n\)/i, // (Y/n), (y/N)
  /\[y\/n\]/i, // [Y/n], [y/N]
  /\(yes\/no\)/i,
  /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\? *$/i, // directed questions
  /Press (any key|Enter)/i,
  /Continue\?/i,
  /Overwrite\?/i,
];

export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.replace(/\r\n/g, '\n').trimEnd().split('\n').pop() ?? '';
  return PROMPT_PATTERNS.some(p => p.test(lastLine));
}

// Output-side analog of peekForStdinData (utils/process.ts): fire a one-shot
// notification if output stops growing and the tail looks like a prompt.
function startStallWatchdog(
  taskId: string,
  description: string,
  kind: BashTaskKind | undefined,
  toolUseId?: string,
  agentId?: AgentId,
): () => void {
  if (kind === 'monitor') return () => {};
  const capturedAls = captureCurrentShellAls();
  const outputPath = getTaskOutputPath(taskId);
  let lastSize = 0;
  let lastGrowth = Date.now();
  let cancelled = false;

  const timer = setInterval(() => {
    void stat(outputPath).then(
      s => {
        if (s.size > lastSize) {
          lastSize = s.size;
          lastGrowth = Date.now();
          return;
        }
        if (Date.now() - lastGrowth < STALL_THRESHOLD_MS) return;
        void tailFile(outputPath, STALL_TAIL_BYTES).then(
          ({ content }) => {
            if (cancelled) return;
            if (!looksLikePrompt(content)) {
              // Not a prompt — keep watching. Reset so the next check is
              // 45s out instead of re-reading the tail on every tick.
              lastGrowth = Date.now();
              return;
            }
            // Latch before the async-boundary-visible side effects so an
            // overlapping tick's callback sees cancelled=true and bails.
            cancelled = true;
            clearInterval(timer);
            withCapturedShellAls(capturedAls, () => {
              const toolUseIdLine = toolUseId
                ? `\n<${TOOL_USE_ID_TAG}>${escapeXml(toolUseId)}</${TOOL_USE_ID_TAG}>`
                : '';
              const summary = truncateNotificationSummary(
                `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" appears to be waiting for interactive input`,
              );
              const cleanedTail = stripAnsi(content).trimEnd();
              // No <status> tag — print.ts treats <status> as a terminal
              // signal and an unknown value falls through to 'completed',
              // falsely closing the task for SDK consumers. Statusless
              // notifications are skipped by the SDK emitter (progress ping).
              const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(taskId)}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${escapeXml(outputPath)}</${OUTPUT_FILE_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
Last output:
${cleanedTail}

The command is likely blocked on an interactive prompt. Stop this task and re-run with piped input (e.g., \`echo y | command\`) or a non-interactive flag if one exists.`;
              enqueuePendingNotification(
                {
                  value: message,
                  mode: 'task-notification',
                  skipAttachments: true,
                  priority: 'next',
                  agentId: agentId ?? getMainThreadAgentId(),
                },
                { turnAttribution: 'inherit' },
              );
              leftoverY('task_local_shell_stall_detected');
            });
          },
          () => {},
        );
      },
      () => {}, // File may not exist yet
    );
  }, STALL_CHECK_INTERVAL_MS);
  timer.unref();

  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}

/**
 * densable Ovu / monitor Gge portable: Gge(agentId, bash|monitor:id).
 * Returns dispose that tB's the same reason (bXi releaseBgCap / result.settle).
 * densable Ovu always calls Gge (no-op when agentId undefined); !pn is only for
 * agent/workflow child holds. Main-thread shells omit agentId → no panel owner.
 */
function attachShellKeepalive(
  taskId: string,
  agentId: AgentId | undefined,
  kind: BashTaskKind | undefined,
  registry: TaskRegistry,
): () => void {
  if (!agentId) {
    return () => {};
  }
  const reason = kind === 'monitor' ? monitorKeepaliveReason(taskId) : bashKeepaliveReason(taskId);
  addKeepaliveReason(agentId, reason, registry);
  return () => {
    removeKeepaliveReason(agentId, reason, registry);
  };
}

// ---------------------------------------------------------------------------
// Quiet Check-in Watchdog — Official `p1o` / `tUi` / `rUi`
// (`chunk@294254613.js @5722000-5725800`)
// ---------------------------------------------------------------------------

const QUIET_CHECKIN_MAX_POLL_MS = 60_000; // VBi
const QUIET_CHECKIN_MIN_THRESHOLD_MS = 10_000; // ZBi
const QUIET_CHECKIN_MAX_BACKOFF_EXP = 4; // f1o

export function getQuietCheckinThresholdMs(): number {
  const val = getFeatureValue_CACHED_MAY_BE_STALE('tengu_silent_heron', 0);
  return typeof val === 'number' && Number.isFinite(val) && val >= QUIET_CHECKIN_MIN_THRESHOLD_MS ? val : 0;
}

function formatQuietDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

type QuietCheckinWatch = {
  taskId: string;
  description: string;
  taskRegistry: TaskRegistry;
  toolUseId?: string;
  agentId?: AgentId;
  owner: QuietShellOwnerState;
  queue: MessageQueueInstance;
  capturedAls: CapturedShellAls;
  lastSize: number;
  lastOutputAt: number;
  getOutputSize: (taskId: string) => Promise<number>;
  getThresholdMs: () => number;
  getNow: () => number;
  getLastInteraction: () => number;
  isMainLoopBusy: () => boolean;
};

type QuietShellOwnerState = {
  agentId: AgentId;
  watches: Set<QuietCheckinWatch>;
  pollMs: number;
  timer: ReturnType<typeof setInterval> | undefined;
  lastPollAt: number;
  checkins: number;
  lastCheckinAt: number;
  previousCheckinAt: number;
};

const allQuietShellOwnerMaps = new Set<WeakRef<Map<AgentId, QuietShellOwnerState>>>();
const quietShellOwnersByHost = new HostSlot<Map<AgentId, QuietShellOwnerState>>(() => {
  const map = new Map<AgentId, QuietShellOwnerState>();
  if (allQuietShellOwnerMaps.size > 64) {
    for (const ref of allQuietShellOwnerMaps) {
      if (ref.deref() === undefined) {
        allQuietShellOwnerMaps.delete(ref);
      }
    }
  }
  allQuietShellOwnerMaps.add(new WeakRef(map));
  return map;
});

export function resetQuietCheckinOwnersForTests(): void {
  for (const ref of allQuietShellOwnerMaps) {
    const map = ref.deref();
    if (map === undefined) {
      allQuietShellOwnerMaps.delete(ref);
      continue;
    }
    for (const owner of map.values()) {
      if (owner.timer !== undefined) clearInterval(owner.timer);
      owner.watches.clear();
    }
    map.clear();
  }
}

function getQuietShellOwner(agentId: AgentId): QuietShellOwnerState {
  const quietShellOwners = quietShellOwnersByHost.of(getBootstrapSessionHost());
  const existing = quietShellOwners.get(agentId);
  if (existing !== undefined) return existing;
  const mainId = getMainThreadAgentId();
  for (const [key, state] of quietShellOwners) {
    if (state.watches.size === 0 && key !== mainId) {
      quietShellOwners.delete(key);
    }
  }
  const created: QuietShellOwnerState = {
    agentId,
    watches: new Set(),
    pollMs: 0,
    timer: undefined,
    lastPollAt: 0,
    checkins: 0,
    lastCheckinAt: 0,
    previousCheckinAt: 0,
  };
  quietShellOwners.set(agentId, created);
  return created;
}

function detachQuietWatch(watch: QuietCheckinWatch): void {
  const owner = watch.owner;
  owner.watches.delete(watch);
  if (owner.watches.size === 0 && owner.timer !== undefined) {
    clearInterval(owner.timer);
    owner.timer = undefined;
  }
}

function isQuietCheckinCommandForOwner(cmd: QueuedCommand, owner: QuietShellOwnerState): boolean {
  return (
    cmd.origin?.kind === 'task-notification' && cmd.origin.source === 'shell-checkin' && cmd.agentId === owner.agentId
  );
}

function evaluateQuietCheckinTick(
  owner: QuietShellOwnerState,
  watches: QuietCheckinWatch[],
  sizes: Array<number | undefined>,
): void {
  const firstWatch = watches[0];
  if (!firstWatch) return;
  const thresholdMs = firstWatch.getThresholdMs();
  if (owner.timer === undefined || thresholdMs <= 0) return;

  const now = firstWatch.getNow();
  const elapsedSincePoll = now - owner.lastPollAt - owner.pollMs;
  const suspendDrift = elapsedSincePoll > owner.pollMs ? elapsedSincePoll : 0;
  owner.lastPollAt = now;
  owner.lastCheckinAt = Math.min(now, owner.lastCheckinAt + suspendDrift);

  const lastInteraction = firstWatch.getLastInteraction();
  if (owner.agentId === getMainThreadAgentId() && lastInteraction > owner.lastCheckinAt) {
    owner.checkins = 0;
  }

  const eligible: Array<{ watch: QuietCheckinWatch; task: LocalShellTaskState }> = [];
  for (let idx = 0; idx < watches.length; idx++) {
    const watch = watches[idx]!;
    watch.lastOutputAt = Math.min(now, watch.lastOutputAt + suspendDrift);
    const size = sizes[idx];
    if (size === undefined || !owner.watches.has(watch)) continue;
    if (size > watch.lastSize) {
      watch.lastSize = size;
      watch.lastOutputAt = now;
    }
    const task = watch.taskRegistry.get(watch.taskId);
    if (
      isLocalShellTask(task) &&
      task.status === 'running' &&
      !task.notified &&
      task.shellCommand?.status === 'backgrounded'
    ) {
      eligible.push({ watch, task });
    }
  }

  const waitMs = thresholdMs * 2 ** Math.min(owner.checkins, QUIET_CHECKIN_MAX_BACKOFF_EXP);
  const candidate = eligible.find(({ watch }) => now - Math.max(watch.lastOutputAt, owner.lastCheckinAt) >= waitMs);
  if (candidate === undefined) return;
  if (now - lastInteraction < thresholdMs) return;
  if (candidate.watch.isMainLoopBusy() || hasActiveAgentishTasks(candidate.watch.taskRegistry.all())) return;
  if (candidate.watch.queue.peek(cmd => isQuietCheckinCommandForOwner(cmd, owner)) !== undefined) return;

  const { watch, task } = candidate;
  const silenceMs = now - watch.lastOutputAt;
  const othersList = eligible
    .filter(item => item !== candidate)
    .map(
      item =>
        `\n- ${item.watch.taskId} "${escapeXml(truncateNotificationSummary(item.watch.description))}": no new output for ${formatQuietDuration(now - item.watch.lastOutputAt)}, output file ${getTaskOutputPath(item.watch.taskId)}`,
    )
    .join('');
  const nextWaitMs = thresholdMs * 2 ** Math.min(owner.checkins + 1, QUIET_CHECKIN_MAX_BACKOFF_EXP);
  const outputPath = getTaskOutputPath(watch.taskId);
  const toolUseIdLine = watch.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${escapeXml(watch.toolUseId)}</${TOOL_USE_ID_TAG}>`
    : '';
  const summary = truncateNotificationSummary(
    `${BACKGROUND_BASH_SUMMARY_PREFIX}"${watch.description}" is still running after ${formatQuietDuration(now - task.startTime)}, with no new output for ${formatQuietDuration(silenceMs)}`,
  );
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(watch.taskId)}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${escapeXml(outputPath)}</${OUTPUT_FILE_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
This is a check-in, not a completion. The command may be working quietly, or it may be hung: waiting on a lock, on input, or on a process that will never exit. Find out which before you wait any longer: read its output file and look at its processes. If it is stuck, stop this task and get the work done another way. If it is making progress, or is meant to keep running (a server, a watcher), leave it and end your turn. The next check-in comes after another ${formatQuietDuration(nextWaitMs)} of silence.${
    othersList
      ? `\nIt speaks for your other background commands too, which get none of their own. Look at any that has been silent for longer than it should:${othersList}`
      : ''
  }`;

  watch.queue.enqueuePendingNotification(
    {
      value: message,
      mode: 'task-notification',
      origin: { kind: 'task-notification', source: 'shell-checkin', slug: watch.taskId },
      skipAttachments: true,
      priority: 'next',
      agentId: owner.agentId,
    },
    { turnAttribution: 'inherit' },
  );
  owner.previousCheckinAt = owner.lastCheckinAt;
  owner.lastCheckinAt = now;
  owner.checkins++;
  leftoverY('task_local_shell_quiet_checkin');
  logForDebugging(
    `LocalShellTask ${watch.taskId}: quiet check-in #${owner.checkins} for ${eligible.length} command(s) after ${silenceMs}ms of silence`,
  );
}

function pollQuietCheckinOwner(owner: QuietShellOwnerState): void {
  const watches = [...owner.watches];
  if (watches.length === 0) return;
  const capturedAls = watches[0]!.capturedAls;
  const thresholdMs = withCapturedShellAls(capturedAls, () => watches[0]!.getThresholdMs());
  if (thresholdMs <= 0) {
    watches.forEach(detachQuietWatch);
    return;
  }
  void Promise.all(
    watches.map(w => withCapturedShellAls(w.capturedAls, () => w.getOutputSize(w.taskId)).catch(() => undefined)),
  ).then(sizes => {
    withCapturedShellAls(capturedAls, () => {
      try {
        evaluateQuietCheckinTick(owner, watches, sizes);
      } catch (err) {
        watches.forEach(detachQuietWatch);
        leftoverM('task_local_shell_quiet_checkin', 'threw');
        logError(err);
      }
    });
  });
}

/**
 * Official `p1o` (`chunk@294254613.js @5722300`):
 * Register a background shell task for periodic quiet check-in notifications
 * (`shell-checkin` / `task_local_shell_quiet_checkin`) after extended silence.
 */
export function startQuietCheckin(
  opts: {
    taskId: string;
    description: string;
    taskRegistry: TaskRegistry;
    toolUseId?: string;
    kind?: BashTaskKind;
    agentId?: AgentId;
  },
  deps?: {
    queue?: MessageQueueInstance;
    thresholdMs?: number;
    pollMs?: number;
    getOutputSize?: (taskId: string) => Promise<number>;
    getNow?: () => number;
    getLastInteraction?: () => number;
    isMainLoopBusy?: () => boolean;
  },
): () => void {
  if (opts.kind === 'monitor') return () => {};
  const capturedAls = captureCurrentShellAls();
  const getThresholdMs = deps?.thresholdMs !== undefined ? () => deps.thresholdMs! : getQuietCheckinThresholdMs;
  const thresholdMs = getThresholdMs();
  if (thresholdMs <= 0) return () => {};
  if (!getIsInteractive() && deps?.thresholdMs === undefined) return () => {};

  const getNow = deps?.getNow ?? Date.now;
  const now = getNow();
  const ownerId = opts.agentId ?? getMainThreadAgentId();
  const owner = getQuietShellOwner(ownerId);
  const queue = deps?.queue ?? getActiveMessageQueue();

  const watch: QuietCheckinWatch = {
    taskId: opts.taskId,
    description: opts.description,
    taskRegistry: opts.taskRegistry,
    toolUseId: opts.toolUseId,
    agentId: opts.agentId,
    owner,
    queue,
    capturedAls,
    lastSize: 0,
    lastOutputAt: now,
    getOutputSize: deps?.getOutputSize ?? getTaskOutputSize,
    getThresholdMs,
    getNow,
    getLastInteraction: deps?.getLastInteraction ?? getLastInteractionTime,
    isMainLoopBusy: deps?.isMainLoopBusy ?? getMainLoopBusy,
  };

  owner.watches.add(watch);
  if (owner.timer === undefined) {
    owner.pollMs = deps?.pollMs ?? Math.min(QUIET_CHECKIN_MAX_POLL_MS, Math.ceil(thresholdMs / 4));
    owner.lastPollAt = now;
    owner.timer = setInterval(pollQuietCheckinOwner, owner.pollMs, owner);
    owner.timer.unref?.();
  }

  return () => {
    withCapturedShellAls(capturedAls, () => {
      detachQuietWatch(watch);
      const removed = queue.removeByFilter(cmd => isQuietCheckinCommandForOwner(cmd, owner));
      if (removed.length > 0) {
        owner.checkins = Math.max(0, owner.checkins - 1);
        owner.lastCheckinAt = owner.previousCheckinAt;
      }
    });
  };
}

/**
 * Official $xu / eqo (`chunk@294254613.js @5729800-5730800`) — register
 * `memoryPressure` listener for main-thread bg shells.
 * Only reaps when `level === 'critical'`, enforces 30m anti-churn
 * (`lastPressureReapAt` with no terminal input since), and verifies host memory
 * scarcity via `checkHostMemoryScarce()`.
 */
export function installShellPressureReap(
  taskId: string,
  description: string,
  registry: TaskRegistry,
  toolUseId?: string,
  kind?: BashTaskKind,
  agentId?: AgentId,
  testOverrides?: {
    isInteractive?: boolean;
    getLastInteraction?: () => number;
    isMainLoopBusy?: () => boolean;
    getNow?: () => number;
    checkHostMemory?: () => { scarce: boolean; detail: string };
  },
): () => void {
  const capturedAls = captureCurrentShellAls();
  if (
    !shouldRegisterShellPressureReap({
      agentId,
      kind,
      isInteractive: testOverrides?.isInteractive ?? getIsInteractive(),
    })
  ) {
    return () => {};
  }

  type MemoryPressureProcess = NodeJS.Process & {
    on(event: 'memoryPressure', listener: (level?: string) => void): NodeJS.Process;
    off(event: 'memoryPressure', listener: (level?: string) => void): NodeJS.Process;
  };
  const proc = process as MemoryPressureProcess;
  const skipLoggedAt = new Map<string, number>();

  const onPressure = (level?: string): void => {
    withCapturedShellAls(capturedAls, () => {
      try {
        const task = registry.get(taskId);
        if (
          !isLocalShellTask(task) ||
          task.status !== 'running' ||
          task.notified ||
          (task.shellCommand && task.shellCommand.status !== 'backgrounded')
        ) {
          return;
        }
        const now = testOverrides?.getNow ? testOverrides.getNow() : Date.now();
        const lastInteraction = testOverrides?.getLastInteraction
          ? testOverrides.getLastInteraction()
          : getLastInteractionTime();
        const decision = evaluateMemoryPressureReap({
          level,
          status: task.status,
          notified: task.notified,
          shellCommandStatus: task.shellCommand?.status,
          lastInteractionTime: lastInteraction,
          now,
          mainLoopBusy: testOverrides?.isMainLoopBusy ? testOverrides.isMainLoopBusy() : getMainLoopBusy(),
          hasActiveAgentTasks: hasActiveAgentishTasks(registry.all()),
          lastPressureReapAt: getLastPressureReapAt(),
          taskStartTime: task.startTime,
          checkHostMemory: testOverrides?.checkHostMemory,
        });
        if (!decision.shouldReap) {
          if (decision.skipReason !== undefined) {
            const prev = skipLoggedAt.get(decision.skipReason);
            if (prev === undefined || now - prev >= SHELL_PRESSURE_SKIP_LOG_THROTTLE_MS) {
              skipLoggedAt.set(decision.skipReason, now);
              logForDebugging(
                `LocalShellTask ${taskId}: memory-pressure reap skipped: ${decision.skipReason}${
                  decision.memoryDetail ? ` (${decision.memoryDetail})` : ''
                }`,
              );
            }
          }
          return;
        }
        logForDebugging(
          `LocalShellTask ${taskId}: reaped under critical memory pressure after ${Math.floor((now - lastInteraction) / 60_000)}m idle (${decision.memoryDetail})`,
        );
        leftoverY('task_local_shell_pressure_reap');
        setLastPressureReapAt(now);
        // Official F9r then t5e — notify first, then kill.
        void enqueueShellNotification(
          taskId,
          description,
          'killed',
          undefined,
          registry,
          toolUseId,
          kind ?? 'bash',
          agentId,
          'memory_pressure',
          undefined,
          capturedAls,
        );
        killTask(taskId, registry);
      } catch (err) {
        leftoverM('task_local_shell_pressure_reap', 'threw');
        logError(err);
      }
    });
  };

  proc.on('memoryPressure', onPressure);
  return () => {
    proc.off('memoryPressure', onPressure);
  };
}

/**
 * densable `xmn` deadline timer + `tengu_background_shell_settled`.
 * Pressure reap and keepalive stay on their existing hosts.
 */
/** densable `xmn` — background deadline timer. Exported for live Cvr tests. */
export function installBackgroundDeadline(
  taskId: string,
  description: string,
  registry: TaskRegistry,
  toolUseId: string | undefined,
  kind: BashTaskKind | undefined,
  agentId: AgentId | undefined,
  requestedTimeoutMs?: number,
): (outcome?: string) => void {
  const capturedAls = captureCurrentShellAls();
  const startedAt = Date.now();
  const deadlineMs = backgroundShellDeadlineMs(requestedTimeoutMs);
  const bag: { cause?: BashTaskStopCause } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (deadlineMs !== undefined) {
    timer = setTimeout(() => {
      withCapturedShellAls(capturedAls, () => {
        try {
          // densable Cvr: re-check gUr at fire.
          if (!isBackgroundShellDeadlineEnabled()) return;
          const task = registry.get(taskId);
          if (
            !isLocalShellTask(task) ||
            task.status !== 'running' ||
            task.notified ||
            task.shellCommand?.status !== 'backgrounded'
          ) {
            return;
          }
          bag.cause = 'deadline';
          // densable Cvr → Rmn: try notify, finally kill.
          try {
            void enqueueShellNotification(
              taskId,
              description,
              'killed',
              undefined,
              registry,
              toolUseId,
              kind ?? 'bash',
              agentId,
              'deadline',
              undefined,
              capturedAls,
            );
          } finally {
            killTask(taskId, registry);
          }
          leftoverY('task_local_shell_background_deadline');
          logForDebugging(`LocalShellTask ${taskId}: stopped at its ${deadlineMs}ms background deadline`);
        } catch (err) {
          leftoverM('task_local_shell_background_deadline', 'threw');
          logError(err);
        }
      });
    }, deadlineMs);
    timer.unref();
  }
  return outcome => {
    if (timer !== undefined) clearTimeout(timer);
    withCapturedShellAls(capturedAls, () => {
      logEvent('tengu_background_shell_settled', {
        elapsed_ms: Date.now() - startedAt,
        requested_timeout_ms: requestedTimeoutMs ?? 0,
        deadline_ms: deadlineMs ?? 0,
        outcome: (bag.cause ? 'killed' : (outcome ?? '')) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        stop_cause: (bag.cause ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        subagent_owned: agentId !== undefined,
      });
    });
  };
}

/** densable YVe return / Amn `terminalNotification`. */
export type ShellTerminalNotification = {
  taskId: string;
  toolUseId?: string;
  agentId?: AgentId;
  status: 'completed' | 'failed' | 'killed';
  summary: string;
  outputFile: string;
  stopCause?: BashTaskStopCause;
  snapshot?: unknown;
};

type CommandSemanticFn = (
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
) => { isError: boolean; message?: string };

function getShellCommandInterpreter(shell: LocalShellFlavor): CommandSemanticFn {
  if (shell === 'powershell') {
    // Lazy require avoids a TypeScript type-inference cycle through builtin-tools ↔ LocalShellTask.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/builtin-tools/tools/PowerShellTool/commandSemantics.js') as {
      interpretCommandResult: CommandSemanticFn;
    };
    return mod.interpretCommandResult;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@claude-code/builtin-tools/tools/BashTool/commandSemantics.js') as {
    interpretCommandResult: CommandSemanticFn;
  };
  return mod.interpretCommandResult;
}

/** densable `Zxn(exitCode, exitNote)` @179437571. */
function formatCompletedExitCodeSuffix(exitCode: number, exitNote?: string): string {
  return ` (exit code ${exitCode}${exitNote ? `: ${exitNote}` : ''})`;
}

/** densable `jhe(result, task)` @191205950 — semantic exit interpretation. */
export function interpretShellExitResult(
  result: {
    code: number;
    interrupted: boolean;
    stdout?: string;
    stderr?: string;
    noExitStatus?: boolean;
    preSpawnError?: string;
  },
  task: Pick<LocalShellTaskState, 'shell' | 'command'> | undefined,
): { status: 'completed' | 'failed' | 'killed'; exitNote: string | undefined } {
  if (result.interrupted) {
    return { status: 'killed', exitNote: undefined };
  }
  if (result.noExitStatus || result.preSpawnError) {
    return { status: 'failed', exitNote: undefined };
  }
  if (task?.shell === undefined) {
    return {
      status: result.code === 0 ? 'completed' : 'failed',
      exitNote: undefined,
    };
  }
  const interpret = getShellCommandInterpreter(task.shell);
  const { isError, message } = interpret(task.command, result.code, result.stdout ?? '', result.stderr ?? '');
  return isError ? { status: 'failed', exitNote: undefined } : { status: 'completed', exitNote: message };
}

export async function enqueueShellNotification(
  taskId: string,
  description: string,
  status: 'completed' | 'failed' | 'killed',
  exitCode: number | undefined,
  registry: TaskRegistry,
  toolUseId?: string,
  kind: BashTaskKind = 'bash',
  agentId?: AgentId,
  stopCause?: BashTaskStopCause,
  exitNote?: string,
  capturedAls?: CapturedShellAls,
): Promise<ShellTerminalNotification | undefined> {
  if (
    capturedAls !== undefined &&
    (getActiveSessionFromAls() !== capturedAls.session ||
      getActiveSubconversationFromAls() !== capturedAls.subconversation)
  ) {
    return withCapturedShellAls(capturedAls, () =>
      enqueueShellNotification(
        taskId,
        description,
        status,
        exitCode,
        registry,
        toolUseId,
        kind,
        agentId,
        stopCause,
        exitNote,
        capturedAls,
      ),
    );
  }
  // Atomically check and set notified flag to prevent duplicate notifications.
  // If the task was already marked as notified (e.g., by TaskStopTool), skip
  // enqueueing to avoid sending redundant messages to the model.
  let shouldEnqueue = false;
  let claimedTask: LocalShellTaskState | undefined;
  registry.update(taskId, task => {
    if (isLocalShellTask(task)) {
      claimedTask = task;
    }
    if (task.notified) {
      return task;
    }
    shouldEnqueue = true;
    return { ...task, notified: true };
  });

  if (!shouldEnqueue) {
    return;
  }

  // Read monitor output size and GetTask snapshot output BEFORE appending the
  // exit footer (`\n[exited with code 0]\n`), matching official Amn/YVe
  // (@191206900 / @191198850) so neither `outputBytes === 0` nor GetTask's
  // snapshot tail is polluted by the footer.
  let monitorOutputBytes: number | undefined;
  if (feature('MONITOR_TOOL')) {
    if (kind === 'monitor' && status === 'completed') {
      monitorOutputBytes = await getTaskOutputSize(taskId);
    }
  }
  const snapshotOutput =
    kind !== 'monitor' && isBashTaskGetDeliveryEnabled() && !claimedTask?.isAdopted && status !== 'killed'
      ? await readBashTaskSnapshotOutput(taskId)
      : undefined;

  // Official ADt: if(!u?.isAdopted) RW(`[exited with code ${r??"unknown"}]`)
  if (shouldAppendLocalShellExitFooter(claimedTask)) {
    appendTaskOutput(taskId, formatLocalShellExitFooter(status, exitCode));
  }

  // Gold YVe has no speculation abort (K3 claimed + IPe/y/m/Di only).

  let summary: string;
  if (feature('MONITOR_TOOL') && kind === 'monitor') {
    // Monitor is streaming-only (post-#22764) — the script exiting means
    // the stream ended, not "condition met". Distinct from the bash prefix
    // so Monitor completions don't fold into the "N background commands
    // completed" collapse.
    // densable 2.1.221 zZs: completed + output bytes === 0 → empty copy.
    const exitSuffix = exitCode !== undefined ? ` (exit ${exitCode})` : '';
    switch (status) {
      case 'completed': {
        const outputBytes = monitorOutputBytes ?? (await getTaskOutputSize(taskId));
        summary =
          outputBytes === 0
            ? `Monitor "${description}" ended without producing output${exitSuffix}`
            : `Monitor "${description}" stream ended`;
        break;
      }
      case 'failed':
        summary = `Monitor "${description}" script failed${exitSuffix}`;
        break;
      case 'killed':
        summary = `Monitor "${description}" stopped`;
        break;
    }
  } else {
    switch (status) {
      case 'completed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" completed${exitCode !== undefined ? formatCompletedExitCodeSuffix(exitCode, exitNote) : ''}`;
        break;
      case 'failed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" failed${exitCode !== undefined ? ` with exit code ${exitCode}` : ''}`;
        break;
      case 'killed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" was ${stopCause ? STOP_CAUSE_SHORT[stopCause] : 'stopped'}`;
        break;
    }
  }

  const outputPath = getTaskOutputPath(taskId);
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${escapeXml(toolUseId)}</${TOOL_USE_ID_TAG}>` : '';
  const stopNoteLine = stopCause ? `\n<${NOTE_TAG}>${escapeXml(STOP_CAUSE_LONG[stopCause])}</${NOTE_TAG}>` : '';
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(taskId)}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${escapeXml(outputPath)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(truncateNotificationSummary(summary))}</${SUMMARY_TAG}>${stopNoteLine}
</${TASK_NOTIFICATION_TAG}>`;

  let snapshot: ReturnType<typeof buildBashTaskDeliverySnapshot> | undefined;

  // gold Amn: if(Te&&s!=="monitor") Ui — live monitor XML is JCr'd from reportExit,
  // whereas adopted monitor shells (`wDo` @191203400) have no MonitorTool caller
  // and must enqueue their completion notification here.
  let enqueueXml = true;
  if (feature('MONITOR_TOOL')) {
    if (kind === 'monitor' && !claimedTask?.isAdopted) enqueueXml = false;
  }
  if (enqueueXml) {
    snapshot =
      kind !== 'monitor' && isBashTaskGetDeliveryEnabled()
        ? buildBashTaskDeliverySnapshot({
            taskId,
            outcome: status,
            exitCode: claimedTask?.isAdopted ? undefined : exitCode,
            startTime: claimedTask?.startTime ?? Date.now(),
            endTime: Date.now(),
            outputFile: outputPath,
            output: snapshotOutput,
            stopCause,
          })
        : undefined;
    if (snapshot !== undefined) {
      // densable YVe: Qn().withdrawShellNotification??=Rvr then remember.
      const bag = getBashTaskDeliveryBag();
      bag.withdrawShellNotification ??= withdrawQueuedBashTaskNotification;
      rememberBashTaskSnapshot(taskId, snapshot, agentId);
    }
    if (status === 'completed') leftoverY('task_local_shell');
    else if (status === 'failed') leftoverM('task_local_shell', 'task_local_shell_failed');
    // densable YVe does not y deadline — Cvr/xmn already did.
    // Main-thread enqueue often omits agentId; stamp mi() so withdraw match
    // (`cmd.agentId === n??Ve()`) cannot miss. Subagent owner is preserved.
    enqueuePendingNotification(
      {
        value: message,
        mode: 'task-notification',
        skipAttachments: true,
        priority: feature('MONITOR_TOOL') ? 'next' : 'later',
        agentId: agentId ?? getMainThreadAgentId(),
        taskId,
        ...(snapshot !== undefined && { taskDelivery: snapshot }),
      },
      { turnAttribution: 'inherit' },
    );
  }

  const payload: ShellTerminalNotification = {
    taskId,
    toolUseId,
    agentId,
    status,
    summary,
    outputFile: outputPath,
    ...(stopCause !== undefined ? { stopCause } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
  };

  // densable Ovu dual bookend: XML for model + once-gated SDK task_notification
  // so Host Tasks (Jp) closes without waiting for print→ask drain alone.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js');
    emitTaskTerminatedSdk(taskId, status === 'killed' ? 'stopped' : status, {
      toolUseId,
      summary,
      outputFile: outputPath,
    });
  } catch {
    // best-effort
  }
  return payload;
}

export const LocalShellTask: Task = {
  name: 'LocalShellTask',
  type: 'local_bash',
  async kill(taskId, registry) {
    killTask(taskId, registry);
  },
};

export type ShellTaskHandle = TaskHandle & {
  /** densable gRe `settled` — Amn result including monitor terminalNotification. */
  settled: Promise<{ terminalNotification?: ShellTerminalNotification }>;
};

export async function spawnShellTask(
  input: LocalShellSpawnInput & { shellCommand: ShellCommand },
  context: TaskContext,
): Promise<ShellTaskHandle> {
  const { command, description, shellCommand, toolUseId, agentId, kind, timeout, innerCall, shell, stopsOnExit } =
    input as typeof input & { stopsOnExit?: boolean };
  const capturedAls = shellAlsByCommand.get(shellCommand) ?? captureCurrentShellAls();
  if (!shellAlsByCommand.has(shellCommand)) {
    shellAlsByCommand.set(shellCommand, capturedAls);
  }
  const { setAppState, getAppState } = context;
  const registry = createTaskRegistry(getAppState, setAppState);

  // TaskOutput owns the data — use its taskId so disk writes are consistent
  const { taskOutput } = shellCommand;
  const taskId = taskOutput.taskId;

  const unregisterCleanup = registerCleanup(async () => {
    withCapturedShellAls(capturedAls, () => {
      killTask(taskId, registry);
    });
  });

  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    ...(shell !== undefined ? { shell } : {}),
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
    agentId,
    caller: shellCallerFromContext({ innerCall, agentId }),
    kind,
    ...(stopsOnExit ? { stopsOnExit: true } : {}),
  };

  registerTask(taskState, setAppState);

  // densable Ovu: Gge(agentId, bash|monitor:id) after register; dispose = tB
  const releaseShellKeepalive = attachShellKeepalive(taskId, agentId, kind, registry);

  // Official $xu — main-thread bg shells only (not monitor / not agent-scoped)
  const disposePressureReap = installShellPressureReap(taskId, description, registry, toolUseId, kind, agentId);

  // Data flows through TaskOutput automatically — no stream listeners needed.
  // Just transition to backgrounded state so the process keeps running.
  // densable Ppt: background(u, { capMs: kind !== 'monitor' ? fkd(agentId) : void 0 })
  shellCommand.background(taskId, {
    capMs: kind !== 'monitor' ? resolveSubagentBgShellCapMs(agentId) : undefined,
  });

  // densable xmn: h9n(timeout) timer; monitor skips.
  const disposeDeadline =
    kind !== 'monitor'
      ? installBackgroundDeadline(taskId, description, registry, toolUseId, kind, agentId, timeout)
      : () => {};

  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);
  const disposeQuietCheckin = startQuietCheckin({
    taskId,
    description,
    taskRegistry: registry,
    toolUseId,
    kind,
    agentId,
  });

  const settled = shellCommand.result.then(result =>
    withCapturedShellAls(capturedAls, async () => {
      cancelStallWatchdog();
      disposeQuietCheckin();
      disposePressureReap();
      await flushAndCleanup(shellCommand);
      let wasKilled = false;
      let settledExit = interpretShellExitResult(result, shell !== undefined ? { shell, command } : undefined);

      updateTaskState<LocalShellTaskState>(taskId, setAppState, task => {
        if (task.status === 'killed') {
          wasKilled = true;
          return task;
        }
        settledExit = interpretShellExitResult(result, task);

        return {
          ...task,
          status: settledExit.status,
          result: { code: result.code, interrupted: result.interrupted },
          shellCommand: null,
          unregisterCleanup: undefined,
          endTime: Date.now(),
        };
      });

      const finalStatus = wasKilled ? 'killed' : settledExit.status;
      const terminalNotification = await enqueueShellNotification(
        taskId,
        description,
        finalStatus,
        result.code,
        registry,
        toolUseId,
        kind,
        agentId,
        wasKilled && result.killedByBackgroundCap ? 'deadline' : undefined,
        wasKilled ? undefined : settledExit.exitNote,
        capturedAls,
      );

      // densable bXi: l?.() releaseBgCap after notify (tB bash|monitor:id)
      releaseShellKeepalive();
      disposeDeadline(finalStatus);

      void evictTaskOutput(taskId);
      return { terminalNotification };
    }),
  );

  return {
    taskId,
    cleanup: () => {
      unregisterCleanup();
    },
    settled,
  };
}

/**
 * Register a foreground task that could be backgrounded later.
 * Called when a bash command has been running long enough to show the BackgroundHint.
 * @returns taskId for the registered task
 */
export function registerForeground(
  input: LocalShellSpawnInput & {
    shellCommand: ShellCommand;
    onlyWaitsByLooking?: boolean;
  },
  setAppState: SetAppState,
  toolUseId: string | undefined,
  getAppState: () => AppState,
): string {
  const { command, description, shellCommand, agentId, innerCall, shell, onlyWaitsByLooking } = input;
  const capturedAls = captureCurrentShellAls();
  if (!shellAlsByCommand.has(shellCommand)) {
    shellAlsByCommand.set(shellCommand, capturedAls);
  }

  const taskId = shellCommand.taskOutput.taskId;

  const unregisterCleanup = registerCleanup(async () => {
    // densable zN(id, Xm) — kill always has registry. Production callers pass getAppState.
    withCapturedShellAls(capturedAls, () => {
      killTask(taskId, createTaskRegistry(getAppState, setAppState));
    });
  });

  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    ...(shell !== undefined ? { shell } : {}),
    ...(onlyWaitsByLooking === true ? { onlyWaitsByLooking: true } : {}),
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: false, // Not yet backgrounded - running in foreground
    agentId,
    caller: shellCallerFromContext({ innerCall, agentId }),
  };

  registerTask(taskState, setAppState);
  return taskId;
}

/**
 * Background a specific foreground shell task.
 * @returns true if backgrounded successfully, false otherwise
 */
/** densable `_un` / `XVe(e,n,r)` — n is Xm/taskRegistry. */
export function backgroundTask(
  taskId: string,
  registry: TaskRegistry,
  extras?: {
    backgroundedToDeliverMessage?: boolean;
    backgroundedByTurnAbort?: boolean;
  },
): boolean {
  const task = registry.get(taskId);
  if (!isLocalShellTask(task) || task.isBackgrounded || !task.shellCommand) {
    return false;
  }

  const shellCommand = task.shellCommand;
  const capturedAls = shellAlsByCommand.get(shellCommand) ?? captureCurrentShellAls();
  if (!shellAlsByCommand.has(shellCommand)) {
    shellAlsByCommand.set(shellCommand, capturedAls);
  }
  const description = task.description;
  const { toolUseId, kind, agentId } = task;

  return withCapturedShellAls(capturedAls, () => {
    // Transition to backgrounded — TaskOutput continues receiving data automatically
    // densable Tsn: background(e, { capMs: fkd(agentId) }) — Ctrl+B same cap as spawn
    if (
      !shellCommand.background(taskId, {
        capMs: resolveSubagentBgShellCapMs(agentId),
      })
    ) {
      return false;
    }

    let didBackground = false;
    registry.update(taskId, prevTask => {
      if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
        return prevTask;
      }
      didBackground = true;
      return { ...prevTask, isBackgrounded: true, ...extras };
    });
    // densable `_un` s.update → updateTaskState already emits task_updated.

    const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);
    const disposeQuietCheckin = startQuietCheckin({
      taskId,
      description,
      taskRegistry: registry,
      toolUseId,
      kind,
      agentId,
    });

    // densable xmn on Ctrl+B / tNr: pressure + h9n(undefined)
    const disposePressureReap = installShellPressureReap(taskId, description, registry, toolUseId, kind, agentId);
    const disposeDeadline = installBackgroundDeadline(taskId, description, registry, toolUseId, kind, agentId);

    // densable Ovu on mid-bg: Gge only once the shell is backgrounded
    const releaseShellKeepalive = attachShellKeepalive(taskId, agentId, kind, registry);

    // Set up result handler
    void shellCommand.result.then(result =>
      withCapturedShellAls(capturedAls, async () => {
        cancelStallWatchdog();
        disposeQuietCheckin();
        disposePressureReap();
        await flushAndCleanup(shellCommand);
        let wasKilled = false;
        let cleanupFn: (() => void) | undefined;
        let settledExit = interpretShellExitResult(result, task);

        registry.update<LocalShellTaskState>(taskId, t => {
          if (t.status === 'killed') {
            wasKilled = true;
            return t;
          }
          settledExit = interpretShellExitResult(result, t);

          // Capture cleanup function to call outside of updater
          cleanupFn = t.unregisterCleanup;

          return {
            ...t,
            status: settledExit.status,
            result: { code: result.code, interrupted: result.interrupted },
            shellCommand: null,
            unregisterCleanup: undefined,
            endTime: Date.now(),
          };
        });

        // Call cleanup outside of the state updater (avoid side effects in updater)
        cleanupFn?.();

        const finalStatus = wasKilled ? 'killed' : settledExit.status;
        await enqueueShellNotification(
          taskId,
          description,
          finalStatus,
          result.code,
          registry,
          toolUseId,
          kind,
          agentId,
          wasKilled && result.killedByBackgroundCap ? 'deadline' : undefined,
          wasKilled ? undefined : settledExit.exitNote,
          capturedAls,
        );

        releaseShellKeepalive();
        disposeDeadline(finalStatus);
        void evictTaskOutput(taskId);
      }),
    );

    // Official densable NZ6 returns true after shell.background succeeds; if
    // AppState was already backgrounded (race), still true — shell left FG.
    // Prefer reporting actual state flip for Host background_tasks response.
    return didBackground;
  });
}

/**
 * Background ALL foreground tasks (bash commands and agents).
 * Called when user presses Ctrl+B to background all running tasks.
 */
/**
 * Check if there are any foreground tasks (bash or agent) that can be backgrounded.
 * Used to determine whether Ctrl+B should background existing tasks vs. background the session.
 */
export function hasForegroundTasks(state: AppState): boolean {
  return Object.values(state.tasks).some(task => {
    if (isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand) {
      return true;
    }
    // Exclude main session tasks - they display in the main view, not as foreground tasks
    if (isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task)) {
      return true;
    }
    return false;
  });
}

export function backgroundAll(getAppState: () => AppState, setAppState: SetAppState): void {
  leftoverY('task_local_shell_background_all');
  const registry = createTaskRegistry(getAppState, setAppState);
  const state = getAppState();

  // Background all foreground bash tasks
  const foregroundBashTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand;
  });
  for (const taskId of foregroundBashTaskIds) {
    backgroundTask(taskId, registry);
  }

  // Background all foreground agent tasks (exclude main session — same
  // filter as hasForegroundTasks; Host background_tasks without tool_use_id).
  const foregroundAgentTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task);
  });
  for (const taskId of foregroundAgentTaskIds) {
    backgroundAgentTask(taskId, registry);
  }
}

/**
 * Official 2.1.x control `background_tasks` with tool_use_id (xPK densable).
 * Backgrounds the single foreground shell/agent task that originated from the
 * given tool_use block id.
 * @returns true if a matching task was backgrounded
 */
export function backgroundTaskByToolUseId(
  toolUseId: string,
  getAppState: () => AppState,
  setAppState: SetAppState,
): boolean {
  if (!toolUseId) {
    return false;
  }
  const state = getAppState();
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.toolUseId !== toolUseId) {
      continue;
    }
    if (isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand) {
      return backgroundTask(taskId, createTaskRegistry(getAppState, setAppState));
    }
    if (isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task)) {
      return backgroundAgentTask(taskId, createTaskRegistry(getAppState, setAppState));
    }
    // Matched tool_use_id but not backgroundable (already bg / terminal / main).
    return false;
  }
  return false;
}

/**
 * Background an already-registered foreground task in-place.
 * Unlike spawn(), this does NOT re-register the task — it flips isBackgrounded
 * on the existing registration and sets up a completion handler.
 * Used when the auto-background timer fires after registerForeground() has
 * already registered the task (avoiding duplicate task_started SDK events
 * and leaked cleanup callbacks).
 */
export function backgroundExistingForegroundTask(
  taskId: string,
  shellCommand: ShellCommand,
  description: string,
  setAppState: SetAppState,
  toolUseId: string | undefined,
  getAppState: () => AppState,
): boolean {
  const capturedAls = shellAlsByCommand.get(shellCommand) ?? captureCurrentShellAls();
  if (!shellAlsByCommand.has(shellCommand)) {
    shellAlsByCommand.set(shellCommand, capturedAls);
  }
  return withCapturedShellAls(capturedAls, () => {
    // Peek agentId before background so densable fkd cap can arm on auto-bg too.
    // densable YP/xmn always have Xm; production callers pass getAppState.
    let agentId: AgentId | undefined;
    const peek = getAppState().tasks[taskId];
    if (isLocalShellTask(peek)) {
      agentId = peek.agentId;
    }

    if (
      !shellCommand.background(taskId, {
        capMs: resolveSubagentBgShellCapMs(agentId),
      })
    ) {
      return false;
    }

    let didBackground = false;
    setAppState(prev => {
      const prevTask = prev.tasks[taskId];
      if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
        return prev;
      }
      agentId = prevTask.agentId;
      didBackground = true;
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: { ...prevTask, isBackgrounded: true },
        },
      };
    });
    // Official 2.1 task_updated only when state actually flipped.
    if (didBackground) {
      try {
        const { emitTaskUpdatedSdk } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('src/utils/sdkEventQueue.js') as typeof import('src/utils/sdkEventQueue.js');
        emitTaskUpdatedSdk(taskId, { is_backgrounded: true });
      } catch {
        // optional
      }
    }

    const cancelStallWatchdog = startStallWatchdog(taskId, description, undefined, toolUseId, agentId);

    // Official YJn → $xu: pressure reap on auto-backgrounded foreground tasks
    // densable xmn/Ovu always have Xm — do not skip Gge when owner keepalive should attach.
    const autoBgRegistry = createTaskRegistry(getAppState, setAppState);
    const disposeQuietCheckin = startQuietCheckin({
      taskId,
      description,
      taskRegistry: autoBgRegistry,
      toolUseId,
      agentId,
    });
    const disposePressureReap = installShellPressureReap(
      taskId,
      description,
      autoBgRegistry,
      toolUseId,
      undefined,
      agentId,
    );
    const disposeDeadline = installBackgroundDeadline(
      taskId,
      description,
      autoBgRegistry,
      toolUseId,
      undefined,
      agentId,
    );

    // densable Ovu on auto-bg: YP(agentId, bash:id, Xm) once backgrounded
    const releaseShellKeepalive = attachShellKeepalive(taskId, agentId, undefined, autoBgRegistry);

    // Set up result handler (mirrors backgroundTask's handler)
    void shellCommand.result.then(result =>
      withCapturedShellAls(capturedAls, async () => {
        cancelStallWatchdog();
        disposeQuietCheckin();
        disposePressureReap();
        await flushAndCleanup(shellCommand);
        let wasKilled = false;
        let cleanupFn: (() => void) | undefined;
        let settledExit = interpretShellExitResult(result, isLocalShellTask(peek) ? peek : undefined);

        updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
          if (t.status === 'killed') {
            wasKilled = true;
            return t;
          }
          settledExit = interpretShellExitResult(result, t);
          cleanupFn = t.unregisterCleanup;
          return {
            ...t,
            status: settledExit.status,
            result: { code: result.code, interrupted: result.interrupted },
            shellCommand: null,
            unregisterCleanup: undefined,
            endTime: Date.now(),
          };
        });

        cleanupFn?.();

        const finalStatus = wasKilled ? 'killed' : settledExit.status;
        await enqueueShellNotification(
          taskId,
          description,
          finalStatus,
          result.code,
          autoBgRegistry,
          toolUseId,
          undefined,
          agentId,
          wasKilled && result.killedByBackgroundCap ? 'deadline' : undefined,
          wasKilled ? undefined : settledExit.exitNote,
          capturedAls,
        );

        releaseShellKeepalive();
        disposeDeadline(finalStatus);
        void evictTaskOutput(taskId);
      }),
    );

    return didBackground;
  });
}

/**
 * Mark a task as notified to suppress a pending enqueueShellNotification.
 * Used when backgrounding raced with completion — the tool result already
 * carries the full output, so the <task_notification> would be redundant.
 */
export function markTaskNotified(taskId: string, setAppState: SetAppState): void {
  updateTaskState(taskId, setAppState, t => (t.notified ? t : { ...t, notified: true }));
}

/**
 * Unregister a foreground task when the command completes without being backgrounded.
 */
export function unregisterForeground(taskId: string, setAppState: SetAppState): void {
  let cleanupFn: (() => void) | undefined;

  setAppState(prev => {
    const task = prev.tasks[taskId];
    // Only remove if it's a foreground task (not backgrounded)
    if (!isLocalShellTask(task) || task.isBackgrounded) {
      return prev;
    }

    // Capture cleanup function to call outside of updater
    cleanupFn = task.unregisterCleanup;

    const { [taskId]: removed, ...rest } = prev.tasks;
    return { ...prev, tasks: rest };
  });

  // Call cleanup outside of the state updater (avoid side effects in updater)
  cleanupFn?.();
}

const OUTPUT_ENDED_WAIT_MS = 250;

async function flushAndCleanup(shellCommand: ShellCommand): Promise<void> {
  try {
    // Official 2.1.319 (#1741): await pipe outputEnded before flushing to disk
    // and emitting the completion notification so fast-exiting commands do not
    // drop output. Guarded with a bounded timer so stuck pipes or test mocks
    // whose outputEnded never resolves cannot hang settlement.
    if (shellCommand.outputEnded !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.resolve(shellCommand.outputEnded).catch(() => {}),
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, OUTPUT_ENDED_WAIT_MS);
          timer.unref?.();
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    }
    await shellCommand.taskOutput.flush();
    shellCommand.cleanup();
  } catch (error) {
    logError(error);
  }
}

// ---------------------------------------------------------------------------
// Official 2.1.331: Foreground Bash wait grace period after background jobs
// (`Sle` / `XJt` / `ePe` / `JJt` / `ZJt` / `eZt` / `tZt` / `tengu_bash_wait_after_jobs`).
// ---------------------------------------------------------------------------

/** Official GrowthBook flag (`JJt`) controlling wait-after-jobs mode (`'count' | 'end'`). */
export const BASH_WAIT_AFTER_JOBS_FLAG = 'tengu_breezy_wolf';

const SLEEP_COMMAND_MAX_LEN = 10_000;
const SLEEP_WAIT_MIN_SECONDS = 20;
const SLEEP_WAIT_GRACE_EXTRA_SECONDS = 3;
const WAIT_AFTER_JOBS_MIN_ELAPSED_MS = 60_000;
const SLEEP_UNIT_MULTIPLIERS: Record<string, number> = {
  m: 60,
  h: 3600,
  d: 86400,
};
const SLEEP_ARG_RE = /\bsleep(?:\s+-s(?:econds)?)?\s+(\d+(?:\.\d*)?)([smhd]?)\b/gi;
const BASH_SLEEP_LOOP_RE = /[;\n][ \t]*do\s(?:(?![;\n][ \t]*done\b)[\s\S])*?\bsleep\s|\b(?:until|while)\s+sleep\s/;
const PWSH_SLEEP_LOOP_RE =
  /(?:\b(?:do|for|foreach|until|while)\b|%)[^{]*\{(?:[^{}]|\{[^{}]*\})*?(?:\{[^{}]*?)?\bsleep\s/i;
const WAIT_AFTER_JOBS_ENTRYPOINTS = new Set(['cli', 'claude-vscode', 'claude-desktop']);
const ACTIVE_JOB_TASK_TYPES = new Set(['local_bash', 'local_agent', 'remote_agent', 'local_workflow', 'local_script']);

export type BashWaitAfterJobsMode = 'count' | 'end';

export type BashWaitAfterJobsEntry = {
  firstSeenAt: number;
  mode: BashWaitAfterJobsMode;
  graceMs: number;
  movedForJob: boolean;
};

/** Official `Sle` — per-toolUseId grace tracker stored in `toolUseContext.toolState`. */
export class BashWaitAfterJobsState {
  byCall = new Map<string, BashWaitAfterJobsEntry>();
}

/** Official `XJt` — compute grace seconds from max sleep inside a bash loop + 3s buffer. */
export function computeSleepWaitGraceSeconds(command: string): number {
  const maxSleepSecs = BASH_SLEEP_LOOP_RE.test(command)
    ? Math.max(
        0,
        ...Array.from(
          command.matchAll(SLEEP_ARG_RE),
          ([, num, unit]) => Number(num) * (SLEEP_UNIT_MULTIPLIERS[unit?.toLowerCase() ?? ''] ?? 1),
        ),
      )
    : 0;
  return maxSleepSecs + SLEEP_WAIT_GRACE_EXTRA_SECONDS;
}

/** Official `ePe` — detect long sleep (>= 20s) or polling sleep loop in bash/powershell. */
export function isSleepWaitCommand(command: string, shell: LocalShellFlavor = 'bash'): boolean {
  if (command.length > SLEEP_COMMAND_MAX_LEN) return false;
  const hasLongSleep = Array.from(command.matchAll(SLEEP_ARG_RE)).some(
    ([, num, unit]) => Number(num) * (SLEEP_UNIT_MULTIPLIERS[unit?.toLowerCase() ?? ''] ?? 1) >= SLEEP_WAIT_MIN_SECONDS,
  );
  if (hasLongSleep) return true;
  return (shell === 'powershell' ? PWSH_SLEEP_LOOP_RE : BASH_SLEEP_LOOP_RE).test(command);
}

/** Official `JJt` — read `tengu_breezy_wolf` mode (`'count' | 'end' | undefined`). */
export function getBashWaitAfterJobsMode(override?: string): BashWaitAfterJobsMode | undefined {
  const value = override !== undefined ? override : getFeatureValue_CACHED_MAY_BE_STALE(BASH_WAIT_AFTER_JOBS_FLAG, '');
  return value === 'count' || value === 'end' ? value : undefined;
}

/** Official `ZJt` — enabled on cli / claude-vscode / claude-desktop when `tengu_breezy_wolf` is `'count'` or `'end'`. */
export function isBashWaitAfterJobsEnabled(options?: { entrypoint?: string; modeOverride?: string }): boolean {
  const entrypoint = options?.entrypoint ?? process.env.CLAUDE_CODE_ENTRYPOINT ?? 'cli';
  return WAIT_AFTER_JOBS_ENTRYPOINTS.has(entrypoint) && getBashWaitAfterJobsMode(options?.modeOverride) !== undefined;
}

/** Official `ZYe` — strip `:preamble-...` suffix and omit `:inner` synthetic tool use IDs. */
export function sanitizeBashWaitToolUseId(toolUseId: string | undefined): string | undefined {
  if (toolUseId === undefined) return undefined;
  const preambleIdx = toolUseId.indexOf(':preamble-');
  const trimmed = preambleIdx === -1 ? toolUseId : toolUseId.slice(0, preambleIdx);
  if (trimmed.endsWith(':inner')) return undefined;
  return trimmed;
}

/**
 * Official 2.1.331 `eZt` — register `firstSeenAt`/`graceMs`/`mode`/`movedForJob`
 * in `state.byCall` and return `true` once when `mode === 'end'`, the call has
 * been running long enough (`elapsedLongEnough`), and `now - firstSeenAt >= graceMs`.
 */
export function shouldMoveBashWaitAfterJobs(
  state: BashWaitAfterJobsState,
  task: { toolUseId?: string; command: string },
  elapsedLongEnough: boolean,
  now: number = Date.now(),
  modeOverride?: string,
): boolean {
  const { toolUseId } = task;
  if (toolUseId === undefined) return false;
  let entry = state.byCall.get(toolUseId);
  if (entry === undefined) {
    const mode = getBashWaitAfterJobsMode(modeOverride);
    if (mode === undefined) return false;
    entry = {
      firstSeenAt: now,
      mode,
      graceMs: computeSleepWaitGraceSeconds(task.command) * 1000,
      movedForJob: false,
    };
    state.byCall.set(toolUseId, entry);
  }
  if (entry.mode !== 'end' || entry.movedForJob || !elapsedLongEnough || now - entry.firstSeenAt < entry.graceMs) {
    return false;
  }
  entry.movedForJob = true;
  return true;
}

/**
 * Official 2.1.331 `tZt` — on foreground Bash settle, delete the `byCall` entry
 * and emit `tengu_bash_wait_after_jobs` + `task_local_shell_wait_after_jobs`.
 */
export function recordBashWaitAfterJobsSettle(
  state: BashWaitAfterJobsState,
  toolUseId: string | undefined,
  result: {
    code: number;
    interrupted: boolean;
    timedOutAfterMs?: number;
    backgroundTaskId?: string;
  },
  now: number = Date.now(),
): boolean {
  const entry = toolUseId === undefined ? undefined : state.byCall.get(toolUseId);
  if (toolUseId === undefined || entry === undefined) return false;
  state.byCall.delete(toolUseId);
  const sanitizedToolUseId = sanitizeBashWaitToolUseId(toolUseId);
  logEvent('tengu_bash_wait_after_jobs', {
    enabled: entry.mode === 'end',
    wait_ms: now - entry.firstSeenAt,
    timeout_ms: entry.graceMs,
    timed_out: result.timedOutAfterMs !== undefined,
    was_backgrounded: result.backgroundTaskId !== undefined,
    interrupted: result.interrupted,
    exit_code: result.code,
    ...(sanitizedToolUseId !== undefined
      ? {
          tool_use_id: sanitizedToolUseId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
  });
  leftoverY('task_local_shell_wait_after_jobs');
  return true;
}

/**
 * Official 2.1.331 `xhs` (wait-after-jobs branch) — called on foreground Bash
 * progress ticks. If a completed/failed background `local_bash` notification is
 * queued while this sole foreground `onlyWaitsByLooking` task is waiting and no
 * other active non-monitor jobs remain, consult `shouldMoveBashWaitAfterJobs`
 * and background the wait command so the queued job completion can reach Claude.
 */
export function maybeMoveBashWaitForCompletedJobs(params: {
  state: BashWaitAfterJobsState;
  toolUseId: string | undefined;
  agentId: string | undefined;
  getAppState: () => AppState;
  setAppState: SetAppState;
  now?: number;
}): boolean {
  const { state, toolUseId, agentId, getAppState, setAppState, now = Date.now() } = params;
  if (toolUseId === undefined || agentId !== undefined) return false;
  try {
    const tasks = getAppState().tasks;
    const foregroundWait = Object.values(tasks).find(
      (t): t is LocalShellTaskState =>
        isLocalShellTask(t) &&
        t.status === 'running' &&
        !t.isBackgrounded &&
        t.toolUseId === toolUseId &&
        t.onlyWaitsByLooking === true,
    );
    if (!foregroundWait) return false;

    const queue = getActiveMessageQueue();
    const queuedCommands = queue.getCommandsByMaxPriority('next');
    const hasCompletedJobNotification = queuedCommands.some(cmd => {
      if (cmd.mode !== 'task-notification') return false;
      const taskId = cmd.taskId;
      if (!taskId) return false;
      const notifiedTask = tasks[taskId];
      return (
        isLocalShellTask(notifiedTask) &&
        notifiedTask.kind !== 'monitor' &&
        notifiedTask.onlyWaitsByLooking !== true &&
        (notifiedTask.status === 'completed' || notifiedTask.status === 'failed')
      );
    });
    if (!hasCompletedJobNotification) return false;

    const otherActiveJobRunning = Object.values(tasks).some(t => {
      if (t.status !== 'running' && t.status !== 'pending') return false;
      if (!ACTIVE_JOB_TASK_TYPES.has(t.type)) return false;
      if (isLocalShellTask(t) && (t.kind === 'monitor' || t.onlyWaitsByLooking === true)) {
        return false;
      }
      return true;
    });
    if (otherActiveJobRunning) return false;

    const elapsedLongEnough = now - foregroundWait.startTime >= WAIT_AFTER_JOBS_MIN_ELAPSED_MS;
    if (!shouldMoveBashWaitAfterJobs(state, foregroundWait, elapsedLongEnough, now)) {
      return false;
    }

    const registry = createTaskRegistry(getAppState, setAppState);
    return backgroundTask(foregroundWait.id, registry, {
      backgroundedToDeliverMessage: true,
    });
  } catch (err) {
    logError(err);
    return false;
  }
}
