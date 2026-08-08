import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import { getIsNonInteractiveSession, getSdkAgentProgressSummariesEnabled } from '../../bootstrap/state.js';
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
  WORKTREE_BRANCH_TAG,
  WORKTREE_PATH_TAG,
  WORKTREE_TAG,
} from '../../constants/xml.js';
import { abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import type { AppState } from '../../state/AppState.js';
import type { SetAppState, Task, TaskStateBase } from '../../Task.js';
import { createTaskStateBase, isTerminalTaskStatus } from '../../Task.js';
import type { Tools } from '../../Tool.js';
import { findToolByName } from '../../Tool.js';
import type { AgentToolResult } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js';
import { VERIFICATION_AGENT_TYPE } from '@claude-code/builtin-tools/tools/AgentTool/constants.js';
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js';
import { asAgentId } from '../../types/ids.js';
import type { AgentId } from '../../types/ids.js';
import type { Message } from '../../types/message.js';
import { createAbortController, createChildAbortController } from '../../utils/abortController.js';
import type { EffortValue } from '../../utils/effort.js';
import type { ActiveTaskExecutionContext } from '../../utils/tasks.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { getToolSearchOrReadInfo } from '../../utils/collapseReadSearch.js';
import { dequeueAllMatching, enqueuePendingNotification, getCommandQueue } from '../../utils/messageQueueManager.js';
import { logForDebugging } from '../../utils/debug.js';
import {
  getAgentTranscriptPath,
  isTranscriptPersistenceDisabled,
  readAgentMetadata,
  writeAgentMetadata,
} from '../../utils/sessionStorage.js';
import { stopObserverPairing } from '../../utils/observerAgents.js';
import { getTaskExecutionMetadata, getTaskListId, listTasks, markTaskCompletionSuggested } from '../../utils/tasks.js';
import {
  evictTaskOutput,
  getTaskOutputPath,
  initTaskOutput,
  initTaskOutputAsSymlink,
} from '../../utils/task/diskOutput.js';
import {
  addKeepaliveReason,
  agentKeepaliveReason,
  computePanelEvictAfter,
  hasLiveAgentKeepaliveChildren,
  idleWindowKeepaliveReason,
  IDLE_WINDOW_KEEPALIVE_REASON,
  IDLE_WINDOW_MS,
  isParkedKeepaliveAgent,
  registerTask,
  removeKeepaliveReason,
  sweepStaleKeepaliveReasons,
  updateTaskState,
} from '../../utils/task/framework.js';
import { emitTaskProgress } from '../../utils/task/sdkProgress.js';
import { createSignal } from '../../utils/signal.js';
import { roughTokenCountEstimationForMessages } from '../../services/tokenEstimation.js';
import { validateWorkerResult } from '../../coordinator/workerResultValidator.js';
import { escapeXml } from '../../utils/xml.js';
import type { TaskState } from '../types.js';

/**
 * densable Weo (`vs()` signal): fire agentId when DSu completes with
 * non-empty pendingMessages so REPL luf-hook can Qeo→Aye resume.
 */
export const strandedAgentResume = createSignal<[agentId: string]>();

/**
 * densable sqe pending entry: `{text, origin, isMeta}`.
 * `origin` mirrors densable promptOrigin (`kind: human|observer-activity|…`).
 */
export type PendingAgentMessageOrigin = {
  kind: string;
  [key: string]: unknown;
};

export type PendingAgentMessage = {
  text: string;
  origin?: PendingAgentMessageOrigin;
  isMeta: boolean;
};

export type QueuePendingMessageOpts = {
  origin?: PendingAgentMessageOrigin;
  isMeta?: boolean;
};

export type ToolActivity = {
  toolName: string;
  input: Record<string, unknown>;
  /** Pre-computed activity description from the tool, e.g. "Reading src/foo.ts" */
  activityDescription?: string;
  /** Pre-computed: true if this is a search operation (Grep, Glob, etc.) */
  isSearch?: boolean;
  /** Pre-computed: true if this is a read operation (Read, cat, etc.) */
  isRead?: boolean;
};

export type AgentProgress = {
  toolUseCount: number;
  tokenCount: number;
  lastActivity?: ToolActivity;
  recentActivities?: ToolActivity[];
  summary?: string;
};

const MAX_RECENT_ACTIVITIES = 5;

export type ProgressTracker = {
  toolUseCount: number;
  // Track input and output separately to avoid double-counting.
  // input_tokens in Claude API is cumulative per turn (includes all previous context),
  // so we keep the latest value. output_tokens is per-turn, so we sum those.
  latestInputTokens: number;
  cumulativeOutputTokens: number;
  recentActivities: ToolActivity[];
  /**
   * Incremental content-token estimate cache. getProgressUpdate used to re-scan
   * the entire message list on every progress tick (O(n) per call → O(n²) over
   * a long agent turn). We cache per-message estimates by identity + content
   * length so unchanged prefix messages are O(1) and only the growing tail is
   * re-estimated.
   */
  contentEstimateCache?: WeakMap<object, { contentLen: number; tokens: number }>;
};

export function createProgressTracker(): ProgressTracker {
  return {
    toolUseCount: 0,
    latestInputTokens: 0,
    cumulativeOutputTokens: 0,
    recentActivities: [],
  };
}

export function getTokenCountFromTracker(tracker: ProgressTracker): number {
  return tracker.latestInputTokens + tracker.cumulativeOutputTokens;
}

/**
 * Resolver function that returns a human-readable activity description
 * for a given tool name and input. Used to pre-compute descriptions
 * from Tool.getActivityDescription() at recording time.
 */
export type ActivityDescriptionResolver = (toolName: string, input: Record<string, unknown>) => string | undefined;

export function updateProgressFromMessage(
  tracker: ProgressTracker,
  message: Message,
  resolveActivityDescription?: ActivityDescriptionResolver,
  tools?: Tools,
): void {
  if (message.type !== 'assistant') {
    return;
  }

  // Tool activity is independent of usage — providers may omit usage on
  // intermediate assistant turns while still emitting tool_use blocks.
  for (const content of (message.message!.content ?? []) as Array<{ type: string; name?: string; input?: unknown }>) {
    if (content.type === 'tool_use') {
      tracker.toolUseCount++;
      // Omit StructuredOutput from preview - it's an internal tool
      if (content.name !== SYNTHETIC_OUTPUT_TOOL_NAME) {
        const input = content.input as Record<string, unknown>;
        const classification = tools ? getToolSearchOrReadInfo(content.name!, input, tools) : undefined;
        tracker.recentActivities.push({
          toolName: content.name!,
          input,
          activityDescription: resolveActivityDescription?.(content.name!, input),
          isSearch: classification?.isSearch,
          isRead: classification?.isRead,
        });
      }
    }
  }
  while (tracker.recentActivities.length > MAX_RECENT_ACTIVITIES) {
    tracker.recentActivities.shift();
  }

  const usage = message.message?.usage as BetaUsage | undefined;
  if (!usage) {
    return;
  }
  // Keep latest input (it's cumulative in the API), sum outputs.
  // Intermediate / tool-only assistant turns often report usage all-zeros
  // (streaming placeholders or providers that omit usage on tool rounds).
  // Never regress the high-water mark — that made the footer show
  // "↓ 0 tokens" after real usage had already been counted.
  //
  // Also: first-party streaming yields at content_block_stop with message_start
  // usage (often zeros for output), then mutates message.usage in place when
  // message_delta arrives. Callers must rebuild from messages after that
  // mutation (see rebuildProgressFromMessages) to pick up final counts.
  const inputTotal =
    (usage.input_tokens as number) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  if (inputTotal > 0) {
    tracker.latestInputTokens = inputTotal;
  }
  const outputTokens = usage.output_tokens as number;
  if (typeof outputTokens === 'number' && outputTokens > 0) {
    tracker.cumulativeOutputTokens += outputTokens;
  }
}

/**
 * Reset and recompute tracker state from a message list.
 *
 * Required because streaming providers often yield AssistantMessage before
 * final usage is known, then mutate `message.message.usage` in place when
 * message_delta arrives. Incremental updateProgressFromMessage at yield time
 * would permanently stick at 0 tokens.
 *
 * Usage is counted once per API response id (message.message.id). Parallel
 * tool-call streaming splits one response into multiple AssistantMessage
 * records that share the same id. First-party streaming also yields a separate
 * usage snapshot per content_block_stop and only writes final message_delta
 * usage onto the last sibling — so for a given id we must take the last usage
 * (last-wins), not the first. Summing every sibling would multi-count
 * output_tokens when they share one final usage object.
 */
export function rebuildProgressFromMessages(
  tracker: ProgressTracker,
  messages: readonly Message[],
  resolveActivityDescription?: ActivityDescriptionResolver,
  tools?: Tools,
): void {
  tracker.toolUseCount = 0;
  tracker.latestInputTokens = 0;
  tracker.cumulativeOutputTokens = 0;
  tracker.recentActivities = [];

  // Best usage per response id. Prefer the sibling whose usage scores highest:
  // message_delta usually lands on the last sibling, but some providers /
  // partial snapshots leave zeros on the last while an earlier sibling already
  // has real input counts. Max-score avoids "only first / stuck" footer tokens.
  const usageByResponseId = new Map<string, BetaUsage>();
  const anonymousUsages: BetaUsage[] = [];

  const scoreUsage = (usage: BetaUsage): number => {
    const inputTotal =
      (usage.input_tokens as number) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const outputTokens = typeof usage.output_tokens === 'number' ? (usage.output_tokens as number) : 0;
    return Math.max(0, inputTotal) + Math.max(0, outputTokens);
  };

  for (const message of messages) {
    if (message.type !== 'assistant') {
      continue;
    }

    // Always collect tool activity from every split record.
    for (const content of (message.message?.content ?? []) as Array<{
      type: string;
      name?: string;
      input?: unknown;
    }>) {
      if (content.type === 'tool_use') {
        tracker.toolUseCount++;
        if (content.name !== SYNTHETIC_OUTPUT_TOOL_NAME) {
          const input = content.input as Record<string, unknown>;
          const classification = tools ? getToolSearchOrReadInfo(content.name!, input, tools) : undefined;
          tracker.recentActivities.push({
            toolName: content.name!,
            input,
            activityDescription: resolveActivityDescription?.(content.name!, input),
            isSearch: classification?.isSearch,
            isRead: classification?.isRead,
          });
        }
      }
    }
    while (tracker.recentActivities.length > MAX_RECENT_ACTIVITIES) {
      tracker.recentActivities.shift();
    }

    const usage = message.message?.usage as BetaUsage | undefined;
    if (!usage) {
      continue;
    }

    const responseId =
      message.message && 'id' in message.message && typeof message.message.id === 'string'
        ? message.message.id
        : undefined;
    if (responseId) {
      const prev = usageByResponseId.get(responseId);
      if (!prev || scoreUsage(usage) >= scoreUsage(prev)) {
        usageByResponseId.set(responseId, usage);
      }
    } else {
      anonymousUsages.push(usage);
    }
  }

  for (const usage of [...usageByResponseId.values(), ...anonymousUsages]) {
    const inputTotal =
      (usage.input_tokens as number) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    if (inputTotal > 0) {
      // Input is cumulative per Claude turn — keep high-water across turns.
      tracker.latestInputTokens = Math.max(tracker.latestInputTokens, inputTotal);
    }
    const outputTokens = usage.output_tokens as number;
    if (typeof outputTokens === 'number' && outputTokens > 0) {
      tracker.cumulativeOutputTokens += outputTokens;
    }
  }
}

/**
 * Content-length fingerprint for a message so we can reuse cached estimates
 * when the object is mutated in place (streaming usage/content updates) or
 * when the prefix of the array is stable across ticks.
 */
function messageContentLen(message: Message): number {
  try {
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (typeof content === 'string') return content.length;
    if (Array.isArray(content)) {
      let n = 0;
      for (const block of content) {
        if (typeof block === 'string') n += block.length;
        else if (block && typeof block === 'object') {
          const b = block as { text?: string; thinking?: string; input?: unknown };
          if (typeof b.text === 'string') n += b.text.length;
          if (typeof b.thinking === 'string') n += b.thinking.length;
          if (b.input !== undefined) {
            // Cheap structural size — avoid full JSON stringify of huge inputs.
            n += typeof b.input === 'string' ? b.input.length : 64;
          }
        }
      }
      return n;
    }
  } catch {
    // ignore
  }
  return 0;
}

/**
 * Estimate content tokens with a per-tracker cache so repeated progress ticks
 * on a long transcript do not re-walk every prior message (O(n²) over a turn).
 */
export function estimateContentTokensCached(tracker: ProgressTracker, messages: readonly Message[]): number {
  if (!tracker.contentEstimateCache) {
    tracker.contentEstimateCache = new WeakMap();
  }
  const cache = tracker.contentEstimateCache;
  let total = 0;
  for (const message of messages) {
    const len = messageContentLen(message);
    // WeakMap keys must be objects; non-object messages fall through to estimate.
    // contentLen invalidates when streaming mutates text in place.
    if (message && typeof message === 'object') {
      const hit = cache.get(message);
      if (hit && hit.contentLen === len) {
        total += hit.tokens;
        continue;
      }
      const tokens = roughTokenCountEstimationForMessages([message]);
      cache.set(message, { contentLen: len, tokens });
      total += tokens;
    } else {
      total += roughTokenCountEstimationForMessages([message]);
    }
  }
  return total;
}

export function getProgressUpdate(tracker: ProgressTracker, messages?: readonly Message[]): AgentProgress {
  let tokenCount = getTokenCountFromTracker(tracker);
  // Gateways / partial streams often leave usage at zeros for long stretches,
  // or only attach usage on an early sibling while later content has zero
  // usage. Always take max(usage, contentEstimate) so the footer keeps
  // growing when the agent is clearly producing tokens after a non-zero
  // first update (no-regress alone would freeze on the early usage total).
  if (messages && messages.length > 0) {
    const estimated = estimateContentTokensCached(tracker, messages);
    if (estimated > tokenCount) {
      tokenCount = estimated;
    }
  }
  return {
    toolUseCount: tracker.toolUseCount,
    tokenCount,
    lastActivity:
      tracker.recentActivities.length > 0 ? tracker.recentActivities[tracker.recentActivities.length - 1] : undefined,
    recentActivities: [...tracker.recentActivities],
  };
}

/**
 * Schedule a progress rebuild after the current stream turn yields.
 *
 * First-party streaming yields AssistantMessage at content_block_stop with
 * partial/zero usage, then mutates `message.message.usage` in place when
 * message_delta arrives — often with no further yields until the next tool
 * result / API turn. Without a deferred rebuild, the footer freezes at the
 * first non-zero (or zero) snapshot for the entire tool-execution gap.
 *
 * Multiple delays: some proxies attach usage slightly after the local event
 * loop drains microtasks; re-probe at 0/50/250ms while still on the same turn.
 */
/**
 * Per-task deferred rebuild timers. Each schedule cancels prior timers for the
 * same taskId so long agents do not pile O(n) rebuildProgressFromMessages.
 * Generation tokens also invalidate in-flight queueMicrotask callbacks that
 * clearTimeout cannot cancel.
 */
const deferredProgressRebuildTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
const deferredProgressRebuildGeneration = new Map<string, number>();

/** Cancel deferred progress rebuild timers for one agent (complete/kill/fail). */
export function clearDeferredAgentProgressRebuild(taskId: string): void {
  const timers = deferredProgressRebuildTimers.get(taskId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    deferredProgressRebuildTimers.delete(taskId);
  }
  // Bump generation so already-queued microtasks no-op even if timers were empty.
  deferredProgressRebuildGeneration.set(taskId, (deferredProgressRebuildGeneration.get(taskId) ?? 0) + 1);
}

/** @internal test helper — clear all deferred rebuild timers. */
export function clearAllDeferredAgentProgressRebuildsForTests(): void {
  for (const taskId of [
    ...new Set([...deferredProgressRebuildTimers.keys(), ...deferredProgressRebuildGeneration.keys()]),
  ]) {
    clearDeferredAgentProgressRebuild(taskId);
  }
  deferredProgressRebuildGeneration.clear();
}

export function scheduleDeferredAgentProgressRebuild(
  taskId: string,
  tracker: ProgressTracker,
  messages: readonly Message[],
  setAppState: SetAppState,
  resolveActivityDescription?: ActivityDescriptionResolver,
  tools?: Tools,
): void {
  clearDeferredAgentProgressRebuild(taskId);
  const generation = (deferredProgressRebuildGeneration.get(taskId) ?? 0) + 1;
  deferredProgressRebuildGeneration.set(taskId, generation);
  const run = (): void => {
    // Cancelled by clearDeferred / re-schedule (microtasks are not clearTimeout-able).
    if (deferredProgressRebuildGeneration.get(taskId) !== generation) return;
    // Skip after task left running (complete/kill/fail), even if a timeout races.
    let stillRunning = false;
    setAppState(prev => {
      const t = prev.tasks?.[taskId];
      stillRunning = t?.type === 'local_agent' && t.status === 'running';
      return prev;
    });
    if (!stillRunning) return;
    if (deferredProgressRebuildGeneration.get(taskId) !== generation) return;
    rebuildProgressFromMessages(tracker, messages, resolveActivityDescription, tools);
    updateAgentProgress(taskId, getProgressUpdate(tracker, messages), setAppState);
  };
  // Two ticks: message_delta is applied after the yield returns into the
  // generator; a single queueMicrotask can still race the mutation.
  queueMicrotask(() => {
    queueMicrotask(run);
  });
  const timers: ReturnType<typeof setTimeout>[] = [setTimeout(run, 0), setTimeout(run, 50), setTimeout(run, 250)];
  deferredProgressRebuildTimers.set(taskId, timers);
}

/**
 * Creates an ActivityDescriptionResolver from a tools list.
 * Looks up the tool by name and calls getActivityDescription if available.
 */
export function createActivityDescriptionResolver(tools: Tools): ActivityDescriptionResolver {
  return (toolName, input) => {
    const tool = findToolByName(tools, toolName);
    return tool?.getActivityDescription?.(input) ?? undefined;
  };
}

export type LocalAgentTaskState = TaskStateBase & {
  type: 'local_agent';
  agentId: string;
  prompt: string;
  selectedAgent?: AgentDefinition;
  agentType: string;
  model?: string;
  /**
   * densable 214: effort stamped at register (from agent definition).
   * Surfaced on subagentStatusLine payload as `effort`.
   */
  effort?: EffortValue;
  activeTaskExecutionContext?: ActiveTaskExecutionContext;
  ownedFiles?: string[];
  notificationTargetAgentId?: AgentId;
  abortController?: AbortController;
  unregisterCleanup?: () => void;
  error?: string;
  result?: AgentToolResult;
  progress?: AgentProgress;
  retrieved: boolean;
  messages?: Message[];
  // Track what we last reported for computing deltas
  lastReportedToolCount: number;
  lastReportedTokenCount: number;
  // Whether the task has been backgrounded (false = foreground running, true = backgrounded)
  isBackgrounded: boolean;
  /**
   * densable sqe/Qeo pending queue — objects `{text, origin, isMeta}` (not bare
   * strings). Drained at tool-round boundaries and on Weo stranded resume.
   */
  pendingMessages: PendingAgentMessage[];
  /**
   * densable local_agent isIdle (Yqe D): true only when every in-flight tool is a
   * nested Agent/Task spawn — panel shows "waiting". Not teammate park/idle.
   * false when no tools in flight or any non-Agent tool is running.
   */
  isIdle: boolean;
  // UI is holding this task: blocks eviction, enables stream-append, triggers
  // disk bootstrap. Set by enterTeammateView. Separate from viewingAgentTaskId
  // (which is "what am I LOOKING at") — retain is "what am I HOLDING."
  retain: boolean;
  // Bootstrap has read the sidechain JSONL and UUID-merged into messages.
  // One-shot per retain cycle; stream appends from there.
  diskLoaded: boolean;
  // Panel visibility deadline. undefined = no deadline (running or retained);
  // timestamp = hide + GC-eligible after this time. Set at terminal transition
  // and on unselect; cleared on retain.
  evictAfter?: number;
  /**
   * Official ownerAgentId — parent agent holding this task for keepalive /
   * notification routing (PSu resume + Gge/tB).
   */
  ownerAgentId?: string;
  /** Official parentAgentId — spawn tree parent (adopt rehydrate). */
  parentAgentId?: string;
  /** Official spawnDepth — adopt tree order (r4d sort / ekg merge). */
  spawnDepth?: number;
  /**
   * Official isObserver — observer-activity spawns; ekg merge carries when set.
   */
  isObserver?: boolean;
  /**
   * Official keepaliveReasons — Set of reason strings (`workflow:id`,
   * `agent:id`, `bash:id`, `monitor:id`, `flag:idle-window`). Non-empty
   * blocks eviction (zle/tB); Gge adds, tB removes.
   */
  keepaliveReasons?: Set<string>;
  /**
   * Official quietlyParked — parked agent marked notified without a user-facing
   * queue drain (Kle). XV kill of YC+quietlyParked clears notified so BRt can
   * re-notify as killed.
   */
  quietlyParked?: boolean;
  /**
   * Official stoppedByUser (hAe) — user-initiated stop marker.
   */
  stoppedByUser?: boolean;
  /**
   * Official XV killedBy — who initiated the kill. Stamped on status:"killed".
   * BRt summary: parent→"was stopped by Claude", user→"was stopped by user".
   */
  killedBy?: 'user' | 'parent' | 'system';
  /**
   * densable Aye `resuming` CAS gate — set true while resume setup runs
   * (before status becomes running again). Concurrent Aye throws B6 when
   * status==="running" || resuming.
   */
  resuming?: boolean;
  /**
   * Product UX: PSu adopt placeholder is status:"completed" so Aye CAS can
   * claim (must not set resuming/running). Panel treats this as non-done
   * ("resuming") until Aye claim / alreadyCompleted / re-register clears it.
   * Ignored by tryClaimAgentResume.
   */
  adoptResumePending?: boolean;
  /**
   * densable 2.1.218 wvo `forkedSkillName` — skill name that launched this
   * background agent. Used to dedupe live forked-skill duplicates.
   */
  forkedSkillName?: string;
};

function initAgentTaskOutput(agentId: string): void {
  if (isTranscriptPersistenceDisabled()) {
    void initTaskOutput(agentId);
    return;
  }
  void initTaskOutputAsSymlink(agentId, getAgentTranscriptPath(asAgentId(agentId)));
}

function evictAgentTaskOutputIfPersistent(taskId: string): void {
  if (!isTranscriptPersistenceDisabled()) {
    void evictTaskOutput(taskId);
  }
}

/**
 * densable Yqe D: `te = $.size>0 && $.size===N.size`
 * N = all in-flight tool_use ids; $ = subset whose name is Agent (or legacy Task).
 * isIdle only when parent is blocked solely on nested agent tool results.
 */
export function computeLocalAgentIsIdle(
  inFlightToolUseIds: ReadonlySet<string>,
  nestedAgentToolUseIds: ReadonlySet<string>,
): boolean {
  return nestedAgentToolUseIds.size > 0 && nestedAgentToolUseIds.size === inFlightToolUseIds.size;
}

/** densable Sot/OSu/Yqe — stamp isIdle without churning AppState when unchanged. */
export function updateLocalAgentIsIdle(taskId: string, isIdle: boolean, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.isIdle === isIdle) return task;
    return { ...task, isIdle };
  });
}

export function isLocalAgentTask(task: unknown): task is LocalAgentTaskState {
  return typeof task === 'object' && task !== null && 'type' in task && task.type === 'local_agent';
}

/**
 * densable Aye CAS:
 *   if (Wl(_)) {
 *     pe=false; update: if status==="running"||resuming return same; else pe=true, resuming:!0
 *     if (!pe) throw B6("already running or being resumed")
 *   }
 * No-op (ok) when task is not in registry (cold resume from disk only).
 * Returns true if claim applied (or no task to claim); false if blocked.
 *
 * Prefer passing getAppState so missing-task short-circuit matches densable Wl(_).
 */
export function tryClaimAgentResume(agentId: string, setAppState: SetAppState, getAppState?: () => AppState): boolean {
  // Peek: no local_agent task → densable skips CAS entirely (cold disk resume).
  // Prefer getAppState when provided so blocked (running/resuming) short-circuits
  // without a write; update path still enforces CAS under concurrent setAppState.
  if (getAppState) {
    const cur = getAppState().tasks?.[agentId];
    if (!isLocalAgentTask(cur)) return true;
    if (cur.status === 'running' || cur.resuming) return false;
  }

  let claimed = false;
  let seen = false;
  updateTaskState<LocalAgentTaskState>(agentId, setAppState, task => {
    seen = true;
    if (task.status === 'running' || task.resuming) {
      return task;
    }
    claimed = true;
    // Clear adopt placeholder when CAS takes over (resuming is the setup gate).
    return { ...task, resuming: true, adoptResumePending: false };
  });
  // Missing task → densable Wl(_) false → cold resume ok.
  // Seen but not claimed → blocked (running/resuming). Never treat blocked as cold.
  if (!seen) return true;
  return claimed;
}

/**
 * densable Aye S(): clear resuming flag after failed setup paths.
 *   g.update(e, pe => pe.resuming ? {...pe, resuming:!1} : pe)
 */
export function clearAgentResuming(agentId: string, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(agentId, setAppState, task => {
    if (!task.resuming && !task.adoptResumePending) return task;
    return { ...task, resuming: false, adoptResumePending: false };
  });
}

/**
 * Panel "active" for local_agent: non-terminal, or densable YC keepalive hold,
 * or product adopt/Aye in-flight (completed placeholder + resuming CAS).
 * Does not affect tryClaimAgentResume (CAS still only running||resuming).
 */
export function isLocalAgentPanelActive(task: LocalAgentTaskState): boolean {
  if (task.status === 'running') return true;
  if (task.resuming || task.adoptResumePending) return true;
  if (task.status === 'completed' && (task.keepaliveReasons?.size ?? 0) > 0) {
    return true;
  }
  return false;
}

/**
 * A local_agent task that the CoordinatorTaskPanel manages (not main-session).
 * For ants, these render in the panel instead of the background-task pill.
 * This is the ONE predicate that all pill/panel filters must agree on — if
 * the gate changes, change it here.
 */
export function isPanelAgentTask(t: unknown): t is LocalAgentTaskState {
  return isLocalAgentTask(t) && t.agentType !== 'main-session';
}

/**
 * densable OH(task): local_agent && isObserver===true
 */
export function isObserverAgentTask(t: unknown): t is LocalAgentTaskState {
  return isLocalAgentTask(t) && t.isObserver === true;
}

/**
 * densable Beo(child, ancestorId, tasks): walk child.parentAgentId chain for ancestor.
 * Used by H1e parked cascade and ySr/gtf panel descendant kill.
 */
export function isDescendantAgentOf(
  child: { parentAgentId?: string },
  ancestorId: string | undefined | null,
  tasks: Record<string, TaskState | undefined>,
): boolean {
  if (!ancestorId) return false;
  const seen = new Set<string>();
  let cursor: string | undefined = typeof child.parentAgentId === 'string' ? child.parentAgentId : undefined;
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    const node = tasks[cursor];
    cursor =
      node !== undefined &&
      node.type === 'local_agent' &&
      typeof (node as LocalAgentTaskState).parentAgentId === 'string'
        ? (node as LocalAgentTaskState).parentAgentId
        : undefined;
  }
  return false;
}

/**
 * densable Gzg(e, agentType): persist stoppedByUser on agent sidecar meta.
 * Fire-and-forget; inaccessible FS is logged and swallowed.
 */
export async function persistAgentStoppedByUser(taskId: string, agentType: string): Promise<void> {
  try {
    const id = asAgentId(taskId);
    const prev = await readAgentMetadata(id);
    if (prev?.stoppedByUser) return;
    await writeAgentMetadata(id, {
      ...(prev ?? { agentType }),
      agentType: prev?.agentType ?? agentType,
      stoppedByUser: true,
    });
  } catch (e) {
    logForDebugging(`failed to persist stop marker for ${taskId}: ${String(e)}`);
  }
}

/**
 * densable hAe(id, registry): stamp stoppedByUser in-memory + Gzg disk sidecar.
 */
export function markAgentStoppedByUser(taskId: string, setAppState: SetAppState): void {
  let agentType: string | undefined;
  let shouldPersist = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.stoppedByUser) return task;
    shouldPersist = true;
    agentType = typeof task.agentType === 'string' && task.agentType.length > 0 ? task.agentType : 'general-purpose';
    return { ...task, stoppedByUser: true };
  });
  if (shouldPersist && agentType) {
    void persistAgentStoppedByUser(taskId, agentType);
  }
}

/**
 * densable Aye clear of disk stoppedByUser when userInitiated resume proceeds.
 */
export async function clearAgentStoppedByUser(taskId: string): Promise<void> {
  try {
    const id = asAgentId(taskId);
    const prev = await readAgentMetadata(id);
    if (!prev?.stoppedByUser) return;
    const { stoppedByUser: _cleared, ...rest } = prev;
    await writeAgentMetadata(id, rest);
  } catch (e) {
    logForDebugging(`failed to clear stop marker for ${taskId}: ${String(e)}`);
  }
}

/**
 * densable gtf(parentTask, registry, {source}): kill running/YC descendants
 * whose parentAgentId chain reaches parent.agentId.
 * Panel kill (ySr) always cascades; H1e only when target was zle/YC.
 * densable: source=user && OH → Fjr observer tombstone before kill.
 */
export function killDescendantAgents(
  parent: { id: string; agentId?: string },
  getAppState: () => Pick<AppState, 'tasks'> | AppState,
  setAppState: SetAppState,
  opts?: { source?: 'user' | 'system'; killedBy?: 'user' | 'parent' | 'system' },
): void {
  const ancestorId = parent.agentId ?? parent.id;
  const tasks = getAppState().tasks ?? {};
  const source = opts?.source ?? 'user';
  const killedBy = opts?.killedBy ?? 'user';
  for (const child of Object.values(tasks)) {
    if (!isLocalAgentTask(child) || child.id === parent.id) continue;
    const live = child.status === 'running' || isParkedKeepaliveAgent(child);
    if (!live) continue;
    if (!isDescendantAgentOf(child, ancestorId, tasks)) continue;
    // densable gtf: if source===user && OH → Fjr
    if (source === 'user' && isObserverAgentTask(child)) {
      void stopObserverPairing(child.id, {
        agentType: typeof child.agentType === 'string' ? child.agentType : undefined,
      }).catch(() => {});
    }
    // densable: hAe when source===user || !OH — for OH, only user stamps
    if (source === 'user' || !isObserverAgentTask(child)) {
      markAgentStoppedByUser(child.id, setAppState);
    }
    // densable gtf: Kle then XV — mark notified to suppress noise on cascade
    markAgentsNotified(child.id, setAppState);
    killAsyncAgent(child.id, setAppState, killedBy);
  }
}

/**
 * densable Yeo(parentId, registry):
 *   if parent is local_agent && agentType !== "main-session" → parentId else void 0
 *
 * densable Sot/OSu/mid-bg/BRt then do `Yeo(parent) ?? mi()`. This helper is Yeo
 * only — callers fall through to getMainThreadAgentId() (AgentTool spawn,
 * BRt/enqueue). Official AL is agentId===mi().
 */
export function resolvePanelOwnerAgentId(
  parentAgentId: string | undefined | null,
  getAppState: () => Pick<AppState, 'tasks'> | AppState,
): string | undefined {
  if (!parentAgentId) return undefined;
  const t = getAppState().tasks?.[parentAgentId];
  return isPanelAgentTask(t) ? parentAgentId : undefined;
}

/**
 * densable sqe(e,t,r,n={}): append `{text, origin, isMeta:n.isMeta??!1}`.
 * Overload accepts a full entry (re-queue path after Qeo) or text + opts.
 */
export function queuePendingMessage(
  taskId: string,
  msg: string | PendingAgentMessage,
  setAppState: (f: (prev: AppState) => AppState) => void,
  opts?: QueuePendingMessageOpts,
): void {
  const entry: PendingAgentMessage =
    typeof msg === 'string'
      ? {
          text: msg,
          ...(opts?.origin !== undefined ? { origin: opts.origin } : {}),
          isMeta: opts?.isMeta ?? false,
        }
      : {
          text: msg.text,
          ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
          isMeta: msg.isMeta ?? false,
        };
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
    ...task,
    pendingMessages: [...task.pendingMessages, entry],
  }));
}

/**
 * Append a message to task.messages so it appears in the viewed transcript
 * immediately. Caller constructs the Message (breaks the messages.ts cycle).
 * queuePendingMessage and resumeAgentBackground route the prompt to the
 * agent's API input but don't touch the display.
 */
export function appendMessageToLocalAgent(
  taskId: string,
  message: Message,
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
    ...task,
    messages: [...(task.messages ?? []), message],
  }));
}

/**
 * densable Qeo: drain and clear pendingMessages; returns entry objects.
 *
 * Product fortification vs gold snapshot-then-clear:
 * Capture + clear inside a single setAppState updater so concurrent drains
 * cannot both return the same batch (read→clear race). Callers still rely on
 * tryClaimAgentResume / B6 for resume serialization; this only hardens drain.
 */
export function drainPendingMessages(
  taskId: string,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): PendingAgentMessage[] {
  // Fast path: avoid setAppState when already empty (same as densable early return).
  const peek = getAppState().tasks?.[taskId];
  if (!isLocalAgentTask(peek) || peek.pendingMessages.length === 0) {
    return [];
  }
  let drained: PendingAgentMessage[] = [];
  setAppState(prev => {
    const task = prev.tasks?.[taskId];
    if (!isLocalAgentTask(task) || task.pendingMessages.length === 0) {
      return prev;
    }
    drained = task.pendingMessages;
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...task,
          pendingMessages: [],
        },
      },
    };
  });
  return drained;
}

/**
 * Enqueue an agent notification to the message queue.
 */
async function getLinkedTaskCompletionHint(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  linkedTaskListId?: string,
): Promise<string | undefined> {
  if (status !== 'completed') {
    return undefined;
  }

  for (const taskListId of getCompletionHintTaskListIds(linkedTaskListId)) {
    const taskList = await listTasks(taskListId);
    const linkedTask = taskList.find(task => {
      const metadata = getTaskExecutionMetadata(task);
      return metadata?.linkedBackgroundTaskId === taskId;
    });
    if (!linkedTask || linkedTask.status !== 'in_progress') {
      continue;
    }

    const shouldSuggest = await markTaskCompletionSuggested(taskListId, linkedTask.id, taskId);
    if (!shouldSuggest) {
      return undefined;
    }

    return `Background task for task #${linkedTask.id} has completed. If the work is done, call TaskUpdate with status: "completed" before proceeding.`;
  }

  return undefined;
}

function getCompletionHintTaskListIds(linkedTaskListId: string | undefined): string[] {
  const currentTaskListId = getTaskListId();
  return linkedTaskListId && linkedTaskListId !== currentTaskListId
    ? [linkedTaskListId, currentTaskListId]
    : [currentTaskListId];
}

export async function enqueueAgentNotification({
  taskId,
  description,
  status,
  killedBy,
  error,
  setAppState,
  finalMessage,
  usage,
  toolUseId,
  worktreePath,
  worktreeBranch,
  ownerAgentId,
}: {
  taskId: string;
  description: string;
  status: 'completed' | 'failed' | 'killed';
  /**
   * Official BRt killedBy — only affects killed summary:
   * parent→"was stopped by Claude", user→"was stopped by user", else "was stopped".
   */
  killedBy?: 'user' | 'parent' | 'system';
  error?: string;
  setAppState: SetAppState;
  finalMessage?: string;
  usage?: {
    totalTokens: number;
    toolUses: number;
    durationMs: number;
  };
  toolUseId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  /**
   * densable BRt `ownerAgentId` fallback when task.ownerAgentId missing
   * (XV re-notify path stamps it).
   */
  ownerAgentId?: string;
}): Promise<void> {
  // BRt owner notify — INTENTIONAL fortify over densable 2.1.211 (do not "align"):
  // densable gold: ownerBusy = YC(parked)||running → skip tB + route to owner.
  // That permanently sticks a parent that park-on-keepalive deferred its own
  // BRt: last child never tB's, parent never unparks, child notif sits on a
  // dead owner queue (Zeo also skips YC interactive). Known hang class.
  //
  // Local (keep this fork; tests/automation must expect local timing):
  //   1. atomic notified gate; capture owner
  //   2. hold KA (skip tB) ONLY while owner.status==="running" (can drain)
  //   3. YC-parked / terminal / missing owner → always tB
  //   4. route to owner only when running; else main-thread
  //   5. after tB, if parked owner now has no live agent: children and never
  //      notified → fire deferred parent completion BRt + Zeo rewire
  let shouldEnqueue = false;
  let shouldCompletePlanVerification = false;
  let owner: string | undefined;
  let linkedTaskListId: string | undefined;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    owner = task.ownerAgentId ?? task.notificationTargetAgentId;
    if (task.notified) {
      return task;
    }
    shouldEnqueue = true;
    shouldCompletePlanVerification = task.agentType === VERIFICATION_AGENT_TYPE;
    linkedTaskListId = task.activeTaskExecutionContext?.taskListId;
    return {
      ...task,
      notified: true,
    };
  });
  owner ??= ownerAgentId;

  // Hold KA only while owner is still running (can drain mid-turn notifs).
  // YC-parked is NOT busy for hold/route — see deferred parent BRt below.
  let ownerRunning = false;
  let ownerWasParked = false;
  if (owner) {
    setAppState(prev => {
      const g = prev.tasks?.[owner!];
      if (g && g.type === 'local_agent') {
        ownerRunning = g.status === 'running';
        ownerWasParked = isParkedKeepaliveAgent(g) && !getIsNonInteractiveSession();
      }
      return prev;
    });
  }
  // Skip tB only on first-notify + owner still running.
  // already-notified re-entry and parked/terminal owners always detach.
  if (!(shouldEnqueue && ownerRunning)) {
    removeKeepaliveReason(owner, agentKeepaliveReason(taskId), setAppState);
  }

  if (!shouldEnqueue) {
    // Re-notify / kill paths still tB above; finish park-deferred parent if ready.
    if (owner && ownerWasParked && !ownerRunning) {
      await fireDeferredParkedOwnerCompletion(owner, setAppState);
    }
    return;
  }

  // Abort any active speculation — background task state changed, so speculated
  // results may reference stale task output. The prompt suggestion text is
  // preserved; only the pre-computed response is discarded.
  abortSpeculation(setAppState);

  if (shouldCompletePlanVerification) {
    setAppState(prev => {
      const pending = prev.pendingPlanVerification;
      if (!pending || !pending.verificationStarted || pending.verificationCompleted) {
        return prev;
      }

      return {
        ...prev,
        pendingPlanVerification: {
          ...pending,
          verificationCompleted: true,
        },
      };
    });
  }

  // densable BRt summary wording
  const killedSummary =
    killedBy === 'parent' ? 'was stopped by Claude' : killedBy === 'user' ? 'was stopped by user' : 'was stopped';
  const summary =
    status === 'completed'
      ? `Agent "${description}" finished`
      : status === 'failed'
        ? `Agent "${description}" failed: ${error || 'Unknown error'}`
        : `Agent "${description}" ${killedSummary}`;

  const outputPath = getTaskOutputPath(taskId);
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
  const completionHint = await getLinkedTaskCompletionHint(taskId, status, linkedTaskListId);
  const resultWithHint = completionHint ? [finalMessage, completionHint].filter(Boolean).join('\n\n') : finalMessage;
  const validatedResult = validateWorkerResult(resultWithHint, status, description);
  // densable BRt: omit <result> when finalMessage/hint absent
  const resultSection = resultWithHint ? `\n<result>${escapeXml(validatedResult.result ?? '')}</result>` : '';
  // densable BRt: <usage><subagent_tokens>...
  const usageSection = usage
    ? `\n<usage><subagent_tokens>${usage.totalTokens}</subagent_tokens><tool_uses>${usage.toolUses}</tool_uses><duration_ms>${usage.durationMs}</duration_ms></usage>`
    : '';
  const worktreeSection = worktreePath
    ? `\n<${WORKTREE_TAG}><${WORKTREE_PATH_TAG}>${worktreePath}</${WORKTREE_PATH_TAG}>${worktreeBranch ? `<${WORKTREE_BRANCH_TAG}>${worktreeBranch}</${WORKTREE_BRANCH_TAG}>` : ''}</${WORKTREE_TAG}>`
    : '';
  const noteSection =
    '\n<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>';

  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>${noteSection}${resultSection}${usageSection}${worktreeSection}
</${TASK_NOTIFICATION_TAG}>`;

  // Local route: owner only while running (can drain). Parked/terminal → main.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMainThreadAgentId } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js');
  const routeAgentId = ownerRunning && owner ? asAgentId(owner) : getMainThreadAgentId();
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    agentId: routeAgentId,
    priority: 'next',
    taskId,
  });

  // densable Host contract: system task_notification bookend for Jp Tasks.
  // BRt XML still feeds the model via print.ts; dual-emit SDK so Hosts that
  // only subscribe to system events (or drain before ask()) still settle.
  // Once-gated in emitTaskTerminatedSdk (c7c) — print re-emit is a no-op.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js');
    emitTaskTerminatedSdk(taskId, status === 'killed' ? 'stopped' : status, {
      toolUseId,
      summary,
      outputFile: outputPath,
      usage: usage
        ? {
            total_tokens: usage.totalTokens,
            tool_uses: usage.toolUses,
            duration_ms: usage.durationMs,
          }
        : undefined,
    });
  } catch {
    // best-effort — never block agent completion on SDK bookend
  }

  // After child notif: last agent: child of a park-deferred parent → parent BRt.
  if (owner && ownerWasParked && !ownerRunning) {
    await fireDeferredParkedOwnerCompletion(owner, setAppState);
  }
}

/**
 * INTENTIONAL fortify for child-first hang (densable 2.1.211 also stuck):
 * Child BRt while parent still `running` → skip tB, notif on parent queue.
 * Parent DSu then Jeo keeps `agent:child` (queue hold) → park without BRt.
 * Zeo skips YC interactive → notifs stuck; parent never notified.
 *
 * After parent parks: force-rewire owner-routed notifs to main, Jeo-detach
 * notified/missing agent: children, then deferred parent BRt if no agent: left.
 * Live (running) children keep the parent parked.
 *
 * Do not "align to gold" by restoring YC-as-busy — that reintroduces hang.
 */
export async function resolveParkedOwnerAfterChildrenSettled(ownerId: string, setAppState: SetAppState): Promise<void> {
  let shouldResolve = false;
  setAppState(prev => {
    const t = prev.tasks?.[ownerId];
    if (t && t.type === 'local_agent' && t.status === 'completed' && t.notified !== true && isParkedKeepaliveAgent(t)) {
      shouldResolve = true;
    }
    return prev;
  });
  if (!shouldResolve) return;

  // Bypass densable Zeo YC guard — parked parent will never drain these.
  rewireOrphanedOwnerNotifications(ownerId, setAppState, { force: true });
  // Queue holds cleared → Jeo can detach notified/missing agent: children.
  sweepStaleKeepaliveReasons(ownerId, setAppState);
  await fireDeferredParkedOwnerCompletion(ownerId, setAppState);
}

/**
 * INTENTIONAL fortify over densable BRt/YC hang: when a park-deferred parent
 * (`completed` + live `agent:` children, never notified) loses its last
 * agent: hold via child tB, rewire orphan notifs and fire the deferred
 * parent completion BRt so the panel does not stick until the next user turn.
 *
 * Safe under concurrent child notifies: parent notified gate is atomic inside
 * enqueueAgentNotification; remaining live agent: children keep the parent parked.
 * Keep this fork — gold YC-as-busy hangs permanently.
 */
async function fireDeferredParkedOwnerCompletion(ownerId: string, setAppState: SetAppState): Promise<void> {
  let description = 'agent';
  let notified = true;
  let status: string | undefined;
  let result: AgentToolResult | undefined;
  let appState: AppState | undefined;
  setAppState(prev => {
    appState = prev;
    const t = prev.tasks?.[ownerId];
    if (t && t.type === 'local_agent') {
      const agent = t as LocalAgentTaskState;
      description = agent.description || 'agent';
      notified = agent.notified === true;
      status = agent.status;
      result = agent.result;
    }
    return prev;
  });

  // Only park-deferred completion (Yqe if(Z) return without BRt).
  if (notified || status !== 'completed') {
    return;
  }
  // Still has other live agent: children → stay parked.
  if (!appState || hasLiveAgentKeepaliveChildren(ownerId, () => appState!)) {
    return;
  }

  // KA may still hold non-agent reasons (bash:/monitor:); Zeo skips only while
  // YC interactive. After last agent: tB, empty-KA parents rewire; non-empty
  // still attempt BRt (notified gate) so user sees completion.
  rewireOrphanedOwnerNotifications(ownerId, setAppState);

  const finalMessage =
    result?.content
      ?.map(block => (block && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n') || undefined;
  const usage =
    result !== undefined
      ? {
          totalTokens: result.totalTokens ?? 0,
          toolUses: result.totalToolUseCount ?? 0,
          durationMs: result.totalDurationMs ?? 0,
        }
      : undefined;

  await enqueueAgentNotification({
    taskId: ownerId,
    description,
    status: 'completed',
    setAppState,
    finalMessage,
    usage,
  });
}

/**
 * LocalAgentTask - Handles background agent execution.
 *
 * Replaces the AsyncAgent implementation from src/tools/AgentTool/asyncAgentUtils.ts
 * with a unified Task interface.
 */
export const LocalAgentTask: Task = {
  name: 'LocalAgentTask',
  type: 'local_agent',

  // densable: async kill(e,t,r,n){XV(e,t,n)} — local drops registry, 3rd=killedBy
  async kill(taskId, setAppState, killedBy = 'user') {
    killAsyncAgent(taskId, setAppState, killedBy);
  },
};

/**
 * Official XV(taskId, registry, killedBy="user") portable.
 *
 * Kills **running** or **YC parked** (completed + keepaliveReasons) local_agent.
 *
 * Densable order:
 * 1. YC + quietlyParked → un-notify (so kill can re-surface via BRt)
 * 2. YC + notified → tB(owner, agent:id)
 * 3. YC + !notified → BRt(status killed, killedBy)
 * 4. running || YC → status killed, killedBy, notified ||= YC, clear self KA, QYi(park:false)
 *
 * Running path also detaches owner KA (local residual used by kill tests /
 * coordinator; densable relies on later Jeo for some running cases).
 *
 * No-op when terminal without park (failed/killed) or non-agent.
 */
export function killAsyncAgent(
  taskId: string,
  setAppState: SetAppState,
  killedBy: 'user' | 'parent' | 'system' = 'user',
): void {
  // densable: kill drops idle-window timer so okg cannot fire after XV clear KA
  clearIdleWindowTimer(taskId);

  // Official XV step 1: YC + quietlyParked → un-notify so kill can re-surface.
  // Also clear densable c7c gate so re-BRt can emit a new SDK bookend.
  setAppState(prev => {
    const t = prev.tasks?.[taskId];
    if (
      t &&
      t.type === 'local_agent' &&
      isParkedKeepaliveAgent(t) &&
      (t as LocalAgentTaskState).quietlyParked === true
    ) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { clearTaskTerminatedSdkGate } =
          require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js');
        clearTaskTerminatedSdkGate(taskId);
      } catch {
        // optional
      }
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: {
            ...t,
            notified: false,
            quietlyParked: false,
          },
        },
      };
    }
    return prev;
  });

  // Re-read after un-notify for densable steps 2–3 (tB vs BRt).
  let wasParked = false;
  let wasNotified = false;
  let preOwner: string | undefined;
  let preDescription = '';
  let preToolUseId: string | undefined;
  let preFinalMessage: string | undefined;
  let preUsage: { totalTokens: number; toolUses: number; durationMs: number } | undefined;
  setAppState(prev => {
    const t = prev.tasks?.[taskId];
    if (t && t.type === 'local_agent' && isParkedKeepaliveAgent(t)) {
      const agent = t as LocalAgentTaskState;
      wasParked = true;
      wasNotified = agent.notified === true;
      preOwner = agent.ownerAgentId ?? agent.notificationTargetAgentId;
      preDescription = agent.description;
      preToolUseId = agent.toolUseId;
      const result = agent.result;
      if (result) {
        preFinalMessage = result.content.map(c => c.text).join('\n');
        preUsage = {
          totalTokens: result.totalTokens,
          toolUses: result.totalToolUseCount,
          durationMs: result.totalDurationMs,
        };
      }
    }
    return prev;
  });

  // Densable: if (YC && notified) tB(owner, agent:id)
  if (wasParked && wasNotified) {
    removeKeepaliveReason(preOwner, agentKeepaliveReason(taskId), setAppState);
  }
  // Densable: if (YC && !notified) BRt({status:"killed", killedBy:r, ...})
  if (wasParked && !wasNotified) {
    void enqueueAgentNotification({
      taskId,
      description: preDescription,
      status: 'killed',
      killedBy,
      setAppState,
      finalMessage: preFinalMessage,
      usage: preUsage,
      toolUseId: preToolUseId,
      ownerAgentId: preOwner,
    });
  }

  let killed = false;
  let owner: string | undefined;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    const parked = isParkedKeepaliveAgent(task);
    if (task.status !== 'running' && !parked) {
      return task;
    }
    killed = true;
    owner = task.ownerAgentId ?? task.notificationTargetAgentId;
    try {
      task.abortController?.abort();
    } catch {
      /* ignore */
    }
    task.unregisterCleanup?.();
    // Official XV: status killed + killedBy:r; notified = s.notified || YC(s).
    // densable XV does NOT clear Aye resuming — only S()/Sot/complete/fail do.
    // Clearing here races dual claim: stop mid-resume → resuming false → second
    // worker can claim the same agent id.
    return {
      ...task,
      status: 'killed',
      killedBy,
      endTime: Date.now(),
      notified: task.notified || parked,
      quietlyParked: false,
      keepaliveReasons: new Set(),
      evictAfter: computePanelEvictAfter(task, { park: false }),
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined,
    };
  });
  if (killed) {
    clearDeferredAgentProgressRebuild(taskId);
    // Running kill: detach owner KA (local residual; densable pre-steps only
    // cover YC). Parked paths already handled tB/BRt above — avoid double tB.
    if (!wasParked) {
      removeKeepaliveReason(owner, agentKeepaliveReason(taskId), setAppState);
    }
    // Official XV: if (i) Zeo(e,t), zS(e)
    rewireOrphanedOwnerNotifications(taskId, setAppState);
    evictAgentTaskOutputIfPersistent(taskId);
  }
}

/**
 * Official densable kSu: kill YC parked agents first, then running.
 * Used by ESC cancellation / chat:killAgents coordinator paths.
 */
export function killAllRunningAgentTasks(
  tasks: Record<string, TaskState>,
  setAppState: SetAppState,
  killedBy: 'user' | 'parent' | 'system' = 'user',
): void {
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.type === 'local_agent' && isParkedKeepaliveAgent(task)) {
      killAsyncAgent(taskId, setAppState, killedBy);
    }
  }
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.type === 'local_agent' && task.status === 'running') {
      killAsyncAgent(taskId, setAppState, killedBy);
    }
  }
}

/**
 * Official Kle: mark notified without enqueueing a notification.
 * If already notified and NOT quietlyParked → no-op.
 * Otherwise set notified:true, quietlyParked:false.
 */
export function markAgentsNotified(taskId: string, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.notified && task.quietlyParked !== true) {
      return task;
    }
    return {
      ...task,
      notified: true,
      quietlyParked: false,
    };
  });
}

/**
 * Update progress for an agent task.
 * Preserves the existing summary field so that background summarization
 * results are not clobbered by progress updates from assistant messages.
 */
export function updateAgentProgress(taskId: string, progress: AgentProgress, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }

    const existingSummary = task.progress?.summary;
    // Never regress live footer tokens: a rebuild that still sees pre-message_delta
    // zeros (or a stale sibling snapshot) must not wipe a higher count already shown.
    const tokenCount = Math.max(progress.tokenCount ?? 0, task.progress?.tokenCount ?? 0);
    const toolUseCount = Math.max(progress.toolUseCount ?? 0, task.progress?.toolUseCount ?? 0);
    const next: AgentProgress = {
      ...progress,
      tokenCount,
      toolUseCount,
      ...(existingSummary !== undefined ? { summary: existingSummary } : {}),
    };
    if (
      task.progress?.tokenCount === next.tokenCount &&
      task.progress?.toolUseCount === next.toolUseCount &&
      task.progress?.summary === next.summary &&
      task.progress?.lastActivity === next.lastActivity
    ) {
      return task;
    }
    return {
      ...task,
      progress: next,
    };
  });
}

/**
 * Update the background summary for an agent task.
 * Called by the periodic summarization service to store a 1-2 sentence progress summary.
 */
export function updateAgentSummary(taskId: string, summary: string, setAppState: SetAppState): void {
  let captured: {
    tokenCount: number;
    toolUseCount: number;
    startTime: number;
    toolUseId: string | undefined;
  } | null = null;

  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }

    captured = {
      tokenCount: task.progress?.tokenCount ?? 0,
      toolUseCount: task.progress?.toolUseCount ?? 0,
      startTime: task.startTime,
      toolUseId: task.toolUseId,
    };

    return {
      ...task,
      progress: {
        ...task.progress,
        toolUseCount: task.progress?.toolUseCount ?? 0,
        tokenCount: task.progress?.tokenCount ?? 0,
        summary,
      },
    };
  });

  // Emit summary to SDK consumers (e.g. VS Code subagent panel). No-op in TUI.
  // Gate on the SDK option so coordinator-mode sessions without the flag don't
  // leak summary events to consumers who didn't opt in.
  if (captured && getSdkAgentProgressSummariesEnabled()) {
    const { tokenCount, toolUseCount, startTime, toolUseId } = captured;
    emitTaskProgress({
      taskId,
      toolUseId,
      description: summary,
      startTime,
      totalTokens: tokenCount,
      toolUses: toolUseCount,
      summary,
    });
  }
}

/**
 * Official Zeo(ownerId, registry): when an agent leaves without remaining YC
 * park (or is killed), rewire undrained `task-notification` queue entries that
 * target this agent as owner onto main-thread AL.
 *
 * densable re-cf with agentId:mi() (main-thread AL).
 * Guard: if owner is still YC parked in an interactive session, skip —
 * unless `force` (local child-first park fortification).
 */
export function rewireOrphanedOwnerNotifications(
  ownerTaskId: string,
  setAppState: SetAppState,
  opts?: { force?: boolean },
): void {
  // Official: if (Wl(r)&&YC(r)&&!pn()) return
  let skip = false;
  if (!opts?.force) {
    setAppState(prev => {
      const t = prev.tasks?.[ownerTaskId];
      if (t && t.type === 'local_agent' && isParkedKeepaliveAgent(t) && !getIsNonInteractiveSession()) {
        skip = true;
      }
      return prev;
    });
  }
  if (skip) return;

  // densable Zeo: re-cf with agentId:mi() for orphaned owner-routed notifs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMainThreadAgentId } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js');
  const mainId = getMainThreadAgentId();
  const dequeued = dequeueAllMatching(cmd => {
    if (cmd.mode !== 'task-notification') return false;
    if (cmd.agentId !== ownerTaskId) return false;
    let childOwner: string | undefined;
    setAppState(prev => {
      const child = cmd.taskId ? prev.tasks?.[cmd.taskId] : undefined;
      if (child && child.type === 'local_agent') {
        childOwner =
          (child as LocalAgentTaskState).ownerAgentId ?? (child as LocalAgentTaskState).notificationTargetAgentId;
      }
      return prev;
    });
    return childOwner === ownerTaskId;
  });
  for (const cmd of dequeued) {
    enqueuePendingNotification({
      ...cmd,
      agentId: mainId,
    });
  }
}

/**
 * densable XYi — per-agent idle-window timer map (okg after CSu).
 * Module-level so complete/kill/fail/tests share one timer table.
 */
const idleWindowTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Test/cleanup: clear all idle-window timers (densable XYi). */
export function clearAllIdleWindowTimersForTests(): void {
  for (const timer of idleWindowTimers.values()) {
    clearTimeout(timer);
  }
  idleWindowTimers.clear();
}

/** densable: clear XYi entry for one agent (kill/fail/re-arm). */
export function clearIdleWindowTimer(taskId: string): void {
  const existing = idleWindowTimers.get(taskId);
  if (existing !== undefined) {
    clearTimeout(existing);
    idleWindowTimers.delete(taskId);
  }
}

/**
 * densable okg(taskId, registry):
 * 1. XYi.delete + tB(self, bot)
 * 2. if completed && KA empty: zS + Zeo; if notified && no pending owner notif for
 *    this taskId → tB(owner, agent:id)
 *
 * Gold DSu uses `a=!1` so complete never arms this path; helpers remain for
 * fidelity / manual armIdleWindowTimer (tests, future densable revival).
 */
export function expireIdleWindowKeepalive(taskId: string, setAppState: SetAppState): void {
  idleWindowTimers.delete(taskId);
  const bot = idleWindowKeepaliveReason();
  removeKeepaliveReason(taskId, bot, setAppState);

  let status: string | undefined;
  let notified = false;
  let ownerId: string | undefined;
  let remainingSize = 0;
  setAppState(prev => {
    const t = prev.tasks?.[taskId];
    if (t && t.type === 'local_agent') {
      const agent = t as LocalAgentTaskState;
      status = agent.status;
      notified = agent.notified === true;
      ownerId = agent.ownerAgentId ?? agent.notificationTargetAgentId;
      remainingSize = agent.keepaliveReasons?.size ?? 0;
    }
    return prev;
  });

  // densable: if (Wl(r)&&r.status==="completed"&&Wge(r).size===0)
  if (status !== 'completed' || remainingSize !== 0) {
    return;
  }

  // densable okg: zS(e), Zeo(e,t)
  rewireOrphanedOwnerNotifications(taskId, setAppState);

  if (!notified) {
    return;
  }

  // if notified: only tB owner when no pending task-notification for this
  // taskId still targeting the owner (densable Hte scan).
  let hasPendingOwnerNotif = false;
  if (ownerId) {
    for (const cmd of getCommandQueue()) {
      if (cmd.mode === 'task-notification' && cmd.agentId === ownerId && cmd.taskId === taskId) {
        hasPendingOwnerNotif = true;
        break;
      }
    }
  }
  if (!hasPendingOwnerNotif) {
    removeKeepaliveReason(ownerId, agentKeepaliveReason(taskId), setAppState);
  }
}

/**
 * densable DSu arm: if (o&&a) clearTimeout + setTimeout(okg, CSu).
 * Gold a=!1 → complete never calls this; exported for okg fidelity/tests.
 */
export function armIdleWindowTimer(taskId: string, setAppState: SetAppState): void {
  clearIdleWindowTimer(taskId);
  const timer = setTimeout(() => {
    expireIdleWindowKeepalive(taskId, setAppState);
  }, IDLE_WINDOW_MS);
  // densable: u.unref?.()
  timer.unref?.();
  idleWindowTimers.set(taskId, timer);
}

/**
 * Complete an agent task with result (densable DSu body).
 *
 * densable Yqe: `Jeo → Z=JXt → Cns(suppress:Z) → DSu → if(Z) park`.
 * DSu itself has **no** Jeo. Callers that already swept (lifecycle / mid-bg)
 * pass `skipJeo: true` so park/suppress share that single pre-DSu Z.
 * Standalone callers (tests, other complete sites) leave default: Jeo here
 * once before DSu (same net as Yqe when they don't pre-sweep).
 *
 * densable DSu `a=!1` (2.1.211): do **not** stamp flag:idle-window / arm okg.
 * u = keepaliveReasons (unchanged); QYi(park:true); Zeo when !YC interactive.
 * No owner tB (BRt does conditional tB).
 */
export function completeAgentTask(
  result: AgentToolResult,
  setAppState: SetAppState,
  opts?: { skipJeo?: boolean },
): void {
  const taskId = result.agentId;
  // densable Jeo before DSu — skip when caller already ran Jeo for the same Z.
  if (!opts?.skipJeo) {
    sweepStaleKeepaliveReasons(taskId, setAppState);
  }

  let completed = false;
  let parkedInteractive = false;
  // densable DSu: a=!1 — never arm bot/okg on complete (dead branch in gold)
  const a = false;
  let armedIdleWindow = false;
  // densable DSu: s = (d.pendingMessages?.length ?? 0) > 0 → Weo.emit after update
  let hasPendingMessages = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }

    task.unregisterCleanup?.();
    completed = true;
    hasPendingMessages = (task.pendingMessages?.length ?? 0) > 0;

    // Footer reads progress.tokenCount even after completion. Sync from the
    // finalized result so a late usage mutation (or rebuild miss) doesn't leave
    // completed agents stuck at "↓ 0 tokens".
    const prevProgress = task.progress;
    const tokenCount = Math.max(result.totalTokens ?? 0, prevProgress?.tokenCount ?? 0);
    const toolUseCount = Math.max(result.totalToolUseCount ?? 0, prevProgress?.toolUseCount ?? 0);

    // densable DSu: a=!1 → u = c.keepaliveReasons (no bot stamp).
    // Gold `l` (hasNonIdleWindowKeepalive) only gates dead `o&&a&&!l` telemetry.
    const prevReasons = task.keepaliveReasons ?? new Set<string>();
    const nextKeepalive = a ? new Set(prevReasons).add(IDLE_WINDOW_KEEPALIVE_REASON) : new Set(prevReasons);
    armedIdleWindow = a;

    const next = {
      ...task,
      status: 'completed' as const,
      // densable: terminal clears in-flight resume CAS flag
      resuming: false,
      adoptResumePending: false,
      result,
      progress: {
        toolUseCount,
        tokenCount,
        lastActivity: prevProgress?.lastActivity,
        recentActivities: prevProgress?.recentActivities,
        summary: prevProgress?.summary,
      },
      endTime: Date.now(),
      keepaliveReasons: nextKeepalive,
      // densable QYi(park:true): non-empty KA → no grace; empty → panel grace
      evictAfter: computePanelEvictAfter({ retain: task.retain, keepaliveReasons: nextKeepalive }, { park: true }),
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined,
    };
    // Official: i = YC(d) && !pn() — skip Zeo when parked interactive
    parkedInteractive = isParkedKeepaliveAgent(next) && !getIsNonInteractiveSession();
    return next;
  });
  if (completed) {
    clearDeferredAgentProgressRebuild(taskId);
    evictAgentTaskOutputIfPersistent(taskId);
    // Official DSu: if (o && !i) ... Zeo(n,t)
    if (!parkedInteractive) {
      rewireOrphanedOwnerNotifications(taskId, setAppState);
    } else {
      // Local fortification (not densable): child-first hang — children that
      // notified while we were still running left agent: holds + owner-queue
      // notifs. densable defers until resume; we settle notified children now.
      void resolveParkedOwnerAfterChildrenSettled(taskId, setAppState);
    }
    // densable: if (o&&a) arm okg — gold a=!1 never enters
    if (armedIdleWindow) {
      armIdleWindowTimer(taskId, setAppState);
    }
    // densable: if (o&&s) Weo.emit(n) — stranded pending drain/resume (luf→Aye)
    if (hasPendingMessages) {
      strandedAgentResume.emit(taskId);
    }
  }
  // Notification + densable BRt owner tB: AgentTool via enqueueAgentNotification
}

/**
 * Fail an agent task with error.
 * densable eto: QYi(park:false); always Zeo; owner tB deferred to BRt.
 */
export function failAgentTask(taskId: string, error: string, setAppState: SetAppState): void {
  // densable eto: no idle-window arm; clear any prior timer defensively
  clearIdleWindowTimer(taskId);
  let failed = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    // clear Aye CAS if fail races mid-resume

    task.unregisterCleanup?.();
    failed = true;

    return {
      ...task,
      status: 'failed',
      resuming: false,
      adoptResumePending: false,
      error,
      endTime: Date.now(),
      // densable eto: leave keepaliveReasons as-is (no bot arm on fail path)
      evictAfter: computePanelEvictAfter(task, { park: false }),
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined,
    };
  });
  if (failed) {
    clearDeferredAgentProgressRebuild(taskId);
    evictAgentTaskOutputIfPersistent(taskId);
    // Official eto: always Zeo after fail (no YC park)
    rewireOrphanedOwnerNotifications(taskId, setAppState);
  }
  // Notification + densable BRt owner tB: AgentTool via enqueueAgentNotification
}

/**
 * Register an agent task.
 * Called by AgentTool to create a new background agent.
 *
 * @param parentAbortController - Optional parent abort controller. If provided,
 *   the agent's abort controller will be a child that auto-aborts when parent aborts.
 *   This ensures subagents are aborted when their parent (e.g., in-process teammate) aborts.
 */
export function registerAsyncAgent({
  agentId,
  description,
  prompt,
  selectedAgent,
  setAppState,
  parentAbortController,
  toolUseId,
  activeTaskExecutionContext,
  notificationTargetAgentId,
  ownerAgentId,
  parentAgentId,
  spawnDepth,
  ownedFiles,
  isObserver,
  forkedSkillName,
  model,
  attachOwnerKeepalive = true,
}: {
  agentId: string;
  description: string;
  prompt: string;
  selectedAgent: AgentDefinition;
  setAppState: SetAppState;
  parentAbortController?: AbortController;
  toolUseId?: string;
  activeTaskExecutionContext?: ActiveTaskExecutionContext;
  notificationTargetAgentId?: AgentId;
  /** Official ownerAgentId for Gge `agent:${id}` (defaults to notification target). */
  ownerAgentId?: string;
  parentAgentId?: string;
  spawnDepth?: number;
  ownedFiles?: string[];
  /** Official Sot isObserver — observer-activity spawns. */
  isObserver?: boolean;
  /** densable 2.1.218 wvo forkedSkillName for live-duplicate dedupe. */
  forkedSkillName?: string;
  model?: string;
  /**
   * densable: Gge is call-site only (nested spawn `if(!pn())Gge`), not inside Sot.
   * Resume Aye / observer Sot stamp ownerAgentId:mi() without Gge.
   * Default true for AgentTool nested async; resume/observer pass false.
   */
  attachOwnerKeepalive?: boolean;
}): LocalAgentTaskState {
  initAgentTaskOutput(agentId);

  // Create abort controller - if parent provided, create child that auto-aborts with parent
  const abortController = parentAbortController
    ? createChildAbortController(parentAbortController)
    : createAbortController();

  const resolvedOwner = ownerAgentId ?? notificationTargetAgentId;

  const taskState: LocalAgentTaskState = {
    ...createTaskStateBase(agentId, 'local_agent', description, toolUseId),
    type: 'local_agent',
    status: 'running',
    agentId,
    prompt,
    selectedAgent,
    agentType: selectedAgent.agentType ?? 'general-purpose',
    // densable Sot: effort:a.effort from agent definition
    ...(selectedAgent.effort !== undefined ? { effort: selectedAgent.effort } : {}),
    ...(model !== undefined ? { model } : {}),
    activeTaskExecutionContext,
    ownedFiles,
    notificationTargetAgentId,
    ownerAgentId: resolvedOwner,
    parentAgentId,
    spawnDepth,
    abortController,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true, // registerAsyncAgent immediately backgrounds
    pendingMessages: [],
    isIdle: false, // densable Sot isIdle:!1
    // densable Sot replaces Aye resuming CAS with status:running
    resuming: false,
    adoptResumePending: false,
    retain: false,
    diskLoaded: false,
    ...(isObserver === true ? { isObserver: true } : {}),
    ...(forkedSkillName !== undefined ? { forkedSkillName } : {}),
  };

  // Register cleanup handler
  const unregisterCleanup = registerCleanup(async () => {
    killAsyncAgent(agentId, setAppState);
  });

  taskState.unregisterCleanup = unregisterCleanup;

  // Register task in AppState
  registerTask(taskState, setAppState);

  // densable nested spawn: if (!pn()) Gge(Re, `agent:${st}`, registry)
  // Resume/observer stamp owner without Gge (attachOwnerKeepalive:false).
  if (attachOwnerKeepalive && resolvedOwner && !getIsNonInteractiveSession()) {
    addKeepaliveReason(resolvedOwner, agentKeepaliveReason(agentId), setAppState);
  }

  return taskState;
}

// Map of taskId -> resolve function for background signals
// When backgroundAgentTask is called, it resolves the corresponding promise
const backgroundSignalResolvers = new Map<string, () => void>();

/**
 * Register a foreground agent task that could be backgrounded later.
 * Called when an agent has been running long enough to show the BackgroundHint.
 * @returns object with taskId and backgroundSignal promise
 */
export function registerAgentForeground({
  agentId,
  description,
  prompt,
  selectedAgent,
  setAppState,
  autoBackgroundMs,
  toolUseId,
  notificationTargetAgentId,
  ownerAgentId,
  parentAgentId,
  spawnDepth,
}: {
  agentId: string;
  description: string;
  prompt: string;
  selectedAgent: AgentDefinition;
  setAppState: SetAppState;
  autoBackgroundMs?: number;
  toolUseId?: string;
  notificationTargetAgentId?: AgentId;
  /**
   * densable OSu ownerAgentId — stamped at foreground register so mid-bg
   * Gge + later BRt tB can resolve the panel owner. OSu does NOT Gge here;
   * mid-bg / async_launched path does.
   */
  ownerAgentId?: string;
  parentAgentId?: string;
  spawnDepth?: number;
}): {
  taskId: string;
  backgroundSignal: Promise<void>;
  cancelAutoBackground?: () => void;
} {
  initAgentTaskOutput(agentId);

  const abortController = createAbortController();

  const unregisterCleanup = registerCleanup(async () => {
    killAsyncAgent(agentId, setAppState);
  });

  // densable OSu: ownerAgentId:t at register (no Gge until mid-bg).
  const resolvedOwner = ownerAgentId ?? notificationTargetAgentId;

  const taskState: LocalAgentTaskState = {
    ...createTaskStateBase(agentId, 'local_agent', description, toolUseId),
    type: 'local_agent',
    status: 'running',
    agentId,
    prompt,
    selectedAgent,
    agentType: selectedAgent.agentType ?? 'general-purpose',
    // densable OSu: effort:a.effort from agent definition
    ...(selectedAgent.effort !== undefined ? { effort: selectedAgent.effort } : {}),
    notificationTargetAgentId,
    ownerAgentId: resolvedOwner,
    parentAgentId,
    spawnDepth,
    abortController,
    unregisterCleanup,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: false, // Not yet backgrounded - running in foreground
    pendingMessages: [],
    isIdle: false, // densable OSu isIdle:!1
    retain: false,
    diskLoaded: false,
  };

  // Create background signal promise
  let resolveBackgroundSignal: () => void;
  const backgroundSignal = new Promise<void>(resolve => {
    resolveBackgroundSignal = resolve;
  });
  backgroundSignalResolvers.set(agentId, resolveBackgroundSignal!);

  registerTask(taskState, setAppState);

  // Auto-background after timeout if configured
  let cancelAutoBackground: (() => void) | undefined;
  if (autoBackgroundMs !== undefined && autoBackgroundMs > 0) {
    const timer = setTimeout(
      (setAppState, agentId) => {
        // Mark task as backgrounded and resolve the signal
        let didBackground = false;
        setAppState(prev => {
          const prevTask = prev.tasks[agentId];
          if (!isLocalAgentTask(prevTask) || prevTask.isBackgrounded) {
            return prev;
          }
          didBackground = true;
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [agentId]: { ...prevTask, isBackgrounded: true },
            },
          };
        });
        // Official 2.1 task_updated (auto-bg setAppState bypasses updateTaskState)
        if (didBackground) {
          try {
            const { emitTaskUpdatedSdk } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('src/utils/sdkEventQueue.js') as typeof import('src/utils/sdkEventQueue.js');
            emitTaskUpdatedSdk(agentId, { is_backgrounded: true });
          } catch {
            // optional
          }
        }
        const resolver = backgroundSignalResolvers.get(agentId);
        if (resolver) {
          resolver();
          backgroundSignalResolvers.delete(agentId);
        }
      },
      autoBackgroundMs,
      setAppState,
      agentId,
    );
    cancelAutoBackground = () => clearTimeout(timer);
  }

  return { taskId: agentId, backgroundSignal, cancelAutoBackground };
}

/**
 * Background a specific foreground agent task.
 * densable J5r: UE(status)&&!YC(task) → refuse (terminal non-parked).
 * @returns true if backgrounded successfully, false otherwise
 */
export function backgroundAgentTask(taskId: string, getAppState: () => AppState, setAppState: SetAppState): boolean {
  const state = getAppState();
  const task = state.tasks[taskId];
  if (!isLocalAgentTask(task) || task.isBackgrounded) {
    return false;
  }
  // densable J5r: terminal non-parked cannot be backgrounded
  if (isTerminalTaskStatus(task.status) && !isParkedKeepaliveAgent(task)) {
    return false;
  }

  // Update state to mark as backgrounded
  let didBackground = false;
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalAgentTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
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

  // Resolve the background signal only when we actually flipped (official
  // J5r refuse paths already returned false). If already bg, leave resolver.
  if (didBackground) {
    const resolver = backgroundSignalResolvers.get(taskId);
    if (resolver) {
      resolver();
      backgroundSignalResolvers.delete(taskId);
    }
  }

  return didBackground;
}

/**
 * Unregister a foreground agent task when the agent completes without being backgrounded.
 * densable LSu: skip remove when JXt (owner still holds `agent:` keepalive children).
 */
export function unregisterAgentForeground(taskId: string, setAppState: SetAppState): void {
  // Clean up the background signal resolver
  backgroundSignalResolvers.delete(taskId);

  // densable JXt gate before remove
  let rootSnap: AppState | undefined;
  setAppState(prev => {
    rootSnap = prev;
    return prev;
  });
  if (hasLiveAgentKeepaliveChildren(taskId, () => rootSnap as AppState)) {
    return;
  }

  let cleanupFn: (() => void) | undefined;

  setAppState(prev => {
    const task = prev.tasks[taskId];
    // Only remove if it's a foreground task (not backgrounded)
    if (!isLocalAgentTask(task) || task.isBackgrounded) {
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
