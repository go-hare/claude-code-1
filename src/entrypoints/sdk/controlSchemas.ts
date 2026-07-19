/**
 * SDK Control Schemas - Zod schemas for the control protocol.
 *
 * These schemas define the control protocol between SDK implementations and the CLI.
 * Used by SDK builders (e.g., Python SDK) to communicate with the CLI process.
 *
 * SDK consumers should use coreSchemas.ts instead.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  AccountInfoSchema,
  AgentDefinitionSchema,
  AgentInfoSchema,
  FastModeStateSchema,
  HookEventSchema,
  HookInputSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusSchema,
  ModelInfoSchema,
  ModelUsageSchema,
  PermissionModeSchema,
  PermissionUpdateSchema,
  SDKMessageSchema,
  SDKPostTurnSummaryMessageSchema,
  SDKStreamlinedTextMessageSchema,
  SDKStreamlinedToolUseSummaryMessageSchema,
  SDKUserMessageSchema,
  SlashCommandSchema,
} from './coreSchemas.js'

// ============================================================================
// External Type Placeholders
// ============================================================================

// JSONRPCMessage from @modelcontextprotocol/sdk - treat as unknown
export const JSONRPCMessagePlaceholder = lazySchema(() => z.unknown())

// ============================================================================
// Hook Callback Types
// ============================================================================

export const SDKHookCallbackMatcherSchema = lazySchema(() =>
  z
    .object({
      matcher: z.string().optional(),
      hookCallbackIds: z.array(z.string()),
      timeout: z.number().optional(),
    })
    .describe('Configuration for matching and routing hook callbacks.'),
)

// ============================================================================
// Control Request Types
// ============================================================================

export const SDKControlInitializeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('initialize'),
      hooks: z
        .record(HookEventSchema(), z.array(SDKHookCallbackMatcherSchema()))
        .optional(),
      sdkMcpServers: z.array(z.string()).optional(),
      jsonSchema: z.record(z.string(), z.unknown()).optional(),
      // Local accepts a single string; densable gold is string[]. Hosts that
      // need multi-line arrays should join client-side for this tree.
      systemPrompt: z.string().optional(),
      appendSystemPrompt: z.string().optional(),
      planModeInstructions: z
        .string()
        .optional()
        .describe(
          'Custom workflow body for the plan-mode system reminder. Replaces the default code-implementation phases; the CLI still wraps it with the read-only enforcement preamble and the ExitPlanMode protocol footer.',
        ),
      appendSubagentSystemPrompt: z
        .string()
        .optional()
        .describe(
          '@internal Additional system prompt appended to every Task-tool subagent (and propagated to nested subagents). Gated by CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT.',
        ),
      toolAliases: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Map of tool-name aliases applied before name resolution. When the model emits a tool_use whose name is a key in this map, the tool execution path resolves the mapped name instead. Single-hop (no chains). See Options.toolAliases.',
        ),
      agents: z.record(z.string(), AgentDefinitionSchema()).optional(),
      // densable initialize title — custom session title; skips automatic title
      // generation when provided. No effect on persisted title when resuming.
      title: z
        .string()
        .optional()
        .describe(
          'Custom session title. When provided, the session uses this title and skips automatic title generation. Has no effect on the persisted title when resuming an existing session.',
        ),
      // densable skills filter — main-session skill allowlist (kQo).
      skills: z
        .array(z.string())
        .optional()
        .describe(
          'When provided, only skills whose names match an entry are loaded into the main session system prompt, using the same rules as AgentDefinition.skills: exact name, plugin-qualified name, or ":name" suffix. Omit to load every discovered skill. Applies to the main session only; subagents use AgentDefinition.skills.',
        ),
      // densable excludeDynamicSections — stored on options; full getSystemPrompt
      // mB/ESo consumption is a separate residual.
      excludeDynamicSections: z
        .boolean()
        .optional()
        .describe(
          'When true, omit per-user dynamic sections (working directory, auto-memory path) from the cached system prompt and re-inject them as the first user message. Lets cross-user prompt caching hit on a static system prompt prefix. Tradeoff: the model sees this context slightly later in the prompt, so steering on the working directory and memory location is marginally less authoritative. Has no effect when a custom (non-preset) system prompt is in use.',
        ),
      // densable webSearchIsolationExemptMcpServers — print validates type;
      // isolation latch apply (xju) is densable-only and not wired locally.
      webSearchIsolationExemptMcpServers: z
        .array(z.string())
        .optional()
        .describe(
          '@internal Additional MCP server names exempt from the web search / connector isolation latch. Unioned with the built-in infra-server list.',
        ),
      promptSuggestions: z.boolean().optional(),
      agentProgressSummaries: z.boolean().optional(),
      forwardSubagentText: z.boolean().optional(),
      /**
       * Official supportedDialogKinds — dialog kinds the SDK host can render
       * for request_user_dialog. Sanitized/capped server-side (vje/cJr).
       */
      supportedDialogKinds: z.array(z.string()).optional(),
    })
    .describe(
      'Initializes the SDK session with hooks, MCP servers, and agent configuration.',
    ),
)

export const SDKControlInitializeResponseSchema = lazySchema(() =>
  z
    .object({
      commands: z.array(SlashCommandSchema()),
      agents: z.array(AgentInfoSchema()),
      output_style: z.string(),
      available_output_styles: z.array(z.string()),
      models: z.array(ModelInfoSchema()),
      account: AccountInfoSchema(),
      pid: z
        .number()
        .optional()
        .describe('@internal CLI process PID for tmux socket isolation'),
      fast_mode_state: FastModeStateSchema().optional(),
    })
    .describe(
      'Response from session initialization with available commands, models, and account info.',
    ),
)

export const SDKControlInterruptRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('interrupt'),
    })
    .describe('Interrupts the currently running conversation turn.'),
)

/**
 * densable lJk — interrupt control_response success payload.
 * Advertised by interrupt_receipt_v1 on system/init; older CLIs send empty success.
 */
export const SDKControlInterruptResponseSchema = lazySchema(() =>
  z
    .object({
      still_queued: z
        .array(z.string())
        .describe(
          'Uuids of async user messages that survive this interrupt: commands still in the queue, plus any batch already dequeued for the imminent turn but not yet reachable by the abort. These WILL run unless cancelled first. Cancellation granularity: uuids still in the queue are individually cancellable via cancel_async_message; once a batch is dequeued and coalesced into one turn, cancelling a NON-representative member uuid is a no-op (its content still runs), while cancelling the batch-representative uuid drops the WHOLE coalesced batch — in both cases the cancel response reports cancelled:false because the message was no longer in the queue. Coverage caveats: only uuid-STAMPED messages appear (a message enqueued without a uuid still runs but is never listed, so [] does not mean "nothing will run"); only main-thread messages are listed (subagent-addressed messages are out of scope); and the list may include internally-enqueued uuids the client never sent (cron triggers, auto-resume continuations) — ignore unknown uuids rather than treating them as an error. Ordering: on a clean interrupt this receipt is written before the interrupted turn result; a turn that crashes during interrupt handling emits its error result on a direct-write path that may precede the receipt. Snapshot is taken synchronously with abort processing — probing the queue after the interrupted result instead always loses the race against the drain loop, which starts the next queued turn immediately.',
        ),
    })
    .describe(
      'Result of an interrupt operation. Advertised by the interrupt_receipt_v1 capability on system/init; older CLIs send an empty success response with no still_queued field.',
    ),
)

export const SDKControlPermissionRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('can_use_tool'),
      tool_name: z.string(),
      input: z.record(z.string(), z.unknown()),
      permission_suggestions: z.array(PermissionUpdateSchema()).optional(),
      blocked_path: z.string().optional(),
      decision_reason: z.string().optional(),
      title: z.string().optional(),
      display_name: z.string().optional(),
      tool_use_id: z.string(),
      agent_id: z.string().optional(),
      description: z.string().optional(),
    })
    .describe('Requests permission to use a tool with the given input.'),
)

export const SDKControlSetPermissionModeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_permission_mode'),
      mode: PermissionModeSchema(),
      ultraplan: z
        .boolean()
        .optional()
        .describe('@internal CCR ultraplan session marker.'),
    })
    .describe('Sets the permission mode for tool execution handling.'),
)

export const SDKControlSetModelRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_model'),
      // densable: string | null | omitted — null/omitted resolve to "default".
      model: z.string().nullable().optional(),
    })
    .describe('Sets the model to use for subsequent conversation turns.'),
)

export const SDKControlSetMaxThinkingTokensRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_max_thinking_tokens'),
      // densable: omitted/null clears mid-session budget override; integer
      // sets fixed budget; 0 disables. Must be integer when present.
      max_thinking_tokens: z.number().int().nullable().optional(),
      // densable thinking_display: summarized|omitted|null|omitted-field.
      // A value replaces session display mode; null clears to API default;
      // omitted keeps the display mode from session start.
      thinking_display: z
        .enum(['summarized', 'omitted'])
        .nullable()
        .optional(),
    })
    .describe(
      'Sets the maximum number of thinking tokens for extended thinking. When max_thinking_tokens is omitted or null, thinking resets to the session default: any mid-session budget override is cleared (back to the spawn-time budget, if one was set), and thinking stays off for sessions that have it disabled. thinking_display optionally sets the thinking display mode for the rest of the session: a value replaces the session display mode, null clears it back to the API default, and when omitted the display mode from session start (--thinking-display) is kept.',
    ),
)

export const SDKControlMcpStatusRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_status'),
    })
    .describe('Requests the current status of all MCP server connections.'),
)

export const SDKControlMcpStatusResponseSchema = lazySchema(() =>
  z
    .object({
      mcpServers: z.array(McpServerStatusSchema()),
    })
    .describe(
      'Response containing the current status of all MCP server connections.',
    ),
)

export const SDKControlGetContextUsageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_context_usage'),
    })
    .describe(
      'Requests a breakdown of current context window usage by category.',
    ),
)

/**
 * densable oNf — thin-client /version asks the remote worker for its binary stamp.
 */
export const SDKControlGetBinaryVersionRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_binary_version'),
    })
    .describe(
      "Requests the responder's CLI binary version. Used by /version in --remote mode so the thin client can show both its own and the remote container's version.",
    ),
)

/** densable mJk */
export const SDKControlGetBinaryVersionResponseSchema = lazySchema(() =>
  z.object({
    version: z.string(),
    buildTime: z.string().optional(),
  }),
)

/**
 * densable tNf — thin-client /usage dialog needs remote container cost text.
 */
export const SDKControlGetSessionCostRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_session_cost'),
    })
    .describe(
      'Requests the formatted session cost summary (the same text /usage prints in non-interactive mode). Used by the thin-client /usage dialog to show the remote container cost instead of the local $0.00.',
    ),
)

/** densable dJk — formatted session cost text, ANSI-stripped. */
export const SDKControlGetSessionCostResponseSchema = lazySchema(() =>
  z
    .object({
      text: z.string(),
    })
    .describe('Formatted session cost text, ANSI-stripped.'),
)

/**
 * densable rNf — worker model catalog for caps.modelCatalog.
 */
export const SDKControlListModelsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('list_models'),
    })
    .describe(
      "Requests the worker's selectable model catalog. Fulfills the caps.modelCatalog capability: in a remote thin-client session the worker's provider, settings cascade, and enforcement policy decide which models the session can run, so the thin client must ask rather than read its own getModelOptions().",
    ),
)

/** densable pJk — models via toModelInfos / initialize ModelInfo shape. */
export const SDKControlListModelsResponseSchema = lazySchema(() =>
  z
    .object({
      models: z.array(ModelInfoSchema()),
    })
    .describe(
      "The worker's model options serialized via toModelInfos() — the same ModelInfo shape the initialize response carries.",
    ),
)

/**
 * densable nNf / fJk — structured /usage (session slice; rate limits optional).
 * Local residual: session + subscription_type always; rate_limits/behaviors null
 * without claude.ai usage endpoint / transcript scan (no cloud fleet).
 */
export const SDKControlGetUsageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_usage'),
    })
    .describe(
      'Requests the structured /usage data: session cost/usage totals plus claude.ai plan rate-limit utilization when available. Experimental — the response shape may change.',
    ),
)

const UsageRateLimitWindowSchema = lazySchema(() =>
  z.object({
    utilization: z
      .number()
      .nullable()
      .describe('Percentage of the window used, 0-100.'),
    resets_at: z
      .string()
      .nullable()
      .describe('ISO 8601 timestamp when the window resets.'),
  }),
)

export const SDKControlGetUsageResponseSchema = lazySchema(() =>
  z
    .object({
      session: z
        .object({
          total_cost_usd: z.number(),
          total_api_duration_ms: z.number(),
          total_duration_ms: z.number(),
          total_lines_added: z.number(),
          total_lines_removed: z.number(),
          model_usage: z.record(z.string(), ModelUsageSchema()),
        })
        .describe('Cost and usage accumulated by the current session.'),
      subscription_type: z
        .string()
        .nullable()
        .describe(
          "Claude.ai subscription type ('pro', 'max', 'team', 'enterprise') or null for API key / 3P provider sessions.",
        ),
      rate_limits_available: z
        .boolean()
        .describe(
          'False when plan rate limits do not apply (API key, Bedrock, Vertex, or missing profile scope) — rate_limits will be null.',
        ),
      rate_limits: z
        .object({
          five_hour: UsageRateLimitWindowSchema().nullable().optional(),
          seven_day: UsageRateLimitWindowSchema().nullable().optional(),
          seven_day_oauth_apps: UsageRateLimitWindowSchema()
            .nullable()
            .optional(),
          seven_day_opus: UsageRateLimitWindowSchema().nullable().optional(),
          seven_day_sonnet: UsageRateLimitWindowSchema().nullable().optional(),
          model_scoped: z
            .array(
              z.object({
                display_name: z.string(),
                utilization: z.number().nullable(),
                resets_at: z.string().nullable(),
              }),
            )
            .optional(),
          extra_usage: z
            .object({
              is_enabled: z.boolean(),
              monthly_limit: z.number().nullable(),
              used_credits: z.number().nullable(),
              utilization: z.number().nullable(),
              currency: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .describe(
          'Plan rate-limit utilization windows from the claude.ai usage endpoint, or null when unavailable.',
        ),
      behaviors: z
        .unknown()
        .nullable()
        .describe(
          "What's contributing to limits usage from local transcripts, or null when unavailable.",
        ),
    })
    .describe(
      'Structured /usage data: session cost/usage totals plus claude.ai plan rate-limit utilization. Experimental — the shape may change.',
    ),
)

/**
 * densable cNf — read session plan-mode plan without creating slug/file.
 */
export const SDKControlGetPlanRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_plan'),
    })
    .describe(
      "Read the session's current plan-mode plan. Unlike read_file, the caller does not need to know the plan file's path — the worker resolves its own plan slug. Never creates a plan slug or file.",
    ),
)

/** densable SJk */
export const SDKControlGetPlanResponseSchema = lazySchema(() =>
  z
    .object({
      exists: z.boolean(),
      content: z
        .string()
        .optional()
        .describe('Plan markdown. Present iff exists is true.'),
      path: z
        .string()
        .optional()
        .describe(
          'Absolute plan-file path on the session filesystem. Present iff exists is true.',
        ),
    })
    .describe(
      '@internal The current plan-mode plan for this session, or exists:false when no plan slug/file is present.',
    ),
)

/**
 * densable oNf-adjacent — at-mention file autocomplete for thin clients.
 */
export const SDKControlFileSuggestionsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('file_suggestions'),
      query: z.string(),
    })
    .describe(
      'Requests at-mention file autocomplete suggestions for a partial path prefix. Returns the same fuzzy-matched results the TUI shows.',
    ),
)

/** densable uJk */
export const SDKControlFileSuggestionsResponseSchema = lazySchema(() =>
  z
    .object({
      suggestions: z.array(
        z.object({
          path: z.string(),
          score: z.number().optional(),
        }),
      ),
    })
    .describe(
      'Response containing fuzzy-ranked file path suggestions (capped at the same limit as the TUI typeahead).',
    ),
)

const ContextCategorySchema = lazySchema(() =>
  z.object({
    name: z.string(),
    tokens: z.number(),
    color: z.string(),
    isDeferred: z.boolean().optional(),
  }),
)

const ContextGridSquareSchema = lazySchema(() =>
  z.object({
    color: z.string(),
    isFilled: z.boolean(),
    categoryName: z.string(),
    tokens: z.number(),
    percentage: z.number(),
    squareFullness: z.number(),
  }),
)

export const SDKControlGetContextUsageResponseSchema = lazySchema(() =>
  z
    .object({
      categories: z.array(ContextCategorySchema()),
      totalTokens: z.number(),
      maxTokens: z.number(),
      rawMaxTokens: z.number(),
      percentage: z.number(),
      gridRows: z.array(z.array(ContextGridSquareSchema())),
      model: z.string(),
      memoryFiles: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          tokens: z.number(),
        }),
      ),
      mcpTools: z.array(
        z.object({
          name: z.string(),
          serverName: z.string(),
          tokens: z.number(),
          isLoaded: z.boolean().optional(),
        }),
      ),
      deferredBuiltinTools: z
        .array(
          z.object({
            name: z.string(),
            tokens: z.number(),
            isLoaded: z.boolean(),
          }),
        )
        .optional(),
      systemTools: z
        .array(z.object({ name: z.string(), tokens: z.number() }))
        .optional(),
      systemPromptSections: z
        .array(z.object({ name: z.string(), tokens: z.number() }))
        .optional(),
      agents: z.array(
        z.object({
          agentType: z.string(),
          source: z.string(),
          tokens: z.number(),
        }),
      ),
      slashCommands: z
        .object({
          totalCommands: z.number(),
          includedCommands: z.number(),
          tokens: z.number(),
        })
        .optional(),
      skills: z
        .object({
          totalSkills: z.number(),
          includedSkills: z.number(),
          tokens: z.number(),
          skillFrontmatter: z.array(
            z.object({
              name: z.string(),
              source: z.string(),
              tokens: z.number(),
            }),
          ),
        })
        .optional(),
      autoCompactThreshold: z.number().optional(),
      isAutoCompactEnabled: z.boolean(),
      messageBreakdown: z
        .object({
          toolCallTokens: z.number(),
          toolResultTokens: z.number(),
          attachmentTokens: z.number(),
          assistantMessageTokens: z.number(),
          userMessageTokens: z.number(),
          toolCallsByType: z.array(
            z.object({
              name: z.string(),
              callTokens: z.number(),
              resultTokens: z.number(),
            }),
          ),
          attachmentsByType: z.array(
            z.object({ name: z.string(), tokens: z.number() }),
          ),
        })
        .optional(),
      apiUsage: z
        .object({
          input_tokens: z.number(),
          output_tokens: z.number(),
          cache_creation_input_tokens: z.number(),
          cache_read_input_tokens: z.number(),
        })
        .nullable(),
    })
    .describe(
      'Breakdown of current context window usage by category (system prompt, tools, messages, etc.).',
    ),
)

export const SDKControlRewindFilesRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('rewind_files'),
      user_message_id: z.string(),
      dry_run: z.boolean().optional(),
    })
    .describe('Rewinds file changes made since a specific user message.'),
)

export const SDKControlRewindFilesResponseSchema = lazySchema(() =>
  z
    .object({
      canRewind: z.boolean(),
      error: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      insertions: z.number().optional(),
      deletions: z.number().optional(),
    })
    .describe('Result of a rewindFiles operation.'),
)

export const SDKControlCancelAsyncMessageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('cancel_async_message'),
      message_uuid: z.string(),
    })
    .describe(
      'Drops a pending async user message from the command queue by uuid. No-op if already dequeued for execution.',
    ),
)

export const SDKControlCancelAsyncMessageResponseSchema = lazySchema(() =>
  z
    .object({
      cancelled: z.boolean(),
    })
    .describe(
      'Result of a cancel_async_message operation. cancelled=false means the message was not in the queue (already dequeued or never enqueued).',
    ),
)

/** densable JMf — sets the user-facing title for the current session. */
export const SDKControlRenameSessionRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('rename_session'),
      title: z.string(),
    })
    .describe('Sets the user-facing title for the current session.'),
)

/**
 * densable Fzo — records a per-message thumbs up/down rating (SDK control).
 * Logs tengu_message_rated when product feedback policy allows.
 */
export const SDKControlMessageRatedRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('message_rated'),
      messageUuid: z
        .string()
        .describe('UUID of the assistant message being rated.'),
      sentiment: z
        .enum(['positive', 'negative'])
        .describe(
          'User rating: positive (thumbs up) or negative (thumbs down).',
        ),
      surface: z
        .enum(['tool_use', 'assistant_text'])
        .optional()
        .describe(
          'Which in-conversation surface the rating came from. If omitted, logged as tool_use.',
        ),
      cleared: z
        .boolean()
        .optional()
        .describe(
          'True when the caller is un-rating a message (clicking the same control a second time).',
        ),
    })
    .describe(
      'Records a per-message thumbs up/down rating. Logs tengu_message_rated with the same shape as the in-conversation rating controls.',
    ),
)

export const SDKControlSeedReadStateRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('seed_read_state'),
      path: z.string(),
      mtime: z.number(),
    })
    .describe(
      'Seeds the readFileState cache with a path+mtime entry. Use when a prior Read was removed from context (e.g. by snip) so Edit validation would fail despite the client having observed the Read. The mtime lets the CLI detect if the file changed since the seeded Read — same staleness check as the normal path.',
    ),
)

export const SDKHookCallbackRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('hook_callback'),
      callback_id: z.string(),
      input: HookInputSchema(),
      tool_use_id: z.string().optional(),
    })
    .describe('Delivers a hook callback with its input data.'),
)

export const SDKControlMcpMessageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_message'),
      server_name: z.string(),
      message: JSONRPCMessagePlaceholder(),
    })
    .describe('Sends a JSON-RPC message to a specific MCP server.'),
)

export const SDKControlMcpSetServersRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_set_servers'),
      servers: z.record(z.string(), McpServerConfigForProcessTransportSchema()),
    })
    .describe('Replaces the set of dynamically managed MCP servers.'),
)

export const SDKControlMcpSetServersResponseSchema = lazySchema(() =>
  z
    .object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      errors: z.record(z.string(), z.string()),
    })
    .describe(
      'Result of replacing the set of dynamically managed MCP servers.',
    ),
)

export const SDKControlReloadPluginsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('reload_plugins'),
    })
    .describe(
      'Reloads plugins from disk and returns the refreshed session components.',
    ),
)

export const SDKControlReloadPluginsResponseSchema = lazySchema(() =>
  z
    .object({
      commands: z.array(SlashCommandSchema()),
      agents: z.array(AgentInfoSchema()),
      plugins: z.array(
        z.object({
          name: z.string(),
          path: z.string(),
          source: z.string().optional(),
        }),
      ),
      mcpServers: z.array(McpServerStatusSchema()),
      error_count: z.number(),
    })
    .describe(
      'Refreshed commands, agents, plugins, and MCP server status after reload.',
    ),
)

export const SDKControlMcpReconnectRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_reconnect'),
      serverName: z.string(),
    })
    .describe('Reconnects a disconnected or failed MCP server.'),
)

export const SDKControlMcpToggleRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_toggle'),
      serverName: z.string(),
      enabled: z.boolean(),
    })
    .describe('Enables or disables an MCP server.'),
)

/**
 * Official 2.1.x control channel: pin an MCP server to a tighten-only mode
 * (`default` / `auto`) or clear the pin with null. Used by Remote Control /
 * claude-in-chrome set_permission_mode demotion paths.
 */
export const SDKControlSetMcpPermissionModeOverrideRequestSchema = lazySchema(
  () =>
    z
      .object({
        subtype: z.literal('set_mcp_permission_mode_override'),
        serverName: z.string(),
        // null clears the override; string values are validated tighten-only
        // at the handler (WDu) so unknown modes can return a clear error.
        mode: z.string().nullable(),
      })
      .describe(
        "Sets a per-MCP-server permission mode override (tighten-only: 'default', 'auto', or null to clear).",
      ),
)

export const SDKControlStopTaskRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('stop_task'),
      task_id: z.string(),
    })
    .describe('Stops a running task.'),
)

/** densable JTn — skill entry in reload_skills response. */
export const SDKControlSkillInfoSchema = lazySchema(() =>
  z
    .object({
      name: z.string().describe('Skill name (without the leading slash)'),
      description: z.string().describe('Description of what the skill does'),
      argumentHint: z
        .string()
        .describe('Hint for skill arguments (e.g., "<file>")'),
      aliases: z
        .array(z.string())
        .optional()
        .describe(
          'Alternate names that resolve to this command (e.g., /cost and /stats both resolve to /usage)',
        ),
    })
    .describe('Information about a skill command after reload.'),
)

/** densable hNf — reloads skills from disk and returns the refreshed list. */
export const SDKControlReloadSkillsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('reload_skills'),
    })
    .describe('Reloads skills from disk and returns the refreshed skill list.'),
)

/** densable CJk — refreshed skill commands after reload. */
export const SDKControlReloadSkillsResponseSchema = lazySchema(() =>
  z
    .object({
      skills: z.array(SDKControlSkillInfoSchema()),
    })
    .describe('Refreshed skill commands after reload.'),
)

/** densable ENf — backgrounds in-flight foreground bash/agent tasks. */
export const SDKControlBackgroundTasksRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('background_tasks'),
      tool_use_id: z
        .string()
        .optional()
        .describe(
          'When set, backgrounds only the task whose originating tool_use block has this id. When omitted, backgrounds all foreground tasks (Ctrl+B semantics).',
        ),
    })
    .describe(
      'Backgrounds in-flight foreground tasks (Bash commands and subagents). With tool_use_id, targets the single task started by that tool_use block; without it, backgrounds all.',
    ),
)

/** densable response: `{backgrounded}` when tool_use_id set; empty object otherwise. */
export const SDKControlBackgroundTasksResponseSchema = lazySchema(() =>
  z
    .object({
      backgrounded: z
        .boolean()
        .optional()
        .describe(
          'Present when tool_use_id was set: whether that task was backgrounded.',
        ),
    })
    .describe('Response from background_tasks control request.'),
)

export const SDKControlApplyFlagSettingsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('apply_flag_settings'),
      settings: z.record(z.string(), z.unknown()),
    })
    .describe(
      'Merges the provided settings into the flag settings layer, updating the active configuration.',
    ),
)

export const SDKControlGetSettingsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_settings'),
    })
    .describe(
      'Returns the effective merged settings and the raw per-source settings.',
    ),
)

export const SDKControlGetSettingsResponseSchema = lazySchema(() =>
  z
    .object({
      effective: z.record(z.string(), z.unknown()),
      sources: z
        .array(
          z.object({
            source: z.enum([
              'userSettings',
              'projectSettings',
              'localSettings',
              'flagSettings',
              'policySettings',
            ]),
            settings: z.record(z.string(), z.unknown()),
          }),
        )
        .describe(
          'Ordered low-to-high priority — later entries override earlier ones.',
        ),
      applied: z
        .object({
          model: z.string(),
          // String levels only — numeric effort is ant-only and the
          // Zod→proto generator can't emit enum∪number unions.
          effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable(),
          // densable AJk — advisor model after enablement/allowlist/pairing.
          advisor: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Advisor model that will be attached to API requests, after enablement, allowlist, and pairing validation. Null when none will be attached; absent on workers that predate the field.',
            ),
          // densable AJk — ultracode session active (xhigh + workflows).
          ultracode: z
            .boolean()
            .optional()
            .describe(
              'Whether ultracode (xhigh effort plus standing dynamic-workflow orchestration) is active for the session. Set per session via the `ultracode` settings key (--settings or apply_flag_settings).',
            ),
        })
        .optional()
        .describe(
          'Runtime-resolved values after env overrides, session state, and model-specific defaults are applied. Unlike `effective` (disk merge), these reflect what will actually be sent to the API.',
        ),
      errors: z
        .array(
          z.object({
            file: z.string().optional(),
            path: z.unknown().optional(),
            message: z.string(),
          }),
        )
        .optional()
        .describe(
          'Non-warning settings validation errors, if any (densable aee filter).',
        ),
    })
    .describe(
      'Effective merged settings plus raw per-source settings in merge order.',
    ),
)

export const SDKControlElicitationRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('elicitation'),
      mcp_server_name: z.string(),
      message: z.string(),
      mode: z.enum(['form', 'url']).optional(),
      url: z.string().optional(),
      elicitation_id: z.string().optional(),
      requested_schema: z.record(z.string(), z.unknown()).optional(),
    })
    .describe(
      'Requests the SDK consumer to handle an MCP elicitation (user input request).',
    ),
)

export const SDKControlElicitationResponseSchema = lazySchema(() =>
  z
    .object({
      action: z.enum(['accept', 'decline', 'cancel']),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .describe('Response from the SDK consumer for an elicitation request.'),
)

/**
 * Official oauth_token_refresh control request — CLI asks SDK host for a
 * fresh OAuth access token after 401 when the host owns refresh.
 * @internal
 */
export const SDKControlOauthTokenRefreshRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('oauth_token_refresh'),
    })
    .describe(
      '@internal Request from the CLI subprocess to the SDK host for a fresh OAuth access token after a 401 with no local refresh token.',
    ),
)

/** Official lSf response: accessToken string | null. */
export const SDKControlOauthTokenRefreshResponseSchema = lazySchema(() =>
  z
    .object({
      accessToken: z.string().nullable(),
    })
    .describe(
      '@internal Fresh OAuth access token returned by the SDK host getOAuthToken callback, or null when the host has no token available.',
    ),
)

/**
 * Official host_auth_token_refresh control request — CLI asks SDK host for a
 * fresh provider auth token after 401 (Cowork 3P / host-managed).
 * @internal
 */
export const SDKControlHostAuthTokenRefreshRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('host_auth_token_refresh'),
    })
    .describe(
      '@internal Request from the CLI subprocess to the SDK host for a fresh provider auth token after a 401 when the host owns the credential (Cowork 3P).',
    ),
)

/** Official uSf response: authToken string | null. */
export const SDKControlHostAuthTokenRefreshResponseSchema = lazySchema(() =>
  z
    .object({
      authToken: z.string().nullable(),
    })
    .describe(
      '@internal Fresh provider auth token returned by the SDK host getHostAuthToken callback, or null when the host has no token available.',
    ),
)

/**
 * Official request_user_dialog control request — CLI parks a host-rendered
 * dialog (refusal_fallback_prompt, etc.) until the SDK consumer answers.
 * @internal
 */
export const SDKControlRequestUserDialogRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('request_user_dialog'),
      dialog_kind: z.string(),
      payload: z.unknown().optional(),
      tool_use_id: z.string().optional(),
    })
    .describe(
      '@internal Request from the CLI to the SDK host to present a user dialog. Host answers with behavior completed|cancelled + optional result.',
    ),
)

/**
 * Official iSf response for request_user_dialog.
 * behavior completed|cancelled; result is dialog-kind-specific opaque payload.
 */
export const SDKControlRequestUserDialogResponseSchema = lazySchema(() =>
  z
    .object({
      behavior: z.enum(['completed', 'cancelled']),
      result: z
        .unknown()
        .optional()
        .describe(
          'Dialog-specific result payload. Opaque to the protocol; the caller and dialog renderer agree on the shape per dialog_kind.',
        ),
    })
    .describe(
      'Response from the SDK consumer for a request_user_dialog request.',
    ),
)

// ============================================================================
// Control Request/Response Wrappers
// ============================================================================

export const SDKControlRequestInnerSchema = lazySchema(() =>
  z.union([
    SDKControlInterruptRequestSchema(),
    SDKControlPermissionRequestSchema(),
    SDKControlInitializeRequestSchema(),
    SDKControlSetPermissionModeRequestSchema(),
    SDKControlSetModelRequestSchema(),
    SDKControlSetMaxThinkingTokensRequestSchema(),
    SDKControlMcpStatusRequestSchema(),
    SDKControlGetContextUsageRequestSchema(),
    SDKControlGetBinaryVersionRequestSchema(),
    SDKControlGetSessionCostRequestSchema(),
    SDKControlListModelsRequestSchema(),
    SDKControlGetUsageRequestSchema(),
    SDKControlGetPlanRequestSchema(),
    SDKControlFileSuggestionsRequestSchema(),
    SDKHookCallbackRequestSchema(),
    SDKControlMcpMessageRequestSchema(),
    SDKControlRewindFilesRequestSchema(),
    SDKControlCancelAsyncMessageRequestSchema(),
    SDKControlRenameSessionRequestSchema(),
    SDKControlMessageRatedRequestSchema(),
    SDKControlSeedReadStateRequestSchema(),
    SDKControlMcpSetServersRequestSchema(),
    SDKControlReloadPluginsRequestSchema(),
    SDKControlReloadSkillsRequestSchema(),
    SDKControlMcpReconnectRequestSchema(),
    SDKControlMcpToggleRequestSchema(),
    SDKControlSetMcpPermissionModeOverrideRequestSchema(),
    SDKControlStopTaskRequestSchema(),
    SDKControlBackgroundTasksRequestSchema(),
    SDKControlApplyFlagSettingsRequestSchema(),
    SDKControlGetSettingsRequestSchema(),
    SDKControlElicitationRequestSchema(),
    SDKControlOauthTokenRefreshRequestSchema(),
    SDKControlHostAuthTokenRefreshRequestSchema(),
    SDKControlRequestUserDialogRequestSchema(),
  ]),
)

export const SDKControlRequestSchema = lazySchema(() =>
  z.object({
    type: z.literal('control_request'),
    request_id: z.string(),
    request: SDKControlRequestInnerSchema(),
  }),
)

export const ControlResponseSchema = lazySchema(() =>
  z.object({
    subtype: z.literal('success'),
    request_id: z.string(),
    response: z.record(z.string(), z.unknown()).optional(),
  }),
)

export const ControlErrorResponseSchema = lazySchema(() =>
  z.object({
    subtype: z.literal('error'),
    request_id: z.string(),
    error: z.string(),
    pending_permission_requests: z
      .array(z.lazy(() => SDKControlRequestSchema()))
      .optional(),
    /** Official pending_user_dialog_requests redelivery on initialize error. */
    pending_user_dialog_requests: z
      .array(z.lazy(() => SDKControlRequestSchema()))
      .optional(),
  }),
)

export const SDKControlResponseSchema = lazySchema(() =>
  z.object({
    type: z.literal('control_response'),
    response: z.union([ControlResponseSchema(), ControlErrorResponseSchema()]),
  }),
)

export const SDKControlCancelRequestSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('control_cancel_request'),
      request_id: z.string(),
    })
    .describe('Cancels a currently open control request.'),
)

export const SDKKeepAliveMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('keep_alive'),
    })
    .describe('Keep-alive message to maintain WebSocket connection.'),
)

export const SDKUpdateEnvironmentVariablesMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('update_environment_variables'),
      variables: z.record(z.string(), z.string()),
    })
    .describe('Updates environment variables at runtime.'),
)

// ============================================================================
// Aggregate Message Types
// ============================================================================

export const StdoutMessageSchema = lazySchema(() =>
  z.union([
    SDKMessageSchema(),
    SDKStreamlinedTextMessageSchema(),
    SDKStreamlinedToolUseSummaryMessageSchema(),
    SDKPostTurnSummaryMessageSchema(),
    SDKControlResponseSchema(),
    SDKControlRequestSchema(),
    SDKControlCancelRequestSchema(),
    SDKKeepAliveMessageSchema(),
  ]),
)

export const StdinMessageSchema = lazySchema(() =>
  z.union([
    SDKUserMessageSchema(),
    SDKControlRequestSchema(),
    SDKControlResponseSchema(),
    SDKKeepAliveMessageSchema(),
    SDKUpdateEnvironmentVariablesMessageSchema(),
  ]),
)
