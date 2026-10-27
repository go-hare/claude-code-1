import { feature } from 'bun:bundle';
import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { randomUUID } from 'crypto';
import { setPromptId } from 'src/bootstrap/state.js';
import {
  builtInCommandNames,
  type Command,
  type CommandBase,
  findCommand,
  getCommand,
  getCommandName,
  isCommandEnabled,
  type PromptCommand,
} from 'src/commands.js';
import { NO_CONTENT_MESSAGE } from 'src/constants/messages.js';
import type { SetToolJSXFn, ToolUseContext } from 'src/Tool.js';
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  NormalizedUserMessage,
  ProgressMessage,
  UserMessage,
} from 'src/types/message.js';
import type { QueuedCommand } from 'src/types/textInputTypes.js';
import { addInvokedSkill, getSessionId } from '../../bootstrap/state.js';
import { COMMAND_MESSAGE_TAG, COMMAND_NAME_TAG } from '../../constants/xml.js';
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js';
import { getDumpPromptsPath } from '../../services/api/dumpPrompts.js';
import { buildPostCompactMessages } from '../../services/compact/compact.js';
import { resetMicrocompactState } from '../../services/compact/microCompact.js';
import type { Progress as AgentProgress } from '@claude-code/builtin-tools/tools/AgentTool/AgentTool.js';
import { isRunAgentSpinnerMode, runAgent } from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js';
import { renderToolUseProgressMessage } from '@claude-code/builtin-tools/tools/AgentTool/UI.js';
import type { CommandResultDisplay } from '../../types/command.js';
import { createAbortController } from '../abortController.js';
import { getAgentContext } from '../agentContext.js';
import { createAttachmentMessage, getAttachmentMessages } from '../attachments.js';
import { logForDebugging } from '../debug.js';
import { isCoordinatorMainThread } from '../../coordinator/coordinatorMode.js';
import { SKILL_TOOL_NAME } from '@claude-code/builtin-tools/tools/SkillTool/constants.js';
import { AbortError, errorMessage, MalformedCommandError } from '../errors.js';
import { getDisplayPath } from '../file.js';
import { extractResultText, prepareForkedCommandContext } from '../forkedAgent.js';
import {
  formatForkedSkillLaunchMarker,
  launchBackgroundForkedSkill,
  shouldBackgroundForkedSkill,
} from '../forkedSkillBackground.js';
import { getFsImplementation } from '../fsOperations.js';
import { runUserPromptExpansionHook } from '../hooks.js';
import { isFullscreenEnvEnabled } from '../fullscreen.js';
import { isCommandImmediate } from '../immediateCommand.js';
import { toArray } from '../generators.js';
import { registerSkillHooks } from '../hooks/registerSkillHooks.js';
import { logError } from '../log.js';
import { enqueue, enqueuePendingNotification } from '../messageQueueManager.js';
import {
  createCommandInputMessage,
  createSyntheticUserCaveatMessage,
  createSystemMessage,
  createUserInterruptionMessage,
  createUserMessage,
  formatCommandInputTags,
  isCompactBoundaryMessage,
  isSystemLocalCommandMessage,
  normalizeMessages,
  prepareUserContent,
} from '../messages.js';
import type { ModelAlias } from '../model/aliases.js';
import { parseToolListFromCLI } from '../permissions/permissionSetup.js';
import { hasPermissionsToUseTool } from '../permissions/permissions.js';
import { isOfficialMarketplaceName, parsePluginIdentifier } from '../plugins/pluginIdentifier.js';
import { resolveTrustedSkillAllowedTools } from '../permissions/skillAllowedToolsTrust.js';
import { isRestrictedToPluginOnly, isSourceAdminTrusted } from '../settings/pluginOnlyPolicy.js';
import { shouldSkipSkillAttachments } from '../skills/skillAttachmentSkip.js';
import { resolveSkillEffort, resolveSkillExecutionContext } from '../skills/skillExecutionContext.js';
import { getSkillPromptBlocks } from '../skills/skillPromptHook.js';
import {
  isSkillFullyDisabledByOverride,
  isSkillModelInvocationBlockedByOverride,
  resolveSkillOverrideMode,
} from '../residualFinalEnvGates.js';
import { getInitialSettings } from '../settings/settings.js';
import { parseSlashCommand } from '../slashCommandParsing.js';
import { slashCommandEditDistance, suggestSlashCommand } from '../slashCommandSuggest.js';
import { sleep } from '../sleep.js';
import { incrementPluginUsage } from '../plugins/pluginUsagePending.js';
import { recordSkillUsage } from '../suggestions/skillUsageTracking.js';
import { logOTelEvent, redactIfDisabled } from '../telemetry/events.js';
import { buildPluginCommandTelemetryFields } from '../telemetry/pluginTelemetry.js';
import { getAssistantMessageContentLength } from '../tokens.js';
import { createAgentId } from '../uuid.js';
import { finalizeAutonomyRunCompleted, finalizeAutonomyRunFailed } from '../autonomyRuns.js';
import { getWorkload } from '../workloadContext.js';
import type { ProcessUserInputBaseResult, ProcessUserInputContext } from './processUserInput.js';
import { parseStackedSlashCommands, shouldParseStackedSlash, STACKED_SLASH_LIMIT } from './stackedSlashExpansion.js';

type SlashCommandResult = ProcessUserInputBaseResult & {
  command: Command;
};

// Poll interval and deadline for MCP settle before launching a background
// forked subagent. MCP servers typically connect within 1-3s of startup;
// 10s headroom covers slow SSE handshakes.
const MCP_SETTLE_POLL_MS = 200;
const MCP_SETTLE_TIMEOUT_MS = 10_000;

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test';
}

function assertBackgroundForkedSlashCommandTestOverrideAllowed(): void {
  if (!isTestRuntime()) {
    throw new Error(
      'ToolUseContext.options.allowBackgroundForkedSlashCommands is test-only and cannot be enabled outside NODE_ENV=test.',
    );
  }
}

/**
 * Executes a slash command with context: fork in a sub-agent.
 */
async function executeForkedSlashCommand(
  command: CommandBase & PromptCommand,
  args: string,
  context: ProcessUserInputContext,
  precedingInputBlocks: ContentBlockParam[],
  setToolJSX: SetToolJSXFn,
  canUseTool: CanUseToolFn,
  autonomy?: QueuedCommand['autonomy'],
): Promise<SlashCommandResult> {
  const agentId = createAgentId();

  const pluginMarketplace = command.pluginInfo
    ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
    : undefined;
  logEvent('tengu_slash_command_forked', {
    command_name: command.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(command.pluginInfo && {
      _PROTO_plugin_name: command.pluginInfo.pluginManifest.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(pluginMarketplace && {
        _PROTO_marketplace_name: pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      ...buildPluginCommandTelemetryFields(command.pluginInfo),
    }),
  });

  const appState = await context.getAppState();
  const forceSyncFork =
    // Non-interactive / disable-bg handled inside shouldBackgroundForkedSkill
    false;
  const background = shouldBackgroundForkedSkill(command, forceSyncFork);
  const {
    skillContent,
    modifiedGetAppState,
    baseAgent,
    promptMessages,
    availableTools,
    webFetchReadmissionAllowed,
    contextLayers,
    recordInvocation,
    forkReadFileState,
  } = await prepareForkedCommandContext(command, args, context, {
    replaceCommandRules: true,
    replaceDenyRules: !background,
    deferInvocationRecording: background,
    // Gold sNt `g?.extractAttachments && !Lje` — slash passes collector when
    // the caller waits in-line; background fork skips (SkillTool omits it).
    ...(!background
      ? {
          extractAttachments: (skillContent, ctx) =>
            getAttachmentMessages(skillContent, ctx, null, [], ctx.messages, 'repl_main_thread', {
              skipSkillDiscovery: true,
              skipAtMentions: false,
            }),
        }
      : {}),
  });
  const permissionLayers =
    contextLayers.length > 0 ? [...(context.permissionLayers ?? []), ...contextLayers] : context.permissionLayers;

  // Gold `O=e.getEffort?.(s,o)??e.getDefaultEffort?.(s,o)?.value??e.effort`
  const resolvedEffort = resolveSkillEffort(command, args, context);
  const agentDefinition = resolvedEffort !== undefined ? { ...baseAgent, effort: resolvedEffort } : baseAgent;

  logForDebugging(`Executing forked slash command /${command.name} with agent ${agentDefinition.agentType}`);

  // densable 2.1.218 Cvo/wvo: context:fork skills default to background agents
  // (task-notification on complete). Opt out with frontmatter `background: false`.
  // KAIROS/assistant path below remains a separate fire-and-forget re-enqueue
  // loop for scheduled tasks (meta prompt + autonomy finalize).
  if (
    background &&
    // KAIROS path owns autonomy re-enqueue; skip double-bg when that wins.
    !(appState.kairosEnabled && (feature('KAIROS') || context.options.allowBackgroundForkedSlashCommands === true))
  ) {
    const setAppState = context.setAppStateForTasks ?? context.setAppState;
    try {
      const launched = await launchBackgroundForkedSkill({
        agentId,
        agentDefinition,
        command,
        description: `/${getCommandName(command)} ${args}`.trim(),
        prompt: skillContent,
        promptMessages,
        context: {
          ...context,
          getAppState: modifiedGetAppState,
          permissionLayers,
        },
        canUseTool,
        getAppState: modifiedGetAppState,
        setAppState,
        availableTools,
        webFetchReadmissionAllowed,
        readFileState: forkReadFileState,
        recordInvocationOnSuccess: recordInvocation,
      });
      if (launched) {
        const stdout = `Running in the background as @${launched.name}`;
        const marker = formatForkedSkillLaunchMarker({
          agentId: launched.agentId,
          skillName: command.name,
          description: `/${getCommandName(command)} ${args}`.trim(),
        });
        return {
          messages: [
            createUserMessage({
              content: prepareUserContent({
                inputString: `/${getCommandName(command)} ${args}`.trim(),
                precedingInputBlocks,
              }),
            }),
            createUserMessage({
              content: `<local-command-stdout>${stdout}</local-command-stdout>\n${marker}`,
            }),
          ],
          shouldQuery: false,
          command,
          resultText: stdout,
        };
      }
      // Official: live-duplicate → T() then fall through to sync
      recordInvocation();
      // null = live-duplicate → fall through to sync path
    } catch (err) {
      if (context.abortController.signal.aborted) {
        return {
          messages: [
            createUserMessage({
              content: prepareUserContent({
                inputString: `/${getCommandName(command)} ${args}`.trim(),
                precedingInputBlocks,
              }),
            }),
            createUserInterruptionMessage({ toolUse: false }),
          ],
          shouldQuery: false,
          command,
        };
      }
      return {
        messages: [
          createUserMessage({
            content: prepareUserContent({
              inputString: `/${getCommandName(command)} ${args}`.trim(),
              precedingInputBlocks,
            }),
          }),
          createUserMessage({
            content: `<local-command-stderr>${err instanceof Error ? err.message : String(err)}</local-command-stderr>`,
          }),
        ],
        shouldQuery: false,
        command,
      };
    }
  }

  // Assistant mode: fire-and-forget. Launch subagent in background, return
  // immediately, re-enqueue the result as an isMeta prompt when done.
  // Without this, N scheduled tasks on startup = N serial (subagent + main
  // agent turn) cycles blocking user input. With this, N subagents run in
  // parallel and results trickle into the queue as they finish.
  //
  // Gated on kairosEnabled (not CLAUDE_CODE_BRIEF) because the closed loop
  // depends on assistant-mode invariants: scheduled_tasks.json exists,
  // the main agent knows to pipe results through SendUserMessage, and
  // isMeta prompts are hidden. Outside assistant mode, context:fork commands
  // are user-invoked skills that default to densable bg above; KAIROS keeps
  // the scheduled-task re-enqueue path.
  const allowBackgroundForkedSlashCommands = context.options.allowBackgroundForkedSlashCommands === true;
  if (allowBackgroundForkedSlashCommands) {
    assertBackgroundForkedSlashCommandTestOverrideAllowed();
  }
  let canRunBackgroundForkedSlashCommand = false;
  if (appState.kairosEnabled) {
    if (feature('KAIROS')) {
      canRunBackgroundForkedSlashCommand = true;
    } else if (allowBackgroundForkedSlashCommands) {
      canRunBackgroundForkedSlashCommand = true;
    }
  }
  if (canRunBackgroundForkedSlashCommand) {
    recordInvocation();
    // Standalone abortController — background subagents survive main-thread
    // ESC (same policy as AgentTool's async path). They're cron-driven; if
    // killed mid-run they just re-fire on the next schedule.
    const bgAbortController = createAbortController();
    const commandName = getCommandName(command);

    // Workload: handlePromptSubmit wraps the entire turn in runWithWorkload
    // (AsyncLocalStorage). ALS context is captured when this `void` fires
    // and survives every await inside — isolated from the parent's
    // continuation. The detached closure's runAgent calls see the cron tag
    // automatically. We still capture the value here ONLY for the
    // re-enqueued result prompt below: that second turn runs in a fresh
    // handlePromptSubmit → fresh runWithWorkload boundary (which always
    // establishes a new context, even for `undefined`) → so it needs its
    // own QueuedCommand.workload tag to preserve attribution.
    const spawnTimeWorkload = getWorkload();

    // Re-enter the queue as a hidden prompt. isMeta: hides from queue
    // preview + placeholder + transcript. skipSlashCommands: prevents
    // re-parsing if the result text happens to start with '/'. When
    // drained, this triggers a main-agent turn that sees the result and
    // decides whether to SendUserMessage. Propagate workload so that
    // second turn is also tagged.
    const enqueueResult = (value: string): void =>
      enqueuePendingNotification({
        value,
        mode: 'prompt',
        priority: 'later',
        isMeta: true,
        skipSlashCommands: true,
        workload: spawnTimeWorkload,
      });
    const finalizeDeferredAutonomyRunCompleted = async (): Promise<void> => {
      if (!autonomy?.runId) {
        return;
      }
      const nextCommands = await finalizeAutonomyRunCompleted({
        runId: autonomy.runId,
        rootDir: autonomy.rootDir,
        priority: 'later',
        workload: spawnTimeWorkload,
      });
      for (const nextCommand of nextCommands) {
        enqueue(nextCommand);
      }
    };
    const finalizeDeferredAutonomyRunFailed = async (error: unknown): Promise<void> => {
      if (!autonomy?.runId) {
        return;
      }
      await finalizeAutonomyRunFailed({
        runId: autonomy.runId,
        rootDir: autonomy.rootDir,
        error: error instanceof Error ? error.message : String(error),
      });
    };

    void (async () => {
      // Wait for MCP servers to settle. Scheduled tasks fire at startup and
      // all N drain within ~1ms (since we return immediately), capturing
      // context.options.tools before MCP connects. The sync path
      // accidentally avoided this — tasks serialized, so task N's drain
      // happened after task N-1's 30s run, by which time MCP was up.
      // Poll until no 'pending' clients remain, then refresh.
      const deadline = Date.now() + MCP_SETTLE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const s = context.getAppState();
        if (!s.mcp.clients.some(c => c.type === 'pending')) break;
        await sleep(MCP_SETTLE_POLL_MS);
      }
      const freshTools = context.options.refreshTools?.() ?? context.options.tools;

      const agentMessages: Message[] = [];
      for await (const message of runAgent({
        agentDefinition,
        promptMessages,
        toolUseContext: {
          ...context,
          getAppState: modifiedGetAppState,
          permissionLayers,
          abortController: bgAbortController,
        },
        canUseTool,
        isAsync: true,
        querySource: 'agent:custom',
        model: command.model as ModelAlias | undefined,
        availableTools: freshTools,
        override: { agentId, readFileState: forkReadFileState },
      })) {
        if (isRunAgentSpinnerMode(message)) continue;
        agentMessages.push(message);
      }
      const resultText = extractResultText(agentMessages, 'Command completed');
      logForDebugging(`Background forked command /${commandName} completed (agent ${agentId})`);
      // Enqueue the worker's result before finalizing the autonomy run so the
      // <scheduled-task-result> notification is observed before any follow-up
      // autonomy commands the finalizer enqueues at the same priority. Without
      // this ordering, both land at `priority: 'later'` and the next autonomy
      // step can run before the main thread sees this worker's output.
      enqueueResult(`<scheduled-task-result command="/${commandName}">\n${resultText}\n</scheduled-task-result>`);
      // The slash command itself succeeded; an error from the finalize call
      // must not surface as a contradictory <scheduled-task-result status="failed">
      // via the outer catch below. Log it locally and stop.
      try {
        await finalizeDeferredAutonomyRunCompleted();
      } catch (finalizeError) {
        logError(finalizeError);
      }
    })().catch(async err => {
      logError(err);
      enqueueResult(
        `<scheduled-task-result command="/${commandName}" status="failed">\n${err instanceof Error ? err.message : String(err)}\n</scheduled-task-result>`,
      );
      await finalizeDeferredAutonomyRunFailed(err);
    });

    // Nothing to render, nothing to query — the background runner re-enters
    // the queue on its own schedule.
    return {
      messages: [],
      shouldQuery: false,
      command,
      deferAutonomyCompletion: Boolean(autonomy?.runId),
    };
  }

  // Collect messages from the forked agent
  const agentMessages: Message[] = [];

  // Build progress messages for the agent progress UI
  const progressMessages: ProgressMessage<AgentProgress>[] = [];
  const parentToolUseID = `forked-command-${command.name}`;
  let toolUseCounter = 0;

  // Helper to create a progress message from an agent message
  const createProgressMessage = (message: AssistantMessage | NormalizedUserMessage): ProgressMessage<AgentProgress> => {
    toolUseCounter++;
    return {
      type: 'progress',
      data: {
        message,
        type: 'agent_progress',
        prompt: skillContent,
        agentId,
      },
      parentToolUseID,
      toolUseID: `${parentToolUseID}-${toolUseCounter}`,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
    };
  };

  // Helper to update progress display using agent progress UI
  const updateProgress = (): void => {
    setToolJSX({
      jsx: renderToolUseProgressMessage(progressMessages, {
        tools: context.options.tools,
        verbose: false,
      }),
      shouldHidePromptInput: false,
      shouldContinueAnimation: true,
      showSpinner: true,
    });
  };

  // Show initial "Initializing…" state
  updateProgress();

  // Run the sub-agent
  try {
    for await (const message of runAgent({
      agentDefinition,
      promptMessages,
      toolUseContext: {
        ...context,
        getAppState: modifiedGetAppState,
        permissionLayers,
      },
      canUseTool,
      isAsync: false,
      querySource: 'agent:custom',
      model: command.model as ModelAlias | undefined,
      availableTools,
      webFetchReadmissionAllowed,
      override: { readFileState: forkReadFileState },
    })) {
      if (isRunAgentSpinnerMode(message)) continue;
      agentMessages.push(message);
      const normalizedNew = normalizeMessages([message]);

      // Add progress message for assistant messages (which contain tool uses)
      if (message.type === 'assistant') {
        // Increment token count in spinner for assistant messages
        const contentLength = getAssistantMessageContentLength(message as AssistantMessage);
        if (contentLength > 0) {
          context.setResponseLength(len => len + contentLength);
        }

        const normalizedMsg = normalizedNew[0];
        if (normalizedMsg && normalizedMsg.type === 'assistant') {
          progressMessages.push(createProgressMessage(message as AssistantMessage));
          updateProgress();
        }
      }

      // Add progress message for user messages (which contain tool results)
      if (message.type === 'user') {
        const normalizedMsg = normalizedNew[0];
        if (normalizedMsg && normalizedMsg.type === 'user') {
          progressMessages.push(createProgressMessage(normalizedMsg as AssistantMessage));
          updateProgress();
        }
      }
    }
  } finally {
    // Clear the progress display
    setToolJSX(null);
  }

  let resultText = extractResultText(agentMessages, 'Command completed');

  logForDebugging(`Forked slash command /${command.name} completed with agent ${agentId}`);

  // Prepend debug log for ant users so it appears inside the command output
  if (process.env.USER_TYPE === 'ant') {
    resultText = `[ANT-ONLY] API calls: ${getDisplayPath(getDumpPromptsPath(agentId))}\n${resultText}`;
  }

  // Return the result as a user message (simulates the agent's output)
  const messages: UserMessage[] = [
    createUserMessage({
      content: prepareUserContent({
        inputString: `/${getCommandName(command)} ${args}`.trim(),
        precedingInputBlocks,
      }),
    }),
    createUserMessage({
      content: `<local-command-stdout>\n${resultText}\n</local-command-stdout>`,
    }),
  ];

  return {
    messages,
    shouldQuery: false,
    command,
    resultText,
  };
}

/**
 * Determines if a string looks like a valid command name.
 * Valid command names only contain letters, numbers, colons, hyphens, and underscores.
 *
 * @param commandName - The potential command name to check
 * @returns true if it looks like a command name, false if it contains non-command characters
 */
export function looksLikeCommand(commandName: string): boolean {
  // densable 2.1.246 #29 cn — must start with [A-Za-z0-9_], then [A-Za-z0-9:_-]*.
  // `/--…` is a prompt, not an unknown slash command.
  return /^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$/.test(commandName);
}

/** densable `cie` — skillOverrides "off" hides from Did-you-mean. */
function isSlashCommandOff(cmd: Command): boolean {
  try {
    const settings = getInitialSettings();
    return isSkillFullyDisabledByOverride(
      resolveSkillOverrideMode(cmd, {
        skillOverrides: settings.skillOverrides,
        settingsDisableBundledSkills: settings.disableBundledSkills,
      }),
    );
  } catch {
    return false;
  }
}

/** densable `pe("cmd_dispatch", errorCode)` → tengu_feature_bad. */
function logCmdDispatch(errorCode: 'cmd_parse_failed' | 'cmd_unknown' | 'cmd_unavailable_headless'): void {
  logEvent('tengu_feature_bad', {
    feature_name: 'cmd_dispatch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code: errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
}

/** densable `m(O4(name), "cmd_hook_blocked")` — Ze first-command block. */
function logCmdHookBlocked(commandName: string): void {
  const feature = builtInCommandNames().has(commandName) ? commandName : 'custom';
  logEvent('tengu_feature_bad', {
    feature_name: `cmd_${feature}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code: 'cmd_hook_blocked' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
}

export async function processSlashCommand(
  inputString: string,
  precedingInputBlocks: ContentBlockParam[],
  imageContentBlocks: ContentBlockParam[],
  attachmentMessages: AttachmentMessage[],
  context: ProcessUserInputContext,
  setToolJSX: SetToolJSXFn,
  uuid?: string,
  isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,
  autonomy?: QueuedCommand['autonomy'],
  /** densable modelScheduledOrigin — threaded into prompt skill context. */
  modelScheduledOrigin?: boolean,
  /** densable `g` — WGw `submissionOrigin`. */
  submissionOrigin?: { kind?: string },
): Promise<ProcessUserInputBaseResult> {
  const parsed = parseSlashCommand(inputString);
  if (!parsed) {
    logEvent('tengu_input_slash_missing', {});
    if (!context.options.isNonInteractiveSession) {
      logCmdDispatch('cmd_parse_failed');
    }
    const errorMessage = 'Commands are in the form `/command [args]`';
    return {
      messages: [
        createSyntheticUserCaveatMessage(),
        ...attachmentMessages,
        createUserMessage({
          content: prepareUserContent({
            inputString: errorMessage,
            precedingInputBlocks,
          }),
        }),
      ],
      shouldQuery: false,
      resultText: errorMessage,
    };
  }

  const { commandName, args: parsedArgs, isMcp } = parsed;

  const sanitizedCommandName = isMcp ? 'mcp' : !builtInCommandNames().has(commandName) ? 'custom' : commandName;

  // densable: `if(C&&!UD(C))C=void 0` — disabled command is missing.
  const foundCommand = findCommand(commandName, context.options.commands);
  const resolvedCommand = foundCommand && isCommandEnabled(foundCommand) ? foundCommand : undefined;
  if (!resolvedCommand) {
    // Check if this looks like a command name vs a file path or other input
    // Also check if it's an actual file path that exists
    let isFilePath = false;
    try {
      await getFsImplementation().stat(`/${commandName}`);
      isFilePath = true;
    } catch {
      // Not a file path — treat as command name
    }
    const isMcpTemplateUnmatched = commandName.includes('://');
    if ((looksLikeCommand(commandName) || isMcpTemplateUnmatched) && !isFilePath) {
      // densable print + shipped builtin name: report unavailable, do not fuzzy-run.
      if (context.options.isNonInteractiveSession && builtInCommandNames().has(commandName)) {
        const unavailable = `/${commandName} isn't available in this environment.`;
        logEvent('tengu_input_slash_invalid', {
          input_length: commandName.length,
          had_suggestion: false,
        });
        logCmdDispatch('cmd_unavailable_headless');
        const echoArgs = !parsedArgs ? '' : foundCommand?.isSensitive ? ' ***' : ` ${parsedArgs}`;
        return {
          messages: [
            ...attachmentMessages,
            createCommandInputMessage(`/${commandName}${echoArgs}`),
            createCommandInputMessage(`<local-command-stdout>${unavailable}</local-command-stdout>`),
          ],
          shouldQuery: false,
          resultText: unavailable,
        };
      }
      const suggestion = suggestSlashCommand(
        commandName,
        context.options.commands
          .filter(cmd => !cmd.isHidden && !isSlashCommandOff(cmd) && isCommandEnabled(cmd))
          .map(cmd => ({ name: getCommandName(cmd), aliases: cmd.aliases })),
        { maxEditDistance: 2 },
      );
      logEvent('tengu_input_slash_invalid', {
        input_length: commandName.length,
        is_mcp_template_unmatched: isMcpTemplateUnmatched,
        had_suggestion: Boolean(suggestion),
        suggestion_distance: suggestion ? slashCommandEditDistance(commandName, suggestion) : undefined,
      });
      logCmdDispatch('cmd_unknown');

      const unknownMessage = suggestion
        ? `Unknown command: /${commandName}. Did you mean /${suggestion}?`
        : `Unknown command: /${commandName}`;
      // densable: print echoes /cmd + local-command-stdout; interactive is warning.
      if (context.options.isNonInteractiveSession) {
        return {
          messages: [
            ...attachmentMessages,
            createCommandInputMessage(`/${commandName}${parsedArgs ? ` ${parsedArgs}` : ''}`),
            createCommandInputMessage(`<local-command-stdout>${unknownMessage}</local-command-stdout>`),
          ],
          shouldQuery: false,
          resultText: unknownMessage,
        };
      }
      return {
        messages: [
          ...attachmentMessages,
          createSystemMessage(unknownMessage, 'warning'),
          ...(parsedArgs ? [createSystemMessage(`Args from unknown skill: ${parsedArgs}`, 'warning')] : []),
        ],
        shouldQuery: false,
        resultText: unknownMessage,
      };
    }

    const promptId = randomUUID();
    setPromptId(promptId);
    logEvent('tengu_input_prompt', {});
    // Log user prompt event for OTLP
    void logOTelEvent('user_prompt', {
      prompt_length: String(inputString.length),
      prompt: redactIfDisabled(inputString),
      'prompt.id': promptId,
    });
    return {
      messages: [
        createUserMessage({
          content: prepareUserContent({ inputString, precedingInputBlocks }),
          uuid: uuid,
        }),
        ...attachmentMessages,
      ],
      shouldQuery: true,
    };
  }

  // Track slash command usage for feature discovery

  const {
    messages: newMessages,
    shouldQuery: messageShouldQuery,
    allowedTools,
    model,
    effort,
    command: returnedCommand,
    resultText,
    nextInput,
    submitNextInput,
    deferAutonomyCompletion,
  } = await getMessagesForSlashCommand(
    commandName,
    parsedArgs,
    setToolJSX,
    context,
    precedingInputBlocks,
    imageContentBlocks,
    isAlreadyProcessing,
    canUseTool,
    uuid,
    autonomy,
    modelScheduledOrigin,
    submissionOrigin,
  );

  // Local slash commands that skip messages
  if (newMessages.length === 0) {
    const eventData: Record<string, boolean | number | undefined> = {
      input: sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    };

    // Add plugin metadata if this is a plugin command
    if (returnedCommand.type === 'prompt' && returnedCommand.pluginInfo) {
      incrementPluginUsage(returnedCommand.pluginInfo.repository);
      const { pluginManifest, repository } = returnedCommand.pluginInfo;
      const { marketplace } = parsePluginIdentifier(repository);
      const isOfficial = isOfficialMarketplaceName(marketplace);
      // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns
      // (unredacted, all users); plugin_name/plugin_repository stay in
      // additional_metadata as redacted variants for general-access dashboards.
      eventData._PROTO_plugin_name = pluginManifest.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
      if (marketplace) {
        eventData._PROTO_marketplace_name = marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
      }
      eventData.plugin_repository = (
        isOfficial ? repository : 'third-party'
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      eventData.plugin_name = (
        isOfficial ? pluginManifest.name : 'third-party'
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      if (isOfficial && pluginManifest.version) {
        eventData.plugin_version = pluginManifest.version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      }
      Object.assign(eventData, buildPluginCommandTelemetryFields(returnedCommand.pluginInfo));
    }

    logEvent('tengu_input_command', {
      ...eventData,
      invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(process.env.USER_TYPE === 'ant' && {
        skill_name: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(returnedCommand.type === 'prompt' && {
          skill_source: returnedCommand.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(returnedCommand.loadedFrom && {
          skill_loaded_from: returnedCommand.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(returnedCommand.kind && {
          skill_kind: returnedCommand.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      }),
    });
    return {
      messages: [],
      shouldQuery: false,

      model,
      nextInput,
      submitNextInput,
      deferAutonomyCompletion,
    };
  }

  // For invalid commands, preserve both the user message and error
  if (
    newMessages.length === 2 &&
    newMessages[1]!.type === 'user' &&
    typeof newMessages[1]!.message.content === 'string' &&
    newMessages[1]!.message.content.startsWith('Unknown command:')
  ) {
    // Don't log as invalid if it looks like a common file path
    const looksLikeFilePath =
      inputString.startsWith('/var') || inputString.startsWith('/tmp') || inputString.startsWith('/private');

    if (!looksLikeFilePath) {
      logEvent('tengu_input_slash_invalid', {
        input_length: commandName.length,
        had_suggestion: false,
      });
      logCmdDispatch('cmd_unknown');
    }

    return {
      messages: [createSyntheticUserCaveatMessage(), ...newMessages],
      shouldQuery: messageShouldQuery,
      allowedTools,

      model,
    };
  }

  // A valid command
  const eventData: Record<string, boolean | number | undefined> = {
    input: sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  };

  // Add plugin metadata if this is a plugin command
  if (returnedCommand.type === 'prompt' && returnedCommand.pluginInfo) {
    incrementPluginUsage(returnedCommand.pluginInfo.repository);
    const { pluginManifest, repository } = returnedCommand.pluginInfo;
    const { marketplace } = parsePluginIdentifier(repository);
    const isOfficial = isOfficialMarketplaceName(marketplace);
    eventData._PROTO_plugin_name = pluginManifest.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
    if (marketplace) {
      eventData._PROTO_marketplace_name = marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
    }
    eventData.plugin_repository = (
      isOfficial ? repository : 'third-party'
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    eventData.plugin_name = (
      isOfficial ? pluginManifest.name : 'third-party'
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    if (isOfficial && pluginManifest.version) {
      eventData.plugin_version = pluginManifest.version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    }
    Object.assign(eventData, buildPluginCommandTelemetryFields(returnedCommand.pluginInfo));
  }

  logEvent('tengu_input_command', {
    ...eventData,
    invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(process.env.USER_TYPE === 'ant' && {
      skill_name: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(returnedCommand.type === 'prompt' && {
        skill_source: returnedCommand.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(returnedCommand.loadedFrom && {
        skill_loaded_from: returnedCommand.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(returnedCommand.kind && {
        skill_kind: returnedCommand.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    }),
  });

  // Check if this is a compact result which handle their own synthetic caveat message ordering
  const isCompactResult = newMessages.length > 0 && newMessages[0] && isCompactBoundaryMessage(newMessages[0]);

  return {
    messages:
      messageShouldQuery || newMessages.every(isSystemLocalCommandMessage) || isCompactResult
        ? newMessages
        : [createSyntheticUserCaveatMessage(), ...newMessages],
    shouldQuery: messageShouldQuery,
    allowedTools,
    model,
    effort,
    resultText,
    nextInput,
    submitNextInput,
    deferAutonomyCompletion,
  };
}

/**
 * densable sdr — resolve first-arg subcommand redirect
 * (e.g. code-review `ultra` → ultrareview, remaining args preserved).
 */
export function resolveSlashSubcommand(
  command: Command,
  args: string,
): { targetName: string; consumedToken: string; remainingArgs: string } | null {
  if (!command.subcommands) return null;
  const r = args.trimStart();
  const n = r.search(/\s/);
  const token = n === -1 ? r : r.slice(0, n);
  if (!token) return null;
  const targetName = command.subcommands[token.toLowerCase()];
  if (targetName === undefined) return null;
  const remainingArgs = (n === -1 ? '' : r.slice(n + 1).trimStart()).trim();
  // densable yen @195499142 — bare-only tokens do not redirect with extra args.
  if (command.subcommandsBareOnly && remainingArgs !== '') return null;
  return { targetName, consumedToken: token, remainingArgs };
}

async function getMessagesForSlashCommand(
  commandName: string,
  args: string,
  setToolJSX: SetToolJSXFn,
  context: ProcessUserInputContext,
  precedingInputBlocks: ContentBlockParam[],
  imageContentBlocks: ContentBlockParam[],
  _isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,
  uuid?: string,
  autonomy?: QueuedCommand['autonomy'],
  /** densable modelScheduledOrigin — threaded into prompt skill context. */
  modelScheduledOrigin?: boolean,
  /** densable `g` — WGw `submissionOrigin`. */
  submissionOrigin?: { kind?: string },
): Promise<SlashCommandResult> {
  let resolvedName = commandName;
  let resolvedArgs = args;
  let command = getCommand(commandName, context.options.commands);

  // densable sdr: /code-review ultra → /ultrareview <remaining>
  const sub = resolveSlashSubcommand(command, args);
  if (sub) {
    try {
      const target = getCommand(sub.targetName, context.options.commands);
      if (target && isCommandEnabled(target)) {
        resolvedName = sub.targetName;
        resolvedArgs = sub.remainingArgs;
        command = target;
      }
    } catch {
      // Target not registered / disabled — fall through to original command
      // (getPrompt will surface ultraFallback local note).
    }
  }

  // Official IJ densable — skillOverrides "off" blocks slash invocation.
  try {
    const { getInitialSettings } = await import('../settings/settings.js');
    const { resolveSkillOverrideMode, isSkillFullyDisabledByOverride } = await import('../residualFinalEnvGates.js');
    const settings = getInitialSettings();
    const mode = resolveSkillOverrideMode(command, {
      skillOverrides: settings.skillOverrides,
      settingsDisableBundledSkills: settings.disableBundledSkills,
    });
    if (isSkillFullyDisabledByOverride(mode)) {
      logEvent('tengu_input_slash_invalid', {
        input: 'cmd_skill_override_off' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      const disabledMessage = `Skill "${commandName}" is disabled via skillOverrides. Re-enable it in /skills or remove the override from your settings to run it.`;
      return {
        messages: [
          createSyntheticUserCaveatMessage(),
          createUserMessage({
            content: prepareUserContent({
              inputString: disabledMessage,
              precedingInputBlocks,
            }),
          }),
          ...(args ? [createSystemMessage(`Args from disabled skill: ${args}`, 'warning')] : []),
        ],
        shouldQuery: false,
        resultText: disabledMessage,
        command,
      };
    }
  } catch {
    // Settings / residual helpers optional.
  }

  // Track skill usage for ranking (only for prompt commands that are user-invocable)
  if (command.type === 'prompt' && command.userInvocable !== false) {
    recordSkillUsage(resolvedName);
  }

  // Check if the command is user-invocable
  // Skills with userInvocable === false can only be invoked by the model via SkillTool
  if (command.userInvocable === false) {
    return {
      messages: [
        createUserMessage({
          content: prepareUserContent({
            inputString: `/${resolvedName}`,
            precedingInputBlocks,
          }),
        }),
        createUserMessage({
          content: `This skill can only be invoked by Claude, not directly by users. Ask Claude to use the "${resolvedName}" skill for you.`,
        }),
      ],
      shouldQuery: false,
      command,
    };
  }

  // densable sdr: use redirected args for dispatch
  const argsForDispatch = resolvedArgs;

  try {
    switch (command.type) {
      case 'local-jsx': {
        return new Promise<SlashCommandResult>(resolve => {
          let doneWasCalled = false;
          const onDone = (
            result?: string,
            options?: {
              display?: CommandResultDisplay;
              shouldQuery?: boolean;
              metaMessages?: string[];
              nextInput?: string;
              submitNextInput?: boolean;
              displayArgs?: string;
            },
          ) => {
            doneWasCalled = true;
            // If display is 'skip', don't add any messages to the conversation
            if (options?.display === 'skip') {
              void resolve({
                messages: [],
                shouldQuery: false,
                command,
                nextInput: options?.nextInput,
                submitNextInput: options?.submitNextInput,
              });
              return;
            }

            // Meta messages are model-visible but hidden from the user
            const metaMessages = (options?.metaMessages ?? []).map((content: string) =>
              createUserMessage({ content, isMeta: true }),
            );

            // In fullscreen the command just showed as a centered modal
            // pane — the transient notification is enough feedback. The
            // "❯ /config" + "⎿ dismissed" transcript entries are
            // type:system subtype:local_command (user-visible but NOT sent
            // to the model), so skipping them doesn't affect model context.
            // Outside fullscreen keep them so scrollback shows what ran.
            // Only skip "<Name> dismissed" modal-close notifications —
            // commands that early-exit before showing a modal (/rename,
            // /proactive) use display:system for actual
            // output that must reach the transcript.
            const skipTranscript =
              isFullscreenEnvEnabled() && typeof result === 'string' && result.endsWith(' dismissed');

            const breadcrumbArgs = options?.displayArgs ?? argsForDispatch;

            void resolve({
              messages:
                options?.display === 'system'
                  ? skipTranscript
                    ? metaMessages
                    : [
                        createCommandInputMessage(formatCommandInput(command, breadcrumbArgs)),
                        createCommandInputMessage(`<local-command-stdout>${result}</local-command-stdout>`),
                        ...metaMessages,
                      ]
                  : [
                      createUserMessage({
                        content: prepareUserContent({
                          inputString: formatCommandInput(command, breadcrumbArgs),
                          precedingInputBlocks,
                        }),
                      }),
                      result
                        ? createUserMessage({
                            content: `<local-command-stdout>${result}</local-command-stdout>`,
                          })
                        : createUserMessage({
                            content: `<local-command-stdout>${NO_CONTENT_MESSAGE}</local-command-stdout>`,
                          }),
                      ...metaMessages,
                    ],
              shouldQuery: options?.shouldQuery ?? false,
              command,
              nextInput: options?.nextInput,
              submitNextInput: options?.submitNextInput,
            });
          };

          void command
            .load()
            .then(mod =>
              mod.call(
                onDone,
                {
                  ...context,
                  canUseTool,
                  // densable dispatchedAsImmediate: E$t(cmd, args)
                  dispatchedAsImmediate: isCommandImmediate(command, argsForDispatch, context.presentation ?? 'inline'),
                  submissionOrigin,
                },
                argsForDispatch,
              ),
            )
            .then(jsx => {
              if (jsx == null) return;
              if (context.options.isNonInteractiveSession) {
                void resolve({
                  messages: [],
                  shouldQuery: false,
                  command,
                });
                return;
              }
              // Guard: if onDone fired during mod.call() (early-exit path
              // that calls onDone then returns JSX), skip setToolJSX. This
              // chain is fire-and-forget — the outer Promise resolves when
              // onDone is called, so executeUserInput may have already run
              // its setToolJSX({clearLocalJSX: true}) before we get here.
              // Setting isLocalJSXCommand after clear leaves it stuck true,
              // blocking useQueueProcessor and TextInput focus.
              if (doneWasCalled) return;
              setToolJSX({
                jsx,
                shouldHidePromptInput: true,
                showSpinner: false,
                isLocalJSXCommand: true,
                // densable ARt — resolve function-form immediate with args
                isImmediate: isCommandImmediate(command, argsForDispatch, context.presentation ?? 'inline'),
              });
            })
            .catch(e => {
              // If load()/call() throws and onDone never fired, the outer
              // Promise hangs forever, leaving queryGuard stuck in
              // 'dispatching' and deadlocking the queue processor.
              logError(e);
              if (doneWasCalled) return;
              doneWasCalled = true;
              setToolJSX({
                jsx: null,
                shouldHidePromptInput: false,
                clearLocalJSX: true,
              });
              void resolve({ messages: [], shouldQuery: false, command });
            });
        });
      }
      case 'local': {
        const displayArgs = command.isSensitive && argsForDispatch.trim() ? '***' : argsForDispatch;
        const userMessage = createUserMessage({
          content: prepareUserContent({
            inputString: formatCommandInput(command, displayArgs),
            precedingInputBlocks,
          }),
        });

        try {
          const syntheticCaveatMessage = createSyntheticUserCaveatMessage();
          const mod = await command.load();
          const result = await mod.call(argsForDispatch, {
            ...context,
            submissionOrigin,
          });

          if (result.type === 'skip') {
            return {
              messages: [],
              shouldQuery: false,
              command,
            };
          }

          // Use discriminated union to handle different result types
          if (result.type === 'compact') {
            // Append slash command messages to messagesToKeep so that
            // attachments and hookResults come after user messages
            const slashCommandMessages = [
              syntheticCaveatMessage,
              userMessage,
              ...(result.displayText
                ? [
                    createUserMessage({
                      content: `<local-command-stdout>${result.displayText}</local-command-stdout>`,
                      // --resume looks at latest timestamp message to determine which message to resume from
                      // This is a perf optimization to avoid having to recaculcate the leaf node every time
                      // Since we're creating a bunch of synthetic messages for compact, it's important to set
                      // the timestamp of the last message to be slightly after the current time
                      // This is mostly important for sdk / -p mode
                      timestamp: new Date(Date.now() + 100).toISOString(),
                    }),
                  ]
                : []),
            ];
            const compactionResultWithSlashMessages = {
              ...result.compactionResult,
              messagesToKeep: [...(result.compactionResult.messagesToKeep ?? []), ...slashCommandMessages],
            };
            // Reset microcompact state since full compact replaces all
            // messages — old tool IDs are no longer relevant. Budget state
            // (on toolUseContext) needs no reset: stale entries are inert
            // (UUIDs never repeat, so they're never looked up).
            resetMicrocompactState();
            return {
              messages: buildPostCompactMessages(compactionResultWithSlashMessages) as AssistantMessage[],
              shouldQuery: false,
              command,
            };
          }

          // densable headless local → model turn (e.g. ultrareview non-interactive)
          if (result.type === 'query') {
            const stdout = result.value;
            const promptText = result.prompt?.trim() ? result.prompt : undefined;
            return {
              messages: [
                userMessage,
                createCommandInputMessage(`<local-command-stdout>${stdout}</local-command-stdout>`),
                ...(promptText
                  ? [
                      createUserMessage({
                        content: promptText,
                        isMeta: true,
                      }),
                    ]
                  : []),
              ],
              shouldQuery: true,
              command,
              resultText: stdout,
            };
          }

          // Text result — use system message so it doesn't render as a user bubble
          return {
            messages: [
              userMessage,
              createCommandInputMessage(`<local-command-stdout>${result.value}</local-command-stdout>`),
            ],
            shouldQuery: false,
            command,
            resultText: result.value,
          };
        } catch (e) {
          logError(e);
          return {
            messages: [
              userMessage,
              createCommandInputMessage(`<local-command-stderr>${String(e)}</local-command-stderr>`),
            ],
            shouldQuery: false,
            command,
          };
        }
      }
      case 'prompt': {
        try {
          // densable kt @208163281 — peel nested `/skill` tokens off first-command args.
          const originalRemainder = argsForDispatch;
          const stackedParse = shouldParseStackedSlash(command)
            ? parseStackedSlashCommands(
                originalRemainder,
                originalRemainder,
                context.options.commands,
                _isAlreadyProcessing ? () => true : undefined,
              )
            : {
                stacked: [] as ReturnType<typeof parseStackedSlashCommands>['stacked'],
                trailingArgs: originalRemainder,
                capped: false,
              };
          const stackedCommands = stackedParse.stacked;
          const trailingArgs = stackedParse.trailingArgs;
          if (stackedCommands.length > 0) {
            logEvent('tengu_stacked_slash_commands', {
              stacked_count: stackedCommands.length,
            });
          }
          // densable Ze @208164542 — UserPromptExpansion before effort / fork / Le.
          const expansion = await runUserPromptExpansionHook(command, trailingArgs, context);
          if ('blocked' in expansion) {
            logCmdHookBlocked(command.name);
            return { ...expansion.blocked, command };
          }
          // densable user-slash: onUserTypedArgs then getDefaultEffort notice
          // only when getEffort is undefined. Fork splices notice at [1];
          // Le pushes it after the load result. No N9 here (289 dropped 247).
          let effortNotice: ReturnType<typeof createSystemMessage> | undefined;
          if (!context.options.isNonInteractiveSession) {
            command.onUserTypedArgs?.(trailingArgs, context);
            if (command.getEffort?.(trailingArgs, context) === undefined) {
              const notice = command.getDefaultEffort?.(trailingArgs, context)?.notice;
              if (notice) {
                effortNotice = createSystemMessage(notice, 'notice');
              }
            }
          }
          // densable `k_n(...)==="fork"&&!IQ(o)` — coordinator main falls through to Le.
          if (
            resolveSkillExecutionContext(command, trailingArgs, context) === 'fork' &&
            !isCoordinatorMainThread(context.agentId)
          ) {
            const forked = await executeForkedSlashCommand(
              command,
              trailingArgs,
              context,
              precedingInputBlocks,
              setToolJSX,
              canUseTool ?? hasPermissionsToUseTool,
              autonomy,
            );
            if (expansion.hookMessages.length > 0) {
              forked.messages.splice(1, 0, ...expansion.hookMessages);
            }
            if (effortNotice) {
              forked.messages.splice(1, 0, effortNotice);
            }
            return forked;
          }

          const loaded = await getMessagesForPromptSlashCommand(
            command,
            trailingArgs,
            context,
            precedingInputBlocks,
            imageContentBlocks,
            uuid,
            expansion.hookMessages,
            modelScheduledOrigin,
          );
          if (stackedCommands.length > 0) {
            const head = loaded.messages[0];
            if (head?.type === 'user' && !head.isMeta) {
              (head as { stackedOriginalInput?: string }).stackedOriginalInput =
                `/${command.name} ${originalRemainder}`;
            }
          }
          for (const stackedCommand of stackedCommands) {
            try {
              // densable Ze on each stacked skill; blocked → warning + continue.
              const stackedExpansion = await runUserPromptExpansionHook(stackedCommand, trailingArgs, context);
              if ('blocked' in stackedExpansion) {
                loaded.messages.push(
                  createSystemMessage(
                    `Stacked skill /${getCommandName(stackedCommand)} blocked by UserPromptExpansion hook`,
                    'warning',
                  ),
                );
                continue;
              }
              if (!context.options.isNonInteractiveSession) {
                stackedCommand.onUserTypedArgs?.(trailingArgs, context);
                if (stackedCommand.getEffort?.(trailingArgs, context) === undefined) {
                  const stackedNotice = stackedCommand.getDefaultEffort?.(trailingArgs, context)?.notice;
                  if (stackedNotice) {
                    loaded.messages.push(createSystemMessage(stackedNotice, 'notice'));
                  }
                }
              }
              if (stackedCommand.type === 'prompt' && stackedCommand.userInvocable !== false) {
                recordSkillUsage(stackedCommand.name);
              }
              if (stackedCommand.pluginInfo) {
                incrementPluginUsage(stackedCommand.pluginInfo.repository);
              }
              if (!(stackedCommand.isMcp && stackedCommand.loadedFrom !== 'mcp')) {
                logEvent('tengu_input_command', {
                  input: stackedCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              }
              const next = await getMessagesForPromptSlashCommand(
                stackedCommand,
                trailingArgs,
                context,
                [],
                [],
                undefined,
                stackedExpansion.hookMessages,
                modelScheduledOrigin,
              );
              const stackedHead = next.messages[0];
              if (stackedHead?.type === 'user' && !stackedHead.isMeta) {
                (stackedHead as { stackedExpansion?: boolean }).stackedExpansion = true;
              }
              loaded.messages.push(...next.messages);
              loaded.allowedTools = [...(loaded.allowedTools ?? []), ...(next.allowedTools ?? [])];
              loaded.disallowedTools = [...(loaded.disallowedTools ?? []), ...(next.disallowedTools ?? [])];
              loaded.model = next.model ?? loaded.model;
              loaded.effort = next.effort ?? loaded.effort;
            } catch (stackedError) {
              if (stackedError instanceof MalformedCommandError) throw stackedError;
              logError(stackedError);
              logForDebugging('stacked slash command expansion threw');
              loaded.messages.push(
                createSystemMessage(
                  `Stacked skill /${getCommandName(stackedCommand)} failed to load: ${errorMessage(stackedError)}`,
                  'warning',
                ),
              );
            }
          }
          if (stackedParse.capped) {
            loaded.messages.push(
              createSystemMessage(
                `Stacked command limit (${STACKED_SLASH_LIMIT}) reached — remaining input passed as arguments`,
                'warning',
              ),
            );
          }
          if (effortNotice) {
            loaded.messages.push(effortNotice);
          }
          return loaded;
        } catch (e) {
          // Handle abort errors specially to show proper "Interrupted" message
          if (e instanceof AbortError) {
            return {
              messages: [
                createUserMessage({
                  content: prepareUserContent({
                    inputString: formatCommandInput(command, argsForDispatch),
                    precedingInputBlocks,
                  }),
                }),
                createUserInterruptionMessage({ toolUse: false }),
              ],
              shouldQuery: false,
              command,
            };
          }
          return {
            messages: [
              createUserMessage({
                content: prepareUserContent({
                  inputString: formatCommandInput(command, argsForDispatch),
                  precedingInputBlocks,
                }),
              }),
              createUserMessage({
                content: `<local-command-stderr>${String(e)}</local-command-stderr>`,
              }),
            ],
            shouldQuery: false,
            command,
          };
        }
      }
    }
  } catch (e) {
    if (e instanceof MalformedCommandError) {
      return {
        messages: [
          createUserMessage({
            content: prepareUserContent({
              inputString: e.message,
              precedingInputBlocks,
            }),
          }),
        ],
        shouldQuery: false,
        command,
      };
    }
    throw e;
  }
}

function formatCommandInput(command: CommandBase, args: string): string {
  return formatCommandInputTags(getCommandName(command), args);
}

/**
 * Formats the metadata for a skill loading message.
 * Used by the Skill tool and for subagent skill preloading.
 */
export function formatSkillLoadingMetadata(skillName: string, _progressMessage: string = 'loading'): string {
  // Use skill name only - UserCommandMessage renders as "Skill(name)"
  return [
    `<${COMMAND_MESSAGE_TAG}>${skillName}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>${skillName}</${COMMAND_NAME_TAG}>`,
    `<skill-format>true</skill-format>`,
  ].join('\n');
}

/**
 * Formats the metadata for a slash command loading message.
 */
function formatSlashCommandLoadingMetadata(commandName: string, args?: string): string {
  return [
    `<${COMMAND_MESSAGE_TAG}>${commandName}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>/${commandName}</${COMMAND_NAME_TAG}>`,
    args ? `<command-args>${args}</command-args>` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Formats the loading metadata for a command (skill or slash command).
 * User-invocable skills use slash command format (/name), while model-only
 * skills use the skill format ("The X skill is running").
 */
function formatCommandLoadingMetadata(command: CommandBase & PromptCommand, args?: string): string {
  // Use command.name (the qualified name including plugin prefix, e.g.
  // "product-management:feature-spec") instead of userFacingName() which may
  // strip the plugin prefix via displayName fallback.
  // User-invocable skills should show as /command-name like regular slash commands
  if (command.userInvocable !== false) {
    return formatSlashCommandLoadingMetadata(command.name, args);
  }
  // Model-only skills (userInvocable: false) show as "The X skill is running"
  if (command.loadedFrom === 'skills' || command.loadedFrom === 'plugin' || command.loadedFrom === 'mcp') {
    return formatSkillLoadingMetadata(command.name, command.progressMessage);
  }
  return formatSlashCommandLoadingMetadata(command.name, args);
}

export async function processPromptSlashCommand(
  commandName: string,
  args: string,
  commands: Command[],
  context: ToolUseContext,
  imageContentBlocks: ContentBlockParam[] = [],
  /** densable `I` / `readOnlySkillLoad` — Skill tool passes `IQ(context)`. */
  readOnlySkillLoad = false,
): Promise<SlashCommandResult> {
  const command = findCommand(commandName, commands);
  if (!command) {
    throw new MalformedCommandError(`Unknown command: ${commandName}`);
  }
  if (command.type !== 'prompt') {
    throw new Error(
      `Unexpected ${command.type} command. Expected 'prompt' command. Use /${commandName} directly in the main conversation.`,
    );
  }
  return getMessagesForPromptSlashCommand(
    command,
    args,
    context,
    [],
    imageContentBlocks,
    undefined,
    [],
    undefined,
    readOnlySkillLoad,
  );
}

async function getMessagesForPromptSlashCommand(
  command: CommandBase & PromptCommand,
  args: string,
  context: ToolUseContext,
  precedingInputBlocks: ContentBlockParam[] = [],
  imageContentBlocks: ContentBlockParam[] = [],
  uuid?: string,
  /** densable Le `g` — UserPromptExpansion hookMessages. */
  hookMessages: SlashCommandResult['messages'] = [],
  /** densable: stamp options.modelScheduledOrigin for getPromptForCommand. */
  modelScheduledOrigin?: boolean,
  /** densable `I` — Skill tool passes `IQ(context)`. */
  readOnlySkillLoad = false,
): Promise<SlashCommandResult> {
  // densable `Le`: `IQ(o)&&!I` — user slash on coordinator main summarizes;
  // Skill tool passes I so this gate is false and the body loads read-only.
  if (isCoordinatorMainThread(context.agentId) && !readOnlySkillLoad) {
    const metadata = formatCommandLoadingMetadata(command, args);
    const mcpPrompt = command.isMcp === true && command.loadedFrom !== 'mcp';
    const overrideBlocked = isSkillModelInvocationBlockedByOverride(
      resolveSkillOverrideMode(command, {
        skillOverrides: getInitialSettings().skillOverrides,
        settingsDisableBundledSkills: getInitialSettings().disableBundledSkills,
      }),
    );
    if (command.disableModelInvocation || mcpPrompt || overrideBlocked) {
      const parts: string[] = [
        mcpPrompt
          ? `"/${command.name}" is an MCP prompt and cannot run in coordinator mode: the coordinator does not load prompt content, and workers cannot invoke MCP prompts via the ${SKILL_TOOL_NAME} tool.`
          : `Skill "/${command.name}" is user-invocable only (${command.disableModelInvocation ? 'disable-model-invocation' : 'disabled for model invocation in settings'}) and cannot run in coordinator mode: the coordinator does not load skill content, and workers cannot invoke it via the ${SKILL_TOOL_NAME} tool.`,
      ];
      if (command.description) {
        parts.push(`Description: ${command.description}`);
      }
      const liveSubcommands = Object.entries(command.subcommands ?? {})
        .filter(([, target]) => {
          const resolved = findCommand(target, context.options.commands ?? []);
          if (!resolved || !isCommandEnabled(resolved)) return false;
          if (resolved.disableModelInvocation) return false;
          if (
            isSkillModelInvocationBlockedByOverride(
              resolveSkillOverrideMode(resolved, {
                skillOverrides: getInitialSettings().skillOverrides,
                settingsDisableBundledSkills: getInitialSettings().disableBundledSkills,
              }),
            )
          ) {
            return false;
          }
          return !(resolved.isMcp && resolved.loadedFrom !== 'mcp');
        })
        .map(([name]) => name);
      if (liveSubcommands.length > 0) {
        parts.push(
          `Note: the subcommands ${liveSubcommands.map(name => `"/${command.name} ${name}"`).join(', ')} route to their own dedicated commands and DO still work when the user types them directly in the terminal (remote-control clients gate some commands separately).`,
        );
      }
      parts.push(
        `\nDo not instruct workers to invoke this via the ${SKILL_TOOL_NAME} tool — it will be refused. Tell the user that ${liveSubcommands.length > 0 ? `/${command.name} itself (beyond the subcommands above) is` : `the /${command.name} command is`} unavailable in coordinator mode. If — and only if — the underlying task is achievable with the tools workers actually hold, you may brief a worker to do that work directly; do not promise this otherwise.`,
      );
      return {
        messages: [
          createUserMessage({ content: metadata, uuid }),
          createUserMessage({
            content: [{ type: 'text', text: parts.join('\n') }],
            isMeta: true,
          }),
          ...hookMessages,
        ],
        shouldQuery: true,
        disallowedTools: parseToolListFromCLI(command.disallowedTools ?? []),
        command,
      };
    }
    const parts: string[] = [`Skill "/${command.name}" is available for workers.`];
    if (command.description) {
      parts.push(`Description: ${command.description}`);
    }
    if (command.whenToUse) {
      parts.push(`When to use: ${command.whenToUse}`);
    }
    const skillAllowedTools = await resolveTrustedSkillAllowedTools(command);
    if (skillAllowedTools.length > 0) {
      parts.push(`This skill grants workers additional tool permissions: ${skillAllowedTools.join(', ')}`);
    }
    parts.push(
      `\nInstruct a worker to use this skill by including "Use the /${command.name} skill" in your Agent prompt. The worker has access to the Skill tool and will receive the skill's content and permissions when it invokes it.`,
    );
    return {
      messages: [
        createUserMessage({ content: metadata, uuid }),
        createUserMessage({
          content: [{ type: 'text', text: parts.join('\n') }],
          isMeta: true,
        }),
        ...hookMessages,
      ],
      shouldQuery: true,
      disallowedTools: parseToolListFromCLI(command.disallowedTools ?? []),
      command,
    };
  }

  const promptShellHandOff: Array<{ tool: string; command: string }> = [];
  const result = await getSkillPromptBlocks(command, args, {
    ...context,
    promptShellHandOff,
    ...((modelScheduledOrigin || readOnlySkillLoad) && {
      options: {
        ...context.options,
        ...(modelScheduledOrigin ? { modelScheduledOrigin: true as const } : {}),
        ...(readOnlySkillLoad ? { isSkillPreload: true, readOnlySkillLoad: true } : {}),
      },
    }),
  });

  // Register skill hooks if defined. Under ["hooks"]-only (skills not locked),
  // user skills still load and reach this point — block hook REGISTRATION here
  // where source is known. Mirrors the agent frontmatter gate in runAgent.ts.
  // densable: `(!Id("hooks")||V2(source))&&!I`
  const hooksAllowedForThisSkill =
    (!isRestrictedToPluginOnly('hooks') || isSourceAdminTrusted(command.source)) && !readOnlySkillLoad;
  if (command.hooks && hooksAllowedForThisSkill) {
    const sessionId = getSessionId();
    registerSkillHooks(
      context.setAppState,
      sessionId,
      command.hooks,
      command.name,
      command.type === 'prompt' ? command.skillRoot : undefined,
    );
  }

  // Record skill invocation for compaction preservation, scoped by agent context.
  // Skills are tagged with their agentId so only skills belonging to the current
  // agent are restored during compaction (preventing cross-agent leaks).
  const skillPath = command.source ? `${command.source}:${command.name}` : command.name;
  const skillContent = result
    .filter((b): b is TextBlockParam => b.type === 'text')
    .map(b => b.text)
    .join('\n\n');
  addInvokedSkill(command.name, skillPath, skillContent, getAgentContext()?.agentId ?? null);

  if (context.options) {
    context.options.activeSkill = command.unqualifiedName ?? command.name;
  }

  const metadata = formatCommandLoadingMetadata(command, args);

  const additionalAllowedTools = readOnlySkillLoad
    ? []
    : parseToolListFromCLI(await resolveTrustedSkillAllowedTools(command));
  // densable 2.1.229 — command.disallowedTools → alwaysDenyRules.command
  const additionalDisallowedTools = parseToolListFromCLI(
    command.type === 'prompt' ? (command.disallowedTools ?? []) : [],
  );
  if (additionalDisallowedTools.length > 0) {
    context.setToolPermissionContext(prev => {
      const current = prev.alwaysDenyRules.command ?? [];
      const next = [...new Set([...current, ...additionalDisallowedTools])];
      if (next.length === current.length && next.every((value, index) => value === current[index])) {
        return prev;
      }
      return {
        ...prev,
        alwaysDenyRules: {
          ...prev.alwaysDenyRules,
          command: next,
        },
      };
    });
  }

  // Create content for the main message, including any pasted images
  const mainMessageContent: ContentBlockParam[] =
    imageContentBlocks.length > 0 || precedingInputBlocks.length > 0
      ? [...imageContentBlocks, ...precedingInputBlocks, ...result]
      : result;

  // Extract attachments from command arguments (@-mentions, MCP resources,
  // agent mentions in SKILL.md). skipSkillDiscovery prevents the SKILL.md
  // content itself from triggering discovery — it's meta-content, not user
  // intent, and a large SKILL.md (e.g. 110KB) would fire chunked AKI queries
  // adding seconds of latency to every skill invocation.
  // densable 2.1.228 #12 xTt: hardened synced/MCP skill bodies must not expand @.
  // densable: skip attachments when I || modelScheduledOrigin (I||C) OR Lje(e).
  let attachmentMessages: AttachmentMessage[] = [];
  if (!readOnlySkillLoad && !modelScheduledOrigin && !shouldSkipSkillAttachments(command)) {
    let skipAtMentions = command.loadedFrom === 'mcp';
    if (command.loadedFrom === 'syncedSkills' || command.loadedFrom === 'mcp') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const harden =
          require('../../skills/syncedSkillsHarden.js') as typeof import('../../skills/syncedSkillsHarden.js');
        skipAtMentions = harden.shouldHardenSkillBody(command.loadedFrom);
      } catch {
        skipAtMentions = true;
      }
    }
    attachmentMessages = await toArray(
      getAttachmentMessages(
        result
          .filter((block): block is TextBlockParam => block.type === 'text')
          .map(block => block.text)
          .join(' '),
        context,
        null,
        [], // queuedCommands - handled by query.ts for mid-turn attachments
        context.messages,
        'repl_main_thread',
        { skipSkillDiscovery: true, skipAtMentions },
      ),
    );
  }

  const messages = [
    createUserMessage({
      content: metadata,
      uuid,
    }),
    createUserMessage({
      content: mainMessageContent,
      isMeta: true,
      ...(promptShellHandOff.length > 0 && {
        promptShellHandOff: {
          agentId: context.agentId ?? null,
          commands: promptShellHandOff,
        },
      }),
    }),
    ...attachmentMessages,
    ...hookMessages,
    createAttachmentMessage({
      type: 'command_permissions',
      allowedTools: additionalAllowedTools,
      model: command.model,
    }),
  ];

  return {
    messages,
    shouldQuery: true,
    allowedTools: additionalAllowedTools,
    disallowedTools: additionalDisallowedTools,
    model: command.model,
    effort: resolveSkillEffort(command, args, context),
    command,
  };
}
