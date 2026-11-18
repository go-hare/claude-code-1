// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import omit from 'lodash-es/omit.js'
import reject from 'lodash-es/reject.js'
import {
  type AgentDefinition,
  isBuiltInAgent,
  parseAgentsFromJson,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  getAllowedChannels,
  getFlagSettingsInline,
  getMainThreadAgentType,
  getSessionId,
  registerHookCallbacks,
  setAllowedChannels,
  setFlagSettingsInline,
  setInitJsonSchema,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  setSdkSupportedDialogKinds,
  type ChannelEntry,
} from 'src/bootstrap/state.js'
import { installOAuthTokens } from 'src/cli/handlers/auth.js'
import type { StructuredIO } from 'src/cli/structuredIO.js'
import {
  type Command,
  formatDescriptionWithSource,
  getCommandName,
} from 'src/commands.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getAllOutputStyles,
} from 'src/constants/outputStyles.js'
import type {
  HookEvent,
  McpServerConfigForProcessTransport,
  ModelInfo,
  PermissionResult,
  RewindFilesResult,
} from 'src/entrypoints/agentSdkTypes.js'
import type {
  SDKControlInitializeRequest,
  SDKControlInitializeResponse,
  SDKControlMcpSetServersResponse,
  SDKControlRequest,
  SDKControlResponse,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import {
  performMCPOAuthFlow,
  revokeServerTokens,
} from 'src/services/mcp/auth.js'
import {
  CHANNEL_MESSAGE_METHOD,
  ChannelMessageParamsSchema,
  findChannelEntry,
  gateChannelServer,
  wrapChannelMessage,
} from 'src/services/mcp/channelNotification.js'
import {
  areMcpConfigsEqual,
  clearServerCache,
  connectToServer,
  fetchToolsForClient,
  reconnectMcpServerImpl,
} from 'src/services/mcp/client.js'
import {
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getMcpConfigByName,
  isMcpServerDisabled,
} from 'src/services/mcp/config.js'
import {
  buildMcpToolName,
  getMcpPrefix,
} from 'src/services/mcp/mcpStringUtils.js'
import type {
  MCPServerConnection,
  McpSdkServerConfig,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import { commandBelongsToServer } from 'src/services/mcp/utils.js'
import { OAuthService } from 'src/services/oauth/index.js'
import type { Tools, ToolPermissionContext } from 'src/Tool.js'
import type { HookCallbackMatcher } from 'src/types/hooks.js'
import type { Message, NormalizedUserMessage } from 'src/types/message.js'
import type { PermissionMode as InternalPermissionMode } from 'src/types/permissions.js'
import { getAccountInformation } from 'src/utils/auth.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  DEFAULT_SESSION_EFFORT,
  levelSessionEffort,
  resolveHostEffortFlagPatch,
  sessionEffortEquals,
  teSettingsEffortTable,
  unpinAllEffortLaunchPins,
} from 'src/utils/effort.js'
import { errorMessage, toError } from 'src/utils/errors.js'
import {
  applyFastModeOnModelSwitch,
  clearFastModeCooldown,
  getFastModeState,
  isFastModeAvailable,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import {
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
  fileHistoryRewind,
} from 'src/utils/fileHistory.js'
import { oauthLoginOrgUUIDHint } from 'src/utils/forceLoginOrg.js'
import {
  executePostModelSwitchHooks,
  executePreModelSwitchHooks,
} from 'src/utils/hooks.js'
import { logError, logMCPDebug } from 'src/utils/log.js'
import {
  ENTERPRISE_MCP_SET_SERVERS_IGNORE_REASON,
  HERMETIC_MCP_SET_SERVERS_IGNORE_REASON,
  isRemoteHermeticSession,
} from 'src/utils/mcpHermeticFilter.js'
import { enqueue } from 'src/utils/messageQueueManager.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import { decidePrintSetModel } from 'src/utils/model/printSetModel.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  AUTO_GATE_DENIED_TRIGGER,
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
  isBypassPermissionsModeDisabled,
  transitionPermissionMode,
} from 'src/utils/permissions/permissionSetup.js'
import { isRemoteEnvEnabled } from 'src/utils/residualFinalEnvGates.js'
import { isSafeModeEnabled } from 'src/utils/safeMode.js'
import { AwsAuthStatusManager } from 'src/utils/awsAuthStatusManager.js'
import { findUnresolvedToolUse } from 'src/utils/sessionStorage.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from 'src/utils/settings/settings.js'
import { resetSettingsCache } from 'src/utils/settings/settingsCache.js'
import type { Stream } from 'src/utils/stream.js'
import type {
  AppState,
  SessionAppState,
  UIAppState,
} from '../../state/AppStateStore.js'

import type { HeadlessAppState } from '../../Tool.js'

export type { HeadlessAppState }

export type HeadlessSetAppState<TState extends HeadlessAppState = AppState> = (
  f: (prev: TState) => TState,
) => void

export type DynamicMcpState = {
  clients: MCPServerConnection[]
  tools: Tools
  configs: Record<string, ScopedMcpServerConfig>
}

/**
 * State for SDK MCP servers that run in the SDK process.
 */
export type SdkMcpState = {
  configs: Record<string, McpSdkServerConfig>
  clients: MCPServerConnection[]
  tools: Tools
}

/**
 * Result of handleMcpSetServers - contains new state and response data.
 */
export type McpSetServersResult = {
  response: SDKControlMcpSetServersResponse
  newSdkState: SdkMcpState
  newDynamicState: DynamicMcpState
  sdkServersChanged: boolean
}

type McpSetServersToolPolicy = {
  name: string
  permission_policy?: 'always_allow' | 'always_ask' | 'always_deny' | string
  org_max_permission?: 'allow' | 'ask' | 'blocked' | string
}

/**
 * Orchestrates the headless NDJSON control plane: control response emission,
 * model/flag-settings updates, dynamic MCP server reconciliation, and OAuth
 * flows for MCP servers and Anthropic auth.
 */
export const SET_MODEL_CONFIRM_TIMEOUT_MS = 15_000

export async function confirmModelWithTimeout(
  model: string,
  timeoutMs: number = SET_MODEL_CONFIRM_TIMEOUT_MS,
  confirmFn?: (m: string) => Promise<{ valid: boolean; error?: string }>,
): Promise<{ valid: boolean; error?: string; timedOut?: boolean }> {
  const probe =
    confirmFn ??
    (async (m: string) => {
      const { validateModel } = await import('src/utils/model/validateModel.js')
      return validateModel(m)
    })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      probe(model).then(r => ({ ...r, timedOut: false as const })),
      new Promise<{ valid: false; error: string; timedOut: true }>(resolve => {
        timer = setTimeout(() => {
          resolve({
            valid: false,
            error: `Couldn't confirm model "${model}" with the API. Try again.`,
            timedOut: true,
          })
        }, timeoutMs)
      }),
    ])
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export class HeadlessControlPlane {
  // Track active OAuth flows per server so we can abort a previous flow
  // when a new mcp_authenticate request arrives for the same server.
  private readonly activeOAuthFlows = new Map<string, AbortController>()
  // Track manual callback URL submit functions for active OAuth flows.
  // Used when localhost is not reachable (e.g., browser-based IDEs).
  private readonly oauthCallbackSubmitters = new Map<
    string,
    (callbackUrl: string) => void
  >()
  // Track servers where the manual callback was actually invoked (so the
  // automatic reconnect path knows to skip — the extension will reconnect).
  private readonly oauthManualCallbackUsed = new Set<string>()
  // Track OAuth auth-only promises so mcp_oauth_callback_url can await
  // token exchange completion. Reconnect is handled separately by the
  // extension via handleAuthDone → mcp_reconnect.
  private readonly oauthAuthPromises = new Map<string, Promise<void>>()

  // In-flight Anthropic OAuth flow (claude_authenticate). Single-slot: a
  // second authenticate request cleans up the first.
  private claudeOAuth: {
    service: OAuthService
    flow: Promise<void>
  } | null = null

  constructor(
    private readonly deps: {
      output: Stream<StdoutMessage>
      getAppState: () => HeadlessAppState
      setAppState: (f: (prev: HeadlessAppState) => HeadlessAppState) => void
    },
  ) {}

  dispose(): void {
    for (const ac of this.activeOAuthFlows.values()) {
      ac.abort()
    }
    this.activeOAuthFlows.clear()
    this.oauthCallbackSubmitters.clear()
    this.oauthManualCallbackUsed.clear()
    this.oauthAuthPromises.clear()
    this.claudeOAuth?.service.cleanup()
    this.claudeOAuth = null
  }

  sendControlResponseSuccess(
    message: { request_id: string } | SDKControlRequest,
    response?: Record<string, unknown>,
  ): void {
    this.deps.output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response,
      },
    })
  }

  sendControlResponseError(
    message: { request_id: string } | SDKControlRequest,
    errMsg: string,
  ): void {
    this.deps.output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: message.request_id,
        error: errMsg,
      },
    })
  }

  async handleSetModel(
    msg: SDKControlRequest & {
      request: { subtype: 'set_model'; model?: string }
    },
    opts: {
      activeUserSpecifiedModel: string | undefined
      setActiveUserSpecifiedModel: (model: string | undefined) => void
      mutableMessages: Message[]
      injectModelSwitchBreadcrumbs: (
        requestedArg: string,
        resolvedModel: string,
      ) => void
      confirmWithServer?: boolean
      confirmModel?: (m: string) => Promise<{ valid: boolean; error?: string }>
    },
  ): Promise<void> {
    // densable 2.1.212 print set_model (RGf/DGf/h5/Z0 + Ye/HS/session):
    // type check → default trim → recognition → allowlist/step-down →
    // Ye + HS + mainLoopModelForSession + metadata; breadcrumbs only when
    // main model or family actually changes (avoids redundant remote /model).
    const decision = decidePrintSetModel(
      msg.request.model,
      opts.activeUserSpecifiedModel,
    )
    if (!decision.ok) {
      if (decision.analytics === 'invalid_model_type') {
        logEvent('tengu_feature_bad', {
          feature_name:
            'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code:
            'invalid_model_type' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else if (decision.analytics === 'unrecognized_model') {
        logEvent('tengu_set_model_unrecognized', {
          shape: (decision.recognitionShape ??
            'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          had_suggestion: decision.hadSuggestion === true,
          surface:
            'print' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        logEvent('tengu_feature_bad', {
          feature_name:
            'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code:
            'unrecognized_model' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else if (decision.analytics === 'not_allowed') {
        logEvent('tengu_feature_bad', {
          feature_name:
            'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code:
            'not_allowed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else if (decision.analytics === 'denied_by_managed_settings') {
        logEvent('tengu_feature_bad', {
          feature_name:
            'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code:
            'denied_by_managed_settings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      this.sendControlResponseError(msg, decision.error)
      return
    }

    const fromModel = getMainLoopModel()
    const requestedModel =
      decision.requestedArg.trim().toLowerCase() === 'default'
        ? null
        : decision.requestedArg

    if (
      requestedModel !== null &&
      !decision.steppedDown &&
      opts.confirmWithServer !== false &&
      (opts.confirmModel !== undefined ||
        opts.confirmWithServer === true ||
        process.env.NODE_ENV !== 'test')
    ) {
      const confirmation = await confirmModelWithTimeout(
        decision.model,
        SET_MODEL_CONFIRM_TIMEOUT_MS,
        opts.confirmModel,
      )
      if (!confirmation.valid) {
        this.sendControlResponseError(
          msg,
          confirmation.error ??
            `Couldn't confirm model "${decision.model}" with the API. Try again.`,
        )
        return
      }
    }
    const pre = await executePreModelSwitchHooks(
      {
        fromModel,
        toModel: decision.model,
        requestedModel,
        source: 'print',
      },
      opts.mutableMessages,
    )
    if (pre.decision === 'block' || pre.decision === 'ask') {
      this.sendControlResponseError(
        msg,
        pre.reason ?? 'PreModelSwitch hooks blocked the switch',
      )
      return
    }

    opts.setActiveUserSpecifiedModel(decision.model)
    setMainLoopModelOverride(decision.model)
    // densable 2.1.219 #12 / Bcn: mde() on every model switch when fast
    // is enabled so RC clients drop stale cooldown after set_model.
    if (isFastModeEnabled()) {
      clearFastModeCooldown()
    }
    // densable 2.1.218 #31 — print/SDK set_model also runs uU/dU (MB)
    // Official 2.1.299 (#605) — exit auto mode when the new model doesn't support it
    this.deps.setAppState(prev => {
      const applied = applyFastModeOnModelSwitch(decision.model, prev.fastMode)
      let nextToolPermissionContext = prev.toolPermissionContext
      if (
        feature('TRANSCRIPT_CLASSIFIER') &&
        prev.toolPermissionContext.mode === 'auto'
      ) {
        let gateOk = true
        try {
          gateOk = isAutoModeGateEnabled()
        } catch {
          gateOk = false
        }
        if (!gateOk) {
          const transitioned = transitionPermissionMode(
            'auto',
            'default',
            prev.toolPermissionContext,
            AUTO_GATE_DENIED_TRIGGER,
          )
          nextToolPermissionContext = {
            ...transitioned,
            mode: 'default',
          }
        }
      }
      return {
        ...prev,
        mainLoopModelForSession: decision.model,
        ...(applied.changed ? { fastMode: applied.nextFastMode } : null),
        ...(nextToolPermissionContext !== prev.toolPermissionContext
          ? { toolPermissionContext: nextToolPermissionContext }
          : null),
      }
    })
    const { notifySessionMetadataChanged } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/sessionState.js') as typeof import('src/utils/sessionState.js')
    notifySessionMetadataChanged({ model: decision.model })
    if (decision.injectBreadcrumbs) {
      opts.injectModelSwitchBreadcrumbs(decision.requestedArg, decision.model)
    }
    if (decision.steppedDown) {
      logEvent('tengu_feature_sad', {
        feature_name:
          'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'family_alias_stepped_down' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      logEvent('tengu_feature_ok', {
        feature_name:
          'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    executePostModelSwitchHooks(
      {
        fromModel,
        toModel: decision.model,
        requestedModel,
        source: 'print',
      },
      opts.mutableMessages,
    )
    this.sendControlResponseSuccess(msg)
  }

  handleApplyFlagSettings(
    msg: SDKControlRequest & {
      request: {
        subtype: 'apply_flag_settings'
        settings: Record<string, unknown>
      }
    },
    opts: {
      setActiveUserSpecifiedModel: (model: string | undefined) => void
      injectModelSwitchBreadcrumbs: (
        requestedArg: string,
        resolvedModel: string,
      ) => void
    },
  ): void {
    // Snapshot the current model before applying — we need to detect
    // model switches so we can inject breadcrumbs and notify listeners.
    const prevModel = getMainLoopModel()

    // Merge the provided settings into the in-memory flag settings
    const existing = getFlagSettingsInline() ?? {}
    const incoming = msg.request.settings
    // Shallow-merge top-level keys; getSettingsForSource handles
    // the deep merge with file-based flag settings via mergeWith.
    // JSON serialization drops `undefined`, so callers use `null`
    // to signal "clear this key". Convert nulls to deletions so
    // SettingsSchema().safeParse() doesn't reject the whole object
    // (z.string().optional() accepts string | undefined, not null).
    const merged = { ...existing, ...incoming }
    for (const key of Object.keys(merged)) {
      if (merged[key as keyof typeof merged] === null) {
        delete merged[key as keyof typeof merged]
      }
    }
    setFlagSettingsInline(merged)

    // densable 211 review: apply model override BEFORE notifyChange so
    // applySettingsChange (settings → AppState effort/ultracode sync)
    // resolves ultracode wire against the post-switch model via
    // getMainLoopModel(), not the pre-packet model. Direct
    // resolveHostEffortFlagPatch below still finalizes AppState.
    // Override has higher priority than the settings cascade in
    // getUserSpecifiedModelSetting() (matching set_model).
    if ('model' in incoming) {
      if (incoming.model != null) {
        setMainLoopModelOverride(String(incoming.model))
      } else {
        setMainLoopModelOverride(undefined)
      }
    }

    // Route through notifyChange so fanOut() resets the settings cache
    // before listeners run.
    settingsChangeDetector.notifyChange('flagSettings')

    // If the model changed, inject breadcrumbs so the model sees the
    // mid-conversation switch, and notify metadata listeners (CCR).
    const newModel = getMainLoopModel()
    if (newModel !== prevModel) {
      opts.setActiveUserSpecifiedModel(newModel)
      const modelArg = incoming.model ? String(incoming.model) : 'default'
      const { notifySessionMetadataChanged } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/sessionState.js') as typeof import('src/utils/sessionState.js')
      notifySessionMetadataChanged({ model: newModel })
      opts.injectModelSwitchBreadcrumbs(modelArg, newModel)
    }

    // densable apply_flag: effortLevel / ultracode write AppState directly
    // (M9/UBn + XLr ultracode + N9), not only via settings disk sync.
    const effortModel = newModel
    let effortNotes: ReturnType<typeof resolveHostEffortFlagPatch>['notes']
    if ('effortLevel' in incoming || 'ultracode' in incoming) {
      const patch = resolveHostEffortFlagPatch({
        model: effortModel,
        effortLevel: incoming.effortLevel,
        hasEffortLevel: 'effortLevel' in incoming,
        ultracode: incoming.ultracode,
        hasUltracode: 'ultracode' in incoming,
      })
      effortNotes = patch.notes
      if (
        patch.clearEffort ||
        patch.effortValue !== undefined ||
        patch.ultracode !== undefined
      ) {
        this.deps.setAppState(prev => {
          let next = prev
          if (patch.clearEffort) {
            if (
              !sessionEffortEquals(next.sessionEffort, DEFAULT_SESSION_EFFORT)
            ) {
              next = {
                ...next,
                sessionEffort: DEFAULT_SESSION_EFFORT,
                settingsEffortTable:
                  teSettingsEffortTable() ?? next.settingsEffortTable,
              }
            }
          }
          if (patch.effortValue !== undefined) {
            const targetSessionEffort = levelSessionEffort(patch.effortValue)
            if (!sessionEffortEquals(next.sessionEffort, targetSessionEffort)) {
              next = {
                ...next,
                sessionEffort: targetSessionEffort,
                settingsEffortTable:
                  teSettingsEffortTable() ?? next.settingsEffortTable,
              }
            }
          }
          if (patch.ultracode !== undefined) {
            if (next.ultracode !== patch.ultracode) {
              next = { ...next, ultracode: patch.ultracode }
            }
          }
          return next
        })
      }
      if (patch.unpin) {
        unpinAllEffortLaunchPins()
      }
    }

    // Always success for apply_flag_settings (incl. soft ultracode
    // refusals). Hosts that need explicit no-wire feedback read
    // response.effortNotes and/or re-query get_settings.applied.
    this.sendControlResponseSuccess(
      msg,
      effortNotes && effortNotes.length > 0 ? { effortNotes } : undefined,
    )
  }

  async handleMcpSetServersRequest(
    msg: SDKControlRequest & {
      request: {
        subtype: 'mcp_set_servers'
        servers: Record<string, unknown>
      }
    },
    opts: {
      applyMcpServerChanges: (
        servers: Record<string, McpServerConfigForProcessTransport>,
      ) => Promise<{
        response: SDKControlMcpSetServersResponse
        sdkServersChanged: boolean
      }>
      updateSdkMcp: () => Promise<void>
      workSecretSession?: { resyncProjectsReplyMount: () => void } | null
      hearthMount?: {
        sync: (reason: 'binding_changed') => Promise<void>
      } | null
    },
  ): Promise<void> {
    // densable: if hint===HEARTH_BINDING_CHANGED_HINT, sync hearth
    // reply mount(s) with binding_changed; empty servers short-circuit.
    const { HEARTH_BINDING_CHANGED_HINT } = await import(
      'src/bridge/hearthBinding.js'
    )
    const hearthHint = (msg.request as { hint?: string }).hint
    if (hearthHint === HEARTH_BINDING_CHANGED_HINT) {
      opts.workSecretSession?.resyncProjectsReplyMount()
      void opts.hearthMount?.sync('binding_changed')
      const servers = msg.request.servers as Record<string, unknown>
      if (
        servers !== null &&
        typeof servers === 'object' &&
        !Array.isArray(servers) &&
        Object.keys(servers).length === 0
      ) {
        this.sendControlResponseSuccess(msg, {
          added: [],
          removed: [],
          errors: {},
        })
        return
      }
    }
    const { response, sdkServersChanged } = await opts.applyMcpServerChanges(
      msg.request.servers as Record<string, McpServerConfigForProcessTransport>,
    )
    this.sendControlResponseSuccess(msg, response)

    // Connect SDK servers AFTER response to avoid deadlock
    if (sdkServersChanged) {
      void opts.updateSdkMcp()
    }
  }

  async handleMcpAuthenticate(
    msg: SDKControlRequest,
    req: Record<string, unknown>,
    opts: {
      mcpClients: MCPServerConnection[]
      withControlReconnect: <T>(
        serverName: string,
        fn: () => Promise<T>,
      ) => Promise<T>
      onDynamicMcpStateUpdate: (
        serverName: string,
        client: MCPServerConnection,
        tools: Tools,
      ) => void
    },
  ): Promise<void> {
    const serverName = req.serverName as string
    const currentAppState = this.deps.getAppState()
    const config =
      getMcpConfigByName(serverName) ??
      opts.mcpClients.find(c => c.name === serverName)?.config ??
      currentAppState.mcp.clients.find(c => c.name === serverName)?.config ??
      null
    if (!config) {
      this.sendControlResponseError(msg, `Server not found: ${serverName}`)
      return
    }
    if (config.type !== 'sse' && config.type !== 'http') {
      this.sendControlResponseError(
        msg,
        `Server type "${config.type}" does not support OAuth authentication`,
      )
      return
    }

    try {
      // Abort any previous in-flight OAuth flow for this server
      this.activeOAuthFlows.get(serverName)?.abort()
      const controller = new AbortController()
      this.activeOAuthFlows.set(serverName, controller)

      // Capture the auth URL from the callback
      let resolveAuthUrl: (url: string) => void
      const authUrlPromise = new Promise<string>(resolve => {
        resolveAuthUrl = resolve
      })

      // Start the OAuth flow in the background
      const oauthPromise = performMCPOAuthFlow(
        serverName,
        config,
        url => resolveAuthUrl!(url),
        controller.signal,
        {
          skipBrowserOpen: true,
          onWaitingForCallback: submit => {
            this.oauthCallbackSubmitters.set(serverName, submit)
          },
        },
      )

      // Wait for the auth URL (or the flow to complete without needing redirect)
      const authUrl = await Promise.race([
        authUrlPromise,
        oauthPromise.then(() => null as string | null),
      ])

      if (authUrl) {
        this.sendControlResponseSuccess(msg, {
          authUrl,
          requiresUserAction: true,
        })
      } else {
        this.sendControlResponseSuccess(msg, {
          requiresUserAction: false,
        })
      }

      // Store auth-only promise for mcp_oauth_callback_url handler.
      this.oauthAuthPromises.set(serverName, oauthPromise)

      // Handle background completion — reconnect after auth.
      const fullFlowPromise = oauthPromise
        .then(async () => {
          // Don't reconnect if the server was disabled during the OAuth flow
          if (isMcpServerDisabled(serverName)) {
            return
          }
          // Skip reconnect if the manual callback path was used —
          // handleAuthDone will do it via mcp_reconnect.
          if (this.oauthManualCallbackUsed.has(serverName)) {
            return
          }
          // Reconnect the server after successful auth
          const result = await opts.withControlReconnect(serverName, () =>
            reconnectMcpServerImpl(serverName, config),
          )
          const prefix = getMcpPrefix(serverName)
          this.deps.setAppState(prev => ({
            ...prev,
            mcp: {
              ...prev.mcp,
              clients: prev.mcp.clients.map(c =>
                c.name === serverName ? result.client : c,
              ),
              tools: [
                ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
                ...result.tools,
              ],
              commands: [
                ...reject(prev.mcp.commands, c =>
                  commandBelongsToServer(c, serverName),
                ),
                ...result.commands,
              ],
              resources:
                result.resources && result.resources.length > 0
                  ? {
                      ...prev.mcp.resources,
                      [serverName]: result.resources,
                    }
                  : omit(prev.mcp.resources, serverName),
            },
          }))
          opts.onDynamicMcpStateUpdate(serverName, result.client, result.tools)
        })
        .catch(error => {
          logForDebugging(`MCP OAuth failed for ${serverName}: ${error}`, {
            level: 'error',
          })
        })
        .finally(() => {
          // Clean up only if this is still the active flow
          if (this.activeOAuthFlows.get(serverName) === controller) {
            this.activeOAuthFlows.delete(serverName)
            this.oauthCallbackSubmitters.delete(serverName)
            this.oauthManualCallbackUsed.delete(serverName)
            this.oauthAuthPromises.delete(serverName)
          }
        })
      void fullFlowPromise
    } catch (error) {
      this.sendControlResponseError(msg, errorMessage(error))
    }
  }

  async handleMcpOAuthCallbackUrl(
    msg: SDKControlRequest,
    req: Record<string, unknown>,
  ): Promise<void> {
    const serverName = req.serverName as string
    const callbackUrl = req.callbackUrl as string
    const submit = this.oauthCallbackSubmitters.get(serverName)
    if (!submit) {
      this.sendControlResponseError(
        msg,
        `No active OAuth flow for server: ${serverName}`,
      )
      return
    }

    // Validate the callback URL before submitting. The submit
    // callback in auth.ts silently ignores URLs missing a code
    // param, which would leave the auth promise unresolved and
    // block the control message loop until timeout.
    let hasCodeOrError = false
    try {
      const parsed = new URL(callbackUrl as string | URL)
      hasCodeOrError =
        parsed.searchParams.has('code') || parsed.searchParams.has('error')
    } catch {
      // Invalid URL
    }
    if (!hasCodeOrError) {
      this.sendControlResponseError(
        msg,
        'Invalid callback URL: missing authorization code. Please paste the full redirect URL including the code parameter.',
      )
      return
    }

    this.oauthManualCallbackUsed.add(serverName)
    submit(callbackUrl)
    // Wait for auth (token exchange) to complete before responding.
    const authPromise = this.oauthAuthPromises.get(serverName)
    if (authPromise) {
      try {
        await authPromise
        this.sendControlResponseSuccess(msg)
      } catch (error) {
        this.sendControlResponseError(
          msg,
          error instanceof Error
            ? error.message
            : 'OAuth authentication failed',
        )
      }
    } else {
      this.sendControlResponseSuccess(msg)
    }
  }

  async handleClaudeAuthenticate(
    msg: SDKControlRequest,
    req: Record<string, unknown>,
    opts: {
      headlessMcpIdentityBoundary: {
        refresh: () => Promise<void> | undefined
      }
    },
  ): Promise<void> {
    const loginWithClaudeAi = req.loginWithClaudeAi as boolean | undefined

    // densable Stt(Fr??!0) — refuse when enterprise forceLoginMethod pin mismatches
    const { validateForcedLoginMethod } = await import(
      'src/utils/forceLoginMethod.js'
    )
    const forcePin = validateForcedLoginMethod(loginWithClaudeAi ?? true)
    if (!forcePin.valid) {
      logEvent('tengu_sdk_claude_authenticate_force_login_method_refused', {})
      this.sendControlResponseError(msg, forcePin.message)
      return
    }

    // Clean up any prior flow.
    this.claudeOAuth?.service.cleanup()

    logEvent('tengu_oauth_flow_start', {
      loginWithClaudeAi: (loginWithClaudeAi ?? true) as boolean | number,
    })

    const service = new OAuthService()
    const { getInitialSettings } = await import(
      'src/utils/settings/settings.js'
    )
    const authSettings = getInitialSettings()
    const wantsClaudeAi = loginWithClaudeAi ?? true
    const methodMismatch =
      authSettings.forceLoginMethod !== undefined &&
      wantsClaudeAi !== (authSettings.forceLoginMethod === 'claudeai')
    const orgUUID = oauthLoginOrgUUIDHint(
      authSettings.forceLoginOrgUUID,
      methodMismatch,
    )
    let urlResolver!: (urls: {
      manualUrl: string
      automaticUrl: string
    }) => void
    const urlPromise = new Promise<{
      manualUrl: string
      automaticUrl: string
    }>(resolve => {
      urlResolver = resolve
    })

    const flow = service
      .startOAuthFlow(
        async (manualUrl, automaticUrl) => {
          urlResolver({ manualUrl, automaticUrl: automaticUrl! })
        },
        {
          loginWithClaudeAi: loginWithClaudeAi ?? true,
          skipBrowserOpen: true,
          orgUUID,
        },
      )
      .then(async tokens => {
        await installOAuthTokens(tokens)
        // Official 2.1.325 `Gm` (#1317): refresh organization policy limits
        // after SDK/VS Code `claude_authenticate` login (remote managed
        // settings cache is product-cut per settings.ts:186).
        const { refreshPolicyLimits } = await import(
          'src/services/policyLimits/index.js'
        )
        void refreshPolicyLimits().catch(err =>
          logForDebugging(
            `claude_authenticate: the policy refresh threw (${errorMessage(err)})`,
            { level: 'error' },
          ),
        )
        const connectorMounted = opts.headlessMcpIdentityBoundary.refresh()
        if (connectorMounted) {
          await Promise.race([
            connectorMounted,
            new Promise<void>(resolve => {
              const timer = setTimeout(resolve, 1000)
              timer.unref?.()
            }),
          ])
        }
        logEvent('tengu_oauth_success', {
          loginWithClaudeAi: (loginWithClaudeAi ?? true) as boolean | number,
        })
      })
      .finally(() => {
        service.cleanup()
        if (this.claudeOAuth?.service === service) {
          this.claudeOAuth = null
        }
      })

    this.claudeOAuth = { service, flow }

    void flow.catch(err =>
      logForDebugging(`claude_authenticate flow ended: ${err}`, {
        level: 'info',
      }),
    )

    try {
      const { manualUrl, automaticUrl } = await Promise.race([
        urlPromise,
        flow.then(() => {
          throw new Error('OAuth flow completed without producing auth URLs')
        }),
      ])
      this.sendControlResponseSuccess(msg, {
        manualUrl,
        automaticUrl,
      })
    } catch (error) {
      this.sendControlResponseError(msg, errorMessage(error))
    }
  }

  handleClaudeOAuthCallbackOrWait(
    msg: SDKControlRequest,
    req: Record<string, unknown>,
  ): void {
    if (!this.claudeOAuth) {
      this.sendControlResponseError(msg, 'No active claude_authenticate flow')
      return
    }

    if (req.subtype === 'claude_oauth_callback') {
      this.claudeOAuth.service.handleManualAuthCodeInput({
        authorizationCode: req.authorizationCode as string,
        state: req.state as string,
      })
    }
    const { flow } = this.claudeOAuth
    void flow.then(
      () => {
        const accountInfo = getAccountInformation()
        this.sendControlResponseSuccess(msg, {
          account: {
            email: accountInfo?.email,
            organization: accountInfo?.organization,
            subscriptionType: accountInfo?.subscription,
            tokenSource: accountInfo?.tokenSource,
            apiKeySource: accountInfo?.apiKeySource,
            apiProvider: getAPIProvider(),
          },
        })
      },
      (error: unknown) =>
        this.sendControlResponseError(msg, errorMessage(error)),
    )
  }

  async handleMcpClearAuth(
    msg: SDKControlRequest,
    req: Record<string, unknown>,
    opts: {
      mcpClients: MCPServerConnection[]
      withControlReconnect: <T>(
        serverName: string,
        fn: () => Promise<T>,
      ) => Promise<T>
    },
  ): Promise<void> {
    const serverName = req.serverName as string
    const currentAppState = this.deps.getAppState()
    const config =
      getMcpConfigByName(serverName) ??
      opts.mcpClients.find(c => c.name === serverName)?.config ??
      currentAppState.mcp.clients.find(c => c.name === serverName)?.config ??
      null
    if (!config) {
      this.sendControlResponseError(msg, `Server not found: ${serverName}`)
      return
    }
    if (config.type !== 'sse' && config.type !== 'http') {
      this.sendControlResponseError(
        msg,
        `Cannot clear auth for server type "${config.type}"`,
      )
      return
    }

    await revokeServerTokens(serverName, config)
    const result = await opts.withControlReconnect(serverName, () =>
      reconnectMcpServerImpl(serverName, config),
    )
    const prefix = getMcpPrefix(serverName)
    this.deps.setAppState(prev => ({
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: prev.mcp.clients.map(c =>
          c.name === serverName ? result.client : c,
        ),
        tools: [
          ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
          ...result.tools,
        ],
        commands: [
          ...reject(prev.mcp.commands, c =>
            commandBelongsToServer(c, serverName),
          ),
          ...result.commands,
        ],
        resources:
          result.resources && result.resources.length > 0
            ? {
                ...prev.mcp.resources,
                [serverName]: result.resources,
              }
            : omit(prev.mcp.resources, serverName),
      },
    }))
    this.sendControlResponseSuccess(msg, {})
  }
}

/**
 * densable inl — full initialize payload for first init and reinit redelivery.
 */
export async function buildSdkInitializeResponse(
  commands: Command[],
  agents: AgentDefinition[],
  modelInfos: ModelInfo[],
  options: { userSpecifiedModel?: string | undefined },
  getAppState: () => HeadlessAppState,
): Promise<SDKControlInitializeResponse> {
  const settings = getSettings_DEPRECATED()
  const outputStyle = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME
  const availableOutputStyles = await getAllOutputStyles(getCwd())
  const accountInfo = getAccountInformation()
  const initResponse: SDKControlInitializeResponse = {
    commands: commands
      .filter(cmd => cmd.userInvocable !== false)
      .map(cmd => ({
        name: getCommandName(cmd),
        description: formatDescriptionWithSource(cmd),
        argumentHint: cmd.argumentHint || '',
      })),
    agents: agents.map(agent => ({
      name: agent.agentType,
      description: agent.whenToUse,
      // 'inherit' is an internal sentinel; normalize to undefined for the public API
      model: agent.model === 'inherit' ? undefined : agent.model,
    })),
    output_style: outputStyle,
    available_output_styles: Object.keys(availableOutputStyles),
    models: modelInfos as unknown as SDKControlInitializeResponse['models'],
    account: {
      email: accountInfo?.email,
      organization: accountInfo?.organization,
      subscriptionType: accountInfo?.subscription,
      tokenSource: accountInfo?.tokenSource,
      apiKeySource: accountInfo?.apiKeySource,
      // getAccountInformation() returns undefined under 3P providers, so the
      // other fields are all absent. apiProvider disambiguates "not logged
      // in" (firstParty + tokenSource:none) from "3P, login not applicable".
      apiProvider: getAPIProvider() as
        | 'firstParty'
        | 'bedrock'
        | 'vertex'
        | 'foundry',
    },
    pid: process.pid,
  }

  if (isFastModeEnabled() && isFastModeAvailable()) {
    const appState = getAppState()
    initResponse.fast_mode_state = getFastModeState(
      options.userSpecifiedModel ?? null,
      appState.fastMode,
    )
  }
  return initResponse
}

export async function handleInitializeRequest(
  request: SDKControlInitializeRequest,
  requestId: string,
  initialized: boolean,
  output: Stream<StdoutMessage>,
  commands: Command[],
  modelInfos: ModelInfo[],
  structuredIO: StructuredIO,
  enableAuthStatus: boolean,
  options: {
    systemPrompt: string | undefined
    appendSystemPrompt: string | undefined
    agent?: string | undefined
    userSpecifiedModel?: string | undefined
    [key: string]: unknown
  },
  agents: AgentDefinition[],
  getAppState: () => HeadlessAppState,
): Promise<void> {
  // densable 2.1.216 #5 / l1S: re-initialize after web idle returns **success**
  // with full init payload + pending permission/dialog requests so the host
  // redelivers AskUserQuestion / permission UI instead of re-asking or
  // dropping the answer. Pre-216 error "Already initialized" broke CCR web.
  if (initialized) {
    const {
      buildReinitSuccessResponse,
      reinitRedeliveryTelemetry,
      TENG_U_REINIT_PENDING_REDELIVERY,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/sdkReinitRedelivery.js') as typeof import('src/utils/sdkReinitRedelivery.js')
    const pendingPermissionRequests =
      structuredIO.getPendingPermissionRequests()
    const pendingUserDialogRequests =
      structuredIO.getPendingUserDialogRequests()
    logEvent(
      TENG_U_REINIT_PENDING_REDELIVERY,
      reinitRedeliveryTelemetry(
        pendingPermissionRequests.length,
        pendingUserDialogRequests.length,
      ),
    )
    const initResponse = await buildSdkInitializeResponse(
      commands,
      agents,
      modelInfos,
      options,
      getAppState,
    )
    output.enqueue({
      type: 'control_response',
      response: buildReinitSuccessResponse({
        requestId,
        initResponse: initResponse as unknown as Record<string, unknown>,
        pendingPermissionRequests,
        pendingUserDialogRequests,
      }),
    })
    return
  }

  // Apply systemPrompt/appendSystemPrompt from stdin to avoid ARG_MAX limits
  if (request.systemPrompt !== undefined) {
    options.systemPrompt = request.systemPrompt
  }
  if (request.appendSystemPrompt !== undefined) {
    options.appendSystemPrompt = request.appendSystemPrompt
  }
  if (request.promptSuggestions !== undefined) {
    options.promptSuggestions = request.promptSuggestions
  }

  // Merge agents from stdin to avoid ARG_MAX limits
  if (request.agents) {
    const stdinAgents = parseAgentsFromJson(request.agents, 'flagSettings')
    agents.push(...stdinAgents)
  }

  // Re-evaluate main thread agent after SDK agents are merged
  if (options.agent) {
    const alreadyResolved = getMainThreadAgentType() === options.agent
    const mainThreadAgent = agents.find(a => a.agentType === options.agent)
    if (mainThreadAgent && !alreadyResolved) {
      setMainThreadAgentType(mainThreadAgent.agentType)

      if (!options.systemPrompt && !isBuiltInAgent(mainThreadAgent)) {
        const agentSystemPrompt = mainThreadAgent.getSystemPrompt()
        if (agentSystemPrompt) {
          options.systemPrompt = agentSystemPrompt
        }
      }

      if (
        !options.userSpecifiedModel &&
        mainThreadAgent.model &&
        mainThreadAgent.model !== 'inherit'
      ) {
        const agentModel = parseUserSpecifiedModel(mainThreadAgent.model)
        setMainLoopModelOverride(agentModel)
      }

      if (mainThreadAgent.initialPrompt) {
        structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)
      }
    } else if (mainThreadAgent?.initialPrompt) {
      structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)
    }
  }

  if (request.hooks) {
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}
    for (const [event, matchers] of Object.entries(request.hooks) as [
      string,
      Array<{ hookCallbackIds: string[]; timeout?: number; matcher?: string }>,
    ][]) {
      hooks[event as HookEvent] = matchers.map(matcher => {
        const callbacks = matcher.hookCallbackIds.map(callbackId => {
          return structuredIO.createHookCallback(callbackId, matcher.timeout)
        })
        return {
          matcher: matcher.matcher,
          hooks: callbacks,
        }
      })
    }
    registerHookCallbacks(hooks)
  }
  if (request.jsonSchema) {
    setInitJsonSchema(request.jsonSchema)
  }
  if (request.supportedDialogKinds !== undefined) {
    try {
      const { sanitizeDeclaredDialogKinds } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/userDialog.js') as typeof import('src/utils/userDialog.js')
      const kinds = sanitizeDeclaredDialogKinds(request.supportedDialogKinds)
      setSdkSupportedDialogKinds(
        kinds.length > 0 ? kinds : undefined,
        'initialize',
      )
    } catch {
      // densable optional
    }
  }
  const initResponse = await buildSdkInitializeResponse(
    commands,
    agents,
    modelInfos,
    options,
    getAppState,
  )

  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: initResponse,
    },
  })

  if (enableAuthStatus) {
    const authStatusManager = AwsAuthStatusManager.getInstance()
    const status = authStatusManager.getStatus()
    if (status) {
      output.enqueue({
        type: 'auth_status',
        isAuthenticating: status.isAuthenticating,
        output: status.output,
        error: status.error,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    }
  }
}

export async function handleRewindFiles<
  TState extends HeadlessAppState = AppState,
>(
  userMessageId: UUID,
  appState: HeadlessAppState,
  setAppState: HeadlessSetAppState<TState>,
  dryRun: boolean,
): Promise<RewindFilesResult> {
  if (!fileHistoryEnabled()) {
    return {
      canRewind: false,
      error: 'File rewinding is not enabled.',
      filesChanged: [],
    }
  }
  if (!fileHistoryCanRestore(appState.fileHistory, userMessageId)) {
    return {
      canRewind: false,
      error: 'No file checkpoint found for this message.',
      filesChanged: [],
    }
  }

  if (dryRun) {
    const diffStats = await fileHistoryGetDiffStats(
      appState.fileHistory,
      userMessageId,
    )
    return {
      canRewind: true,
      filesChanged: diffStats?.filesChanged ?? [],
      insertions: diffStats?.insertions,
      deletions: diffStats?.deletions,
    }
  }

  const setHeadlessAppState = setAppState as unknown as (
    f: (prev: HeadlessAppState) => HeadlessAppState,
  ) => void
  try {
    // densable: real rewind returns filesChanged + skippedLinks (dryRun omits)
    const { filesChanged, skippedLinks } = await fileHistoryRewind(
      updater =>
        setHeadlessAppState(prev => ({
          ...prev,
          fileHistory: updater(prev.fileHistory),
        })),
      userMessageId,
    )
    return {
      canRewind: true,
      filesChanged,
      skippedLinks,
    }
  } catch (error) {
    return {
      canRewind: false,
      error: `Failed to rewind: ${errorMessage(error)}`,
      filesChanged: [],
    }
  }
}

export function handleSetPermissionMode(
  request: { mode: InternalPermissionMode },
  requestId: string,
  toolPermissionContext: ToolPermissionContext,
  output: Stream<StdoutMessage>,
): ToolPermissionContext {
  // Check if trying to switch to bypassPermissions mode
  if (request.mode === 'bypassPermissions') {
    if (isBypassPermissionsModeDisabled()) {
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error:
            'Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration',
        },
      })
      return toolPermissionContext
    }
    if (!toolPermissionContext.isBypassPermissionsModeAvailable) {
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error:
            'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions',
        },
      })
      return toolPermissionContext
    }
  }

  // Check if trying to switch to auto mode without the classifier gate
  if (feature('TRANSCRIPT_CLASSIFIER') && request.mode === 'auto') {
    // #435: Re-read settings if gated out so removing disableAutoMode from
    // settings.json takes effect immediately without restarting the session.
    if (!isAutoModeGateEnabled()) {
      resetSettingsCache()
    }
    if (!isAutoModeGateEnabled()) {
      const reason = getAutoModeUnavailableReason()
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error: reason
            ? `Cannot set permission mode to auto: ${getAutoModeUnavailableNotification(reason)}`
            : 'Cannot set permission mode to auto',
        },
      })
      return toolPermissionContext
    }
  }

  // Allow the mode switch
  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        mode: request.mode,
      },
    },
  })

  return {
    ...transitionPermissionMode(
      toolPermissionContext.mode,
      request.mode,
      toolPermissionContext,
    ),
    mode: request.mode,
  }
}

export function handleChannelEnable(
  requestId: string,
  serverName: string,
  connectionPool: readonly MCPServerConnection[],
  output: Stream<StdoutMessage>,
): void {
  const respondError = (error: string) =>
    output.enqueue({
      type: 'control_response',
      response: { subtype: 'error', request_id: requestId, error },
    })

  if (!(feature('KAIROS') || feature('KAIROS_CHANNELS'))) {
    return respondError('channels feature not available in this build')
  }

  const connection = connectionPool.find(
    c => c.name === serverName && c.type === 'connected',
  )
  if (!connection || connection.type !== 'connected') {
    return respondError(`server ${serverName} is not connected`)
  }

  const pluginSource = connection.config.pluginSource
  const parsed = pluginSource ? parsePluginIdentifier(pluginSource) : undefined
  if (!parsed?.marketplace) {
    return respondError(
      `server ${serverName} is not plugin-sourced; channel_enable requires a marketplace plugin`,
    )
  }

  const entry: ChannelEntry = {
    kind: 'plugin',
    name: parsed.name,
    marketplace: parsed.marketplace,
  }
  const prior = getAllowedChannels()
  const already = prior.some(
    e =>
      e.kind === 'plugin' &&
      e.name === entry.name &&
      e.marketplace === entry.marketplace,
  )
  if (!already) setAllowedChannels([...prior, entry])

  const gate = gateChannelServer(
    serverName,
    connection.capabilities,
    pluginSource,
    connection.protocolEra,
  )
  if (gate.action === 'skip') {
    if (!already) setAllowedChannels(prior)
    return respondError(gate.reason)
  }

  const pluginId =
    `${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  logMCPDebug(serverName, 'Channel notifications registered')
  logEvent('tengu_mcp_channel_enable', { plugin: pluginId })

  connection.client.setNotificationHandler(
    CHANNEL_MESSAGE_METHOD,
    { params: ChannelMessageParamsSchema() },
    async params => {
      const { content, meta } = params
      logMCPDebug(
        serverName,
        `notifications/claude/channel: ${content.slice(0, 80)}`,
      )
      logEvent('tengu_mcp_channel_message', {
        content_length: content.length,
        meta_key_count: Object.keys(meta ?? {}).length,
        entry_kind:
          'plugin' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_dev: false,
        plugin: pluginId,
      })
      enqueue({
        mode: 'prompt',
        value: wrapChannelMessage(serverName, content, meta),
        priority: 'next',
        isMeta: true,
        origin: { kind: 'channel', server: serverName },
        skipSlashCommands: true,
        skipAttachments: true,
      })
    },
  )

  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: undefined,
    },
  })
}

export function reregisterChannelHandlerAfterReconnect(
  connection: MCPServerConnection,
): void {
  if (connection.type !== 'connected') return

  const gate = gateChannelServer(
    connection.name,
    connection.capabilities,
    connection.config.pluginSource,
    connection.protocolEra,
  )
  if (gate.action !== 'register') return

  const entry = findChannelEntry(connection.name, getAllowedChannels())
  const pluginId =
    entry?.kind === 'plugin'
      ? (`${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : undefined

  logMCPDebug(
    connection.name,
    'Channel notifications re-registered after reconnect',
  )
  connection.client.setNotificationHandler(
    CHANNEL_MESSAGE_METHOD,
    { params: ChannelMessageParamsSchema() },
    async params => {
      const { content, meta } = params
      logMCPDebug(
        connection.name,
        `notifications/claude/channel: ${content.slice(0, 80)}`,
      )
      logEvent('tengu_mcp_channel_message', {
        content_length: content.length,
        meta_key_count: Object.keys(meta ?? {}).length,
        entry_kind:
          entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_dev: entry?.dev ?? false,
        plugin: pluginId,
      })
      enqueue({
        mode: 'prompt',
        value: wrapChannelMessage(connection.name, content, meta),
        priority: 'next',
        isMeta: true,
        origin: {
          kind: 'channel',
          server: connection.name,
        },
        skipSlashCommands: true,
        skipAttachments: true,
      })
    },
  )
}

/**
 * Handles unexpected permission responses by looking up the unresolved tool
 * call in the transcript and enqueuing it for execution.
 *
 * Returns true if a permission was enqueued, false otherwise.
 */
export async function handleOrphanedPermissionResponse<
  TState extends HeadlessAppState = AppState,
>({
  message,
  setAppState: _setAppState,
  onEnqueued,
  handledToolUseIds,
}: {
  message: SDKControlResponse
  setAppState: HeadlessSetAppState<TState>
  onEnqueued?: () => void
  handledToolUseIds: Set<string>
}): Promise<boolean> {
  const responseInner = message.response as
    | {
        subtype?: string
        response?: Record<string, unknown>
        request_id?: string
      }
    | undefined
  if (
    responseInner?.subtype === 'success' &&
    responseInner.response?.toolUseID &&
    typeof responseInner.response.toolUseID === 'string'
  ) {
    const permissionResult = responseInner.response as PermissionResult & {
      toolUseID?: string
    }
    const toolUseID = permissionResult.toolUseID
    if (!toolUseID) {
      return false
    }

    logForDebugging(
      `handleOrphanedPermissionResponse: received orphaned control_response for toolUseID=${toolUseID} request_id=${responseInner.request_id}`,
    )

    if (handledToolUseIds.has(toolUseID)) {
      logForDebugging(
        `handleOrphanedPermissionResponse: skipping duplicate orphaned permission for toolUseID=${toolUseID} (already handled)`,
      )
      return false
    }

    const assistantMessage = await findUnresolvedToolUse(toolUseID)
    if (!assistantMessage) {
      logForDebugging(
        `handleOrphanedPermissionResponse: no unresolved tool_use found for toolUseID=${toolUseID} (already resolved in transcript)`,
      )
      return false
    }

    if ((assistantMessage as Record<string, unknown>).isSidechain) {
      logForDebugging(
        `handleOrphanedPermissionResponse: skipping orphaned permission for toolUseID=${toolUseID} (belongs to a cancelled subagent)`,
      )
      return false
    }

    handledToolUseIds.add(toolUseID)
    logForDebugging(
      `handleOrphanedPermissionResponse: enqueuing orphaned permission for toolUseID=${toolUseID} messageID=${assistantMessage.message.id}`,
    )
    enqueue({
      mode: 'orphaned-permission' as const,
      value: [],
      orphanedPermission: {
        permissionResult,
        assistantMessage,
      },
    })

    onEnqueued?.()
    return true
  }
  return false
}

function toolPermissionsFromSetServersTools(
  tools:
    | ReadonlyArray<{
        name: string
        org_max_permission?: 'allow' | 'ask' | 'blocked' | string
      }>
    | undefined,
): Record<string, 'allow' | 'ask' | 'blocked'> | undefined {
  if (!tools?.length) return undefined
  const out = Object.create(null) as Record<string, 'allow' | 'ask' | 'blocked'>
  for (const t of tools) {
    if (!t.org_max_permission || t.org_max_permission === 'allow') continue
    if (t.org_max_permission === 'ask' || t.org_max_permission === 'blocked') {
      out[t.name] = t.org_max_permission
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * densable hpi — aggregate dynamic MCP tools[].permission_policy into
 * always_allow / always_deny / always_ask lists of fully-qualified tool names.
 * Stricter policy wins when the same tool appears on multiple servers.
 */
export function permissionPoliciesFromDynamicMcpConfigs(
  configs: Record<
    string,
    {
      type?: string
      tools?: ReadonlyArray<McpSetServersToolPolicy>
    }
  >,
): {
  allow: string[]
  deny: string[]
  ask: string[]
} {
  const rank: Record<string, number> = {
    always_allow: 0,
    always_ask: 1,
    always_deny: 2,
  }
  const byTool = new Map<
    string,
    'always_allow' | 'always_ask' | 'always_deny'
  >()
  for (const [serverName, cfg] of Object.entries(configs)) {
    if (cfg.type !== 'http' && cfg.type !== 'sse') continue
    for (const tool of cfg.tools ?? []) {
      const pol = tool.permission_policy
      if (
        pol !== 'always_allow' &&
        pol !== 'always_ask' &&
        pol !== 'always_deny'
      ) {
        continue
      }
      const fq = buildMcpToolName(serverName, tool.name)
      const prev = byTool.get(fq)
      if (prev === undefined || rank[pol]! > (rank[prev] ?? -1)) {
        byTool.set(fq, pol)
      }
    }
  }
  const allow: string[] = []
  const deny: string[] = []
  const ask: string[] = []
  for (const [name, pol] of byTool) {
    if (pol === 'always_allow') allow.push(name)
    else if (pol === 'always_deny') deny.push(name)
    else ask.push(name)
  }
  return { allow, deny, ask }
}

function withMcpServerPolicyRules<
  T extends {
    alwaysAllowRules: Record<string, string[] | undefined>
    alwaysDenyRules: Record<string, string[] | undefined>
    alwaysAskRules: Record<string, string[] | undefined>
  },
>(ctx: T, policies: { allow: string[]; deny: string[]; ask: string[] }): T {
  const setBucket = (
    rules: Record<string, string[] | undefined>,
    names: string[],
  ): Record<string, string[] | undefined> => {
    const prev = rules.mcpServerPolicy ?? []
    if (names.length === prev.length && names.every((n, i) => n === prev[i])) {
      return rules
    }
    if (names.length === 0) {
      if (!('mcpServerPolicy' in rules)) return rules
      const { mcpServerPolicy: _drop, ...rest } = rules
      return rest
    }
    return { ...rules, mcpServerPolicy: names }
  }
  const alwaysAllowRules = setBucket(ctx.alwaysAllowRules, policies.allow)
  const alwaysDenyRules = setBucket(ctx.alwaysDenyRules, policies.deny)
  const alwaysAskRules = setBucket(ctx.alwaysAskRules, policies.ask)
  if (
    alwaysAllowRules === ctx.alwaysAllowRules &&
    alwaysDenyRules === ctx.alwaysDenyRules &&
    alwaysAskRules === ctx.alwaysAskRules
  ) {
    return ctx
  }
  return {
    ...ctx,
    alwaysAllowRules,
    alwaysDenyRules,
    alwaysAskRules,
  }
}

function toScopedConfig(
  config: McpServerConfigForProcessTransport,
): ScopedMcpServerConfig {
  const rec = config as McpServerConfigForProcessTransport & {
    type?: string
    tools?: ReadonlyArray<McpSetServersToolPolicy>
    toolPermissions?: Record<string, 'allow' | 'ask' | 'blocked'>
  }
  if (rec.type === 'http' || rec.type === 'sse') {
    const { tools, toolPermissions: existing, ...rest } = rec
    const fromTools = toolPermissionsFromSetServersTools(tools)
    const toolPermissions = fromTools ?? existing
    return {
      ...rest,
      ...(toolPermissions && Object.keys(toolPermissions).length > 0
        ? { toolPermissions }
        : {}),
      scope: 'dynamic',
    } as ScopedMcpServerConfig
  }
  return { ...config, scope: 'dynamic' } as ScopedMcpServerConfig
}

/**
 * Handles mcp_set_servers requests by processing both SDK and process-based servers.
 */
export async function handleMcpSetServers<
  TState extends HeadlessAppState = AppState,
>(
  servers: Record<string, McpServerConfigForProcessTransport>,
  sdkState: SdkMcpState,
  dynamicState: DynamicMcpState,
  setAppState: HeadlessSetAppState<TState>,
): Promise<McpSetServersResult> {
  const { allowed: allowedServers, blocked } = filterMcpServersByPolicy(servers)
  const policyErrors: Record<string, string> = {}
  for (const name of blocked) {
    policyErrors[name] =
      'Blocked by enterprise policy (allowedMcpServers/deniedMcpServers)'
  }

  let serversAfterExclusive: Record<
    string,
    McpServerConfigForProcessTransport
  > = allowedServers
  const exclusiveIgnoreReason = isSafeModeEnabled()
    ? 'Ignored in safe mode'
    : isRemoteHermeticSession()
      ? HERMETIC_MCP_SET_SERVERS_IGNORE_REASON
      : isRemoteEnvEnabled() && doesEnterpriseMcpConfigExist()
        ? ENTERPRISE_MCP_SET_SERVERS_IGNORE_REASON
        : getSettingsForSource('policySettings')?.disableSideloadFlags === true
          ? 'Blocked by managed policy (disableSideloadFlags)'
          : undefined
  if (exclusiveIgnoreReason !== undefined) {
    const kept: Record<string, McpServerConfigForProcessTransport> = {}
    for (const [name, config] of Object.entries(allowedServers)) {
      if ((config.type as string) === 'sdk') {
        kept[name] = config
      } else {
        policyErrors[name] = exclusiveIgnoreReason
      }
    }
    serversAfterExclusive = kept
  }

  const sdkServers: Record<string, McpSdkServerConfig> = {}
  const processServers: Record<string, McpServerConfigForProcessTransport> = {}

  for (const [name, config] of Object.entries(serversAfterExclusive)) {
    if ((config.type as string) === 'sdk') {
      sdkServers[name] = config as unknown as McpSdkServerConfig
    } else {
      processServers[name] = config
    }
  }

  const currentSdkNames = new Set(Object.keys(sdkState.configs))
  const newSdkNames = new Set(Object.keys(sdkServers))
  const sdkAdded: string[] = []
  const sdkRemoved: string[] = []

  const newSdkConfigs = { ...sdkState.configs }
  let newSdkClients = [...sdkState.clients]
  let newSdkTools = [...sdkState.tools]

  for (const name of currentSdkNames) {
    if (!newSdkNames.has(name)) {
      const client = newSdkClients.find(c => c.name === name)
      if (client && client.type === 'connected') {
        await client.cleanup()
      }
      newSdkClients = newSdkClients.filter(c => c.name !== name)
      const prefix = `mcp__${name}__`
      newSdkTools = newSdkTools.filter(t => !t.name.startsWith(prefix))
      delete newSdkConfigs[name]
      sdkRemoved.push(name)
    }
  }

  for (const [name, config] of Object.entries(sdkServers)) {
    if (!currentSdkNames.has(name)) {
      newSdkConfigs[name] = config
      const pendingClient: MCPServerConnection = {
        type: 'pending',
        name,
        config: { ...config, scope: 'dynamic' as const },
      }
      newSdkClients = [...newSdkClients, pendingClient]
      sdkAdded.push(name)
    }
  }

  const processResult = await reconcileMcpServers(
    processServers,
    dynamicState,
    setAppState,
  )

  return {
    response: {
      added: [...sdkAdded, ...processResult.response.added],
      removed: [...sdkRemoved, ...processResult.response.removed],
      errors: { ...policyErrors, ...processResult.response.errors },
    },
    newSdkState: {
      configs: newSdkConfigs,
      clients: newSdkClients,
      tools: newSdkTools,
    },
    newDynamicState: processResult.newState,
    sdkServersChanged: sdkAdded.length > 0 || sdkRemoved.length > 0,
  }
}

/**
 * Reconciles the current set of dynamic MCP servers with a new desired state.
 * Handles additions, removals, and config changes.
 */
export async function reconcileMcpServers<
  TState extends HeadlessAppState = AppState,
>(
  desiredConfigs: Record<string, McpServerConfigForProcessTransport>,
  currentState: DynamicMcpState,
  setAppState: HeadlessSetAppState<TState>,
): Promise<{
  response: SDKControlMcpSetServersResponse
  newState: DynamicMcpState
}> {
  const currentNames = new Set(Object.keys(currentState.configs))
  const desiredNames = new Set(Object.keys(desiredConfigs))

  const toRemove = [...currentNames].filter(n => !desiredNames.has(n))
  const toAdd = [...desiredNames].filter(n => !currentNames.has(n))

  const toCheck = [...currentNames].filter(n => desiredNames.has(n))
  const toReplace = toCheck.filter(name => {
    const currentConfig = currentState.configs[name]
    const desiredConfigRaw = desiredConfigs[name]
    if (!currentConfig || !desiredConfigRaw) return true
    const desiredConfig = toScopedConfig(desiredConfigRaw)
    return !areMcpConfigsEqual(currentConfig, desiredConfig)
  })

  const removed: string[] = []
  const added: string[] = []
  const errors: Record<string, string> = {}

  let newClients = [...currentState.clients]
  let newTools = [...currentState.tools]

  for (const name of [...toRemove, ...toReplace]) {
    const client = newClients.find(c => c.name === name)
    const config = currentState.configs[name]
    if (client && config) {
      if (client.type === 'connected') {
        try {
          await client.cleanup()
        } catch (e) {
          logError(e)
        }
      }
      await clearServerCache(name, config)
    }

    const prefix = `mcp__${name}__`
    newTools = newTools.filter(t => !t.name.startsWith(prefix))
    newClients = newClients.filter(c => c.name !== name)

    if (toRemove.includes(name)) {
      removed.push(name)
    }
  }

  for (const name of [...toAdd, ...toReplace]) {
    const config = desiredConfigs[name]
    if (!config) continue
    const scopedConfig = toScopedConfig(config)

    if ((config.type as string) === 'sdk') {
      added.push(name)
      continue
    }

    const { blocked: preConnectBlocked } = filterMcpServersByPolicy({
      [name]: config,
    })
    if (preConnectBlocked.length > 0) {
      errors[name] = `MCP server "${name}" is blocked by managed policy`
      continue
    }
    if (isSafeModeEnabled()) {
      errors[name] = 'Ignored in safe mode'
      continue
    }
    if (isRemoteHermeticSession()) {
      errors[name] = HERMETIC_MCP_SET_SERVERS_IGNORE_REASON
      continue
    }
    if (isRemoteEnvEnabled() && doesEnterpriseMcpConfigExist()) {
      errors[name] = ENTERPRISE_MCP_SET_SERVERS_IGNORE_REASON
      continue
    }
    if (getSettingsForSource('policySettings')?.disableSideloadFlags === true) {
      errors[name] = 'Blocked by managed policy (disableSideloadFlags)'
      continue
    }

    try {
      const client = await connectToServer(name, scopedConfig)
      newClients.push(client)

      if (client.type === 'connected') {
        const serverTools = await fetchToolsForClient(client)
        newTools.push(...serverTools)
      } else if (client.type === 'failed') {
        errors[name] = client.error || 'Connection failed'
      }

      added.push(name)
    } catch (e) {
      const err = toError(e)
      errors[name] = err.message
      logError(err)
    }
  }

  const newConfigs: Record<string, ScopedMcpServerConfig> = {}
  for (const name of desiredNames) {
    const config = desiredConfigs[name]
    if (config) {
      newConfigs[name] = toScopedConfig(config)
    }
  }

  const newState: DynamicMcpState = {
    clients: newClients,
    tools: newTools,
    configs: newConfigs,
  }

  const policies = permissionPoliciesFromDynamicMcpConfigs(desiredConfigs)

  const setHeadlessAppState = setAppState as unknown as (
    f: (prev: HeadlessAppState) => HeadlessAppState,
  ) => void
  setHeadlessAppState(prev => {
    const allDynamicServerNames = new Set([
      ...Object.keys(currentState.configs),
      ...Object.keys(newConfigs),
    ])

    const nonDynamicTools = prev.mcp.tools.filter(t => {
      for (const serverName of allDynamicServerNames) {
        if (t.name.startsWith(`mcp__${serverName}__`)) {
          return false
        }
      }
      return true
    })

    const nonDynamicClients = prev.mcp.clients.filter(c => {
      return !allDynamicServerNames.has(c.name)
    })

    const toolPermissionContext = withMcpServerPolicyRules(
      prev.toolPermissionContext,
      policies,
    )

    return {
      ...prev,
      mcp: {
        ...prev.mcp,
        tools: [...nonDynamicTools, ...newTools],
        clients: [...nonDynamicClients, ...newClients],
      },
      toolPermissionContext,
    }
  })

  return {
    response: { added, removed, errors },
    newState,
  }
}

// Re-export parsePluginIdentifier-free or type helpers if needed
import { parsePluginIdentifier } from 'src/utils/plugins/pluginIdentifier.js'
export type { NormalizedUserMessage }
