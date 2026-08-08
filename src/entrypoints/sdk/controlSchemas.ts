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
      systemPrompt: z.string().optional(),
      appendSystemPrompt: z.string().optional(),
      agents: z.record(z.string(), AgentDefinitionSchema()).optional(),
      promptSuggestions: z.boolean().optional(),
      agentProgressSummaries: z.boolean().optional(),
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
      model: z.string().optional(),
    })
    .describe('Sets the model to use for subsequent conversation turns.'),
)

export const SDKControlSetMaxThinkingTokensRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_max_thinking_tokens'),
      max_thinking_tokens: z.number().nullable(),
    })
    .describe(
      'Sets the maximum number of thinking tokens for extended thinking.',
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

/**
 * densable 2.1.218 set_cwd — headless twin of /cd for SDK hosts.
 * SEA: subtype literal set_cwd + trust_accepted + trusted_directory.
 */
export const SDKControlSetCwdRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_cwd'),
      path: z
        .string()
        .describe(
          'Target directory. Tilde-expanded and realpath-canonicalized by the CLI, exactly like an interactive /cd argument.',
        ),
      trust_accepted: z
        .boolean()
        .optional()
        .describe(
          "Host attestation that the user explicitly accepted a trust dialog for this directory. Only send true after showing one — the CLI records the directory as trusted (the same latch /cd's own prompt writes) before relocating. Requires trusted_directory.",
        ),
      trusted_directory: z
        .string()
        .optional()
        .describe(
          'Required whenever trust_accepted is true: the exact directory string from the needs_trust response being answered. This pins the attestation to the canonical path the user was shown — if the raw path canonicalizes differently by the time the re-send arrives (e.g. a symlink component changed during the dialog), nothing is latched and a fresh needs_trust carries the new canonical directory.',
        ),
    })
    .describe(
      '@internal Moves the session to a new working directory — the headless twin of /cd, for SDK hosts like Claude Desktop. Runs the same validation, Cd(...) permission rules, and relocation path as the interactive command, with the trust prompt delegated to the host via the needs_trust response arm. Rejected while a turn is in flight.',
    ),
)

/**
 * densable set_cwd response discriminated union (status ok | needs_trust | rejected).
 */
export const SDKControlSetCwdResponseSchema = lazySchema(() =>
  z
    .discriminatedUnion('status', [
      z.object({
        status: z.literal('ok'),
        cwd: z
          .string()
          .describe(
            'Canonical (realpath) working directory the session now runs in.',
          ),
        changed: z
          .boolean()
          .describe(
            'False when the target already was the working directory — a successful no-op with no side effects.',
          ),
        transcript_relocated: z
          .boolean()
          .describe(
            'True when the transcript lives in the project slot derived from cwd (the normal case, and the no-op case). False only on the documented edge where the move completed but the transcript move failed AND the rollback chdir failed — a cwd-derived resume lookup will then miss the session.',
          ),
      }),
      z.object({
        status: z.literal('needs_trust'),
        trust_root: z
          .string()
          .optional()
          .describe(
            'Present when `directory` sits inside a git repository whose canonical root differs from it (a subdirectory or a linked worktree). Accepting trust grants that whole repository — every subdirectory and linked worktree of the root — so the trust dialog should name this root alongside `directory`. Informational only: the attestation echo still pins `trusted_directory` to `directory`.',
          ),
        directory: z
          .string()
          .describe(
            'Canonical target directory. Nothing changed; show a trust dialog for exactly this string and, on accept, re-send with trust_accepted: true and trusted_directory echoing it verbatim.',
          ),
      }),
      z.object({
        status: z.literal('rejected'),
        reason: z
          .enum([
            'not_found',
            'not_a_directory',
            'blocked_by_rule',
            'busy',
            'unsafe_path',
          ])
          .describe(
            "unsafe_path: the target's canonical path contains characters that do not render as visible, space-distinguishable glyphs — control (Cc), format (Cf), default-ignorable, line/paragraph-separator (Zl/Zp), non-ASCII-space Zs, or braille-blank code points; rejected fail-closed before the trust round-trip, and the offending path is never echoed back.",
          ),
        message: z.string().describe('Human-readable, ANSI-free explanation.'),
      }),
    ])
    .describe(
      '@internal Result of a set_cwd request. Every non-ok outcome leaves the working directory unchanged — but trust may already have been durably recorded when the request carried a valid attestation (a busy rejection or relocation failure after the latch does not unlatch it; the consent was for the directory, not the attempt). Internal failures (e.g. the transcript move failed and was rolled back) arrive as a control_response error instead.',
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

/**
 * Official 2.1.x control: Ctrl+B semantics over stream-json.
 * tool_use_id targets the single task started by that tool_use; omit = all
 * foreground tasks.
 */
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
      'Backgrounds in-flight foreground tasks (Bash commands and subagents). With tool_use_id, targets the single task started by that tool_use block; without it, backgrounds all foreground tasks — the control-request equivalent of pressing Ctrl+B in the terminal. Each blocking tool call returns immediately with a "running in the background" tool_result and the turn continues; the task keeps running and emits a task_notification when it settles.',
    ),
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
          // densable get_settings.applied.advisor / ultracode (nZn / Dee).
          advisor: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Advisor model that will be attached to API requests, after enablement, allowlist, and pairing validation. Null when none will be attached; absent on workers that predate the field.',
            ),
          ultracode: z
            .boolean()
            .optional()
            .describe(
              'Whether ultracode (top-tier effort plus standing dynamic-workflow orchestration) is active for the session. Set per session via the `ultracode` settings key (--settings or apply_flag_settings).',
            ),
          // Fork extension (densable applied has only model/effort/advisor/
          // ultracode) — lets hosts render the effort slider without a
          // client-side catalog copy. Optional: absent on older workers.
          effortLevels: z
            .array(z.enum(['low', 'medium', 'high', 'xhigh', 'max']))
            .optional()
            .describe(
              'Effort levels the current model supports (capability ladder filtered by org limit). Empty when the model has no effort capability. Fork extension — not present in densable applied.',
            ),
          ultracodeOfferable: z
            .boolean()
            .optional()
            .describe(
              'Whether ultracode can be offered for the current model (workflows feature enabled AND the model has a top-tier wire). Hosts should hide the Ultracode tier when false. Fork extension — not present in densable applied.',
            ),
        })
        .optional()
        .describe(
          'Runtime-resolved values after env overrides, session state, and model-specific defaults are applied. Unlike `effective` (disk merge), these reflect what will actually be sent to the API.',
        ),
      // densable get_settings.errors — non-warning validation failures.
      errors: z
        .array(
          z.object({
            file: z
              .string()
              .optional()
              .describe(
                'Path to the settings file that failed to parse or validate.',
              ),
            path: z
              .string()
              .describe(
                'Dot-notation path to the field with the error, or empty string for whole-file errors.',
              ),
            message: z.string().describe('Human-readable error message.'),
          }),
        )
        .optional()
        .describe(
          'Settings parse and validation errors. When non-empty, the listed files were skipped during the merge — their settings are not reflected in `effective` or `sources`.',
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
    SDKHookCallbackRequestSchema(),
    SDKControlMcpMessageRequestSchema(),
    SDKControlRewindFilesRequestSchema(),
    SDKControlCancelAsyncMessageRequestSchema(),
    SDKControlSeedReadStateRequestSchema(),
    SDKControlSetCwdRequestSchema(),
    SDKControlMcpSetServersRequestSchema(),
    SDKControlReloadPluginsRequestSchema(),
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
    // densable 2.1.214: prompt redelivery fields also on success responses
    // (sibling of error schema; RemoteSessionManager may re-arm dialogs).
    pending_permission_requests: z
      .array(z.lazy(() => SDKControlRequestSchema()))
      .optional(),
    pending_user_dialog_requests: z
      .array(z.lazy(() => SDKControlRequestSchema()))
      .optional(),
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
