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
import type { ActiveTaskExecutionContext } from '../../utils/tasks.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { getToolSearchOrReadInfo } from '../../utils/collapseReadSearch.js';
import { dequeueAllMatching, enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import { getAgentTranscriptPath, isTranscriptPersistenceDisabled } from '../../utils/sessionStorage.js';
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
  isParkedKeepaliveAgent,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
} from '../../utils/task/framework.js';
import { emitTaskProgress } from '../../utils/task/sdkProgress.js';
import { roughTokenCountEstimationForMessages } from '../../services/tokenEstimation.js';
import { validateWorkerResult } from '../../coordinator/workerResultValidator.js';
import { escapeXml } from '../../utils/xml.js';
import type { TaskState } from '../types.js';

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
export function scheduleDeferredAgentProgressRebuild(
  taskId: string,
  tracker: ProgressTracker,
  messages: readonly Message[],
  setAppState: SetAppState,
  resolveActivityDescription?: ActivityDescriptionResolver,
  tools?: Tools,
): void {
  const run = (): void => {
    rebuildProgressFromMessages(tracker, messages, resolveActivityDescription, tools);
    updateAgentProgress(taskId, getProgressUpdate(tracker, messages), setAppState);
  };
  // Two ticks: message_delta is applied after the yield returns into the
  // generator; a single queueMicrotask can still race the mutation.
  queueMicrotask(() => {
    queueMicrotask(run);
  });
  setTimeout(run, 0);
  setTimeout(run, 50);
  setTimeout(run, 250);
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
  // Messages queued mid-turn via SendMessage, drained at tool-round boundaries
  pendingMessages: string[];
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
   * re-notify as killed. Local rarely sets true (densable set-true path sparse);
   * field + Kle/XV gates match official semantics.
   */
  quietlyParked?: boolean;
  /**
   * Official stoppedByUser (hAe) — user-initiated stop marker. Blocks silent
   * resume of agents the user stopped; persisted to agent metadata by densable
   * Gzg. Local sets on TaskStop / descendant cascade.
   */
  stoppedByUser?: boolean;
  /**
   * Official XV killedBy — who initiated the kill. Stamped on status:"killed".
   * TaskStop/H1e passes "parent"; panel/ESC/gtf defaults "user"; rare "system".
   * BRt summary: parent→"was stopped by Claude", user→"was stopped by user".
   * Yqe AbortError path reads this for parent_kill_async analytics + BRt.
   */
  killedBy?: 'user' | 'parent' | 'system';
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

export function isLocalAgentTask(task: unknown): task is LocalAgentTaskState {
  return typeof task === 'object' && task !== null && 'type' in task && task.type === 'local_agent';
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
 * densable Yeo(parentId, registry):
 *   if parent is local_agent && agentType !== "main-session" → parentId else void 0
 *
 * densable BRt/Sot then does `Yeo(parent) ?? mi()`. Local maps main-session /
 * missing parent to `undefined` (never session id) so AL
 * (`agentId === undefined`) still drains main-thread notifications.
 */
export function resolvePanelOwnerAgentId(
  parentAgentId: string | undefined | null,
  getAppState: () => Pick<AppState, 'tasks'> | AppState,
): string | undefined {
  if (!parentAgentId) return undefined;
  const t = getAppState().tasks?.[parentAgentId];
  return isPanelAgentTask(t) ? parentAgentId : undefined;
}

export function queuePendingMessage(
  taskId: string,
  msg: string,
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
    ...task,
    pendingMessages: [...task.pendingMessages, msg],
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

export function drainPendingMessages(
  taskId: string,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): string[] {
  const task = getAppState().tasks[taskId];
  if (!isLocalAgentTask(task) || task.pendingMessages.length === 0) {
    return [];
  }
  const drained = task.pendingMessages;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, t => ({
    ...t,
    pendingMessages: [],
  }));
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
  // densable BRt (2.1.211):
  //   1. atomic notified gate; capture m = task.ownerAgentId
  //   2. m ??= ownerAgentId arg
  //   3. ownerBusy = (YC(owner) && !pn()) || owner.running
  //   4. if (!(firstNotify && ownerBusy)) tB(owner, `agent:${id}`)
  //   5. if (!firstNotify) return
  //   6. cf({ priority:"next", agentId: ownerBusy&&m ? Qc(m) : mi(), taskId })
  // Local: mi() → undefined (AL is agentId===undefined; never stamp session id).
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

  // densable: _ = Wl(g)&&YC(g)&&!pn() || Wl(g)&&g.status==="running"
  let ownerBusy = false;
  if (owner) {
    setAppState(prev => {
      const g = prev.tasks?.[owner!];
      if (g && g.type === 'local_agent') {
        const parked =
          isParkedKeepaliveAgent(g) && !getIsNonInteractiveSession();
        const running = g.status === 'running';
        ownerBusy = parked || running;
      }
      return prev;
    });
  }
  // densable: if (!(p && _)) tB(m, `agent:${e}`, i) — also on already-notified
  if (!(shouldEnqueue && ownerBusy)) {
    removeKeepaliveReason(owner, agentKeepaliveReason(taskId), setAppState);
  }

  if (!shouldEnqueue) {
    // Mirror official already-notified / missing-task skip (no second enqueue).
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

  // densable BRt:
  //   S = completed?"finished"
  //     : failed?`failed: ${o||"Unknown error"}`
  //     : parent?"was stopped by Claude"
  //     : user?"was stopped by user"
  //     : "was stopped"
  //   E = `Agent "${t}" ${S}`
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
  // densable BRt: x=s?`\n<result>${Ul(s)}</result>`:"" — omit when finalMessage absent
  // Gate on raw s (resultWithHint), not validated text: validateWorkerResult always
  // invents a non-empty empty-notice for coordinator context when s is missing.
  const resultSection = resultWithHint ? `\n<result>${escapeXml(validatedResult.result ?? '')}</result>` : '';
  // densable BRt: <usage><subagent_tokens>${a.totalTokens}</subagent_tokens>...
  const usageSection = usage
    ? `\n<usage><subagent_tokens>${usage.totalTokens}</subagent_tokens><tool_uses>${usage.toolUses}</tool_uses><duration_ms>${usage.durationMs}</duration_ms></usage>`
    : '';
  const worktreeSection = worktreePath
    ? `\n<${WORKTREE_TAG}><${WORKTREE_PATH_TAG}>${worktreePath}</${WORKTREE_PATH_TAG}>${worktreeBranch ? `<${WORKTREE_BRANCH_TAG}>${worktreeBranch}</${WORKTREE_BRANCH_TAG}>` : ''}</${WORKTREE_TAG}>`
    : '';
  // densable BRt: fixed <note> after summary, before result/usage/worktree
  const noteSection =
    '\n<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>';

  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>${noteSection}${resultSection}${usageSection}${worktreeSection}
</${TASK_NOTIFICATION_TAG}>`;

  // densable: agentId: _&&m ? Qc(m) : mi(); priority always "next"; taskId for Jeo.
  // Local mi() = undefined so main-thread AL (agentId===undefined) drains it.
  const routeToOwner = ownerBusy && owner ? asAgentId(owner) : undefined;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    agentId: routeToOwner,
    priority: 'next',
    taskId,
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
 * 3. YC + !notified → BRt(status killed, killedBy) (sync notified stamp + conditional tB)
 * 4. running || YC → status killed, killedBy, notified ||= YC, clear self KA, QYi(park:false)
 *
 * Running path also detaches owner KA (local residual used by kill tests /
 * coordinator; densable relies on later Jeo for some running cases).
 *
 * No-op when terminal without park (failed/killed) or non-agent.
 *
 * @param killedBy densable third arg — TaskStop/H1e "parent"; gtf/ESC "user" (default).
 */
export function killAsyncAgent(
  taskId: string,
  setAppState: SetAppState,
  killedBy: 'user' | 'parent' | 'system' = 'user',
): void {
  // Official XV step 1: YC + quietlyParked → un-notify so kill can re-surface.
  setAppState(prev => {
    const t = prev.tasks?.[taskId];
    if (
      t &&
      t.type === 'local_agent' &&
      isParkedKeepaliveAgent(t) &&
      (t as LocalAgentTaskState).quietlyParked === true
    ) {
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
  // Sync prefix of enqueueAgentNotification runs before first await.
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
    // Official XV: status killed + killedBy:r; notified = s.notified || YC(s)
    // so panel eviction + suppress double BRt from bulk kill paths.
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
    // Running kill: detach owner KA (local residual; densable pre-steps only
    // cover YC). Parked paths already handled tB/BRt above — avoid double tB.
    if (!wasParked) {
      removeKeepaliveReason(owner, agentKeepaliveReason(taskId), setAppState);
    }
    // Official XV: if (i) Zeo(e,t), zS(e) — rewire undrained child notifs
    // after kill (killed is never YC, so Zeo guard always proceeds).
    rewireOrphanedOwnerNotifications(taskId, setAppState);
    evictAgentTaskOutputIfPersistent(taskId);
  }
}

/**
 * Official densable kSu(e,t,r="user"): kill YC parked agents first, then running.
 * Used by ESC cancellation / chat:killAgents coordinator paths (not jGr).
 * jGr uses killedBy:"system" and a different selector (OH||running&&Kw&&LLe).
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
 * Official hAe: mark agent stoppedByUser (idempotent) and best-effort persist
 * the stop marker to agent metadata (Gzg). Used by TaskStop / ySr / gtf.
 */
export function markAgentStoppedByUser(taskId: string, setAppState: SetAppState): void {
  let agentType = 'general-purpose';
  let already = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.stoppedByUser) {
      already = true;
      return task;
    }
    agentType = task.agentType ?? 'general-purpose';
    return {
      ...task,
      stoppedByUser: true,
    };
  });
  if (already) return;
  // Official Gzg: persist stoppedByUser into agent sidecar metadata.
  void import('../../utils/sessionStorage.js')
    .then(async ({ readAgentMetadata, writeAgentMetadata }) => {
      try {
        const prev = await readAgentMetadata(asAgentId(taskId));
        if (prev?.stoppedByUser) return;
        await writeAgentMetadata(asAgentId(taskId), {
          ...(prev ?? { agentType }),
          stoppedByUser: true,
        });
      } catch {
        /* best-effort — cold paths may lack sidecar */
      }
    })
    .catch(() => {
      /* ignore */
    });
}

/**
 * Official Beo: walk parentAgentId chain — true if `ancestorAgentId` is an
 * ancestor of `task` (cycle-safe).
 */
export function isAgentDescendantOf(
  task: { parentAgentId?: string },
  ancestorAgentId: string,
  tasks: Record<string, TaskState>,
): boolean {
  const seen = new Set<string>();
  let parent = typeof task.parentAgentId === 'string' ? task.parentAgentId : undefined;
  while (parent && !seen.has(parent)) {
    if (parent === ancestorAgentId) return true;
    seen.add(parent);
    const next = tasks[parent];
    parent =
      next && next.type === 'local_agent' && typeof (next as LocalAgentTaskState).parentAgentId === 'string'
        ? (next as LocalAgentTaskState).parentAgentId
        : undefined;
  }
  return false;
}

/**
 * Official gtf: after stopping an agent, cascade-kill every descendant
 * local_agent that is still running or YC-parked under its parentAgentId tree.
 *
 * For each descendant:
 * - if source==="user" && OH(o) → Fjr(o.id) (stopObserverPairingInPlace)
 * - Kle always
 * - if source==="user" || !OH(o) → hAe
 * - XV(o.id, …, "user")
 */
export function killDescendantAgents(
  root: { id: string; agentId?: string },
  tasksSnapshot: Record<string, TaskState>,
  setAppState: SetAppState,
  opts?: { source?: string },
): void {
  const rootAgentId = root.agentId ?? root.id;
  const source = opts?.source;
  for (const [id, task] of Object.entries(tasksSnapshot)) {
    if (task.type !== 'local_agent') continue;
    if (id === root.id) continue;
    const agent = task as LocalAgentTaskState;
    const killable = agent.status === 'running' || isParkedKeepaliveAgent(agent);
    if (!killable) continue;
    if (!isAgentDescendantOf(agent, rootAgentId, tasksSnapshot)) continue;
    // Official Fjr: user-source observer descendants get pairing tombstone
    // before Kle/hAe/XV so reattach stays blocked even if process kill races.
    if (source === 'user' && agent.isObserver === true) {
      try {
        // Lazy import: LocalAgentTask sits under the task/UI graph; keep
        // observerAgents out of the static cycle used by BackgroundTasksDialog.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { stopObserverPairingInPlace } = require('../../utils/observerAgents.js') as {
          stopObserverPairingInPlace: (observerTaskId: string, opts?: { agentType?: string }) => boolean;
        };
        stopObserverPairingInPlace(id, {
          agentType: agent.agentType,
        });
      } catch {
        /* observer module optional in pure unit contexts */
      }
    }
    // Official: Kle always
    markAgentsNotified(id, setAppState);
    // Official: if (source==="user" || !OH(o)) hAe
    if (source === 'user' || agent.isObserver !== true) {
      markAgentStoppedByUser(id, setAppState);
    }
    killAsyncAgent(id, setAppState);
  }
}

/**
 * Official Kle: mark notified without enqueueing a notification.
 * Used by chat:killAgents bulk kill to suppress per-agent async notifications
 * when a single aggregate message is sent instead.
 *
 * If already notified and NOT quietlyParked → no-op.
 * Otherwise set notified:true, quietlyParked:false (allows re-mark after XV
 * clears quietlyParked un-notify).
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
 * target this agent as owner (`cmd.agentId === owner` and child.ownerAgentId
 * matches) onto the main session agent id (`mi()`).
 *
 * Guard: if owner is still YC parked in an interactive session, skip — the
 * panel is alive for nested children and should keep draining itself.
 */
export function rewireOrphanedOwnerNotifications(ownerTaskId: string, setAppState: SetAppState): void {
  // Official: if (Wl(r)&&YC(r)&&!pn()) return
  let skip = false;
  setAppState(prev => {
    const t = prev.tasks?.[ownerTaskId];
    if (t && t.type === 'local_agent' && isParkedKeepaliveAgent(t) && !getIsNonInteractiveSession()) {
      skip = true;
    }
    return prev;
  });
  if (skip) return;

  // Official main-thread AL: agentId undefined (never mi()/getSessionId()).
  const dequeued = dequeueAllMatching(cmd => {
    if (cmd.mode !== 'task-notification') return false;
    if (cmd.agentId !== ownerTaskId) return false;
    // Densable: child must still be local_agent owned by this owner
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
      agentId: undefined,
    });
  }
}

/**
 * Complete an agent task with result.
 */
export function completeAgentTask(result: AgentToolResult, setAppState: SetAppState): void {
  const taskId = result.agentId;
  let completed = false;
  let parkedInteractive = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }

    task.unregisterCleanup?.();
    completed = true;

    // Footer reads progress.tokenCount even after completion. Sync from the
    // finalized result so a late usage mutation (or rebuild miss) doesn't leave
    // completed agents stuck at "↓ 0 tokens".
    const prevProgress = task.progress;
    const tokenCount = Math.max(result.totalTokens ?? 0, prevProgress?.tokenCount ?? 0);
    const toolUseCount = Math.max(result.totalToolUseCount ?? 0, prevProgress?.toolUseCount ?? 0);

    // densable DSu: QYi({retain, keepaliveReasons}, {park:true}) — no owner tB
    // here; BRt does conditional tB on first notify.
    const nextKeepalive = task.keepaliveReasons;
    const next = {
      ...task,
      status: 'completed' as const,
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
    evictAgentTaskOutputIfPersistent(taskId);
    // Official DSu: if (o && !i) ... Zeo(n,t)
    if (!parkedInteractive) {
      rewireOrphanedOwnerNotifications(taskId, setAppState);
    }
  }
  // Notification + densable BRt owner tB: AgentTool via enqueueAgentNotification
}

/**
 * Fail an agent task with error.
 */
export function failAgentTask(taskId: string, error: string, setAppState: SetAppState): void {
  let failed = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }

    task.unregisterCleanup?.();
    failed = true;

    // densable eto: QYi(park:false) — owner tB deferred to BRt.
    return {
      ...task,
      status: 'failed',
      error,
      endTime: Date.now(),
      evictAfter: computePanelEvictAfter(task, { park: false }),
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined,
    };
  });
  if (failed) {
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
  /**
   * Official Sot `isObserver` — densable stamps when promptOrigin is
   * observer-activity (or spawnFirstRun observer fork). ekg carries this on
   * re-register; Fjr/gtf/OH gates read it.
   */
  isObserver?: boolean;
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
    retain: false,
    diskLoaded: false,
    ...(isObserver === true ? { isObserver: true } : {}),
  };

  // Register cleanup handler
  const unregisterCleanup = registerCleanup(async () => {
    killAsyncAgent(agentId, setAppState);
  });

  taskState.unregisterCleanup = unregisterCleanup;

  // Register task in AppState
  registerTask(taskState, setAppState);

  // Official: if (!pn()) Gge(Re, `agent:${st}`, registry)
  if (resolvedOwner && !getIsNonInteractiveSession()) {
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
}: {
  agentId: string;
  description: string;
  prompt: string;
  selectedAgent: AgentDefinition;
  setAppState: SetAppState;
  autoBackgroundMs?: number;
  toolUseId?: string;
}): {
  taskId: string;
  backgroundSignal: Promise<void>;
  cancelAutoBackground?: () => void;
  /** densable OSu — standalone task abort (linked via YMi at AgentTool call site). */
  abortController: AbortController;
} {
  initAgentTaskOutput(agentId);

  // densable OSu: Mc() standalone — NOT createChildAbortController. AgentTool
  // attaches detachable YMi(parent, task) so parent Esc kills foreground, then
  // Ct() detaches on background so parent cancel no longer reaches the bg agent.
  const abortController = createAbortController();

  const unregisterCleanup = registerCleanup(async () => {
    killAsyncAgent(agentId, setAppState);
  });

  const taskState: LocalAgentTaskState = {
    ...createTaskStateBase(agentId, 'local_agent', description, toolUseId),
    type: 'local_agent',
    status: 'running',
    agentId,
    prompt,
    selectedAgent,
    agentType: selectedAgent.agentType ?? 'general-purpose',
    abortController,
    unregisterCleanup,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: false, // Not yet backgrounded - running in foreground
    pendingMessages: [],
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
        setAppState(prev => {
          const prevTask = prev.tasks[agentId];
          if (!isLocalAgentTask(prevTask) || prevTask.isBackgrounded) {
            return prev;
          }
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [agentId]: { ...prevTask, isBackgrounded: true },
            },
          };
        });
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

  return {
    taskId: agentId,
    backgroundSignal,
    cancelAutoBackground,
    abortController,
  };
}

/**
 * Background a specific foreground agent task.
 * @returns true if backgrounded successfully, false otherwise
 */
export function backgroundAgentTask(taskId: string, getAppState: () => AppState, setAppState: SetAppState): boolean {
  const state = getAppState();
  const task = state.tasks[taskId];
  if (!isLocalAgentTask(task) || task.isBackgrounded) {
    return false;
  }
  // densable J5r: UE(status)&&!YC(task) → refuse (terminal non-parked)
  if (isTerminalTaskStatus(task.status) && !isParkedKeepaliveAgent(task)) {
    return false;
  }

  // Update state to mark as backgrounded
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalAgentTask(prevTask)) {
      return prev;
    }
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...prevTask, isBackgrounded: true },
      },
    };
  });

  // Resolve the background signal to interrupt the agent loop
  const resolver = backgroundSignalResolvers.get(taskId);
  if (resolver) {
    resolver();
    backgroundSignalResolvers.delete(taskId);
  }

  return true;
}

/**
 * Unregister a foreground agent task when the agent completes without being backgrounded.
 * densable LSu: skip remove when JXt (owner still holds `agent:` keepalive children).
 */
export function unregisterAgentForeground(taskId: string, setAppState: SetAppState): void {
  // Clean up the background signal resolver
  backgroundSignalResolvers.delete(taskId);

  // densable JXt gate before remove — snapshot via setAppState (same store as KA writes)
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
