import { feature } from 'bun:bundle';
import * as React from 'react';
import { buildTool, type ToolDef, toolMatchesName } from 'src/Tool.js';
import type { AssistantMessage, Message as MessageType, NormalizedUserMessage } from 'src/types/message.js';
import type { AppState } from 'src/state/AppState.js';
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js';
import { z } from 'zod/v4';
import {
  clearInvokedSkillsForAgent,
  getIsNonInteractiveSession,
  getMainThreadAgentId,
  getSdkAgentProgressSummariesEnabled,
} from 'src/bootstrap/state.js';
import { enhanceSystemPromptWithEnvDetails, getSystemPrompt } from 'src/constants/prompts.js';
import { getWorkerAntiInjectionAddendum, isCoordinatorMode } from 'src/coordinator/coordinatorMode.js';
import { releaseAgentLocks, transferAgentLocks } from 'src/coordinator/fileLockManager.js';
import { startAgentSummarization } from 'src/services/AgentSummary/agentSummary.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { clearDumpState } from 'src/services/api/dumpPrompts.js';
import {
  completeAgentTask as completeAsyncAgent,
  createActivityDescriptionResolver,
  createProgressTracker,
  enqueueAgentNotification,
  failAgentTask as failAsyncAgent,
  getProgressUpdate,
  getTokenCountFromTracker,
  isLocalAgentTask,
  killAsyncAgent,
  rebuildProgressFromMessages,
  registerAgentForeground,
  registerAsyncAgent,
  resolvePanelOwnerAgentId,
  scheduleDeferredAgentProgressRebuild,
  unregisterAgentForeground,
  updateAgentProgress as updateAsyncAgentProgress,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { addKeepaliveReason, agentKeepaliveReason } from 'src/utils/task/framework.js';
import {
  checkRemoteAgentEligibility,
  formatPreconditionError,
  getRemoteTaskSessionUrl,
  registerRemoteAgentTask,
  type BackgroundRemoteSessionPrecondition,
} from 'src/tasks/RemoteAgentTask/RemoteAgentTask.js';
import { assembleToolPool } from 'src/tools.js';
import { asAgentId } from 'src/types/ids.js';
import {
  getAgentContext,
  isDelegatedObservation,
  runWithAgentContext,
  type SubagentContext,
} from 'src/utils/agentContext.js';
import { resolveEffectiveIsolation } from 'src/utils/agentIsolationRemote.js';
import { isAgentSwarmsEnabled } from 'src/utils/agentSwarmsEnabled.js';
import {
  hasSameCwdWriteCapableSibling,
  SHARES_CWD_LAUNCH_NOTE,
  resolveSharesCwdStamp,
} from 'src/utils/agentSharesCwd.js';
import {
  applyHandbackProvenanceToCompletedContent,
  hashHarnessSectionBlocks,
  isHandbackProvenanceEnabled,
} from 'src/utils/harnessTextSanitize.js';
import { getCwd, runWithCwdOverride } from 'src/utils/cwd.js';
import { logForDebugging } from 'src/utils/debug.js';
import { resolveAgentAutoBackgroundMs } from 'src/utils/autoBackgroundTimeout.js';
import {
  BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE,
  getBackgroundLaunchRule,
  isBackgroundLaunchDisabled,
  resolveSpawnBackgroundTasksDisabled,
} from 'src/utils/sessionBackgroundGates.js';
import { recordSubagentSpawn, webFetchSavedFilesForAgent } from 'src/utils/subagentSpawnLedger.js';
import { isInterruptAbortReason } from 'src/utils/abortController.js';
import {
  assertAndTakeConcurrencySlot,
  assertCanSpawnSubagent,
  assertSubagentDepthAllowed,
} from 'src/utils/sessionSpawnCaps.js';
import { AbortError, errorMessage, toError } from 'src/utils/errors.js';
import type { CacheSafeParams } from 'src/utils/forkedAgent.js';
import { filterParentToolsForFork } from 'src/utils/agentToolFilter.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { createUserMessage, extractTextContent, isSyntheticMessage, normalizeMessages } from 'src/utils/messages.js';
import { getAgentModel } from 'src/utils/model/agent.js';
import { permissionModeSchema } from 'src/utils/permissions/PermissionMode.js';
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js';
import { filterDeniedAgents, getDenyRuleForAgent } from 'src/utils/permissions/permissions.js';
import { emitTaskTerminatedSdk } from 'src/utils/sdkEventQueue.js';
import { writeAgentMetadata } from 'src/utils/sessionPaths.js';
import { sleep } from 'src/utils/sleep.js';
import { buildEffectiveSystemPrompt } from 'src/utils/systemPrompt.js';
import { asSystemPrompt } from 'src/utils/systemPromptType.js';
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js';
import { AGENT_NAME_REGEX, isReservedSpawnAgentName, MAIN_RECIPIENT_NAME } from 'src/utils/swarm/constants.js';
import { getParentSessionId, isTeammate } from 'src/utils/teammate.js';
import { isInProcessTeammate } from 'src/utils/teammateContext.js';
import { teleportToRemote } from 'src/utils/teleport.js';
import { getAssistantMessageContentLength } from 'src/utils/tokens.js';
import { createAgentId } from 'src/utils/uuid.js';
import { createAgentWorktree, hasWorktreeChanges, removeAgentWorktree } from 'src/utils/worktree.js';
import { BASH_TOOL_NAME } from '../BashTool/toolName.js';
import { BackgroundHint } from '../BashTool/UI.js';
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js';
import { spawnTeammate } from '../shared/spawnMultiAgent.js';
import { setAgentColor } from './agentColorManager.js';
import {
  agentToolResultSchema,
  classifyHandoffIfNeeded,
  createLocalAgentIsIdleTracker,
  emitTaskProgress,
  extractPartialResult,
  finalizeAgentTool,
  getLastToolUseName,
  readMaxTurnsReached,
  parkAgentOnKeepaliveDeferNotify,
  runAsyncAgentLifecycle,
  sweepAndDetectLiveAgentChildren,
} from './agentToolUtils.js';
import { resolveAgentDefinitionModel } from './built-in/exploreAgent.js';
import { isModelAlias } from 'src/utils/model/aliases.js';
import { applySubagentModelForce, isSubagentModelForceEnabled, resolveForcedSpawnModel } from './subagentModelForce.js';
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js';
import {
  isBuiltInWebFetchAgent,
  normalizeAgentTypeKey,
  shouldSkipTeammateSpawnForWebFetch,
} from './built-in/webFetchAgent.js';
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME, ONE_SHOT_BUILTIN_AGENT_TYPES } from './constants.js';
import {
  consumeUnreviewedWebFetch,
  maybeStampUnreviewedWebFetch,
  spawnRewriteRuling,
  type SpawnPermissionSnap,
} from './spawnHookRewrite.js';
import { SubagentHandbackTool } from '../SubagentHandbackTool/SubagentHandbackTool.js';
import {
  buildForkedMessages,
  buildWorktreeNotice,
  FORK_AGENT,
  FORK_SUBAGENT_TYPE,
  isForkSubagentProductEnabled,
  isForkSubagentScriptCallEnabled,
  isInForkChild,
} from './forkSubagent.js';
import {
  formatAvailableAgentTypes,
  isGeneralPurposeAvailable,
  SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE,
} from './generalPurposeAvailability.js';
import type { AgentDefinition } from './loadAgentsDir.js';
import { filterAgentsByMcpRequirements, hasRequiredMcpServers, isBuiltInAgent } from './loadAgentsDir.js';
import { getPrompt } from './prompt.js';
import { isRunAgentSpinnerMode, runAgent } from './runAgent.js';
import {
  renderGroupedAgentToolUse,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseTag,
  userFacingName,
  userFacingNameBackgroundColor,
} from './UI.js';

// Progress display constants (for showing background hint)
const PROGRESS_THRESHOLD_MS = 2000; // Show background hint after 2 seconds

// Auto-background agent tasks after this many ms (0 = disabled)
// Enabled by env var OR GrowthBook gate (checked lazily since GB may not be ready at module load)
// Official: CLAUDE_AUTO_BACKGROUND_TASKS / CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS / tengu_auto_background_agents
function getAutoBackgroundMs(): number {
  return resolveAgentAutoBackgroundMs({
    gbEnabled: getFeatureValue_CACHED_MAY_BE_STALE('tengu_auto_background_agents', false),
  });
}

// Multi-agent type constants are defined inline inside gated blocks to enable dead code elimination

/** densable Co model describe + Ta() coordinator addendum. */
function agentModelParameterDescription(): string {
  const base =
    'Optional model override for this agent. Takes precedence over the agent definition\'s model frontmatter and the configured default subagent model. If omitted, uses the agent definition\'s model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" — forks always inherit the parent model.';
  if (isCoordinatorMode()) {
    return `${base} Set this only when EXPLICITLY asked by the user for a specific model, never because the task seems small, simple, or cheap; otherwise omit it so the worker uses the default (the session model, unless a default subagent model is configured).`;
  }
  return base;
}

// Base input schema without multi-agent parameters
const baseInputSchema = lazySchema(() =>
  z.object({
    description: z.string().describe('A short (3-5 word) description of the task'),
    prompt: z.string().describe('The task for the agent to perform'),
    subagent_type: z.string().optional().describe('The type of specialized agent to use for this task'),
    model: z.enum(['sonnet', 'opus', 'haiku', 'fable']).optional().describe(agentModelParameterDescription()),
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        "Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs — otherwise leave it in the background so the user can hand you other work.",
      ),
  }),
);

// Full schema combining base + multi-agent params + isolation
const fullInputSchema = lazySchema(() => {
  // Multi-agent parameters
  const multiAgentInputSchema = z.object({
    name: z
      .string()
      .regex(AGENT_NAME_REGEX, {
        message:
          'name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)',
      })
      .refine(t => t !== MAIN_RECIPIENT_NAME, {
        message: `"${MAIN_RECIPIENT_NAME}" is reserved — SendMessage routes it to the main conversation`,
      })
      .refine(t => !isReservedSpawnAgentName(t), {
        message:
          'name must not be a reserved name ("main", "team-lead", "user" or "system", in any spelling) or have the shape of an agent id — those already address an agent directly',
      })
      .optional()
      .describe('Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running.'),
    team_name: z.string().optional().describe('Deprecated; ignored. The session has a single implicit team.'),
    // densable 2.1.212: mode is accepted for schema compatibility but ignored.
    // Subagents inherit the parent session permission mode; agent frontmatter
    // may still override via selectedAgent.permissionMode.
    mode: permissionModeSchema()
      .optional()
      .describe(
        "Deprecated; ignored. Subagents inherit the parent session's permission mode; agent-definition frontmatter may override it.",
      ),
  });

  return baseInputSchema()
    .merge(multiAgentInputSchema)
    .extend({
      isolation: z
        .enum(['worktree', 'remote'])
        .optional()
        .describe(
          'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote cloud environment (always runs in background; availability is gated).',
        ),
      cwd: z
        .string()
        .optional()
        .describe(
          'Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: "worktree".',
        ),
    });
});

// Strip optional fields from the schema when the backing feature is off so
// the model never sees them. Done via .omit() rather than conditional spread
// inside .extend() because the spread-ternary breaks Zod's type inference
// (field type collapses to `unknown`). The ternary return produces a union
// type, but call() destructures via the explicit AgentToolInput type below
// which always includes all optional fields.
/**
 * Static omit (KAIROS cwd / fork-subagent / model force) may cache.
 * densable r_r Ier + Aut parameterDescription is live — installBackgroundLaunchRule
 * after first schema access must still omit/extend (not frozen in lazySchema).
 */
const staticInputSchema = lazySchema(() => {
  const schema = feature('KAIROS') ? fullInputSchema() : fullInputSchema().omit({ cwd: true });
  // Keep run_in_background on the cached type. Fork/Ier omit + Aut describe
  // are live (densable r_r) so a mid-session installBackgroundLaunchRule
  // is not frozen in lazySchema.
  return isSubagentModelForceEnabled() ? schema.omit({ model: true }) : schema;
});

type InputSchema = ReturnType<typeof staticInputSchema>;

export function inputSchema(): InputSchema {
  const base = staticInputSchema();
  // densable r_r: omit when Ier() || Yne(). Yne does not look at Ce.
  if (isForkSubagentProductEnabled() || isBackgroundLaunchDisabled()) {
    return base.omit({ run_in_background: true }) as unknown as InputSchema;
  }
  const launchRule = getBackgroundLaunchRule();
  if (launchRule?.parameterDescription) {
    return base.extend({
      run_in_background: z.boolean().optional().describe(launchRule.parameterDescription),
    }) as unknown as InputSchema;
  }
  return base;
}

// Explicit type widens the schema inference to always include all optional
// fields even when .omit() strips them for gating (cwd, run_in_background).
// subagent_type is optional. Omitting it never selects fork (289). call()
// uses general-purpose when that agent is available. Fork is explicit
// subagent_type "fork" plus isForkSubagentProductEnabled().
type AgentToolInput = z.infer<ReturnType<typeof baseInputSchema>> & {
  name?: string;
  team_name?: string;
  mode?: z.infer<ReturnType<typeof permissionModeSchema>>;
  isolation?: 'worktree' | 'remote';
  cwd?: string;
};

// Output schema - multi-agent spawned schema added dynamically at runtime when enabled
export const outputSchema = lazySchema(() => {
  const syncOutputSchema = agentToolResultSchema().extend({
    status: z.literal('completed'),
    prompt: z.string(),
    worktreePath: z.string().optional(),
    worktreeBranch: z.string().optional(),
  });

  const asyncOutputSchema = z.object({
    status: z.literal('async_launched'),
    isAsync: z.literal(true).optional(),
    agentId: z.string().describe('The ID of the async agent'),
    description: z.string().describe('The description of the task'),
    resolvedModel: z
      .string()
      .optional()
      .describe('Model in use at the backgrounding transition (a pre-background swap is reflected here)'),
    modelsUsed: z
      .array(z.string())
      .optional()
      .describe('Ordered distinct models used before backgrounding (length > 1 means a mid-run swap)'),
    prompt: z.string().describe('The prompt for the agent'),
    agentType: z.string().optional().describe('Spawned agent type (Fetch chrome)'),
    outputFile: z.string().describe('Path to the output file for checking agent progress'),
    canReadOutputFile: z
      .boolean()
      .optional()
      .describe('Whether the calling agent has Read/Bash tools to check progress'),
    sharesCwd: z
      .boolean()
      .optional()
      .describe(
        '@internal True when this unisolated write-capable agent was launched into a working directory where another one is already running and a worktree could have been made here (drives a model-facing note; not a stable consumer field)',
      ),
  });

  const remoteOutputSchema = z.object({
    status: z.literal('remote_launched'),
    taskId: z.string().describe('The ID of the remote agent task'),
    sessionUrl: z.string().describe('The URL of the cloud session'),
    description: z.string().describe('The description of the task'),
    prompt: z.string().describe('The prompt for the agent'),
    outputFile: z.string().describe('Path to the output file for checking agent progress'),
  });

  return z.union([syncOutputSchema, asyncOutputSchema, remoteOutputSchema]);
});
type OutputSchema = ReturnType<typeof outputSchema>;
type Output = z.input<OutputSchema>;

// Private type for teammate spawn results - excluded from exported schema for dead code elimination
// The 'teammate_spawned' status string is only included when ENABLE_AGENT_SWARMS is true
type TeammateSpawnedOutput = {
  status: 'teammate_spawned';
  prompt: string;
  teammate_id: string;
  agent_id: string;
  agent_type?: string;
  model?: string;
  name: string;
  color?: string;
  tmux_session_name: string;
  tmux_window_name: string;
  tmux_pane_id: string;
  team_name?: string;
  is_splitpane?: boolean;
  plan_mode_required?: boolean;
};

// Combined output type including both public and internal types
// Note: TeammateSpawnedOutput type is fine - TypeScript types are erased at compile time
// Private type for remote-launched results — excluded from exported schema
// like TeammateSpawnedOutput for dead code elimination purposes. Exported
// for UI.tsx to do proper discriminated-union narrowing instead of ad-hoc casts.
export type RemoteLaunchedOutput = {
  status: 'remote_launched';
  taskId: string;
  sessionUrl: string;
  description: string;
  prompt: string;
  outputFile: string;
};

type InternalOutput = Output | TeammateSpawnedOutput | RemoteLaunchedOutput;

import type { AgentToolProgress, ShellProgress } from 'src/types/tools.js';
// AgentTool forwards both its own progress events and shell progress
// events from the sub-agent so the SDK receives tool_progress updates during bash/powershell runs.
export type Progress = AgentToolProgress | ShellProgress;

export const AgentTool = buildTool({
  async prompt({
    agents,
    tools,
    getToolPermissionContext,
    allowedAgentTypes,
    model,
    leanPrompt,
    delegationCostsFirst,
    delegationCostsFirstText,
  }) {
    const toolPermissionContext = await getToolPermissionContext();

    // Get MCP servers that have tools available
    const mcpServersWithTools: string[] = [];
    for (const tool of tools) {
      if (tool.name?.startsWith('mcp__')) {
        const parts = tool.name.split('__');
        const serverName = parts[1];
        if (serverName && !mcpServersWithTools.includes(serverName)) {
          mcpServersWithTools.push(serverName);
        }
      }
    }

    // Filter agents: first by MCP requirements, then by permission rules
    const agentsWithMcpRequirementsMet = filterAgentsByMcpRequirements(agents, mcpServersWithTools);
    const filteredAgents = filterDeniedAgents(agentsWithMcpRequirementsMet, toolPermissionContext, AGENT_TOOL_NAME);

    // isCoordinatorMode densable (COORDINATOR_MODE feature + env).
    const isCoordinator = isCoordinatorMode();
    // densable Thf({forkAvailable, generalPurposeAvailable}) — Abf over
    // activeAgents∩allowlist; forkAvailable is the local fork session gate.
    const generalPurposeAvailable = isGeneralPurposeAvailable(agents, allowedAgentTypes);
    const forkDenied = getDenyRuleForAgent(toolPermissionContext, AGENT_TOOL_NAME, FORK_SUBAGENT_TYPE);
    const forkTypeAlreadyListed = agents.some(
      agent => normalizeAgentTypeKey(agent.agentType) === normalizeAgentTypeKey(FORK_SUBAGENT_TYPE),
    );
    return await getPrompt(filteredAgents, isCoordinator, allowedAgentTypes, {
      // densable Cn.available: Yne, not already listed, allowlist includes fork, no deny rule.
      forkAvailable:
        isForkSubagentProductEnabled() &&
        !forkDenied &&
        !forkTypeAlreadyListed &&
        (allowedAgentTypes?.includes(FORK_SUBAGENT_TYPE) ?? true),
      generalPurposeAvailable,
      model,
      leanPrompt,
      delegationCostsFirst,
      delegationCostsFirstText,
    });
  },
  name: AGENT_TOOL_NAME,
  searchHint: 'delegate work to a subagent',
  aliases: [LEGACY_AGENT_TOOL_NAME],
  maxResultSizeChars: 100_000,
  async description() {
    return 'Launch a new agent';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  async call(input: AgentToolInput, toolUseContext, canUseTool, assistantMessage, onProgress?) {
    // densable `bn` may rewrite spawn fields; keep lets so `D.arrived` applies.
    let {
      prompt,
      subagent_type,
      description,
      model: modelParam,
      run_in_background,
      name,
      team_name,
      mode: _deprecatedSpawnMode,
      isolation,
      cwd,
    } = input;
    const startTime = Date.now();
    let model = isCoordinatorMode() ? undefined : modelParam;

    // densable Rs — FORCE zeros tool model unless inherit (applied at getAgentModel / spawn)

    // densable 2.1.212 #42: Task/Agent `mode` param is deprecated and ignored.
    // Keep the field on the schema so old tool calls still validate, but never
    // read `_deprecatedSpawnMode` — parent session mode + agent frontmatter win.
    // densable 2.1.239: team_name is also ignored (single implicit session team).
    void _deprecatedSpawnMode;
    void team_name;

    // Get app state for permission mode and agent filtering
    const appState = toolUseContext.getAppState();
    // densable 2.1.214: refuse Agent/fork launch after EndConversation
    // (spawnForkFromDirective → subagent_fork_ended_by_model).
    if (appState.endedByModel) {
      const { END_CONVERSATION_SESSION_ENDED_MESSAGE } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../EndConversationTool/prompt.js') as typeof import('../EndConversationTool/prompt.js');
      throw new Error(END_CONVERSATION_SESSION_ENDED_MESSAGE);
    }
    // densable `_ = y.mode` — parent session permission mode
    const permissionMode = appState.toolPermissionContext.mode;

    // densable 2.1.289 `bn` / `Cc("agent.spawn")` / `wis` / `Eis` / `fn` / `Rat`.
    // Tail pass-on is `arrived` (rewritten spawn). Hook without next → Rat.
    // Gold then applies `D.arrived` onto prompt/description/cwd/model/background
    // and remaps `subagentType` via `fn` (unknown type → deny).
    const originalSpawnCwd = cwd;
    let hookRan = false;
    let hookChangedBackground = false;
    let hookChangedType = false;
    {
      const { hasMatchingFunctionHook, isInsideAgentSpawnLaunch, runFunctionHookChain } = await import(
        'src/utils/plugins/functionHooksModules.js'
      );
      if (hasMatchingFunctionHook('agent.spawn') && !isInsideAgentSpawnLaunch()) {
        hookRan = true;
        await maybeStampUnreviewedWebFetch({
          toolUseId: toolUseContext.toolUseId,
          prompt,
          subagentType: subagent_type,
          activeAgents: toolUseContext.options.agentDefinitions.activeAgents,
          context: toolUseContext,
        });
        const raisedSnap: SpawnPermissionSnap = {
          prompt,
          description,
          subagentType: subagent_type,
          model,
          background: run_in_background,
          cwd,
        };
        const spawn: Record<string, unknown> = {
          prompt,
          description,
          subagentType: subagent_type,
          model,
          permissionMode,
          background: run_in_background,
          ...(name !== undefined && { name }),
          ...(cwd !== undefined && { cwd }),
        };
        let arrivedSpawn: Record<string, unknown> | undefined;
        const answered = await runFunctionHookChain('agent.spawn', spawn, async event => {
          arrivedSpawn =
            event !== null && typeof event === 'object' && !Array.isArray(event)
              ? (event as Record<string, unknown>)
              : spawn;
          return arrivedSpawn;
        });
        if (arrivedSpawn === undefined) {
          if (toolUseContext.abortController.signal.aborted) {
            throw new AbortError();
          }
          const rec =
            answered !== null && typeof answered === 'object' && !Array.isArray(answered)
              ? (answered as Record<string, unknown>)
              : undefined;
          const reason =
            typeof rec?.deny === 'string' ? rec.deny : 'agent.spawn: a hook answered without passing the spawn on';
          logForDebugging(`agent.spawn ${subagent_type}: refused by a hook (${reason})`);
          throw new Error(`Subagent spawn denied by a plugin: ${reason}`);
        }
        const arrived = arrivedSpawn;
        // densable Eis — log field rewrites (skip Q6t + model has its own line).
        const skipRewriteLog = new Set([
          'tool_use_id',
          'name',
          'fork',
          'isTeammate',
          'parentModel',
          'permissionMode',
          'parentAgentId',
          'provider',
        ]);
        const rewrittenKeys = [...new Set([...Object.keys(spawn), ...Object.keys(arrived)])].filter(
          key => !skipRewriteLog.has(key) && key !== 'model' && spawn[key] !== arrived[key],
        );
        if (rewrittenKeys.length > 0) {
          logForDebugging(`agent.spawn ${subagent_type}: ${rewrittenKeys.join(', ')} rewritten by a hook`);
        }
        if (arrived.model !== spawn.model) {
          logForDebugging(
            `agent.spawn ${subagent_type}: model ${spawn.model ?? '(inherit)'} -> ${arrived.model ?? '(inherit)'} by a hook`,
          );
        }
        // densable fn — unknown subagentType is a deny, not a silent pass-through.
        if (typeof arrived.subagentType === 'string') {
          const agents = toolUseContext.options.agentDefinitions.activeAgents;
          const known =
            arrived.subagentType === subagent_type || agents.some(agent => agent.agentType === arrived.subagentType);
          if (!known) {
            const listed = agents.map(agent => agent.agentType);
            const reason = `a hook's subagentType '${arrived.subagentType}' names no agent this call can dispatch (${listed.length > 0 ? `available: ${listed.join(', ')}` : 'none is available'})`;
            throw new Error(`Subagent spawn denied by a plugin: ${reason}`);
          }
          subagent_type = arrived.subagentType;
        }
        if (typeof arrived.prompt === 'string') {
          prompt = arrived.prompt;
        }
        if (typeof arrived.description === 'string') {
          description = arrived.description.replace(/\s+/g, ' ').trim();
        }
        if (arrived.cwd === undefined || typeof arrived.cwd === 'string') {
          cwd = arrived.cwd as string | undefined;
        }
        if (arrived.model === undefined || typeof arrived.model === 'string') {
          modelParam = arrived.model as typeof modelParam;
          model = isCoordinatorMode() ? undefined : modelParam;
        }
        if (typeof arrived.background === 'boolean') {
          hookChangedBackground = arrived.background !== run_in_background;
          run_in_background = arrived.background;
        }
        hookChangedType = subagent_type !== raisedSnap.subagentType;
        const rewrittenSnap: SpawnPermissionSnap = {
          prompt,
          description,
          subagentType: subagent_type,
          model,
          background: run_in_background,
          cwd,
        };
        const ruling = await spawnRewriteRuling(AgentTool, input, raisedSnap, rewrittenSnap, toolUseContext);
        if (ruling) {
          const verb = ruling.behavior === 'deny' ? 'denies' : 'asks about';
          throw new Error(
            `A plugin's agent.spawn hook rewrote this spawn into one a permission rule ${verb}: ${ruling.message} Dispatch it directly.`,
          );
        }
        if (hookChangedType && consumeUnreviewedWebFetch(toolUseContext.toolUseId)) {
          throw new Error(
            "A plugin's agent.spawn hook named another agent for a web-fetch dispatch admitted without classifier review; it cannot run unconfined. Dispatch that agent directly.",
          );
        }
      }
    }

    // In-process teammates get a no-op setAppState; setAppStateForTasks
    // reaches the root store so task registration/progress/kill stay visible.
    const rootSetAppState = toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState;

    // densable: S = xd() ? g.teamContext : undefined
    const teamContext = isAgentSwarmsEnabled() ? appState.teamContext : undefined;
    // densable: (w || Bht()) && name — roster is flat; isTeammate covers both.
    if (isTeammate() && name) {
      throw new Error(
        'Teammates cannot spawn other teammates — the team roster is flat. To spawn a subagent instead, omit the `name` parameter.',
      );
    }
    // densable: w && run_in_background === true (teammateContext only).
    // A hook that flipped background uses the hook sentence after shouldRunAsync.
    if (isInProcessTeammate() && run_in_background === true && !hookChangedBackground) {
      throw new Error(
        'In-process teammates cannot spawn background agents. Use run_in_background=false for synchronous subagents.',
      );
    }

    // densable 2.1.217 Bue/cN — nest depth gate before any spawn path.
    // m = cN(agentContext); g = Bue(); if (m >= g) throw subagent_depth_cap
    // child depth = m + 1 (spawnDepth / SubagentContext.depth)
    let childSpawnDepth = 1;
    try {
      const parentDepth = assertSubagentDepthAllowed({
        agentContext: getAgentContext(),
      });
      childSpawnDepth = parentDepth + 1;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Subagent nesting limit reached')) {
        logEvent('subagent_depth_cap', {});
      }
      throw error;
    }

    // densable L(Me)/N() — session subagent spawn cap (before any real spawn path).
    // Me=true (allowInterrupt) only for local async spawn: high-priority
    // "interrupt" must not cancel bg agents mid-startup (2.1.216 #15).
    const consumeSessionSpawnSlot = (allowInterrupt = false): void => {
      try {
        assertCanSpawnSubagent({
          abortSignal: toolUseContext.abortController.signal,
          allowInterrupt,
          // densable 2.1.217 Hrr — deny new agents when --max-budget-usd reached
          maxBudgetUsd: toolUseContext.options.maxBudgetUsd,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Subagent spawn limit reached')) {
          logEvent('subagent_count_cap', {});
        }
        if (error instanceof Error && error.message.startsWith('Budget limit reached')) {
          logEvent('subagent_budget_exhausted', {});
        }
        throw error;
      }
    };

    // densable: S && name && !fork && !WIe && !isolation && !cwd
    // Same NFKC fold as isExplicitFork so `Fork` / dashed forms skip teammate spawn.
    const isForkType =
      subagent_type !== undefined &&
      normalizeAgentTypeKey(subagent_type) === normalizeAgentTypeKey(FORK_SUBAGENT_TYPE) &&
      isForkSubagentProductEnabled();
    if (
      teamContext &&
      name &&
      !isForkType &&
      !shouldSkipTeammateSpawnForWebFetch(subagent_type, toolUseContext.options.agentDefinitions.activeAgents) &&
      !isolation &&
      !cwd
    ) {
      // densable: N() before teammate spawn
      consumeSessionSpawnSlot();
      // Set agent definition color for grouped UI display before spawning
      const agentDef = subagent_type
        ? toolUseContext.options.agentDefinitions.activeAgents.find(a => a.agentType === subagent_type)
        : undefined;
      if (agentDef?.color) {
        setAgentColor(subagent_type!, agentDef.color);
      }
      const result = await spawnTeammate(
        {
          name,
          prompt,
          description,
          use_splitpane: true,
          // densable: plan_mode_required:_==="plan" where _ is parent session mode
          // (input `mode` is deprecated/ignored).
          plan_mode_required: permissionMode === 'plan',
          model: resolveForcedSpawnModel(agentDef?.model, model),
          agent_type: subagent_type,
          invokingRequestId: assistantMessage?.requestId as string | undefined,
        },
        toolUseContext,
      );

      // Type assertion uses TeammateSpawnedOutput (defined above) instead of any.
      // This type is excluded from the exported outputSchema for dead code elimination.
      // Cast through unknown because TeammateSpawnedOutput is intentionally
      // not part of the exported Output union (for dead code elimination purposes).
      const spawnResult: TeammateSpawnedOutput = {
        status: 'teammate_spawned' as const,
        prompt,
        ...result.data,
      };
      return { data: spawnResult } as unknown as { data: Output };
    }

    // densable: fork is explicit `subagent_type: fork` (NFKC) AND gate AND
    // constraints. Omitting subagent_type never defaults to fork.
    const allAgents = toolUseContext.options.agentDefinitions.activeAgents;
    const { allowedAgentTypes } = toolUseContext.options.agentDefinitions;
    // densable Nn — remote isolation and recursive fork each have their own sentence.
    const forkConstraintMessage =
      isolation === 'remote'
        ? 'Fork cannot use isolation: "remote" — a remote session cannot inherit the conversation context. Omit isolation (or use "worktree"), or spawn a named agent type for remote work.'
        : toolUseContext.options.querySource === `agent:builtin:${FORK_AGENT.agentType}` ||
            isInForkChild(toolUseContext.messages)
          ? 'Fork is not available inside a forked worker. Complete your task directly using your tools.'
          : null;
    const isExplicitFork =
      subagent_type !== undefined && normalizeAgentTypeKey(subagent_type) === normalizeAgentTypeKey(FORK_SUBAGENT_TYPE);
    const forkTypeAlreadyListed = allAgents.some(
      agent => normalizeAgentTypeKey(agent.agentType) === normalizeAgentTypeKey(FORK_SUBAGENT_TYPE),
    );
    // densable Cn: Yne() || (innerCall && cHr()), fork not already listed, allowlist.
    const forkPredicate =
      (isForkSubagentProductEnabled() || (toolUseContext.innerCall === true && isForkSubagentScriptCallEnabled())) &&
      !forkTypeAlreadyListed &&
      (allowedAgentTypes?.includes(FORK_SUBAGENT_TYPE) ?? true);
    const forkDeniedRule = forkPredicate
      ? getDenyRuleForAgent(appState.toolPermissionContext, AGENT_TOOL_NAME, FORK_SUBAGENT_TYPE)
      : null;
    const forkAvailable = forkPredicate && !forkDeniedRule;
    if (isExplicitFork && forkDeniedRule) {
      throw new Error(
        `Agent type '${FORK_SUBAGENT_TYPE}' has been denied by permission rule '${AGENT_TOOL_NAME}(${FORK_SUBAGENT_TYPE})' from ${forkDeniedRule.source ?? 'settings'}.`,
      );
    }
    const isForkPath = isExplicitFork && forkAvailable;
    if (isForkPath && forkConstraintMessage) {
      throw new Error(forkConstraintMessage);
    }
    if (subagent_type === undefined) {
      if (!isGeneralPurposeAvailable(allAgents, allowedAgentTypes)) {
        const agents = filterDeniedAgents(
          allowedAgentTypes ? allAgents.filter(a => allowedAgentTypes.includes(a.agentType)) : allAgents,
          appState.toolPermissionContext,
          AGENT_TOOL_NAME,
        );
        const availableTypes = agents.map(a => a.agentType);
        const listed =
          forkAvailable && forkConstraintMessage === null ? [FORK_SUBAGENT_TYPE, ...availableTypes] : availableTypes;
        logEvent('tengu_subagent_type_miss', {
          requestedNormalized: 'OMITTED' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          availableCount: agents.length,
        });
        logEvent('tengu_feature_bad', {
          feature_name: 'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code: 'subagent_type_missing' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        throw new Error(
          `${SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE}. Available agents: ${formatAvailableAgentTypes(listed)}`,
        );
      }
    }

    const effectiveType = isForkPath ? undefined : (subagent_type ?? GENERAL_PURPOSE_AGENT.agentType);

    let selectedAgent: AgentDefinition;
    if (isForkPath) {
      // Nn already rejected remote isolation and recursive forks above.
      selectedAgent = FORK_AGENT;
    } else {
      // Non-fork: omit-type → GP. TS cannot narrow `effectiveType` off isForkPath.
      const resolvedType = subagent_type ?? GENERAL_PURPOSE_AGENT.agentType;
      // Filter agents to exclude those denied via Agent(AgentName) syntax
      const agents = filterDeniedAgents(
        // When allowedAgentTypes is set (from Agent(x,y) tool spec), restrict to those types
        allowedAgentTypes ? allAgents.filter(a => allowedAgentTypes.includes(a.agentType)) : allAgents,
        appState.toolPermissionContext,
        AGENT_TOOL_NAME,
      );

      const found = agents.find(agent => agent.agentType === resolvedType);
      if (!found) {
        // Check if the agent exists but is denied by permission rules
        const agentExistsButDenied = allAgents.find(agent => agent.agentType === resolvedType);
        if (agentExistsButDenied) {
          const denyRule = getDenyRuleForAgent(appState.toolPermissionContext, AGENT_TOOL_NAME, resolvedType);
          throw new Error(
            `Agent type '${resolvedType}' has been denied by permission rule '${AGENT_TOOL_NAME}(${resolvedType})' from ${denyRule?.source ?? 'settings'}.`,
          );
        }
        throw new Error(
          `Agent type '${resolvedType}' not found. Available agents: ${formatAvailableAgentTypes(agents.map(a => a.agentType))}`,
        );
      }
      selectedAgent = found;
    }

    // Official bUr densable: resolve observer declaration (warn on
    // chaining/missing). Full o5r spawnFirstRun remains denser; pairing is
    // armed after earlyAgentId so YOu/enqueue can target the observed agent.
    let resolvedObserver:
      | {
          observerDefinition: { agentType: string };
          observerMessage?: string;
        }
      | undefined;
    if (selectedAgent.observer) {
      try {
        const { resolveObserverAgent, formatObserverResolveWarn } = await import('src/utils/observerAgents.js');
        const observerResult = resolveObserverAgent({
          observedDefinition: selectedAgent,
          activeAgents: toolUseContext.options.agentDefinitions.activeAgents,
          // Nested observer agents should not chain further observers.
          observedIsObserver: Boolean(toolUseContext.options.querySource?.startsWith('agent:observer:')),
        });
        const warn = formatObserverResolveWarn(observerResult);
        if (warn) {
          logForDebugging(warn, { level: 'warn' });
        }
        if (observerResult.status === 'ok') {
          resolvedObserver = {
            observerDefinition: observerResult.observerDefinition,
            ...(observerResult.observerMessage ? { observerMessage: observerResult.observerMessage } : {}),
          };
        }
      } catch {
        // Best-effort — observer resolve must not block agent spawn.
      }
    }

    // Same lifecycle constraint as the run_in_background guard above, but for
    // agent definitions that force background via `background: true`. Checked
    // here because selectedAgent is only now resolved.
    if (isInProcessTeammate() && selectedAgent.background === true) {
      throw new Error(
        `In-process teammates cannot spawn background agents. Agent '${selectedAgent.agentType}' has background: true in its definition.`,
      );
    }

    // Capture for type narrowing — `let selectedAgent` prevents TS from
    // narrowing property types across the if-else assignment above.
    const requiredMcpServers = selectedAgent.requiredMcpServers;

    // Check if required MCP servers have tools available
    // A server that's connected but not authenticated won't have any tools
    if (requiredMcpServers?.length) {
      // If any required servers are still pending (connecting), wait for them
      // before checking tool availability. This avoids a race condition where
      // the agent is invoked before MCP servers finish connecting.
      const hasPendingRequiredServers = appState.mcp.clients.some(
        c =>
          c.type === 'pending' &&
          requiredMcpServers.some(pattern => c.name.toLowerCase().includes(pattern.toLowerCase())),
      );

      let currentAppState = appState;
      if (hasPendingRequiredServers) {
        const MAX_WAIT_MS = 30_000;
        const POLL_INTERVAL_MS = 500;
        const deadline = Date.now() + MAX_WAIT_MS;

        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS);
          currentAppState = toolUseContext.getAppState();

          // Early exit: if any required server has already failed, no point
          // waiting for other pending servers — the check will fail regardless.
          const hasFailedRequiredServer = currentAppState.mcp.clients.some(
            c =>
              c.type === 'failed' &&
              requiredMcpServers.some(pattern => c.name.toLowerCase().includes(pattern.toLowerCase())),
          );
          if (hasFailedRequiredServer) break;

          const stillPending = currentAppState.mcp.clients.some(
            c =>
              c.type === 'pending' &&
              requiredMcpServers.some(pattern => c.name.toLowerCase().includes(pattern.toLowerCase())),
          );
          if (!stillPending) break;
        }
      }

      // Get servers that actually have tools (meaning they're connected AND authenticated)
      const serversWithTools: string[] = [];
      for (const tool of currentAppState.mcp.tools) {
        if (tool.name?.startsWith('mcp__')) {
          // Extract server name from tool name (format: mcp__serverName__toolName)
          const parts = tool.name.split('__');
          const serverName = parts[1];
          if (serverName && !serversWithTools.includes(serverName)) {
            serversWithTools.push(serverName);
          }
        }
      }

      if (!hasRequiredMcpServers(selectedAgent, serversWithTools)) {
        const missing = requiredMcpServers.filter(
          pattern => !serversWithTools.some(server => server.toLowerCase().includes(pattern.toLowerCase())),
        );
        throw new Error(
          `Agent '${selectedAgent.agentType}' requires MCP servers matching: ${missing.join(', ')}. ` +
            `MCP servers with tools: ${serversWithTools.length > 0 ? serversWithTools.join(', ') : 'none'}. ` +
            `Use /mcp to configure and authenticate the required MCP servers.`,
        );
      }
    }

    // Initialize the color for this agent if it has a predefined one
    if (selectedAgent.color) {
      setAgentColor(selectedAgent.agentType, selectedAgent.color);
    }

    // densable G before L(G&&!B): async decision must precede spawn-slot consume so
    // interrupt-immunity applies only to local async (2.1.216 #15).
    // isCoordinatorMode densable (COORDINATOR_MODE feature + env).
    const isCoordinator = isCoordinatorMode();
    // densable wo caller bag under semantic names.
    // Gold Ht = Yne() && e.agentId!==void 0 && !Ct && !_e && Ce()
    // Yne = _Ie && !coordinator (product fork, no Ce). Ce only belongs in Ht.
    // (Ce ≈ getIsNonInteractiveSession; Ct = innerCall===true).
    const callerIsInProcessTeammate = isInProcessTeammate();
    const forkProductEnabled = isForkSubagentProductEnabled();
    const callerIsHeadlessSubagent =
      forkProductEnabled &&
      toolUseContext.agentId !== undefined &&
      !toolUseContext.innerCall &&
      !callerIsInProcessTeammate &&
      getIsNonInteractiveSession();
    // densable qt: Yne() && !_e && !Ht — excludes headless-subagent callers (not Ce alone).
    // Fork gate forces eligible spawns async for a unified
    // <task-notification> interaction model (not just fork spawns).
    // Gold 289 has no KAIROS/kairosEnabled "force all agents async" arm.
    const forceAsync = forkProductEnabled && !callerIsInProcessTeammate && !callerIsHeadlessSubagent;
    // Official q resolve: Gji → Iq ignore → Tno fallback. Then U = j || (... && !G).
    const effectiveIsolation = resolveEffectiveIsolation(isolation, selectedAgent);
    const isRemoteIsolation = effectiveIsolation === 'remote';
    // densable wo: h/b/D → shouldRunAsync. Gold 289 has no proactive gate.
    // Unset run_in_background → background by default (except in-process/headless callers).
    // Official U=j||(...)&&!G — remote stays async even when bg tasks are disabled.
    // densable Mv for wo D only: built-in source + agentType==='web-fetch' (Iq), not name-alias h9n.
    const isWebFetchSpawn = isBuiltInWebFetchAgent(selectedAgent);
    const spawnGate = resolveSpawnBackgroundTasksDisabled({
      wantsBackground: run_in_background,
      assistant: assistantMessage,
      toolUseId: toolUseContext.toolUseId,
      callerAgentId: toolUseContext.agentId,
      signal: toolUseContext.abortController.signal,
    });
    const spawnBackgroundTasksDisabled = spawnGate.backgroundTasksDisabled;
    // densable `rn = ALo(...) && TRe()` — compute before Sot so this spawn is
    // not counted as its own sibling. GB tengu_twinkling_boole defaults false.
    const sharesCwdSiblingInput = {
      tasks: appState.tasks,
      selectedAgent,
      effectiveIsolation,
      cwd,
      parentCwd: getCwd(),
      parentAgentId: toolUseContext.agentId,
    };
    const sameCwdWriteCapableSibling = hasSameCwdWriteCapableSibling(sharesCwdSiblingInput);
    const sharesCwd = resolveSharesCwdStamp(sharesCwdSiblingInput);
    const h = callerIsInProcessTeammate || callerIsHeadlessSubagent;
    const b = (isCoordinator && !callerIsInProcessTeammate) || forceAsync || (!h && run_in_background !== false);
    const D = run_in_background === true || selectedAgent.background === true || (!isWebFetchSpawn && b);
    const shouldRunAsync = isRemoteIsolation || (D && !spawnBackgroundTasksDisabled);
    if (hookRan && cwd !== undefined && cwd !== originalSpawnCwd && effectiveIsolation === 'worktree') {
      throw new Error(
        'A plugin\'s agent.spawn hook set cwd on a spawn isolated in a worktree; cwd and isolation: "worktree" are mutually exclusive.',
      );
    }
    if (hookChangedBackground && isInProcessTeammate() && shouldRunAsync && !isRemoteIsolation) {
      throw new Error(
        "In-process teammates cannot spawn background agents; a plugin's agent.spawn hook backgrounded this one.",
      );
    }

    // densable L(G&&!B) — count after type/permission/MCP guards, before worktree/remote/run.
    // Me = local async only: high-priority "interrupt" must not cancel bg startup.
    consumeSessionSpawnSlot(shouldRunAsync && !isRemoteIsolation);

    // Resolve agent params for logging (these are already resolved in runAgent).
    // Official $6e: built-in Explore may rewrite model to opus cap before getAgentModel.
    const [forcedFrontmatter, forcedToolModel] = applySubagentModelForce(
      resolveAgentDefinitionModel(selectedAgent, toolUseContext.options.mainLoopModel),
      isForkPath ? undefined : model,
    );
    const resolvedAgentModel = getAgentModel(
      forcedFrontmatter,
      toolUseContext.options.mainLoopModel,
      forcedToolModel,
      permissionMode,
    );

    logEvent('tengu_agent_tool_selected', {
      agent_type: selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model: resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: selectedAgent.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      color: selectedAgent.color as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      is_built_in_agent: isBuiltInAgent(selectedAgent),
      is_resume: false,
      is_async: shouldRunAsync,
      is_fork: isForkPath,
    });

    // Official j: isolation still remote after Tno fallback → CCR.
    if (isRemoteIsolation) {
      const eligibility = await checkRemoteAgentEligibility();
      if (!eligibility.eligible) {
        const reasons = (eligibility as { eligible: false; errors: BackgroundRemoteSessionPrecondition[] }).errors
          .map(formatPreconditionError)
          .join('\n');
        logEvent('tengu_feature_bad', {
          feature_name: 'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code: 'subagent_remote_ineligible' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        throw new Error(`Cannot launch cloud agent:\n${reasons}`);
      }

      let bundleFailHint: string | undefined;
      const session = await teleportToRemote({
        initialMessage: prompt,
        description,
        signal: toolUseContext.abortController.signal,
        onBundleFail: msg => {
          bundleFailHint = msg;
        },
      });
      if (!session) {
        throw new Error(bundleFailHint ?? 'Failed to create remote session');
      }

      const { taskId, sessionId } = registerRemoteAgentTask({
        remoteTaskType: 'remote-agent',
        session: { id: session.id, title: session.title || description },
        command: prompt,
        context: toolUseContext,
        toolUseId: toolUseContext.toolUseId,
      });

      logEvent('tengu_agent_tool_remote_launched', {
        agent_type: selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      const remoteResult: RemoteLaunchedOutput = {
        status: 'remote_launched',
        taskId,
        sessionUrl: getRemoteTaskSessionUrl(sessionId),
        description,
        prompt,
        outputFile: getTaskOutputPath(taskId),
      };
      return { data: remoteResult } as unknown as { data: Output };
    }
    // System prompt + prompt messages: branch on fork path.
    //
    // Fork path: child inherits the PARENT's system prompt (not FORK_AGENT's)
    // for cache-identical API request prefixes. Prompt messages are built via
    // buildForkedMessages() which clones the parent's full assistant message
    // (all tool_use blocks) + placeholder tool_results + per-child directive.
    //
    // Normal path: build the selected agent's own system prompt with env
    // details, and use a simple user message for the prompt.
    let enhancedSystemPrompt: string[] | undefined;
    let forkParentSystemPrompt: ReturnType<typeof buildEffectiveSystemPrompt> | undefined;
    let promptMessages: MessageType[];

    if (isForkPath) {
      if (toolUseContext.renderedSystemPrompt) {
        forkParentSystemPrompt = toolUseContext.renderedSystemPrompt;
      } else {
        // Fallback: recompute. May diverge from parent's cached bytes if
        // GrowthBook state changed between parent turn-start and fork spawn.
        const mainThreadAgentDefinition = appState.agent
          ? appState.agentDefinitions.activeAgents.find(a => a.agentType === appState.agent)
          : undefined;
        const additionalWorkingDirectories = Array.from(
          appState.toolPermissionContext.additionalWorkingDirectories.keys(),
        );
        const defaultSystemPrompt = await getSystemPrompt(
          toolUseContext.options.tools,
          toolUseContext.options.mainLoopModel,
          additionalWorkingDirectories,
          toolUseContext.options.mcpClients,
        );
        forkParentSystemPrompt = buildEffectiveSystemPrompt({
          mainThreadAgentDefinition,
          toolUseContext,
          customSystemPrompt: toolUseContext.options.customSystemPrompt,
          defaultSystemPrompt,
          appendSystemPrompt: toolUseContext.options.appendSystemPrompt,
        });
      }
      promptMessages = buildForkedMessages(prompt, assistantMessage);
    } else {
      try {
        const additionalWorkingDirectories = Array.from(
          appState.toolPermissionContext.additionalWorkingDirectories.keys(),
        );

        // All agents have getSystemPrompt - pass toolUseContext to all
        const agentPrompt = selectedAgent.getSystemPrompt({ toolUseContext });

        // Log agent memory loaded event for subagents
        if (selectedAgent.memory) {
          logEvent('tengu_agent_memory_loaded', {
            agent_type: selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            scope: selectedAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            source: 'subagent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        }

        // Apply environment details enhancement
        enhancedSystemPrompt = await enhanceSystemPromptWithEnvDetails(
          [agentPrompt],
          resolvedAgentModel,
          additionalWorkingDirectories,
        );
      } catch (error) {
        logForDebugging(`Failed to get system prompt for agent ${selectedAgent.agentType}: ${errorMessage(error)}`);
      }
      promptMessages = [createUserMessage({ content: prompt })];
    }

    const metadata = {
      prompt,
      resolvedAgentModel,
      isBuiltInAgent: isBuiltInAgent(selectedAgent),
      startTime,
      agentType: selectedAgent.agentType,
      // Official 208: default background (run_in_background !== false) unless
      // in-process teammate; explicit true / agent.background still force async.
      isAsync: shouldRunAsync,
      // densable W$n `Mv(s)?moe()` — built-in web-fetch saved-files bag.
      persistedToolResultFiles: webFetchSavedFilesForAgent(selectedAgent),
    };

    // shouldRunAsync / isCoordinator / forceAsync computed earlier (before
    // L(G&&!B) spawn-slot consume) so interrupt immunity matches densable G.
    // Coordinator anti-injection addendum still applied here after system
    // prompt assembly.
    if (isCoordinator && !isForkPath && enhancedSystemPrompt) {
      enhancedSystemPrompt = [...enhancedSystemPrompt, getWorkerAntiInjectionAddendum()];
    }
    // densable `ie={...y,mode:$.permissionMode??_}`:
    // worker tool pool uses agent-definition frontmatter permissionMode, else
    // inherits the parent session mode `_` (not hard-coded acceptEdits).
    // Input `mode` is ignored (#42).
    const workerPermissionContext = {
      ...appState.toolPermissionContext,
      mode: selectedAgent.permissionMode ?? permissionMode,
    };
    const workerTools = assembleToolPool(workerPermissionContext, appState.mcp.tools);

    // Create a stable agent ID early so it can be used for worktree slug
    const earlyAgentId = createAgentId();

    // Official observer pairing densable (G0t/o5r plan+install): reserve
    // observer task id keyed by observed earlyAgentId. Host is pairing-scoped
    // (reads pairing.armingToolUseContext / setAppState) so concurrent agents
    // share one process host without force:true clobber.
    if (resolvedObserver) {
      try {
        const { installObserverPairing } = await import('src/utils/observerAgents.js');
        const { installAgentObserverRuntimeHost } = await import('./observerRuntimeHost.js');
        const rootSetAppStateForObserver = toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState;
        // Shared real G0t host — also used by query VOu / resumeAgent zOu.
        await installAgentObserverRuntimeHost({
          toolUseContext,
          canUseTool,
          setAppState: rootSetAppStateForObserver,
          log: msg => logForDebugging(msg, { level: 'debug' }),
        });
        const armingPermissionMode = toolUseContext.getAppState().toolPermissionContext.mode;
        const installed = await installObserverPairing({
          observedKey: earlyAgentId,
          observedTaskId: earlyAgentId,
          observedName: selectedAgent.agentType,
          observedAgentType: selectedAgent.agentType,
          observerDefinition: {
            agentType: resolvedObserver.observerDefinition.agentType,
            ...(resolvedObserver.observerMessage ? { observerMessage: resolvedObserver.observerMessage } : {}),
          },
          observerTaskId: createAgentId(),
          generateObserverTaskId: () => createAgentId(),
          armingPermissionMode,
          armingToolUseContext: toolUseContext,
          canUseTool,
          setAppState: rootSetAppStateForObserver,
          // Official wZi densable at arm time: Agent tool present +
          // AgentTool.checkPermissions for observer auto-spawn (ZD densable).
          tools: toolUseContext.options.tools?.map(t => ({
            name: t.name,
            ...(t.aliases ? { aliases: t.aliases } : {}),
          })),
          gateCanUseTool: async ({ subagentType, description: gateDesc, prompt: gatePrompt }) => {
            const agentTool = toolUseContext.options.tools.find(
              t => toolMatchesName(t, AGENT_TOOL_NAME) || toolMatchesName(t, LEGACY_AGENT_TOOL_NAME),
            );
            if (!agentTool) return 'deny';
            try {
              const result = await agentTool.checkPermissions(
                {
                  description: gateDesc,
                  prompt: gatePrompt,
                  subagent_type: subagentType,
                  run_in_background: true,
                },
                toolUseContext,
              );
              if (result.behavior === 'allow') return 'allow';
              if (result.behavior === 'deny') return 'deny';
              if (result.behavior === 'ask') return 'ask';
              // passthrough → allow for background auto-spawn densable
              return 'allow';
            } catch {
              return 'error';
            }
          },
          requireHost: true,
          log: msg => logForDebugging(msg, { level: 'debug' }),
        });
        // Official HXt observer pointer write densable for resume re-arm (zOu).
        if (installed) {
          void writeAgentMetadata(asAgentId(earlyAgentId), {
            agentType: selectedAgent.agentType,
            description,
            ...(name ? { name } : {}),
            observerTaskId: installed.observerTaskId,
            ...(installed.armingPermissionMode ? { armingPermissionMode: installed.armingPermissionMode } : {}),
          }).catch(_err => logForDebugging(`Failed to write observer pointer metadata: ${_err}`));
        }
      } catch {
        // Best-effort — pairing arm must not block agent spawn.
      }
    }

    // Set up worktree isolation if requested
    let worktreeInfo: {
      worktreePath: string;
      worktreeBranch?: string;
      headCommit?: string;
      gitRoot?: string;
      hookBased?: boolean;
    } | null = null;

    if (effectiveIsolation === 'worktree') {
      const slug = `agent-${earlyAgentId.slice(0, 8)}`;
      worktreeInfo = await createAgentWorktree(slug);
    }

    // Fork + worktree: inject a notice telling the child to translate paths
    // and re-read potentially stale files. Appended after the fork directive
    // so it appears as the most recent guidance the child sees.
    if (isForkPath && worktreeInfo) {
      promptMessages.push(
        createUserMessage({
          content: buildWorktreeNotice(getCwd(), worktreeInfo.worktreePath),
        }),
      );
    }

    const runAgentParams: Parameters<typeof runAgent>[0] = {
      agentDefinition: selectedAgent,
      promptMessages,
      toolUseContext,
      canUseTool,
      isAsync: shouldRunAsync,
      querySource:
        toolUseContext.options.querySource ??
        getQuerySourceForAgent(selectedAgent.agentType, isBuiltInAgent(selectedAgent)),
      model:
        isForkPath || forcedToolModel === undefined || !isModelAlias(forcedToolModel) ? undefined : forcedToolModel,
      // Fork path: pass parent's system prompt AND parent's exact tool
      // array (cache-identical prefix). workerTools is rebuilt under
      // permissionMode 'bubble' which differs from the parent's mode, so
      // its tool-def serialization diverges and breaks cache at the first
      // differing tool. useExactTools also inherits the parent's
      // thinkingConfig and isNonInteractiveSession (see runAgent.ts).
      //
      // Normal path: when a cwd override is in effect (worktree isolation
      // or explicit cwd), skip the pre-built system prompt so runAgent's
      // buildAgentSystemPrompt() runs inside wrapWithCwd where getCwd()
      // returns the override path.
      override: isForkPath
        ? { systemPrompt: forkParentSystemPrompt }
        : enhancedSystemPrompt && !worktreeInfo && !cwd
          ? { systemPrompt: asSystemPrompt(enhancedSystemPrompt) }
          : undefined,
      availableTools: isForkPath ? filterParentToolsForFork(toolUseContext.options.tools) : workerTools,
      // Pass parent conversation when the fork-subagent path needs full
      // context. useExactTools inherits thinkingConfig (runAgent.ts:624).
      forkContextMessages: isForkPath ? toolUseContext.messages : undefined,
      ...(isForkPath && { useExactTools: true }),
      worktreePath: worktreeInfo?.worktreePath,
      // densable #7 identity: worktreeBranch/cwd/spawnMode/toolUseId/parent
      // so resume restores prompt + tool restrictions (not general-purpose).
      worktreeBranch: worktreeInfo?.worktreeBranch,
      cwd: cwd ?? worktreeInfo?.worktreePath,
      spawnMode: appState.toolPermissionContext.mode,
      toolUseId: toolUseContext.toolUseId,
      parentAgentId: toolUseContext.agentId,
      // densable spawnDepth:ie = cN(parent)+1
      spawnDepth: childSpawnDepth,
      description,
      // densable E8 name:H → sidecar for Aye registerName rehydrate
      ...(name ? { name } : {}),
      // densable St / bt: fork (X) opts out; observers resume separately.
      handbackOptIn: !isForkPath,
      handbackTool: SubagentHandbackTool,
      sameCwdWriteCapableSibling,
    };

    // Helper to wrap execution with a cwd override: explicit cwd arg (KAIROS)
    // takes precedence over worktree isolation path.
    const cwdOverridePath = cwd ?? worktreeInfo?.worktreePath;
    const wrapWithCwd = <T,>(fn: () => T): T => (cwdOverridePath ? runWithCwdOverride(cwdOverridePath, fn) : fn());

    // Helper to clean up worktree after agent completes
    const cleanupWorktreeIfNeeded = async (): Promise<{
      worktreePath?: string;
      worktreeBranch?: string;
    }> => {
      if (!worktreeInfo) return {};
      const { worktreePath, worktreeBranch, headCommit, gitRoot, hookBased } = worktreeInfo;
      // Null out to make idempotent — guards against double-call if code
      // between cleanup and end of try throws into catch
      worktreeInfo = null;
      if (hookBased) {
        // Hook-based worktrees are always kept since we can't detect VCS changes
        logForDebugging(`Hook-based agent worktree kept at: ${worktreePath}`);
        return { worktreePath };
      }
      if (headCommit) {
        const changed = await hasWorktreeChanges(worktreePath, headCommit);
        if (!changed) {
          await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot, false, 'agent_tool');
          // Clear worktreePath from metadata so resume doesn't try to use
          // a deleted directory. Fire-and-forget to match runAgent's
          // writeAgentMetadata handling.
          void writeAgentMetadata(asAgentId(earlyAgentId), {
            agentType: selectedAgent.agentType,
            description,
            ...(name ? { name } : {}),
          }).catch(_err => logForDebugging(`Failed to clear worktree metadata: ${_err}`));
          return {};
        }
      }
      logForDebugging(`Agent worktree has changes, keeping: ${worktreePath}`);
      return { worktreePath, worktreeBranch };
    };

    // densable post-setup gate (after worktree/MCP/prompt awaits, before Flt):
    // if(l.abortController.signal.aborted){
    //   let Me=q_(reason); if(!(G&&Me==="interrupt")) throw await De(), new wl
    // }
    // High-priority "interrupt" during startup must not cancel local async
    // bg registration (2.1.216 #15). Sync / non-interrupt aborts still fail.
    if (toolUseContext.abortController.signal.aborted) {
      if (!(shouldRunAsync && isInterruptAbortReason(toolUseContext.abortController.signal.reason))) {
        await cleanupWorktreeIfNeeded();
        throw new AbortError();
      }
    }

    // densable 2.1.217 B()/P() — live concurrent slot after startup abort gate.
    // Je = await B(); pt wraps observer paths to release on throw; Oze finally / sync
    // completion also call Je(). ultracode + tengu_amber_kestrel bypass the deny.
    let releaseConcurrencySlot: (() => void) | undefined;
    try {
      const slotAppState = toolUseContext.getAppState();
      releaseConcurrencySlot = assertAndTakeConcurrencySlot({
        mainLoopModel: toolUseContext.options.mainLoopModel,
        effortValue: slotAppState.effortValue,
        ultracode: slotAppState.ultracode,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Concurrent subagent limit reached')) {
        logEvent('subagent_concurrency_cap', {});
      }
      await cleanupWorktreeIfNeeded();
      throw error;
    }
    const withConcurrencyRelease = async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        releaseConcurrencySlot?.();
        throw error;
      }
    };

    if (shouldRunAsync) {
      const asyncAgentId = earlyAgentId;
      if (spawnGate.admitted !== undefined) {
        const confirm = spawnGate.admitted.confirm(toolUseContext.abortController.signal);
        if (confirm?.kind === 'aborted') {
          throw new AbortError();
        }
        if (confirm?.kind === 'closed') {
          throw new Error(confirm.message || BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE);
        }
      }
      // densable bJ/Sot: He = c.agentId (raw caller); Re = Yeo(He)??mi().
      // ownerAgentId:Re (BRt/keepalive); parentAgentId:He (lineage walk).
      // Gge via registerAsyncAgent no-ops when owner is not local_agent (main).
      // Gold bJ does NOT stamp handbackContract — densable bGo runs later in
      // runAgent after Ut arming (KEEP that site; do not invent early Sot stamp).
      const parentAgentId = toolUseContext.agentId;
      const ownerId =
        resolvePanelOwnerAgentId(toolUseContext.agentId, toolUseContext.getAppState) ?? getMainThreadAgentId();
      const canReadOutputFile = toolUseContext.options.tools.some(
        t => toolMatchesName(t, FILE_READ_TOOL_NAME) || toolMatchesName(t, BASH_TOOL_NAME),
      );
      const spawnedSubagent = recordSubagentSpawn({
        agentType: selectedAgent.agentType,
        runInBackground: run_in_background,
        runsInBackground: true,
        depth: childSpawnDepth,
      });
      const agentBackgroundTask = registerAsyncAgent({
        agentId: asyncAgentId,
        description,
        prompt,
        selectedAgent,
        setAppState: rootSetAppState,
        // Don't link to parent's abort controller -- background agents should
        // survive when the user presses ESC to cancel the main thread.
        // They are killed explicitly via chat:killAgents.
        toolUseId: toolUseContext.toolUseId,
        ownerAgentId: ownerId,
        notificationTargetAgentId: asAgentId(ownerId),
        parentAgentId,
        spawnDepth: childSpawnDepth,
        cwd: cwdOverridePath ?? getCwd(),
        spawnedSubagent,
        webFetchSavedFiles: webFetchSavedFilesForAgent(selectedAgent),
        outputFileReadable: canReadOutputFile,
        model: resolvedAgentModel,
        // densable YP after handover — Gge only when taken.
        attachOwnerKeepalive: false,
      });
      if (spawnGate.admitted !== undefined) {
        const taken = spawnGate.admitted.handOver({
          agentId: agentBackgroundTask.agentId,
          abortController: agentBackgroundTask.abortController ?? new AbortController(),
        });
        if (!taken) {
          // densable zA(..., {lifecycleNotStarted:!0}), ze(), lx() — never-started.
          killAsyncAgent(agentBackgroundTask.agentId, rootSetAppState, 'system', {
            lifecycleNotStarted: true,
          });
          releaseConcurrencySlot?.();
          logEvent('tengu_feature_bad', {
            feature_name: 'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            error_code:
              'subagent_background_launch_not_taken' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          throw new Error(BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE);
        }
      }
      if (!getIsNonInteractiveSession()) {
        addKeepaliveReason(ownerId, agentKeepaliveReason(asyncAgentId), rootSetAppState);
      }

      // Register name → agentId for SendMessage routing. Post-registerAsyncAgent
      // so we don't leave a stale entry if spawn fails. Sync agents skipped —
      // coordinator is blocked, so SendMessage routing doesn't apply.
      // densable registerName: refuse reserved MAIN_RECIPIENT_NAME ("main").
      if (name && !isReservedSpawnAgentName(name)) {
        rootSetAppState(prev => {
          const next = new Map(prev.agentNameRegistry);
          next.set(name, asAgentId(asyncAgentId));
          return { ...prev, agentNameRegistry: next };
        });
      } else if (name && isReservedSpawnAgentName(name)) {
        logForDebugging(
          `[registerName] refused reserved name "${name}" for ${asyncAgentId} — SendMessage routes it to the main conversation`,
        );
      }

      // Wrap async agent execution in agent context for analytics attribution
      // Gold Wo @194849731: tn=Xo(e.agentContext) → ...tn&&{delegatedObservation:!0}
      const asyncAgentContext: SubagentContext = {
        agentId: asyncAgentId,
        // For subagents from teammates: use team lead's session
        // For subagents from main REPL: undefined (no parent session)
        parentSessionId: getParentSessionId(),
        agentType: 'subagent' as const,
        subagentName: selectedAgent.agentType,
        isBuiltIn: isBuiltInAgent(selectedAgent),
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        invocationKind: 'spawn' as const,
        invocationEmitted: false,
        isBackgroundAgent: true,
        // densable depth:ie
        depth: childSpawnDepth,
        ...(isDelegatedObservation(getAgentContext()) ? { delegatedObservation: true } : {}),
      };

      // Workload propagation: handlePromptSubmit wraps the entire turn in
      // runWithWorkload (AsyncLocalStorage). ALS context is captured at
      // invocation time — when this `void` fires — and survives every await
      // inside. No capture/restore needed; the detached closure sees the
      // parent turn's workload automatically, isolated from its finally.
      void runWithAgentContext(asyncAgentContext, () =>
        wrapWithCwd(async () => {
          try {
            await runAsyncAgentLifecycle({
              taskId: agentBackgroundTask.agentId,
              abortController: agentBackgroundTask.abortController!,
              makeStream: onCacheSafeParams =>
                runAgent({
                  ...runAgentParams,
                  override: {
                    ...runAgentParams.override,
                    agentId: asAgentId(agentBackgroundTask.agentId),
                    abortController: agentBackgroundTask.abortController!,
                  },
                  onCacheSafeParams,
                }),
              metadata,
              description,
              toolUseContext,
              rootSetAppState,
              agentIdForCleanup: asyncAgentId,
              enableSummarization:
                isCoordinator || isForkSubagentProductEnabled() || getSdkAgentProgressSummariesEnabled(),
              getWorktreeResult: cleanupWorktreeIfNeeded,
              // densable Oze finally p?.() — release concurrent slot on settle
              onRunSettled: releaseConcurrencySlot,
            });
          } finally {
            releaseAgentLocks(agentBackgroundTask.agentId);
          }
        }),
      );

      return {
        data: {
          isAsync: true as const,
          status: 'async_launched' as const,
          agentId: agentBackgroundTask.agentId,
          description: description,
          resolvedModel: resolvedAgentModel,
          modelsUsed: [resolvedAgentModel],
          prompt: prompt,
          agentType: selectedAgent.agentType,
          outputFile: getTaskOutputPath(agentBackgroundTask.agentId),
          canReadOutputFile,
          ...(sharesCwd ? { sharesCwd: true as const } : {}),
        },
      };
    } else {
      // Create an explicit agentId for sync agents
      const syncAgentId = asAgentId(earlyAgentId);

      // Set up agent context for sync execution (for analytics attribution)
      // Gold Wo @194850921: same tn=Xo(parent) inherit as async spawn.
      const syncAgentContext: SubagentContext = {
        agentId: syncAgentId,
        // For subagents from teammates: use team lead's session
        // For subagents from main REPL: undefined (no parent session)
        parentSessionId: getParentSessionId(),
        agentType: 'subagent' as const,
        subagentName: selectedAgent.agentType,
        isBuiltIn: isBuiltInAgent(selectedAgent),
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        invocationKind: 'spawn' as const,
        invocationEmitted: false,
        // Official He: sync only backgrounds when parent agentContext is background
        isBackgroundAgent: toolUseContext.isBackgroundAgent ?? false,
        // densable depth:ie
        depth: childSpawnDepth,
        ...(isDelegatedObservation(getAgentContext()) ? { delegatedObservation: true } : {}),
      };

      // densable return pt(Ct) — concurrent release on throw; also release on
      // clean sync settle when not mid-backgrounded (once-safe Je).
      return withConcurrencyRelease(() =>
        runWithAgentContext(syncAgentContext, () =>
          wrapWithCwd(async () => {
            const agentMessages: MessageType[] = [];
            const agentStartTime = Date.now();
            const syncTracker = createProgressTracker();
            const syncResolveActivity = createActivityDescriptionResolver(toolUseContext.options.tools);

            // Yield initial progress message to carry metadata (prompt)
            if (promptMessages.length > 0) {
              const normalizedPromptMessages = normalizeMessages(promptMessages);
              const normalizedFirstMessage = normalizedPromptMessages.find(
                (m): m is NormalizedUserMessage => m.type === 'user',
              );
              if (normalizedFirstMessage && normalizedFirstMessage.type === 'user' && onProgress) {
                onProgress({
                  toolUseID: `agent_${assistantMessage.message.id}`,
                  data: {
                    message: normalizedFirstMessage,
                    type: 'agent_progress',
                    prompt,
                    agentId: syncAgentId,
                  },
                });
              }
            }

            // Register as foreground task immediately so it can be backgrounded at any time
            // Skip registration if background tasks are disabled
            let foregroundTaskId: string | undefined;
            // Create the background race promise once outside the loop — otherwise
            // each iteration adds a new .then() reaction to the same pending
            // promise, accumulating callbacks for the lifetime of the agent.
            let backgroundPromise: Promise<{ type: 'background' }> | undefined;
            let cancelAutoBackground: (() => void) | undefined;
            if (!spawnBackgroundTasksDisabled) {
              // densable OSu: He = c.agentId; Re = Yeo(He)??mi().
              // ownerAgentId:Re; parentAgentId:He. No Gge until mid-bg.
              const fgParentAgentId = toolUseContext.agentId;
              const fgOwnerId =
                resolvePanelOwnerAgentId(toolUseContext.agentId, toolUseContext.getAppState) ?? getMainThreadAgentId();
              const fgCanRead = toolUseContext.options.tools.some(
                t => toolMatchesName(t, FILE_READ_TOOL_NAME) || toolMatchesName(t, BASH_TOOL_NAME),
              );
              const registration = registerAgentForeground({
                agentId: syncAgentId,
                description,
                prompt,
                selectedAgent,
                setAppState: rootSetAppState,
                toolUseId: toolUseContext.toolUseId,
                autoBackgroundMs: getAutoBackgroundMs() || undefined,
                ownerAgentId: fgOwnerId,
                notificationTargetAgentId: asAgentId(fgOwnerId),
                parentAgentId: fgParentAgentId,
                spawnDepth: childSpawnDepth,
                cwd: cwdOverridePath ?? getCwd(),
                spawnedSubagent: recordSubagentSpawn({
                  agentType: selectedAgent.agentType,
                  runInBackground: run_in_background,
                  runsInBackground: false,
                  depth: childSpawnDepth,
                }),
                webFetchSavedFiles: webFetchSavedFilesForAgent(selectedAgent),
                outputFileReadable: fgCanRead,
                model: resolvedAgentModel,
              });
              foregroundTaskId = registration.taskId;
              backgroundPromise = registration.backgroundSignal.then(() => ({
                type: 'background' as const,
              }));
              cancelAutoBackground = registration.cancelAutoBackground;
            }

            // Track if we've shown the background hint UI
            let backgroundHintShown = false;
            // Track if the agent was backgrounded (cleanup handled by backgrounded finally)
            let wasBackgrounded = false;
            // Per-scope stop function — NOT shared with the backgrounded closure.
            // idempotent: startAgentSummarization's stop() checks `stopped` flag.
            let stopForegroundSummarization: (() => void) | undefined;
            // const capture for sound type narrowing inside the callback below
            const summaryTaskId = foregroundTaskId;

            // Get async iterator for the agent
            const agentIterator = runAgent({
              ...runAgentParams,
              override: {
                ...runAgentParams.override,
                agentId: syncAgentId,
              },
              onCacheSafeParams:
                summaryTaskId && getSdkAgentProgressSummariesEnabled()
                  ? (params: CacheSafeParams) => {
                      const { stop } = startAgentSummarization(summaryTaskId, syncAgentId, params, rootSetAppState);
                      stopForegroundSummarization = stop;
                    }
                  : undefined,
            })[Symbol.asyncIterator]();

            // Track if an error occurred during iteration
            let syncAgentError: Error | undefined;
            let wasAborted = false;
            let worktreeResult: {
              worktreePath?: string;
              worktreeBranch?: string;
            } = {};

            try {
              while (true) {
                const elapsed = Date.now() - agentStartTime;

                // Show background hint after threshold (but task is already registered)
                // Skip if background tasks are disabled
                if (
                  !spawnBackgroundTasksDisabled &&
                  !backgroundHintShown &&
                  elapsed >= PROGRESS_THRESHOLD_MS &&
                  toolUseContext.setToolJSX
                ) {
                  backgroundHintShown = true;
                  toolUseContext.setToolJSX({
                    jsx: <BackgroundHint />,
                    shouldHidePromptInput: false,
                    shouldContinueAnimation: true,
                    showSpinner: true,
                  });
                }

                // Race between next message and background signal
                // If background tasks are disabled, just await the next message directly
                const nextMessagePromise = agentIterator.next();
                const raceResult = backgroundPromise
                  ? await Promise.race([
                      nextMessagePromise.then(r => ({
                        type: 'message' as const,
                        result: r,
                      })),
                      backgroundPromise,
                    ])
                  : {
                      type: 'message' as const,
                      result: await nextMessagePromise,
                    };

                // Check if we were backgrounded via backgroundAll()
                // foregroundTaskId is guaranteed to be defined if raceResult.type is 'background'
                // because backgroundPromise is only defined when foregroundTaskId is defined
                if (raceResult.type === 'background' && foregroundTaskId) {
                  const appState = toolUseContext.getAppState();
                  const task = appState.tasks[foregroundTaskId];
                  if (isLocalAgentTask(task) && task.isBackgrounded) {
                    // Capture the taskId for use in the async callback
                    const backgroundedTaskId = foregroundTaskId;
                    wasBackgrounded = true;
                    // densable Gge(Re, `agent:${ze}`) on mid-bg async_launched —
                    // !pn() interactive only; Re = Yeo(parent)??mi().
                    // OSu already stamps child.ownerAgentId at fg register; mid-bg
                    // re-stamps if missing so BRt can tB(owner) (auto-bg path).
                    // Gge no-ops when owner is not local_agent (main/mi()).
                    if (!getIsNonInteractiveSession()) {
                      // densable: re-stamp owner Re only; parent stays He (raw c.agentId)
                      const parentAgentId = toolUseContext.agentId;
                      const ownerId =
                        resolvePanelOwnerAgentId(toolUseContext.agentId, toolUseContext.getAppState) ??
                        getMainThreadAgentId();
                      addKeepaliveReason(ownerId, agentKeepaliveReason(backgroundedTaskId), rootSetAppState);
                      rootSetAppState(prev => {
                        const t = prev.tasks[backgroundedTaskId];
                        if (!isLocalAgentTask(t)) return prev;
                        const nextParentId = t.parentAgentId ?? parentAgentId;
                        if (
                          t.ownerAgentId === ownerId &&
                          t.notificationTargetAgentId === asAgentId(ownerId) &&
                          t.parentAgentId === nextParentId
                        ) {
                          return prev;
                        }
                        return {
                          ...prev,
                          tasks: {
                            ...prev.tasks,
                            [backgroundedTaskId]: {
                              ...t,
                              ownerAgentId: t.ownerAgentId ?? ownerId,
                              notificationTargetAgentId: t.notificationTargetAgentId ?? asAgentId(ownerId),
                              parentAgentId: nextParentId,
                            },
                          },
                        };
                      });
                    }
                    // Stop foreground summarization; the backgrounded closure
                    // below owns its own independent stop function.
                    stopForegroundSummarization?.();

                    // Workload: inherited via ALS at `void` invocation time,
                    // same as the async-from-start path above.
                    // Continue agent in background and return async result
                    transferAgentLocks(syncAgentId, backgroundedTaskId);
                    // Mid-backgrounded: promote to background agent so session
                    // activity no longer bumps mainLoopRefcount (HOn).
                    const backgroundedAgentContext: SubagentContext = {
                      ...syncAgentContext,
                      agentId: asAgentId(backgroundedTaskId),
                      isBackgroundAgent: true,
                    };
                    void runWithAgentContext(backgroundedAgentContext, async () => {
                      let stopBackgroundedSummarization: (() => void) | undefined;
                      try {
                        // Clean up the foreground iterator so its finally block runs
                        // (releases MCP connections, session hooks, prompt cache tracking, etc.)
                        // Timeout prevents blocking if MCP server cleanup hangs.
                        // .catch() prevents unhandled rejection if timeout wins the race.
                        await Promise.race([agentIterator.return(undefined).catch(() => {}), sleep(1000)]);
                        // Initialize progress tracking from existing messages (rebuild so
                        // any in-place usage mutations already applied are visible).
                        const tracker = createProgressTracker();
                        const resolveActivity2 = createActivityDescriptionResolver(toolUseContext.options.tools);
                        // densable Yqe D: seed isIdle from pre-bg messages, then track mid-bg stream.
                        const isIdleTracker = createLocalAgentIsIdleTracker(backgroundedTaskId, rootSetAppState);
                        isIdleTracker.seedFromMessages(agentMessages);
                        rebuildProgressFromMessages(
                          tracker,
                          agentMessages,
                          resolveActivity2,
                          toolUseContext.options.tools,
                        );
                        for await (const msg of runAgent({
                          ...runAgentParams,
                          isAsync: true, // Agent is now running in background
                          override: {
                            ...runAgentParams.override,
                            agentId: asAgentId(backgroundedTaskId),
                            abortController: task.abortController,
                          },
                          onCacheSafeParams: getSdkAgentProgressSummariesEnabled()
                            ? (params: CacheSafeParams) => {
                                const { stop } = startAgentSummarization(
                                  backgroundedTaskId,
                                  asAgentId(backgroundedTaskId),
                                  params,
                                  rootSetAppState,
                                );
                                stopBackgroundedSummarization = stop;
                              }
                            : undefined,
                        })) {
                          // densable Phn/Ohr — skip spinner_mode control events.
                          if (isRunAgentSpinnerMode(msg)) {
                            continue;
                          }
                          agentMessages.push(msg);
                          isIdleTracker.track(msg);

                          // Rebuild so late message_delta usage mutations stick.
                          rebuildProgressFromMessages(
                            tracker,
                            agentMessages,
                            resolveActivity2,
                            toolUseContext.options.tools,
                          );
                          updateAsyncAgentProgress(
                            backgroundedTaskId,
                            getProgressUpdate(tracker, agentMessages),
                            rootSetAppState,
                          );
                          isIdleTracker.sync();
                          // message_delta often lands with no further yields until the
                          // next tool result — deferred rebuild unfreezes footer tokens.
                          scheduleDeferredAgentProgressRebuild(
                            backgroundedTaskId,
                            tracker,
                            agentMessages,
                            rootSetAppState,
                            resolveActivity2,
                            toolUseContext.options.tools,
                          );

                          const lastToolName = getLastToolUseName(msg);
                          if (lastToolName) {
                            emitTaskProgress(
                              tracker,
                              backgroundedTaskId,
                              toolUseContext.toolUseId,
                              description,
                              startTime,
                              lastToolName,
                            );
                          }
                        }
                        // Final rebuild after stream ends so last message_delta
                        // usage mutations are reflected before completion.
                        rebuildProgressFromMessages(
                          tracker,
                          agentMessages,
                          resolveActivity2,
                          toolUseContext.options.tools,
                        );
                        updateAsyncAgentProgress(
                          backgroundedTaskId,
                          getProgressUpdate(tracker, agentMessages),
                          rootSetAppState,
                        );
                        // densable Yqe (single Jeo + same Z):
                        // Jeo → Z=JXt → Cns(suppressTelemetry:Z) → DSu → if(Z) park
                        // JXt reads root via set-snapshot (same store as Jeo).
                        const preCompleteJxt = sweepAndDetectLiveAgentChildren(backgroundedTaskId, rootSetAppState);
                        const agentResult = finalizeAgentTool(agentMessages, backgroundedTaskId, metadata, {
                          suppressTelemetry: preCompleteJxt,
                        });

                        // Mark task completed FIRST so TaskOutput(block=true)
                        // unblocks immediately. classifyHandoffIfNeeded and
                        // cleanupWorktreeIfNeeded can hang — they must not gate
                        // the status transition (gh-20236).
                        // skipJeo: Jeo already ran for Z; DSu must not re-Jeo.
                        completeAsyncAgent(agentResult, rootSetAppState, { skipJeo: true });

                        // densable: if (Z) CWr + defer BRt — same Z as suppressTelemetry
                        if (preCompleteJxt) {
                          parkAgentOnKeepaliveDeferNotify(
                            backgroundedTaskId,
                            agentResult.totalDurationMs,
                            rootSetAppState,
                          );
                          return;
                        }

                        try {
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          const { maybeStopObserverForObservedTerminal } =
                            require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js');
                          maybeStopObserverForObservedTerminal(backgroundedTaskId, msg =>
                            logForDebugging(msg, { level: 'debug' }),
                          );
                        } catch {
                          // densable optional
                        }

                        // Extract text from agent result content for the notification
                        let finalMessage = extractTextContent(agentResult.content, '\n');

                        if (feature('TRANSCRIPT_CLASSIFIER')) {
                          const backgroundedAppState = toolUseContext.getAppState();
                          const handoffWarning = await classifyHandoffIfNeeded({
                            agentMessages,
                            tools: toolUseContext.options.tools,
                            toolPermissionContext: backgroundedAppState.toolPermissionContext,
                            abortSignal: task.abortController!.signal,
                            subagentType: selectedAgent.agentType,
                            totalToolUseCount: agentResult.totalToolUseCount,
                          });
                          if (handoffWarning) {
                            finalMessage = `${handoffWarning}\n\n${finalMessage}`;
                          }
                        }

                        // Clean up worktree before notification so we can include it
                        const worktreeResult = await cleanupWorktreeIfNeeded();

                        enqueueAgentNotification({
                          taskId: backgroundedTaskId,
                          description,
                          status: 'completed',
                          maxTurnsReached: readMaxTurnsReached(agentMessages),
                          setAppState: rootSetAppState,
                          finalMessage,
                          usage: {
                            totalTokens: getTokenCountFromTracker(tracker),
                            toolUses: agentResult.totalToolUseCount,
                            durationMs: agentResult.totalDurationMs,
                          },
                          toolUseId: toolUseContext.toolUseId,
                          ...worktreeResult,
                        });
                      } catch (error) {
                        if (error instanceof AbortError) {
                          // Transition status BEFORE worktree cleanup so
                          // TaskOutput unblocks even if git hangs (gh-20236).
                          killAsyncAgent(backgroundedTaskId, rootSetAppState);
                          try {
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            const { maybeStopObserverForObservedTerminal } =
                              require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js');
                            maybeStopObserverForObservedTerminal(backgroundedTaskId, msg =>
                              logForDebugging(msg, { level: 'debug' }),
                            );
                          } catch {
                            // densable optional
                          }
                          logEvent('tengu_agent_tool_terminated', {
                            agent_type:
                              metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                            model:
                              metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                            duration_ms: Date.now() - metadata.startTime,
                            is_async: true,
                            is_built_in_agent: metadata.isBuiltInAgent,
                            reason:
                              'user_cancel_background' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          });
                          const worktreeResult = await cleanupWorktreeIfNeeded();
                          const partialResult = extractPartialResult(agentMessages);
                          enqueueAgentNotification({
                            taskId: backgroundedTaskId,
                            description,
                            status: 'killed',
                            setAppState: rootSetAppState,
                            toolUseId: toolUseContext.toolUseId,
                            finalMessage: partialResult,
                            ...worktreeResult,
                          });
                          return;
                        }
                        const errMsg = errorMessage(error);
                        failAsyncAgent(backgroundedTaskId, errMsg, rootSetAppState);
                        try {
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          const { maybeStopObserverForObservedTerminal } =
                            require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js');
                          maybeStopObserverForObservedTerminal(backgroundedTaskId, msg =>
                            logForDebugging(msg, { level: 'debug' }),
                          );
                        } catch {
                          // densable optional
                        }
                        const worktreeResult = await cleanupWorktreeIfNeeded();
                        enqueueAgentNotification({
                          taskId: backgroundedTaskId,
                          description,
                          status: 'failed',
                          error: errMsg,
                          setAppState: rootSetAppState,
                          toolUseId: toolUseContext.toolUseId,
                          ...worktreeResult,
                        });
                      } finally {
                        stopBackgroundedSummarization?.();
                        releaseAgentLocks(backgroundedTaskId);
                        clearInvokedSkillsForAgent(syncAgentId);
                        clearDumpState(syncAgentId);
                        // densable 2.1.217 concurrent slot — mid-bg continues after
                        // async_launched return; release when bg lifecycle settles.
                        releaseConcurrencySlot?.();
                        // Note: worktree cleanup is done before enqueueAgentNotification
                        // in both try and catch paths so we can include worktree info
                      }
                    });

                    // Return async_launched result immediately
                    const canReadOutputFile = toolUseContext.options.tools.some(
                      t => toolMatchesName(t, FILE_READ_TOOL_NAME) || toolMatchesName(t, BASH_TOOL_NAME),
                    );
                    return {
                      data: {
                        isAsync: true as const,
                        status: 'async_launched' as const,
                        agentId: backgroundedTaskId,
                        description: description,
                        resolvedModel: resolvedAgentModel,
                        modelsUsed: [resolvedAgentModel],
                        prompt: prompt,
                        agentType: selectedAgent.agentType,
                        outputFile: getTaskOutputPath(backgroundedTaskId),
                        canReadOutputFile,
                        ...(sharesCwd ? { sharesCwd: true as const } : {}),
                      },
                    };
                  }
                }

                // Process the message from the race result
                if (raceResult.type !== 'message') {
                  // This shouldn't happen - background case handled above
                  continue;
                }
                const { result } = raceResult;
                if (result.done) break;
                // densable Phn/Ohr — skip spinner_mode control events.
                if (isRunAgentSpinnerMode(result.value)) {
                  continue;
                }
                const message = result.value as MessageType;
                agentMessages.push(message);

                // Rebuild so late message_delta usage mutations stick.
                rebuildProgressFromMessages(
                  syncTracker,
                  agentMessages,
                  syncResolveActivity,
                  toolUseContext.options.tools,
                );
                if (foregroundTaskId) {
                  // Always push token progress (not only on tool_use messages).
                  // Text-only turns still need footer updates after message_delta.
                  updateAsyncAgentProgress(
                    foregroundTaskId,
                    getProgressUpdate(syncTracker, agentMessages),
                    rootSetAppState,
                  );
                  scheduleDeferredAgentProgressRebuild(
                    foregroundTaskId,
                    syncTracker,
                    agentMessages,
                    rootSetAppState,
                    syncResolveActivity,
                    toolUseContext.options.tools,
                  );
                  const lastToolName = getLastToolUseName(message);
                  if (lastToolName) {
                    emitTaskProgress(
                      syncTracker,
                      foregroundTaskId,
                      toolUseContext.toolUseId,
                      description,
                      agentStartTime,
                      lastToolName,
                    );
                  }
                }

                // densable 2.1.219 #6: Tr = options.forwardSubagentText
                // When set, reforward nested agent_progress (depth-2+) preserving
                // parentToolUseID, and forward full assistant/user content (not
                // only tool_use/tool_result) so stream-json gets nested text.
                const forwardSubagentText = toolUseContext.options.forwardSubagentText === true;

                // Forward bash_progress events from sub-agent to parent so the SDK
                // receives tool_progress events just as it does for the main agent.
                if (
                  message.type === 'progress' &&
                  ((message.data as { type: string })?.type === 'bash_progress' ||
                    (message.data as { type: string })?.type === 'powershell_progress') &&
                  onProgress
                ) {
                  onProgress({
                    toolUseID: message.toolUseID as string,
                    data: message.data,
                  });
                }

                // densable: if(ut.type==="progress"&&ut.data.type==="agent_progress"){
                //   if(Tr)d({...,parentToolUseID:ut.parentToolUseID,data:ut.data}); return}
                if (message.type === 'progress' && (message.data as { type?: string })?.type === 'agent_progress') {
                  if (forwardSubagentText && onProgress) {
                    onProgress({
                      toolUseID: message.toolUseID as string,
                      parentToolUseID: message.parentToolUseID as string | undefined,
                      data: message.data as Progress,
                    });
                  }
                  continue;
                }

                if (message.type !== 'assistant' && message.type !== 'user') {
                  continue;
                }

                // Increment token count in spinner for assistant messages
                // Subagent streaming events are filtered out in runAgent.ts, so we
                // need to count tokens from completed messages here
                if (message.type === 'assistant') {
                  const contentLength = getAssistantMessageContentLength(message as AssistantMessage);
                  if (contentLength > 0) {
                    toolUseContext.setResponseLength(len => len + contentLength);
                  }
                }

                const normalizedNew = normalizeMessages([message]);
                for (const m of normalizedNew) {
                  // densable: for each normalized message, first content block gate:
                  // if (!Tr && it.type !== "tool_use" && it.type !== "tool_result") continue
                  const firstContent = (m.message?.content as readonly { readonly type: string }[] | undefined)?.[0];
                  if (
                    !forwardSubagentText &&
                    firstContent &&
                    firstContent.type !== 'tool_use' &&
                    firstContent.type !== 'tool_result'
                  ) {
                    continue;
                  }
                  if (!firstContent) {
                    continue;
                  }
                  if (!forwardSubagentText) {
                    // Default path: only forward tool_use / tool_result blocks
                    // (one progress per matching content, matching prior behavior)
                    for (const content of (m.message?.content ?? []) as readonly {
                      readonly type: string;
                    }[]) {
                      if (content.type !== 'tool_use' && content.type !== 'tool_result') {
                        continue;
                      }
                      if (onProgress) {
                        onProgress({
                          toolUseID: `agent_${assistantMessage.message.id}`,
                          data: {
                            message: m,
                            type: 'agent_progress',
                            prompt: '',
                            agentId: syncAgentId,
                            agentType: selectedAgent.agentType,
                            description,
                            resolvedModel: resolvedAgentModel,
                          },
                        });
                      }
                    }
                    continue;
                  }

                  // forwardSubagentText: densable forwards the whole normalized
                  // message once (text/thinking included) with agent metadata.
                  if (onProgress) {
                    onProgress({
                      toolUseID: `agent_${assistantMessage.message.id}`,
                      data: {
                        message: m,
                        type: 'agent_progress',
                        // prompt only needed on first progress message (UI.tsx:624
                        // reads progressMessages[0]). Omit here to avoid duplication.
                        prompt: '',
                        agentId: syncAgentId,
                        agentType: selectedAgent.agentType,
                        description,
                        resolvedModel: resolvedAgentModel,
                      },
                    });
                  }
                }
              }
            } catch (error) {
              // Handle errors from the sync agent loop
              // AbortError should be re-thrown for proper interruption handling
              if (error instanceof AbortError) {
                wasAborted = true;
                logEvent('tengu_agent_tool_terminated', {
                  agent_type: metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  model: metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  duration_ms: Date.now() - metadata.startTime,
                  is_async: false,
                  is_built_in_agent: metadata.isBuiltInAgent,
                  reason: 'user_cancel_sync' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
                throw error;
              }

              // Log the error for debugging
              logForDebugging(`Sync agent error: ${errorMessage(error)}`, {
                level: 'error',
              });

              // Store the error to handle after cleanup
              syncAgentError = toError(error);
            } finally {
              // Clear the background hint UI
              if (toolUseContext.setToolJSX) {
                toolUseContext.setToolJSX(null);
              }

              // Stop foreground summarization. Idempotent — if already stopped at
              // the backgrounding transition, this is a no-op. The backgrounded
              // closure owns a separate stop function (stopBackgroundedSummarization).
              stopForegroundSummarization?.();

              // Final rebuild after stream ends — last message_delta may have mutated
              // usage after the final content_block_stop yield with no further
              // messages (runAgent filters stream_event). Always push footer
              // progress (not only when SDK summaries are enabled).
              if (!wasBackgrounded) {
                rebuildProgressFromMessages(
                  syncTracker,
                  agentMessages,
                  syncResolveActivity,
                  toolUseContext.options.tools,
                );
                if (foregroundTaskId) {
                  updateAsyncAgentProgress(
                    foregroundTaskId,
                    getProgressUpdate(syncTracker, agentMessages),
                    rootSetAppState,
                  );
                }
              }

              // Unregister foreground task if agent completed without being backgrounded
              if (foregroundTaskId) {
                unregisterAgentForeground(foregroundTaskId, rootSetAppState);
                // Notify SDK consumers (e.g. VS Code subagent panel) that this
                // foreground agent is done. Goes through drainSdkEvents() — does
                // NOT trigger the print.ts XML task_notification parser or the LLM loop.
                if (!wasBackgrounded) {
                  const progress = getProgressUpdate(syncTracker, agentMessages);
                  // densable lf — once-gated bookend for Host Tasks (Jp).
                  emitTaskTerminatedSdk(
                    foregroundTaskId,
                    syncAgentError ? 'failed' : wasAborted ? 'stopped' : 'completed',
                    {
                      toolUseId: toolUseContext.toolUseId,
                      summary: description,
                      usage: {
                        total_tokens: progress.tokenCount,
                        tool_uses: progress.toolUseCount,
                        duration_ms: Date.now() - agentStartTime,
                      },
                    },
                  );
                }
              }

              // Clean up scoped skills so they don't accumulate in the global map
              clearInvokedSkillsForAgent(syncAgentId);
              releaseAgentLocks(syncAgentId);

              // Official observer densable: stop pairing on pure-sync terminal
              // (async/backgrounded paths stop via agentToolUtils / bg handlers).
              if (!wasBackgrounded) {
                try {
                  const { maybeStopObserverForObservedTerminal } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js');
                  maybeStopObserverForObservedTerminal(earlyAgentId, (msg: string) =>
                    logForDebugging(msg, {
                      level: 'debug',
                    }),
                  );
                } catch {
                  // densable optional
                }
              }

              // Clean up dumpState entry for this agent to prevent unbounded growth
              // Skip if backgrounded — the backgrounded agent's finally handles cleanup
              if (!wasBackgrounded) {
                clearDumpState(syncAgentId);
                // densable 2.1.217: release concurrent slot when pure-sync settles
                // (mid-bg path releases in its own finally). once-safe.
                releaseConcurrencySlot?.();
              }

              // Cancel auto-background timer if agent completed before it fired
              cancelAutoBackground?.();

              // Clean up worktree if applicable (in finally to handle abort/error paths)
              // Skip if backgrounded — the background continuation is still running in it
              if (!wasBackgrounded) {
                worktreeResult = await cleanupWorktreeIfNeeded();
              }
            }

            // Re-throw abort errors
            // TODO: Find a cleaner way to express this
            const lastMessage = agentMessages.findLast(_ => _.type !== 'system' && _.type !== 'progress');
            if (lastMessage && isSyntheticMessage(lastMessage)) {
              logEvent('tengu_agent_tool_terminated', {
                agent_type: metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                model: metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                duration_ms: Date.now() - metadata.startTime,
                is_async: false,
                is_built_in_agent: metadata.isBuiltInAgent,
                reason: 'user_cancel_sync' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              });
              throw new AbortError();
            }

            // If an error occurred during iteration, try to return a result with
            // whatever messages we have. If we have no assistant messages,
            // re-throw the error so it's properly handled by the tool framework.
            if (syncAgentError) {
              // Check if we have any assistant messages to return
              const hasAssistantMessages = agentMessages.some(msg => msg.type === 'assistant');

              if (!hasAssistantMessages) {
                // No messages collected, re-throw the error
                throw syncAgentError;
              }

              // We have some messages, try to finalize and return them
              // This allows the parent agent to see partial progress even after an error
              logForDebugging(`Sync agent recovering from error with ${agentMessages.length} messages`);
            }

            const agentResult = finalizeAgentTool(agentMessages, syncAgentId, metadata);

            if (feature('TRANSCRIPT_CLASSIFIER')) {
              const currentAppState = toolUseContext.getAppState();
              const handoffWarning = await classifyHandoffIfNeeded({
                agentMessages,
                tools: toolUseContext.options.tools,
                toolPermissionContext: currentAppState.toolPermissionContext,
                abortSignal: toolUseContext.abortController.signal,
                subagentType: selectedAgent.agentType,
                totalToolUseCount: agentResult.totalToolUseCount,
              });
              if (handoffWarning) {
                agentResult.content = [{ type: 'text' as const, text: handoffWarning }, ...agentResult.content];
                agentResult.harnessNoteCount = (agentResult.harnessNoteCount ?? 0) + 1;
                agentResult.harnessSectionHash = hashHarnessSectionBlocks(agentResult.content);
              }
            }

            return {
              data: {
                status: 'completed' as const,
                prompt,
                ...agentResult,
                ...worktreeResult,
              },
            };
          }),
        ),
      );
    }
  },
  isReadOnly() {
    return true; // delegates permission checks to its underlying tools
  },
  toAutoClassifierInput(input) {
    const i = input as AgentToolInput;
    // densable #42: mode is deprecated/ignored — do not surface as a tag.
    const tags = [i.subagent_type].filter((t): t is string => t !== undefined);
    const prefix = tags.length > 0 ? `(${tags.join(', ')}): ` : ': ';
    return `${prefix}${i.prompt}`;
  },
  isConcurrencySafe() {
    return true;
  },
  userFacingName,
  userFacingNameBackgroundColor,
  getActivityDescription(input) {
    return input?.description ?? 'Running task';
  },
  async checkPermissions(input, context): Promise<PermissionResult> {
    const appState = context.getAppState();

    // Only route through auto mode classifier when in auto mode
    // In all other modes, auto-approve sub-agent generation
    // Note: process.env.USER_TYPE === 'ant' guard enables dead code elimination for external builds
    if (process.env.USER_TYPE === 'ant' && appState.toolPermissionContext.mode === 'auto') {
      return {
        behavior: 'passthrough',
        message: 'Agent tool requires permission to spawn sub-agents.',
      };
    }

    return { behavior: 'allow', updatedInput: input };
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    // Multi-agent spawn result
    const internalData = data as InternalOutput;
    if (
      typeof internalData === 'object' &&
      internalData !== null &&
      'status' in internalData &&
      internalData.status === 'teammate_spawned'
    ) {
      const spawnData = internalData as TeammateSpawnedOutput;
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          {
            type: 'text',
            text: `Spawned successfully. (This tool result is internal metadata — never quote or paste any part of it, including the ID below, into a user-facing reply.)
agent_id: ${spawnData.teammate_id}
name: ${spawnData.name}
The agent is now running and will receive instructions via mailbox.`,
          },
        ],
      };
    }
    if (data.status === 'remote_launched') {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          {
            type: 'text',
            text: `Cloud agent launched. (This tool result is internal metadata — never quote or paste any part of it, including the ID below, into a user-facing reply.)
taskId: ${data.taskId}
session_url: ${data.sessionUrl}
output_file: ${data.outputFile} (final results land here only after the completion notification; until then it holds a partial, still-growing event log)
The agent is running in the cloud. You will be notified automatically when it completes. Do not report or predict its results before that notification arrives.
In your own words, briefly tell the user what you launched and end your response.`,
          },
        ],
      };
    }
    if (data.status === 'async_launched') {
      const g = `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: ${data.agentId} (internal ID - do not mention to user. Use SendMessage with to: '${data.agentId}', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.`;
      const h =
        data.canReadOutputFile && data.outputFile
          ? `Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: ${data.outputFile}
Do NOT ${FILE_READ_TOOL_NAME} or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`
          : 'In your own words, briefly tell the user what you launched — do not echo this tool result. Agent results will arrive in a subsequent message. If the user asks for progress, say the agent is still running.';
      const sharesNote = data.sharesCwd ? `\n${SHARES_CWD_LAUNCH_NOTE}` : '';
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          {
            type: 'text',
            text: `${g}\n${h}${sharesNote}`,
          },
        ],
      };
    }
    if (data.status === 'completed') {
      const worktreeInfoText = data.worktreePath
        ? `\nworktreePath: ${data.worktreePath}${data.worktreeBranch ? `\nworktreeBranch: ${data.worktreeBranch}` : ''}`
        : '';
      // If the subagent completes with no content, the tool_result is just the
      // agentId/usage trailer below — a metadata-only block at the prompt tail.
      // Some models read that as "nothing to act on" and end their turn
      // immediately. Say so explicitly so the parent has something to react to.
      const contentOrMarker =
        data.content.length > 0
          ? data.content
          : [
              {
                type: 'text' as const,
                text: '(Subagent completed but returned no output.)',
              },
            ];
      // densable Tbe()?C_n(h, note, tail, hash) — provenance join when gated.
      const provenanced = isHandbackProvenanceEnabled()
        ? applyHandbackProvenanceToCompletedContent(
            contentOrMarker,
            data.content.length > 0 ? (data.harnessNoteCount ?? 0) : 0,
            data.content.length > 0 ? (data.harnessTailCount ?? 0) : 0,
            data.harnessSectionHash,
          )
        : contentOrMarker;
      // One-shot built-ins (Explore, Plan) are never continued via SendMessage
      // — the agentId hint and <usage> block are dead weight (~135 chars ×
      // 34M Explore runs/week ≈ 1-2 Gtok/week). Telemetry doesn't parse this
      // block (it uses logEvent in finalizeAgentTool), so dropping is safe.
      // agentType is optional for resume compat — missing means show trailer.
      if (data.agentType && ONE_SHOT_BUILTIN_AGENT_TYPES.has(data.agentType) && !worktreeInfoText) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: provenanced,
        };
      }
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          ...provenanced,
          {
            type: 'text',
            text: `agentId: ${data.agentId} (use SendMessage with to: '${data.agentId}' to continue this agent)${worktreeInfoText}
<usage>total_tokens: ${data.totalTokens}
tool_uses: ${data.totalToolUseCount}
duration_ms: ${data.totalDurationMs}</usage>`,
          },
        ],
      };
    }
    data satisfies never;
    throw new Error(`Unexpected agent tool result status: ${(data as { status: string }).status}`);
  },
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseTag,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderGroupedToolUse: renderGroupedAgentToolUse,
} satisfies ToolDef<InputSchema, Output, Progress>);
