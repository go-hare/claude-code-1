import { describe, expect, test } from 'bun:test'
import { isAutoModeEnvEnabled } from '../autoModeEnv.js'
import {
  getCoordinatorExtraTools,
  shouldPropagateNestedMemory,
} from '../coordinatorEnv.js'
import {
  isForkSubagentEnabled,
  resolveForkSubagentSource,
} from '../forkSubagentGate.js'
import { formatVersionCwdLabel, shouldHideCwd } from '../hideCwd.js'
import {
  resolveAltGrAsTextMode,
  shouldMapBsAsCtrlBackspace,
} from '../keyboardEnv.js'
import {
  isLoopKeepaliveEnabled,
  isLoopPersistentEnabled,
} from '../loopKeepalive.js'
import {
  resolveMaxTurnsFromEnv,
  tryResolveMaxTurnsFromEnv,
} from '../maxTurnsEnv.js'
import {
  isMemoryBulkInflateDisabled,
  isMemoryPeriodicResyncDisabled,
} from '../memoryStoreGates.js'
import { shouldUseMidConversationSystem } from '../midConversationSystem.js'
import {
  getMorningBriefPromptOverride,
  isMorningBriefEnabled,
} from '../morningBriefGate.js'
import {
  getPerforceModePromptAddendum,
  isPerforceModeEnabled,
} from '../perforceMode.js'
import {
  buildPowerShellInvocationFlags,
  shouldRespectPowerShellExecutionPolicy,
} from '../powershellExecutionPolicy.js'
import { isForceSessionPersistenceEnabled } from '../forceSessionPersistence.js'
import { resolvePackageManagerAutoUpdateFromEnv } from '../packageManagerAutoUpdate.js'
import { shouldPropagateTraceparent } from '../propagateTraceparent.js'
import { isRemoteRecapEnabled } from '../remoteRecapGate.js'
import {
  isRefusalFallbackCatchAllEnabled,
  isRefusalFallbackEnabled,
} from '../refusalFallback.js'
import { isSafeModeEnabled, safeModeDisableHint } from '../safeMode.js'
import { getScriptCaps, parseScriptCaps } from '../scriptCaps.js'
import {
  isChildSession,
  isSandboxedSession,
  isSupervisedSession,
} from '../sessionRoleEnv.js'
import {
  resolveAuthFailExitMs,
  resolveAuthFailExitMsOrDefault,
  resolveMaxToolUseConcurrency,
  resolveOauth401WaitMs,
  resolveOauth401WaitMsOrDefault,
  resolveParkedPermissionWaitMs,
  resolveParkedPermissionWaitMsOrDefault,
  resolveStopHookBlockCap,
  resolveTeamTeardownParkTimeoutMs,
  resolveTeamTeardownParkTimeoutMsOrDefault,
  resolveUserDialogTimeoutMs,
  resolveUserDialogTimeoutMsOrDefault,
  resolveIdleThresholdMinutes,
  resolveIdleThresholdMs,
  resolveIdleTokenThreshold,
  resolveSessionEndHooksTimeoutMs,
  resolvePwshParseTimeoutMs,
  resolveApiKeyHelperTtlMs,
  resolveAwsChainResolveTimeoutMs,
  resolveMcpToolIdleTimeoutMs,
  evaluateRemoteAuthFailExit,
  waitForRotatedOauthToken,
  DEFAULT_MAX_TOOL_USE_CONCURRENCY,
  DEFAULT_STOP_HOOK_BLOCK_CAP,
  DEFAULT_AUTH_FAIL_EXIT_MS,
  DEFAULT_USER_DIALOG_TIMEOUT_MS,
  DEFAULT_PARKED_PERMISSION_WAIT_MS,
  DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS,
  DEFAULT_OAUTH_401_WAIT_REMOTE_MS,
  DEFAULT_IDLE_THRESHOLD_MINUTES,
  DEFAULT_IDLE_TOKEN_THRESHOLD,
  DEFAULT_SESSIONEND_HOOKS_TIMEOUT_MS,
  DEFAULT_PWSH_PARSE_TIMEOUT_MS,
  DEFAULT_API_KEY_HELPER_TTL_MS,
  DEFAULT_AWS_CHAIN_RESOLVE_TIMEOUT_MS,
  DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS,
} from '../residualMsEnvGates.js'
import {
  DEFAULT_NOTIFICATION_PRESENCE_MS,
  extractTerminalMcpToolTexts,
  getForceTipId,
  getTerminalMcpTools,
  getTerminalMcpToolSet,
  isAgentViewDisabled,
  isFleetSimpleViewEnabled,
  getAgentViewDisabledReason,
  isUserPresentForNotification,
  messagesEndWithSuccessfulTerminalMcpTool,
  shouldSuppressPushForUserPresence,
  isAlternateScreenDisabled,
  isAxcStickyMainEnabled,
  isEagerFlushEnabled,
  isForceFullLogoEnabled,
  isForceFullscreenUpsellEnabled,
  isForceSyncOutputEnabled,
  isMenuKindLanesEnabled,
  isNotificationPresenceCheckDisabled,
  isWorkingSyncDisabled,
  resolveCommandKindLane,
  resolveCommandSourceTag,
  resolveQuestionPreviewFormat,
  resolveFileReadMaxOutputTokens,
  getSyntaxHighlightUnavailableReason,
  resolveScrollSpeedBase,
} from '../residualUiEnvGates.js'
import {
  buildMcpStdioBaseEnv,
  buildMcpStdioTransportEnv,
  getMcpAllowlistFromEnv,
  getMcpStdioSafeEnvKeys,
  getRemoteSystemPromptGbFeatureKey,
  getResumeFromSessionId,
  getSystemPromptGbFeature,
  pickMcpStdioSafeInheritedEnv,
  resolveSystemPromptWithRemoteGb,
  shouldEnforceMcpAllowlistEnv,
  fetchAndCacheGatewayModels,
  getGatewayModelsCachePath,
  isBackgroundPluginRefreshEnabled,
  isClaudeApiSkillDisabled,
  isClaudeCodeSkillDisabled,
  isAdvisorToolDisabled,
  isExperimentalAdvisorToolEnabled,
  isForceBridgeEnabled,
  isForceEvaluateMemoryEnabled,
  isForceMemorySurveyEnabled,
  isGatewayModelDiscoveryEnabled,
  isNestedChainIdleDisabled,
  isOpus47FastModeEnabled,
  parseGatewayModelOptionsFromCache,
  planGatewayModelsCacheWrite,
  githubRepoGitUrl,
  rewritePluginGitUrlPreferHttps,
  shouldEnableGatewayModelDiscovery,
  shouldKeepMarketplaceOnFailure,
  shouldPreferPluginHttps,
  shouldPreferPluginHttpsOrRemote,
  shouldSkipFastModeNetworkErrors,
  shouldSkipFastModeOrgCheck,
  shouldSkipProjectBackfill,
  shouldSkipRepoUpload,
  shouldSuppressSessionAttribution,
} from '../residualMoreEnvGates.js'
import { shouldSkipPluginMcpServers } from '../skipPluginMcpServers.js'
import {
  isDecstbmEnabled,
  isNativeCursorEnabled,
} from '../terminalFeatureGates.js'
import {
  isWorkflowsAvailable,
  isWorkflowsDisabled,
  isWorkflowsSettingsDisabled,
  isWorkflowKeywordTriggerEnabled,
  resolveWorkflowsAvailability,
} from '../workflowDisableGate.js'
import { isFeedbackSurveyDisabled } from '../../services/analytics/config.js'
import {
  DEFAULT_SYNC_PLUGINS_INSTALL_TIMEOUT_MS,
  DEFAULT_SYNC_PLUGINS_MCP_TIMEOUT_MS,
  DEFAULT_SYNC_SKILLS_WAIT_TIMEOUT_MS,
  apiKeyFromAuthorizationHeader,
  applyRelaunchTerminalSizeFromEnv,
  buildRelaunchTerminalSizeEnv,
  extractAuthorizationHeader,
  filterBetasForSimulateProxyUsage,
  formatSyncPluginInstallTimeoutLog,
  getHfiBearerToken,
  getInvokedSkills,
  getProxyUrl,
  getTuiJustSwitchedValue,
  getWorkflowsEnvPath,
  isAnthropicAwsProviderEnabled,
  isBackgroundTasksDisabled,
  isBenchLiveCountsEnabled,
  isExperimentalObserverAgentsEnabled,
  isMantleProviderEnabled,
  isRelaunchTerminalSizeEnabled,
  isFeedbackSurveyEnvDisabled,
  parseCertStoreSources,
  parseUltrareviewPreflightFixture,
  parseUltrareviewPreflightFixtureTyped,
  resolveOverageGateFromPreflightFixture,
  resolveCertStoreSources,
  resolveDaemonColdStartMode,
  resolveDaemonColdStartModeFull,
  planDaemonColdStart,
  isCronDisabled,
  resolveKairosCronEnabled,
  shouldUploadBriefAttachments,
  isPewterOwlToolEnabled,
  isPewterOwlBriefEnabled,
  getBriefEnforceText,
  resolveReplModeEnabled,
  isBriefModeStopHookDisabled,
  messagesIncludeBriefToolUse,
  messagesIncludeBriefEnforceSentinel,
  resolveBriefModeStopHookEnforce,
  isNewInitEnvEnabled,
  resolveNewInitEnabled,
  isBundledSkillsDisabled,
  isRemoteControlDisabledBySettings,
  isBgExitHandoffDisabled,
  resolveAutoCompactWindowOverride,
  resolveBlockingLimitOverride,
  resolveGlobTimeoutSeconds,
  isEmitToolUseSummariesEnabled,
  isEmitSessionStateEventsEnabled,
  isDontInheritEnvEnabled,
  isAdditionalProtectionEnabled,
  isAdditionalDirectoriesClaudeMdEnabled,
  resolveMaxContextTokensOverride,
  resolveSlowOperationThresholdMs,
  resolvePluginGitTimeoutMs,
  DEFAULT_PLUGIN_GIT_TIMEOUT_MS,
  resolveMaxOutputTokensOverride,
  is1mContextEnvDisabled,
  isThinkingDisabled,
  isAdaptiveThinkingDisabled,
  isAttachmentsDisabled,
  isClaudeMdsDisabled,
  isTerminalTitleDisabled,
  isFileCheckpointingDisabled,
  isPolicySkillsDisabled,
  isNonstreamingFallbackDisabled,
  isExperimentalBetasDisabled,
  isOfficialMarketplaceAutoinstallDisabled,
  isFastModeDisabled,
  isVirtualScrollDisabled,
  isMessageActionsDisabled,
  isPrecompactSkipDisabled,
  isTokenUsageAttachmentEnabled,
  isForceInteractiveEnabled,
  isTasksEnvEnabled,
  isAwaySummaryEnvEnabled,
  isSdkFileCheckpointingEnabled,
  resolveGitInstructionsEnvOverride,
  resolveAutoMemoryEnvOverride,
  resolvePromptSuggestionEnvOverride,
  resolveMaxRetriesOverride,
  isXaaEnvEnabled,
  isLocalGatesDisabled,
  resolveDatadogFlushIntervalMs,
  isIncludePartialMessagesEnabled,
  isProactiveEnvEnabled,
  isExcludeDynamicContextEnabled,
  isBubblewrapEnabled,
  isSessionDataUploadDisabled,
  isStreamlinedOutputEnabled,
  isResumeInterruptedTurnEnabled,
  resolveAttributionHeaderEnvOverride,
  isBgShellPressureReapDisabled,
  isSaveHookAdditionalContextEnabled,
  isCcrMirrorEnvEnabled,
  isTelemetryEnvEnabled,
  isProfileStartupEnabled,
  resolveOverrideDate,
  isPostForSessionIngressV2Enabled,
  resolveEffortLevelOverride,
  resolvePowerShellToolEnvOverride,
  resolveGitBashPath,
  resolveOtelHeadersHelperDebounceMs,
  resolveApiKeyFileDescriptor,
  resolveWorkerEpoch,
  resolveEnvironmentRunnerVersion,
  isSimpleModeEnvEnabled,
  isCoordinatorModeEnvEnabled,
  syncCoordinatorModeEnvFromSession,
  isBriefEnvEnabled,
  resolveShellPrefix,
  isExplorePlanAgentsDisabled,
  isCommandInjectionCheckDisabled,
  isBashSandboxShowIndicatorEnabled,
  resolveAgentListInMessagesEnvOverride,
  isAccessibilityEnvEnabled,
  isRemoteEnvEnabled,
  isCcrV2EnvEnabled,
  isActionEnvEnabled,
  isUnattendedRetryEnvEnabled,
  resolveBuddyEnvOverride,
  isUseBedrockEnvEnabled,
  isUseVertexEnvEnabled,
  isUseFoundryEnvEnabled,
  isUseOpenAIEnvEnabled,
  isUseGeminiEnvEnabled,
  isUseGrokEnvEnabled,
  isSkipBedrockAuthEnvEnabled,
  isSkipVertexAuthEnvEnabled,
  isSkipFoundryAuthEnvEnabled,
  isSkipAwsCredCacheEnvEnabled,
  isProviderManagedByHostEnvEnabled,
  isAutoConnectIdeEnvEnabled,
  isRemoteSendKeepalivesEnvEnabled,
  isNativeFileSearchEnvEnabled,
  isExperimentalAgentTeamsDisabled,
  isVerifyPlanEnvEnabled,
  isTerminalRecordingEnvEnabled,
  isFineGrainedToolStreamingEnvEnabled,
  isAlwaysEnableEffortEnvEnabled,
  isCfcEnvEnabled,
  isDumpAutoModeEnvEnabled,
  isAutoModeExternalPermissionsEnvEnabled,
  isPluginZipCacheEnvEnabled,
  isCoworkPluginsEnvEnabled,
  isIdeSkipValidCheckEnvEnabled,
  isIdeSkipAutoInstallEnvEnabled,
  isBuiltinPromptSkillDisabledByBundledSetting,
  resolveSkillOverrideMode,
  cycleSkillOverrideMode,
  resolveSkillOverrideWriteValue,
  formatSkillOverrideModeLabel,
  SKILL_OVERRIDE_CYCLE_MODES,
  isSkillModelInvocationBlockedByOverride,
  isSkillFullyDisabledByOverride,
  isSkillModelListable,
  clampMaxOutputTokensOverride,
  isClaudeAiConnectorsDisabledBySources,
  resolveEnableArtifactFromSources,
  resolveEnableWorkflowsSetting,
  shouldToolsListOptInToBrief,
  isPlanModeRequiredFromEnv,
  isNoFlickerEnabled,
  isSkillShellExecutionDisabled,
  SKILL_SHELL_DISABLED_PLACEHOLDER,
  stripSkillShellCommands,
  resolveFableBridgeDialogTimeoutMsOrDefault,
  DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS,
  resolveExitAfterStopDelayMs,
  isExitAfterFirstRenderEnabled,
  isSyncPluginInstallEnabled,
  isSyncPluginsEnabled,
  isSyncPluginsOrInstallEnabled,
  isTestForceDenyEnabled,
  isTuiJustSwitched,
  isTuiJustSwitchedFromFullscreen,
  OFFICIAL_GB_REFRESH_INTERVAL_MS,
  parseRelaunchTerminalSize,
  raceWithTimeoutMs,
  resolveGbRefreshIntervalMs,
  resolveGbRefreshIntervalMsOrDefault,
  resolveRemoteSettingsPollMs,
  consumeAgentViewRelaunch,
  resolveSyncPluginInstallTimeoutOverrideMs,
  resolveSyncPluginsInstallTimeoutMs,
  resolveSyncPluginsMcpTimeoutMs,
  resolveSyncSkillsWaitTimeoutMs,
  shouldSimulateProxyUsage,
  shouldSkipAnthropicAwsAuth,
  shouldSkipHfiVersionCheck,
  shouldSkipPromptHistory,
  shouldSkipMantleAuth,
  shouldUseGateway,
  hasSdkOauthRefresh,
  hasSdkHostAuthRefresh,
  shouldRegisterSdkOauthRefreshCallback,
  shouldRegisterSdkHostAuthRefreshCallback,
  isSdkHostAuthRefreshEntrypoint,
  DEFAULT_SDK_AUTH_REFRESH_CONTROL_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS_FOR_TESTING,
  DEFAULT_DOWNLOAD_DEADLINE_MS_FOR_TESTING,
  resolveStallTimeoutMsForTesting,
  resolveStallTimeoutMsForTestingOrDefault,
  resolveDownloadDeadlineMsForTesting,
  resolveDownloadDeadlineMsForTestingOrDefault,
  resolveSpawnTimestampMs,
  resolveSpawnToFirstCheckpointMs,
  isTestNoGitBash,
  isTestNoPwsh,
  isAgentRuleDisabled,
} from '../residualFinalEnvGates.js'

describe('maxTurnsEnv', () => {
  test('parses positive', () => {
    expect(resolveMaxTurnsFromEnv({ CLAUDE_CODE_MAX_TURNS: '5' })).toBe(5)
  })
  test('throws on invalid', () => {
    expect(() =>
      resolveMaxTurnsFromEnv({ CLAUDE_CODE_MAX_TURNS: '0' }),
    ).toThrow(/positive integer/)
  })
  test('try swallows', () => {
    expect(
      tryResolveMaxTurnsFromEnv({ CLAUDE_CODE_MAX_TURNS: 'x' }),
    ).toBeUndefined()
  })
})

describe('hideCwd', () => {
  test('hide empties label', () => {
    expect(
      formatVersionCwdLabel({
        label: 'v1',
        host: 'https://example.com',
        env: { CLAUDE_CODE_HIDE_CWD: '1' },
      }),
    ).toBe('')
    expect(shouldHideCwd({ CLAUDE_CODE_HIDE_CWD: '1' })).toBe(true)
  })
})

describe('safeMode', () => {
  test('env or argv', () => {
    expect(isSafeModeEnabled({ CLAUDE_CODE_SAFE_MODE: '1' }, [])).toBe(true)
    expect(isSafeModeEnabled({}, ['node', 'cli', '--safe-mode'])).toBe(true)
    expect(safeModeDisableHint(['--safe-mode'])).toContain('restart')
  })
})

describe('sessionRoleEnv', () => {
  test('flags', () => {
    expect(isSandboxedSession({ CLAUDE_CODE_SANDBOXED: '1' })).toBe(true)
    expect(isSupervisedSession({ CLAUDE_CODE_SUPERVISED: 'yes' })).toBe(true)
    expect(isChildSession({ CLAUDE_CODE_CHILD_SESSION: '1' })).toBe(true)
  })
})

describe('loopKeepalive', () => {
  test('env overrides gb', () => {
    expect(
      isLoopKeepaliveEnabled({
        env: { CLAUDE_CODE_LOOP_KEEPALIVE: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(
      isLoopPersistentEnabled({
        env: { CLAUDE_CODE_LOOP_PERSISTENT: '0' },
        gbValue: true,
      }),
    ).toBe(false)
  })

  test('resolveLoopTickIntervalMs + planLoopKeepaliveBehavior densable', async () => {
    const {
      resolveLoopTickIntervalMs,
      planLoopKeepaliveBehavior,
      LOOP_DEFAULT_TICK_INTERVAL_MS,
      LOOP_KEEPALIVE_TICK_INTERVAL_MS,
    } = await import('../loopKeepalive.js')
    expect(
      resolveLoopTickIntervalMs({
        env: {},
        keepaliveEnabled: false,
      }),
    ).toBe(LOOP_DEFAULT_TICK_INTERVAL_MS)
    expect(
      resolveLoopTickIntervalMs({
        env: { CLAUDE_CODE_LOOP_KEEPALIVE: '1' },
        keepaliveEnabled: true,
      }),
    ).toBe(LOOP_KEEPALIVE_TICK_INTERVAL_MS)

    const plan = planLoopKeepaliveBehavior({
      keepaliveEnabled: true,
      persistentEnabled: true,
      loopActive: false,
      userRequestedStop: false,
    })
    expect(plan.shouldContinueTicks).toBe(true)
    expect(plan.shouldPersistSchedule).toBe(true)
    expect(plan.intervalMs).toBe(LOOP_KEEPALIVE_TICK_INTERVAL_MS)

    const stopped = planLoopKeepaliveBehavior({
      keepaliveEnabled: true,
      persistentEnabled: true,
      loopActive: true,
      userRequestedStop: true,
    })
    expect(stopped.shouldContinueTicks).toBe(false)
    expect(stopped.shouldPersistSchedule).toBe(false)
  })
})

describe('keyboardEnv', () => {
  test('altgr modes', () => {
    expect(
      resolveAltGrAsTextMode({ env: { CLAUDE_CODE_ALTGR_AS_TEXT: '1' } }),
    ).toBe('force')
    expect(
      resolveAltGrAsTextMode({
        env: { CLAUDE_CODE_ALTGR_AS_TEXT: '0' },
      }),
    ).toBe('off')
    expect(resolveAltGrAsTextMode({ env: {}, wtSession: true })).toBe('auto')
  })
  test('bs as ctrl-backspace', () => {
    expect(
      shouldMapBsAsCtrlBackspace({
        env: { CLAUDE_CODE_BS_AS_CTRL_BACKSPACE: '1' },
        platform: 'darwin',
      }),
    ).toBe(true)
    expect(
      shouldMapBsAsCtrlBackspace({
        env: {},
        platform: 'win32',
      }),
    ).toBe(true)
  })
})

describe('terminalFeatureGates', () => {
  test('env on', () => {
    expect(
      isDecstbmEnabled({ env: { CLAUDE_CODE_DECSTBM: '1' }, gbValue: false }),
    ).toBe(true)
    expect(
      isNativeCursorEnabled({
        env: { CLAUDE_CODE_NATIVE_CURSOR: '1' },
        gbValue: false,
      }),
    ).toBe(true)
  })
})

describe('memoryStoreGates', () => {
  test('disable flags', () => {
    expect(
      isMemoryBulkInflateDisabled({
        CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE: '1',
      }),
    ).toBe(true)
    expect(
      isMemoryPeriodicResyncDisabled({
        CLAUDE_CODE_DISABLE_MEMORY_PERIODIC_RESYNC: '1',
      }),
    ).toBe(true)
  })
})

describe('forkSubagentGate densable 232 #1 Drb/FDd', () => {
  test('env force on / off', () => {
    expect(
      resolveForkSubagentSource({
        env: { CLAUDE_CODE_FORK_SUBAGENT: '1' },
      }),
    ).toBe('env')
    expect(
      isForkSubagentEnabled({
        env: { CLAUDE_CODE_FORK_SUBAGENT: '0' },
      }),
    ).toBe(false)
    expect(
      resolveForkSubagentSource({
        env: { CLAUDE_CODE_FORK_SUBAGENT: '0' },
      }),
    ).toBe('disabled')
  })

  test('non-ant default is default (enabled) — densable Drb', () => {
    expect(
      resolveForkSubagentSource({
        env: {},
        isAnt: false,
      }),
    ).toBe('default')
    expect(
      isForkSubagentEnabled({
        env: {},
        isAnt: false,
      }),
    ).toBe(true)
  })

  test('ant disabled — densable Nn()', () => {
    expect(
      resolveForkSubagentSource({
        env: {},
        isAnt: true,
      }),
    ).toBe('disabled_ant')
    expect(
      isForkSubagentEnabled({
        env: {},
        isAnt: true,
      }),
    ).toBe(false)
  })
})

describe('workflow/auto mode gates', () => {
  test('flags', () => {
    expect(isWorkflowsDisabled({ CLAUDE_CODE_DISABLE_WORKFLOWS: '1' })).toBe(
      true,
    )
    expect(isAutoModeEnvEnabled({ CLAUDE_CODE_ENABLE_AUTO_MODE: '1' })).toBe(
      true,
    )
  })
})

describe('midConversationSystem', () => {
  test('force and model polarity', () => {
    expect(
      shouldUseMidConversationSystem({
        env: { CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM: '1' },
        model: 'claude-opus-4-7',
      }),
    ).toBe(true)
    // Official qqt: known Claude 3/4.x family is unsupported by default
    expect(shouldUseMidConversationSystem({ model: 'claude-opus-4-5' })).toBe(
      false,
    )
    expect(shouldUseMidConversationSystem({ model: 'claude-opus-4-7' })).toBe(
      false,
    )
    expect(shouldUseMidConversationSystem({ model: 'claude-mythos-5' })).toBe(
      true,
    )
  })
})

describe('remoteRecap / morningBrief / perforce / scriptCaps / coordinator', () => {
  test('remote recap env', () => {
    expect(
      isRemoteRecapEnabled({
        env: { CLAUDE_CODE_ENABLE_REMOTE_RECAP: '1' },
        gbValue: false,
      }),
    ).toBe(true)
  })
  test('morning brief', () => {
    expect(
      isMorningBriefEnabled({ CLAUDE_CODE_ENABLE_MORNING_BRIEF: '1' }),
    ).toBe(true)
    expect(
      getMorningBriefPromptOverride({
        CLAUDE_CODE_MORNING_BRIEF_PROMPT: 'hi',
      }),
    ).toBe('hi')
  })
  test('perforce', () => {
    expect(isPerforceModeEnabled({ CLAUDE_CODE_PERFORCE_MODE: '1' })).toBe(true)
    expect(getPerforceModePromptAddendum('Bash')).toContain('p4 edit')
    expect(getPerforceModePromptAddendum('Bash')).toContain('already writable')
  })
  test('script caps', () => {
    expect(parseScriptCaps('{"agents":3}')).toEqual({ agents: 3 })
    expect(getScriptCaps({ CLAUDE_CODE_SCRIPT_CAPS: '{"x":1.5}' })).toEqual({
      x: 1.5,
    })
  })
  test('coordinator', () => {
    expect(
      getCoordinatorExtraTools({
        CLAUDE_CODE_COORDINATOR_EXTRA_TOOLS: 'A, B',
      }),
    ).toEqual(['A', 'B'])
    expect(
      shouldPropagateNestedMemory({
        CLAUDE_CODE_COORDINATOR_PROPAGATE_NESTED_MEMORY: '1',
      }),
    ).toBe(true)
  })
  test('refusal catch-all', () => {
    expect(isRefusalFallbackEnabled({})).toBe(true)
    expect(
      isRefusalFallbackCatchAllEnabled({
        CLAUDE_CODE_REFUSAL_FALLBACK_CATCH_ALL: '1',
      }),
    ).toBe(true)
  })
  test('powershell execution policy', () => {
    expect(shouldRespectPowerShellExecutionPolicy({})).toBe(false)
    expect(
      shouldRespectPowerShellExecutionPolicy({
        CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: '1',
      }),
    ).toBe(true)
    expect(buildPowerShellInvocationFlags({})).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
    ])
    expect(
      buildPowerShellInvocationFlags({
        CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: '1',
      }),
    ).toEqual(['-NoProfile', '-NonInteractive'])
  })
  test('skip plugin mcp', () => {
    expect(shouldSkipPluginMcpServers('foo', {})).toBe(false)
    expect(
      shouldSkipPluginMcpServers('foo', {
        CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1',
      }),
    ).toBe(true)
    expect(
      shouldSkipPluginMcpServers('foo', {
        CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1',
        CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT: 'foo, bar',
      }),
    ).toBe(false)
    expect(
      shouldSkipPluginMcpServers('baz', {
        CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1',
        CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT: 'foo, bar',
      }),
    ).toBe(true)
  })
  test('force session persistence / package manager / traceparent', () => {
    expect(
      isForceSessionPersistenceEnabled({
        CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      }),
    ).toBe(true)
    expect(resolvePackageManagerAutoUpdateFromEnv({})).toBeUndefined()
    expect(
      resolvePackageManagerAutoUpdateFromEnv({
        CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE: '1',
      }),
    ).toBe(true)
    expect(
      resolvePackageManagerAutoUpdateFromEnv({
        CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE: '0',
      }),
    ).toBe(false)
    // Official Axr: Gd() || env — first-party base alone enables
    expect(
      shouldPropagateTraceparent({
        // custom base → not Gd; env off → false
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
      }),
    ).toBe(false)
    expect(
      shouldPropagateTraceparent({
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        CLAUDE_CODE_PROPAGATE_TRACEPARENT: '1',
      }),
    ).toBe(true)
    expect(
      shouldPropagateTraceparent({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }),
    ).toBe(true)
    expect(
      shouldPropagateTraceparent({
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
      }),
    ).toBe(true)
  })
  test('residual ms env gates', () => {
    expect(
      resolveAuthFailExitMs({ CLAUDE_CODE_AUTH_FAIL_EXIT_MS: '1500' }),
    ).toBe(1500)
    expect(
      resolveUserDialogTimeoutMs({ CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS: '0' }),
    ).toBeUndefined()
    expect(
      resolveParkedPermissionWaitMs({
        CLAUDE_CODE_PARKED_PERMISSION_WAIT_MS: '9000',
      }),
    ).toBe(9000)
    expect(
      resolveOauth401WaitMs({ CLAUDE_CODE_OAUTH_401_WAIT_MS: 'abc' }),
    ).toBeUndefined()
    expect(
      resolveTeamTeardownParkTimeoutMs({
        CLAUDE_CODE_TEAM_TEARDOWN_PARK_TIMEOUT_MS: '30000',
      }),
    ).toBe(30000)
    expect(resolveMaxToolUseConcurrency({})).toBe(
      DEFAULT_MAX_TOOL_USE_CONCURRENCY,
    )
    expect(
      resolveMaxToolUseConcurrency({
        CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4',
      }),
    ).toBe(4)
    expect(resolveStopHookBlockCap({})).toBe(DEFAULT_STOP_HOOK_BLOCK_CAP)
    expect(
      resolveStopHookBlockCap({ CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: '3' }),
    ).toBe(3)
    expect(
      resolveStopHookBlockCap({ CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: 'nope' }),
    ).toBe(DEFAULT_STOP_HOOK_BLOCK_CAP)
    // Official OrDefault densables
    expect(resolveAuthFailExitMsOrDefault({})).toBe(DEFAULT_AUTH_FAIL_EXIT_MS)
    expect(
      resolveAuthFailExitMsOrDefault({ CLAUDE_CODE_AUTH_FAIL_EXIT_MS: '0' }),
    ).toBe(0)
    expect(resolveUserDialogTimeoutMsOrDefault({})).toBe(
      DEFAULT_USER_DIALOG_TIMEOUT_MS,
    )
    expect(resolveParkedPermissionWaitMsOrDefault({})).toBe(
      DEFAULT_PARKED_PERMISSION_WAIT_MS,
    )
    expect(resolveTeamTeardownParkTimeoutMsOrDefault({})).toBe(
      DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS,
    )
    // Official XTh
    expect(resolveOauth401WaitMsOrDefault({})).toBe(0)
    expect(
      resolveOauth401WaitMsOrDefault({
        CLAUDE_CODE_REMOTE_SESSION_ID: 'sess-1',
      }),
    ).toBe(DEFAULT_OAUTH_401_WAIT_REMOTE_MS)
    expect(
      resolveOauth401WaitMsOrDefault({
        CLAUDE_CODE_OAUTH_401_WAIT_MS: '0',
        CLAUDE_CODE_REMOTE_SESSION_ID: 'sess-1',
      }),
    ).toBe(0)
    expect(
      resolveOauth401WaitMsOrDefault({ CLAUDE_CODE_OAUTH_401_WAIT_MS: '5000' }),
    ).toBe(5000)
    // Official idle densables
    expect(resolveIdleThresholdMinutes({})).toBe(DEFAULT_IDLE_THRESHOLD_MINUTES)
    expect(
      resolveIdleThresholdMinutes({ CLAUDE_CODE_IDLE_THRESHOLD_MINUTES: '30' }),
    ).toBe(30)
    expect(resolveIdleThresholdMs({})).toBe(
      DEFAULT_IDLE_THRESHOLD_MINUTES * 60_000,
    )
    expect(resolveIdleTokenThreshold({})).toBe(DEFAULT_IDLE_TOKEN_THRESHOLD)
    expect(
      resolveIdleTokenThreshold({ CLAUDE_CODE_IDLE_TOKEN_THRESHOLD: '50000' }),
    ).toBe(50_000)
    // Official timeout densables (sessionend/pwsh/api-key/aws/mcp idle)
    expect(resolveSessionEndHooksTimeoutMs({})).toBe(
      DEFAULT_SESSIONEND_HOOKS_TIMEOUT_MS,
    )
    expect(
      resolveSessionEndHooksTimeoutMs({
        CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS: '9000',
      }),
    ).toBe(9000)
    expect(resolvePwshParseTimeoutMs({})).toBe(DEFAULT_PWSH_PARSE_TIMEOUT_MS)
    expect(
      resolvePwshParseTimeoutMs({ CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS: '12000' }),
    ).toBe(12000)
    expect(resolveApiKeyHelperTtlMs({}).ttlMs).toBe(
      DEFAULT_API_KEY_HELPER_TTL_MS,
    )
    expect(
      resolveApiKeyHelperTtlMs({ CLAUDE_CODE_API_KEY_HELPER_TTL_MS: '1000' })
        .ttlMs,
    ).toBe(1000)
    expect(
      resolveApiKeyHelperTtlMs({ CLAUDE_CODE_API_KEY_HELPER_TTL_MS: 'nope' })
        .invalidRaw,
    ).toBe('nope')
    expect(resolveAwsChainResolveTimeoutMs({})).toBe(
      DEFAULT_AWS_CHAIN_RESOLVE_TIMEOUT_MS,
    )
    expect(
      resolveAwsChainResolveTimeoutMs({
        CLAUDE_CODE_AWS_CHAIN_RESOLVE_TIMEOUT_MS: '15000',
      }),
    ).toBe(15000)
    expect(resolveMcpToolIdleTimeoutMs({})).toBe(
      DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS,
    )
    expect(
      resolveMcpToolIdleTimeoutMs({ CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '0' }),
    ).toBeNull()
    expect(
      resolveMcpToolIdleTimeoutMs({
        CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '45000',
      }),
    ).toBe(45000)
  })
  test('evaluateRemoteAuthFailExit (official cjt)', () => {
    // non-remote → continue
    expect(
      evaluateRemoteAuthFailExit(
        { firstFailAtMs: null },
        { env: {}, nowMs: 1000 },
      ).decision,
    ).toBe('continue')
    // first remote fail records timestamp
    const first = evaluateRemoteAuthFailExit(
      { firstFailAtMs: null },
      {
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'r1' },
        nowMs: 1000,
        thresholdMs: 5000,
      },
    )
    expect(first.decision).toBe('continue')
    expect(first.state.firstFailAtMs).toBe(1000)
    // within threshold
    expect(
      evaluateRemoteAuthFailExit(first.state, {
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'r1' },
        nowMs: 4000,
        thresholdMs: 5000,
      }).decision,
    ).toBe('continue')
    // past threshold → exit
    expect(
      evaluateRemoteAuthFailExit(first.state, {
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'r1' },
        nowMs: 7000,
        thresholdMs: 5000,
      }).decision,
    ).toBe('exit')
    // recovered clears
    const recovered = evaluateRemoteAuthFailExit(first.state, {
      recovered: true,
      env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'r1' },
    })
    expect(recovered.decision).toBe('continue')
    expect(recovered.state.firstFailAtMs).toBeNull()
    // threshold 0 disables
    expect(
      evaluateRemoteAuthFailExit(
        { firstFailAtMs: 0 },
        {
          env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'r1' },
          thresholdMs: 0,
          nowMs: 999999,
        },
      ).decision,
    ).toBe('continue')
  })
  test('waitForRotatedOauthToken (official dbc)', async () => {
    let token: string | undefined = 'old'
    let now = 0
    const ok = await waitForRotatedOauthToken({
      failedAccessToken: 'old',
      timeoutMs: 100,
      pollMs: 10,
      readToken: () => token,
      sleeper: async ms => {
        now += ms
        if (now >= 30) token = 'new'
      },
      nowMs: () => now,
    })
    expect(ok).toBe(true)
    const fail = await waitForRotatedOauthToken({
      failedAccessToken: 'old',
      timeoutMs: 50,
      pollMs: 20,
      readToken: () => 'old',
      sleeper: async ms => {
        now += ms
      },
      nowMs: () => now,
    })
    expect(fail).toBe(false)
  })
  test('residual ui env gates', () => {
    expect(isAgentViewDisabled({ CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' })).toBe(
      true,
    )
    expect(isAgentViewDisabled({}, true)).toBe(true)
    expect(
      getAgentViewDisabledReason({ CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' }),
    ).toContain('CLAUDE_CODE_DISABLE_AGENT_VIEW')
    expect(getAgentViewDisabledReason({}, true)).toContain('disableAgentView')
    expect(getAgentViewDisabledReason({})).toBeNull()
    expect(
      isAlternateScreenDisabled({ CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' }),
    ).toBe(true)
    expect(isAxcStickyMainEnabled({})).toBe(false)
    expect(isAxcStickyMainEnabled({ CLAUDE_CODE_AXC_STICKY_MAIN: '1' })).toBe(
      true,
    )
    expect(
      isWorkingSyncDisabled({ CLAUDE_CODE_DISABLE_WORKING_SYNC: '1' }),
    ).toBe(true)
    expect(
      isMenuKindLanesEnabled({
        env: { CLAUDE_CODE_ENABLE_MENU_KIND_LANES: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(isMenuKindLanesEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(isMenuKindLanesEnabled({ env: {}, gbValue: false })).toBe(false)
    expect(
      isFleetSimpleViewEnabled({
        env: { CLAUDE_CODE_FLEETVIEW_SIMPLE: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(isFleetSimpleViewEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(isFleetSimpleViewEnabled({ env: {}, gbValue: false })).toBe(false)
    expect(resolveCommandSourceTag('projectSettings')).toBe('project')
    expect(resolveCommandSourceTag('plugin')).toBe('org')
    expect(resolveCommandSourceTag('policySettings')).toBe('org')
    expect(resolveCommandSourceTag('userSettings')).toBeUndefined()
    expect(resolveCommandKindLane({ type: 'prompt' })).toBe('skill')
    expect(resolveCommandKindLane({ type: 'local' })).toBe('action')
    expect(
      isForceFullscreenUpsellEnabled({
        CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL: '1',
      }),
    ).toBe(true)
    expect(isForceFullLogoEnabled({ CLAUDE_CODE_FORCE_FULL_LOGO: '1' })).toBe(
      true,
    )
    expect(isEagerFlushEnabled({ CLAUDE_CODE_EAGER_FLUSH: '1' })).toBe(true)
    expect(isEagerFlushEnabled({ CLAUDE_CODE_IS_COWORK: '1' })).toBe(true)
    expect(isEagerFlushEnabled({})).toBe(false)
    expect(
      isForceSyncOutputEnabled({ CLAUDE_CODE_FORCE_SYNC_OUTPUT: '1' }),
    ).toBe(true)
    expect(getForceTipId({ CLAUDE_CODE_FORCE_TIP_ID: 'foo' })).toBe('foo')
    expect(
      isNotificationPresenceCheckDisabled({
        CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK: '1',
      }),
    ).toBe(true)
    // Official V8o / push presence densables
    expect(DEFAULT_NOTIFICATION_PRESENCE_MS).toBe(60_000)
    expect(isUserPresentForNotification({ lastInteractionAgeMs: 1_000 })).toBe(
      true,
    )
    expect(
      isUserPresentForNotification({ lastInteractionAgeMs: 120_000 }),
    ).toBe(false)
    expect(isUserPresentForNotification({ override: true })).toBe(true)
    expect(isUserPresentForNotification({ override: false })).toBe(false)
    expect(
      shouldSuppressPushForUserPresence({
        lastInteractionAgeMs: 1_000,
      }),
    ).toBe(true)
    expect(
      shouldSuppressPushForUserPresence({
        isRemote: true,
        lastInteractionAgeMs: 1_000,
      }),
    ).toBe(false)
    expect(
      shouldSuppressPushForUserPresence({
        env: { CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK: '1' },
        lastInteractionAgeMs: 1_000,
      }),
    ).toBe(false)
    expect(
      getTerminalMcpTools({ CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'A, B' }),
    ).toEqual(['A', 'B'])
    expect(getTerminalMcpTools({})).toBeNull()
    // Official bes / C1u / NIs terminal-MCP densables
    expect(
      getTerminalMcpToolSet({ CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'A, B' }),
    ).toEqual(new Set(['A', 'B']))
    expect(getTerminalMcpToolSet({})).toEqual(new Set())
    expect(
      messagesEndWithSuccessfulTerminalMcpTool(
        [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: 't1', name: 'TermTool' }],
            },
          },
          {
            type: 'user',
            message: {
              content: [
                { type: 'tool_result', tool_use_id: 't1', is_error: false },
              ],
            },
          },
        ],
        { CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'TermTool' },
      ),
    ).toBe(true)
    expect(
      messagesEndWithSuccessfulTerminalMcpTool(
        [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: 't1', name: 'TermTool' }],
            },
          },
          {
            type: 'user',
            message: {
              content: [
                { type: 'tool_result', tool_use_id: 't1', is_error: true },
              ],
            },
          },
        ],
        { CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'TermTool' },
      ),
    ).toBe(false)
    expect(
      messagesEndWithSuccessfulTerminalMcpTool(
        [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: 't1', name: 'Other' }],
            },
          },
          {
            type: 'user',
            message: {
              content: [
                { type: 'tool_result', tool_use_id: 't1', is_error: false },
              ],
            },
          },
        ],
        { CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'TermTool' },
      ),
    ).toBe(false)
    expect(
      extractTerminalMcpToolTexts(
        {
          message: {
            content: [
              { type: 'tool_use', name: 'TermTool', input: { text: 'hi' } },
              { type: 'tool_use', name: 'Other', input: { text: 'no' } },
              { type: 'text', text: 'x' },
            ],
          },
        },
        { CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'TermTool' },
      ),
    ).toBe('hi')
    expect(
      extractTerminalMcpToolTexts(
        { message: { content: [{ type: 'tool_use', name: 'Other' }] } },
        {},
      ),
    ).toBe('')
    // Official question/file-read/syntax/scroll densables
    expect(
      resolveQuestionPreviewFormat({
        CLAUDE_CODE_QUESTION_PREVIEW_FORMAT: 'html',
      }),
    ).toBe('html')
    expect(
      resolveQuestionPreviewFormat({
        CLAUDE_CODE_QUESTION_PREVIEW_FORMAT: 'md',
      }),
    ).toBeUndefined()
    expect(
      resolveFileReadMaxOutputTokens({
        CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: '12000',
      }),
    ).toBe(12000)
    expect(
      resolveFileReadMaxOutputTokens({
        CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: '0',
      }),
    ).toBeUndefined()
    expect(
      getSyntaxHighlightUnavailableReason({
        CLAUDE_CODE_SYNTAX_HIGHLIGHT: '0',
      }),
    ).toBe('env')
    expect(
      getSyntaxHighlightUnavailableReason({
        CLAUDE_CODE_SYNTAX_HIGHLIGHT: 'Monokai',
      }),
    ).toBeNull()
    expect(resolveScrollSpeedBase({})).toBe(1)
    expect(resolveScrollSpeedBase({ CLAUDE_CODE_SCROLL_SPEED: '3' })).toBe(3)
    expect(resolveScrollSpeedBase({ CLAUDE_CODE_SCROLL_SPEED: '99' })).toBe(20)
    expect(resolveScrollSpeedBase({ CLAUDE_CODE_SCROLL_SPEED: '-1' })).toBe(1)
  })
  test('residual more env gates', async () => {
    expect(
      isClaudeApiSkillDisabled({ CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL: '1' }),
    ).toBe(true)
    expect(
      isClaudeCodeSkillDisabled({ CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL: '1' }),
    ).toBe(true)
    expect(
      isNestedChainIdleDisabled({ CLAUDE_CODE_DISABLE_NESTED_CHAIN_IDLE: '1' }),
    ).toBe(true)
    expect(
      isBackgroundPluginRefreshEnabled({
        CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH: '1',
      }),
    ).toBe(true)
    expect(
      isAdvisorToolDisabled({ CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1' }),
    ).toBe(true)
    expect(
      isExperimentalAdvisorToolEnabled({
        CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL: '1',
      }),
    ).toBe(true)
    expect(
      isGatewayModelDiscoveryEnabled({
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
      }),
    ).toBe(true)
    // Official $5l densable
    expect(
      shouldEnableGatewayModelDiscovery({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        },
        provider: 'firstParty',
      }),
    ).toBe(true)
    expect(
      shouldEnableGatewayModelDiscovery({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        },
        provider: 'firstParty',
      }),
    ).toBe(false) // Gd
    expect(
      shouldEnableGatewayModelDiscovery({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        },
        provider: 'bedrock',
      }),
    ).toBe(false)
    expect(
      shouldEnableGatewayModelDiscovery({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          // no BASE_URL
        },
        provider: 'firstParty',
      }),
    ).toBe(false)
    expect(
      parseGatewayModelOptionsFromCache({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        },
        provider: 'firstParty',
        raw: JSON.stringify({
          baseUrl: 'https://gateway.example.com',
          // densable GATEWAY_USABLE_MODEL_ID_RE requires claude|anthropic in id
          models: [
            { id: 'claude-sonnet-4', display_name: 'Gateway One' },
            { id: 'anthropic.claude-opus-4' },
            { id: 'gpt-4o' }, // filtered out
          ],
        }),
      }),
    ).toEqual([
      {
        value: 'claude-sonnet-4',
        label: 'Gateway One',
        description: 'From gateway',
      },
      {
        value: 'anthropic.claude-opus-4',
        label: 'anthropic.claude-opus-4',
        description: 'From gateway',
      },
    ])
    expect(
      parseGatewayModelOptionsFromCache({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        },
        provider: 'firstParty',
        raw: JSON.stringify({
          baseUrl: 'https://other.example.com',
          models: [{ id: 'gw-1' }],
        }),
      }),
    ).toEqual([])
    expect(getGatewayModelsCachePath('/home/u/.claude')).toBe(
      '/home/u/.claude/cache/gateway-models.json',
    )
    // Official q5l densable pure plan + injectable fetch/write
    expect(
      planGatewayModelsCacheWrite({
        baseUrl: 'https://gateway.example.com/',
        responseBody: {
          data: [
            { id: 'claude-a', display_name: 'A' },
            { id: 'anthropic.claude-b' },
            { id: 'gpt-4o' }, // filtered by isGatewayUsableModelId
            { not: 'a-model' },
          ],
        },
      }),
    ).toEqual({
      baseUrl: 'https://gateway.example.com',
      models: [
        { id: 'claude-a', display_name: 'A' },
        { id: 'anthropic.claude-b' },
      ],
    })
    expect(
      planGatewayModelsCacheWrite({
        baseUrl: 'https://gateway.example.com',
        responseBody: { data: [] },
      }),
    ).toBeUndefined()
    {
      let written: { path: string; body: string } | undefined
      const fetchResult = await fetchAndCacheGatewayModels({
        env: {
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
          ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        },
        provider: 'firstParty',
        configHome: '/tmp/claude-gw-cache-test',
        resolveAuthHeaders: () => ({ 'x-api-key': 'k' }),
        getJson: async url => {
          expect(url).toBe('https://gateway.example.com/v1/models')
          return { data: [{ id: 'claude-x', display_name: 'X' }] }
        },
        writeFile: (path, body) => {
          written = { path, body }
        },
      })
      expect(fetchResult).toEqual({
        ok: true,
        path: '/tmp/claude-gw-cache-test/cache/gateway-models.json',
        modelCount: 1,
      })
      expect(written?.path).toBe(
        '/tmp/claude-gw-cache-test/cache/gateway-models.json',
      )
      expect(JSON.parse(written?.body ?? '{}')).toEqual({
        baseUrl: 'https://gateway.example.com',
        models: [{ id: 'claude-x', display_name: 'X' }],
      })
      expect(
        await fetchAndCacheGatewayModels({
          env: {},
          provider: 'firstParty',
        }),
      ).toEqual({ ok: false, reason: 'gate_off' })
    }
    expect(
      isOpus47FastModeEnabled({ CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE: '1' }),
    ).toBe(true)
    expect(isForceBridgeEnabled({ CLAUDE_CODE_FORCE_BRIDGE: '1' })).toBe(true)
    expect(
      isForceEvaluateMemoryEnabled({
        CLAUDE_CODE_FORCE_EVALUATE_MEMORY: '1',
      }),
    ).toBe(true)
    expect(
      isForceMemorySurveyEnabled({ CLAUDE_CODE_FORCE_MEMORY_SURVEY: '1' }),
    ).toBe(true)
    expect(
      shouldPreferPluginHttps({ CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1' }),
    ).toBe(true)
    expect(
      shouldKeepMarketplaceOnFailure({
        CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE: '1',
      }),
    ).toBe(true)
    expect(
      shouldSkipFastModeOrgCheck({
        CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK: '1',
      }),
    ).toBe(true)
    expect(
      shouldSkipFastModeNetworkErrors({
        CLAUDE_CODE_SKIP_FAST_MODE_NETWORK_ERRORS: '1',
      }),
    ).toBe(true)
    expect(shouldPreferPluginHttpsOrRemote({ CLAUDE_CODE_REMOTE: '1' })).toBe(
      true,
    )
    expect(
      shouldPreferPluginHttpsOrRemote({ CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1' }),
    ).toBe(true)
    expect(shouldPreferPluginHttpsOrRemote({})).toBe(false)
    expect(
      shouldSkipProjectBackfill({ CLAUDE_CODE_SKIP_PROJECT_BACKFILL: '1' }),
    ).toBe(true)
    expect(shouldSkipRepoUpload({ CLAUDE_CODE_SKIP_REPO_UPLOAD: '1' })).toBe(
      true,
    )
    expect(
      shouldSuppressSessionAttribution({
        CLAUDE_CODE_SUPPRESS_SESSION_ATTRIBUTION: '1',
      }),
    ).toBe(true)
    expect(
      getSystemPromptGbFeature({
        CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE: 'tengu_x',
      }),
    ).toBe('tengu_x')
    expect(
      getRemoteSystemPromptGbFeatureKey({
        CLAUDE_CODE_REMOTE: '1',
        CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE: 'tengu_x',
      }),
    ).toBe('tengu_x')
    expect(
      getRemoteSystemPromptGbFeatureKey({
        CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE: 'tengu_x',
      }),
    ).toBeUndefined()
    expect(
      resolveSystemPromptWithRemoteGb({
        base: 'base-prompt',
        env: {
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE: 'tengu_x',
        },
        gbValue: 'gb-prompt',
      }),
    ).toBe('gb-prompt')
    expect(
      resolveSystemPromptWithRemoteGb({
        base: 'base-prompt',
        env: {
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE: 'tengu_x',
        },
        gbValue: '',
      }),
    ).toBe('base-prompt')
    expect(
      resolveSystemPromptWithRemoteGb({
        base: 'base-prompt',
        env: { CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE: 'tengu_x' },
        gbValue: 'gb-prompt',
      }),
    ).toBe('base-prompt')
    expect(
      shouldEnforceMcpAllowlistEnv({
        CLAUDE_CODE_MCP_ALLOWLIST_ENV: '1',
      }),
    ).toBe(true)
    expect(
      shouldEnforceMcpAllowlistEnv({
        CLAUDE_CODE_MCP_ALLOWLIST_ENV: '0',
      }),
    ).toBe(false)
    expect(
      shouldEnforceMcpAllowlistEnv({
        CLAUDE_CODE_ENTRYPOINT: 'local-agent',
      }),
    ).toBe(true)
    expect(shouldEnforceMcpAllowlistEnv({})).toBe(false)
    // Named list env key (non-boolean) → parse that env's value.
    expect(
      getMcpAllowlistFromEnv({
        CLAUDE_CODE_MCP_ALLOWLIST_ENV: 'MY_ALLOW',
        MY_ALLOW: 'a, b',
      }),
    ).toEqual(['a', 'b'])
    // Bare truthy flag → empty allowlist; bare falsy → off.
    expect(
      getMcpAllowlistFromEnv({
        CLAUDE_CODE_MCP_ALLOWLIST_ENV: '1',
      }),
    ).toEqual([])
    expect(
      getMcpAllowlistFromEnv({
        CLAUDE_CODE_MCP_ALLOWLIST_ENV: '0',
      }),
    ).toBeNull()
    expect(
      getMcpAllowlistFromEnv({
        CLAUDE_CODE_ENTRYPOINT: 'local-agent',
      }),
    ).toEqual([])
    expect(getMcpAllowlistFromEnv({})).toBeNull()
    // Official Tog/lqi/eUi stdio env densables.
    expect(getMcpStdioSafeEnvKeys('linux')).toEqual([
      'HOME',
      'LOGNAME',
      'PATH',
      'SHELL',
      'TERM',
      'USER',
    ])
    expect(getMcpStdioSafeEnvKeys('win32')).toContain('USERPROFILE')
    expect(
      pickMcpStdioSafeInheritedEnv(
        {
          HOME: '/home/u',
          PATH: '/bin',
          SECRET: 'x',
          SHELL: '() { :; }',
        },
        'linux',
      ),
    ).toEqual({ HOME: '/home/u', PATH: '/bin' })
    expect(
      buildMcpStdioBaseEnv({
        enforceAllowlist: true,
        processEnv: {
          HOME: '/h',
          PATH: '/p',
          ANTHROPIC_API_KEY: 'secret',
        },
        platform: 'linux',
        injectedEnv: { HTTPS_PROXY: 'http://127.0.0.1:1' },
        managedEnv: { HOME: '/h', ANTHROPIC_API_KEY: 'secret', FULL: '1' },
      }),
    ).toEqual({
      HOME: '/h',
      PATH: '/p',
      HTTPS_PROXY: 'http://127.0.0.1:1',
    })
    expect(
      buildMcpStdioBaseEnv({
        enforceAllowlist: false,
        managedEnv: { HOME: '/h', FULL: '1' },
      }),
    ).toEqual({ HOME: '/h', FULL: '1' })
    expect(
      buildMcpStdioTransportEnv({
        baseEnv: {
          HOME: '/h',
          CLAUDE_CODE_CHILD_SESSION: 'child',
          KEEP: 'yes',
        },
        projectDir: '/proj',
        sessionId: 'sid-1',
        serverEnv: { CUSTOM: 'c' },
      }),
    ).toEqual({
      HOME: '/h',
      KEEP: 'yes',
      CLAUDE_PROJECT_DIR: '/proj',
      CLAUDE_CODE_SESSION_ID: 'sid-1',
      CLAUDECODE: '1',
      CUSTOM: 'c',
    })
    expect(
      getResumeFromSessionId({ CLAUDE_CODE_RESUME_FROM_SESSION: 'sid' }),
    ).toBe('sid')
    expect(
      rewritePluginGitUrlPreferHttps('git@github.com:o/r.git', {
        CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1',
      }),
    ).toBe('https://github.com/o/r.git')
    expect(
      rewritePluginGitUrlPreferHttps('http://example.com/r.git', {
        CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1',
      }),
    ).toBe('https://example.com/r.git')
    // Official bZe: REMOTE also prefers HTTPS rewrite.
    expect(
      rewritePluginGitUrlPreferHttps('git@github.com:o/r.git', {
        CLAUDE_CODE_REMOTE: '1',
      }),
    ).toBe('https://github.com/o/r.git')
    expect(rewritePluginGitUrlPreferHttps('git@github.com:o/r.git', {})).toBe(
      'git@github.com:o/r.git',
    )
    expect(githubRepoGitUrl('o/r', {})).toBe('git@github.com:o/r.git')
    expect(githubRepoGitUrl('o/r', { CLAUDE_CODE_REMOTE: '1' })).toBe(
      'https://github.com/o/r.git',
    )
    expect(
      githubRepoGitUrl('o/r', { CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1' }),
    ).toBe('https://github.com/o/r.git')
  })
  test('residual final env gates sample', async () => {
    expect(isSyncPluginsEnabled({ CLAUDE_CODE_SYNC_PLUGINS: '1' })).toBe(true)
    expect(
      isBackgroundTasksDisabled({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }),
    ).toBe(true)
    expect(
      isSyncPluginInstallEnabled({ CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '1' }),
    ).toBe(true)
    expect(
      isSyncPluginsOrInstallEnabled({ CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '1' }),
    ).toBe(true)
    expect(
      isSyncPluginsOrInstallEnabled({ CLAUDE_CODE_SYNC_PLUGINS: '1' }),
    ).toBe(true)
    expect(isSyncPluginsOrInstallEnabled({})).toBe(false)
    expect(
      shouldSkipPromptHistory({ CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1' }),
    ).toBe(true)
    expect(
      isFeedbackSurveyEnvDisabled({ CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1' }),
    ).toBe(true)
    expect(shouldUseGateway({ CLAUDE_CODE_USE_GATEWAY: '1' })).toBe(true)
    expect(isTestForceDenyEnabled({ CLAUDE_CODE_TEST_FORCE_DENY: '1' })).toBe(
      true,
    )
    expect(getWorkflowsEnvPath({ CLAUDE_CODE_WORKFLOWS: '/w' })).toBe('/w')
    expect(getInvokedSkills({ CLAUDE_CODE_INVOKED_SKILLS: 'a, b' })).toEqual([
      'a',
      'b',
    ])
    expect(getProxyUrl({ CLAUDE_CODE_HTTPS_PROXY: 'https://p.example' })).toBe(
      'https://p.example',
    )
    expect(
      resolveRemoteSettingsPollMs({
        CLAUDE_CODE_REMOTE_SETTINGS_POLL_MS: '120000',
      }),
    ).toBe(120000)
    expect(
      isExperimentalObserverAgentsEnabled({
        env: { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
      }),
    ).toBe(true)
    expect(
      isExperimentalObserverAgentsEnabled({
        env: {
          CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1',
          CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
        },
      }),
    ).toBe(false)
    // Official Lmn/Jbf/Pbf defaults when env unset
    expect(resolveSyncPluginsInstallTimeoutMs({})).toBe(
      DEFAULT_SYNC_PLUGINS_INSTALL_TIMEOUT_MS,
    )
    expect(resolveSyncPluginsMcpTimeoutMs({})).toBe(
      DEFAULT_SYNC_PLUGINS_MCP_TIMEOUT_MS,
    )
    expect(resolveSyncSkillsWaitTimeoutMs({})).toBe(
      DEFAULT_SYNC_SKILLS_WAIT_TIMEOUT_MS,
    )
    expect(resolveSyncPluginInstallTimeoutOverrideMs({})).toBeUndefined()
    expect(
      resolveSyncPluginInstallTimeoutOverrideMs({
        CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS: '15000',
      }),
    ).toBe(15000)
    expect(
      resolveSyncPluginsInstallTimeoutMs({
        CLAUDE_CODE_SYNC_PLUGINS_INSTALL_TIMEOUT_MS: '45000',
      }),
    ).toBe(45000)
    // Official GRi — consume one-shot agent-view relaunch
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_AGENT_VIEW_RELAUNCH: '1',
    }
    expect(consumeAgentViewRelaunch(env)).toBe(true)
    expect(env.CLAUDE_CODE_AGENT_VIEW_RELAUNCH).toBeUndefined()
    expect(consumeAgentViewRelaunch({})).toBe(false)
    // Official BENCH_LIVE_COUNTS / TUI_JUST_SWITCHED / SIMULATE_PROXY_USAGE
    expect(
      isBenchLiveCountsEnabled({ CLAUDE_CODE_BENCH_LIVE_COUNTS: '1' }),
    ).toBe(true)
    expect(isBenchLiveCountsEnabled({})).toBe(false)
    // Official JEm CERT_STORE parse + GPo daemon cold start + design OAuth + ultrareview fixture
    expect(
      parseCertStoreSources({
        env: { CLAUDE_CODE_CERT_STORE: 'bundled,system,bundled,bogus' },
      }),
    ).toEqual(['bundled', 'system'])
    expect(
      resolveCertStoreSources({
        env: {},
        nodeOptions: '--use-system-ca',
      }),
    ).toEqual(['system'])
    expect(
      resolveDaemonColdStartMode({ CLAUDE_CODE_DAEMON_COLD_START: 'ask' }),
    ).toBe('ask')
    expect(
      resolveDaemonColdStartMode({ CLAUDE_CODE_DAEMON_COLD_START: '1' }),
    ).toBeUndefined()
    expect(
      resolveDaemonColdStartModeFull({
        env: { CLAUDE_CODE_DAEMON_COLD_START: 'ask' },
        settingsMode: 'transient',
        gbDefault: 'transient',
      }),
    ).toBe('ask')
    expect(
      resolveDaemonColdStartModeFull({
        env: {},
        settingsMode: 'ask',
        gbDefault: 'transient',
      }),
    ).toBe('ask')
    expect(resolveDaemonColdStartModeFull({ env: {} })).toBe('transient')
    // Official KF densable plan — ask vs transient vs forceTransient
    expect(
      planDaemonColdStart({
        env: { CLAUDE_CODE_DAEMON_COLD_START: 'ask' },
        mayPromptInstall: true,
      }),
    ).toEqual({
      action: 'ask_install',
      reason:
        "No background daemon is running. Run 'claude daemon install' to set it up as a persistent service.",
    })
    expect(
      planDaemonColdStart({
        env: { CLAUDE_CODE_DAEMON_COLD_START: 'ask' },
        mayPromptInstall: false,
      }),
    ).toEqual({ action: 'spawn_transient', origin: 'transient' })
    expect(
      planDaemonColdStart({
        env: { CLAUDE_CODE_DAEMON_COLD_START: 'ask' },
        installPromptDismissed: true,
      }),
    ).toEqual({ action: 'spawn_transient', origin: 'transient' })
    expect(
      planDaemonColdStart({
        env: { CLAUDE_CODE_DAEMON_COLD_START: 'ask' },
        forceTransient: true,
      }),
    ).toEqual({ action: 'spawn_transient', origin: 'transient' })
    expect(planDaemonColdStart({ env: {} })).toEqual({
      action: 'spawn_transient',
      origin: 'transient',
    })
    expect(
      parseUltrareviewPreflightFixture({
        raw: '{"reviews_remaining":1}',
      }),
    ).toEqual({ reviews_remaining: 1 })
    expect(parseUltrareviewPreflightFixture({ raw: 'not-json' })).toBeNull()
    expect(
      parseUltrareviewPreflightFixtureTyped({
        raw: '{"action":"proceed","billing_note":"n"}',
      }),
    ).toEqual({ action: 'proceed', billing_note: 'n' })
    expect(
      parseUltrareviewPreflightFixtureTyped({
        raw: '{"action":"nope"}',
      }),
    ).toBeNull()
    expect(
      resolveOverageGateFromPreflightFixture({
        fixture: { action: 'proceed', billing_note: 'ok' },
      }),
    ).toEqual({ kind: 'proceed', billingNote: 'ok' })
    expect(
      resolveOverageGateFromPreflightFixture({
        fixture: {
          action: 'blocked',
          blocked: { message: 'nope', reason: 'policy' },
        },
      }),
    ).toEqual({
      kind: 'blocked',
      message: 'nope',
      actionUrl: null,
      reason: 'policy',
    })
    expect(
      resolveOverageGateFromPreflightFixture({
        fixture: { action: 'confirm', billing_note: 'bill' },
        sessionOverageConfirmed: true,
      }),
    ).toEqual({ kind: 'proceed', billingNote: 'bill' })
    expect(
      resolveOverageGateFromPreflightFixture({
        fixture: { action: 'confirm' },
        sessionOverageConfirmed: false,
      })?.kind,
    ).toBe('needs-confirm')
    expect(
      getTuiJustSwitchedValue({ CLAUDE_CODE_TUI_JUST_SWITCHED: 'fullscreen' }),
    ).toBe('fullscreen')
    expect(
      isTuiJustSwitched({ CLAUDE_CODE_TUI_JUST_SWITCHED: 'default' }),
    ).toBe(true)
    expect(
      isTuiJustSwitchedFromFullscreen({
        CLAUDE_CODE_TUI_JUST_SWITCHED: 'fullscreen',
      }),
    ).toBe(true)
    expect(
      isTuiJustSwitchedFromFullscreen({
        CLAUDE_CODE_TUI_JUST_SWITCHED: 'default',
      }),
    ).toBe(false)
    expect(isTuiJustSwitched({})).toBe(false)
    expect(
      shouldSimulateProxyUsage({ CLAUDE_CODE_SIMULATE_PROXY_USAGE: '1' }),
    ).toBe(true)
    expect(
      filterBetasForSimulateProxyUsage(
        ['oauth-2025-04-20', 'claude-code-20250219', 'context-1m-2025-08-07'],
        'oauth-2025-04-20',
      ),
    ).toEqual(['oauth-2025-04-20'])
    expect(
      filterBetasForSimulateProxyUsage(
        ['claude-code-20250219'],
        'oauth-2025-04-20',
      ),
    ).toEqual([])
    // Official B$y plugin binary assets gate
    const {
      isPluginBinaryAssetsFeatureEnabled,
      maybeProvisionPluginBinaryAssets,
    } = await import('../plugins/pluginBinaryAssets.js')
    expect(
      isPluginBinaryAssetsFeatureEnabled({
        env: { CLAUDE_CODE_PLUGIN_BINARY_ASSETS: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(
      isPluginBinaryAssetsFeatureEnabled({ env: {}, gbValue: false }),
    ).toBe(false)
    expect(isPluginBinaryAssetsFeatureEnabled({ env: {}, gbValue: true })).toBe(
      true,
    )
    const skipped = await maybeProvisionPluginBinaryAssets('/tmp/p', 'p@m', {
      env: {},
      gbValue: false,
    })
    expect(skipped).toEqual({ status: 'skipped', reason: 'disabled' })
    const denser = await maybeProvisionPluginBinaryAssets('/tmp/p', 'p@m', {
      env: { CLAUDE_CODE_PLUGIN_BINARY_ASSETS: '1' },
    })
    expect(denser).toEqual({ status: 'skipped', reason: 'no_manifest' })
    // Official SYNC_SKILLS materialization wait densable
    const {
      clearSyncSkillMaterializations,
      formatSyncSkillNotMaterializedMessage,
      registerSyncSkillMaterialization,
      runSyncSkillMaterialization,
      waitForSyncSkillMaterialization,
    } = await import('../syncSkillsMaterialization.js')
    clearSyncSkillMaterializations()
    expect(await waitForSyncSkillMaterialization('x', { env: {} })).toEqual({
      ok: true,
    })
    const resolve = registerSyncSkillMaterialization('foo')
    const waitP = waitForSyncSkillMaterialization('foo', {
      env: { CLAUDE_CODE_SYNC_SKILLS: '1' },
    })
    resolve({ ok: false, reason: 'timeout' })
    expect(await waitP).toEqual({ ok: false, reason: 'timeout' })
    expect(formatSyncSkillNotMaterializedMessage('foo', 'timeout')).toContain(
      'could not be downloaded',
    )
    // Official Pbf wait-timeout densable
    clearSyncSkillMaterializations()
    registerSyncSkillMaterialization('slow')
    const timedOut = await waitForSyncSkillMaterialization('slow', {
      env: { CLAUDE_CODE_SYNC_SKILLS: '1' },
      timeoutMs: 20,
    })
    expect(timedOut.ok).toBe(false)
    if (!timedOut.ok) {
      expect(timedOut.reason).toContain('wait timed out')
    }
    // Official Dsd producer densable — register + work + settle
    clearSyncSkillMaterializations()
    const producerWait = waitForSyncSkillMaterialization('prod', {
      env: { CLAUDE_CODE_SYNC_SKILLS: '1' },
      timeoutMs: 500,
    })
    const producerResult = await runSyncSkillMaterialization(
      'prod',
      async () => ({ ok: true as const }),
      { env: { CLAUDE_CODE_SYNC_SKILLS: '1' } },
    )
    expect(producerResult).toEqual({ ok: true })
    expect(await producerWait).toEqual({ ok: true })
    // env off: work runs without registry
    expect(
      await runSyncSkillMaterialization(
        'off',
        async () => ({ ok: true as const }),
        { env: {} },
      ),
    ).toEqual({ ok: true })
    // Official TRIGGER_ID pure helper
    const {
      getTriggerId,
      resolveFableBridgeDialogTimeoutMsOrDefault,
      DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS,
    } = await import('../residualFinalEnvGates.js')
    expect(getTriggerId({ CLAUDE_CODE_TRIGGER_ID: 'trig-1' })).toBe('trig-1')
    expect(getTriggerId({})).toBeUndefined()
    expect(resolveFableBridgeDialogTimeoutMsOrDefault({})).toBe(
      DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS,
    )
    expect(
      resolveFableBridgeDialogTimeoutMsOrDefault({
        CLAUDE_CODE_FABLE_BRIDGE_DIALOG_TIMEOUT_MS: '12000',
      }),
    ).toBe(12000)
  })

  test('raceWithTimeoutMs and format timeout log', async () => {
    const done = await raceWithTimeoutMs(Promise.resolve(42), 0)
    expect(done).toEqual({ status: 'completed', value: 42 })
    const timed = await raceWithTimeoutMs(new Promise<number>(() => {}), 20)
    expect(timed.status).toBe('timeout')
    expect(formatSyncPluginInstallTimeoutLog(15000)).toBe(
      'CLAUDE_CODE_SYNC_PLUGIN_INSTALL: plugin installation timed out after 15000ms',
    )
  })

  test('official feh workflows availability', () => {
    expect(
      resolveWorkflowsAvailability({
        env: { CLAUDE_CODE_WORKFLOWS: '1' },
        gbEnabled: true,
      }),
    ).toEqual({ available: true, defaultOn: true })
    expect(
      resolveWorkflowsAvailability({
        env: { CLAUDE_CODE_WORKFLOWS: '1' },
        gbEnabled: false,
      }),
    ).toEqual({ available: false, defaultOn: false })
    expect(
      resolveWorkflowsAvailability({
        env: { CLAUDE_CODE_WORKFLOWS: '0' },
        gbEnabled: true,
      }),
    ).toEqual({ available: false, defaultOn: false })
    expect(
      resolveWorkflowsAvailability({
        env: {},
        gbEnabled: false,
      }),
    ).toEqual({ available: false, defaultOn: false })
    expect(
      resolveWorkflowsAvailability({
        env: {},
        gbEnabled: true,
        subscriptionType: 'pro',
      }),
    ).toEqual({ available: true, defaultOn: false })
    expect(
      resolveWorkflowsAvailability({
        env: {},
        gbEnabled: true,
        subscriptionType: 'max',
      }),
    ).toEqual({ available: true, defaultOn: true })
    expect(
      isWorkflowsDisabled(
        { CLAUDE_CODE_DISABLE_WORKFLOWS: '1' },
        { gbEnabled: true },
      ),
    ).toBe(true)
    expect(
      isWorkflowsDisabled({ CLAUDE_CODE_WORKFLOWS: '0' }, { gbEnabled: true }),
    ).toBe(true)
    expect(
      isWorkflowsAvailable({ CLAUDE_CODE_WORKFLOWS: '1' }, { gbEnabled: true }),
    ).toBe(true)
    expect(
      isWorkflowsDisabled({}, { gbEnabled: true, policyAllow: false }),
    ).toBe(true)
  })

  test('official t2u/Kro relaunch terminal size', () => {
    expect(parseRelaunchTerminalSize('80x24')).toEqual({
      columns: 80,
      rows: 24,
    })
    expect(parseRelaunchTerminalSize('1')).toBeNull()
    expect(parseRelaunchTerminalSize('0x10')).toBeNull()
    expect(parseRelaunchTerminalSize(undefined)).toBeNull()
    expect(
      isRelaunchTerminalSizeEnabled({
        CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE: '120x40',
      }),
    ).toBe(true)
    expect(
      isRelaunchTerminalSizeEnabled({
        CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE: '1',
      }),
    ).toBe(false)
    expect(buildRelaunchTerminalSizeEnv({ columns: 100, rows: 30 })).toEqual({
      CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE: '100x30',
    })
    expect(buildRelaunchTerminalSizeEnv({ columns: 0, rows: 30 })).toEqual({})
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE: '90x25',
    }
    const stdout = {
      columns: undefined as number | undefined,
      rows: undefined as number | undefined,
    }
    const applied = applyRelaunchTerminalSizeFromEnv({
      env,
      isTTY: true,
      stdout,
    })
    expect(applied).toEqual({ columns: 90, rows: 25 })
    expect(stdout.columns).toBe(90)
    expect(stdout.rows).toBe(25)
    expect(env.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBeUndefined()
    // does not overwrite existing columns/rows
    const env2: NodeJS.ProcessEnv = {
      CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE: '50x20',
    }
    const stdout2 = { columns: 200, rows: 60 }
    applyRelaunchTerminalSizeFromEnv({
      env: env2,
      isTTY: true,
      stdout: stdout2,
    })
    expect(stdout2.columns).toBe(200)
    expect(stdout2.rows).toBe(60)
    // non-TTY still deletes env, no apply
    const env3: NodeJS.ProcessEnv = {
      CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE: '80x24',
    }
    expect(
      applyRelaunchTerminalSizeFromEnv({ env: env3, isTTY: false }),
    ).toBeNull()
    expect(env3.CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE).toBeUndefined()
  })

  test('official WW/IIe feedback survey for OTEL', () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevDisableTelemetry = process.env.DISABLE_TELEMETRY
    const prevOtel = process.env.CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL
    const prevEssential = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    try {
      // Isolate privacy + otel env; keep NODE_ENV out of 'test' for the
      // telemetry-only cases by passing an explicit env bag.
      delete process.env.DISABLE_TELEMETRY
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      delete process.env.CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL

      expect(
        isFeedbackSurveyDisabled({
          NODE_ENV: 'test',
        }),
      ).toBe(true)

      // Telemetry off → survey disabled
      process.env.DISABLE_TELEMETRY = '1'
      expect(
        isFeedbackSurveyDisabled({
          NODE_ENV: 'production',
        }),
      ).toBe(true)

      // Official IIe: OTEL force-enable overrides telemetry privacy
      expect(
        isFeedbackSurveyDisabled({
          NODE_ENV: 'production',
          CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL: '1',
        }),
      ).toBe(false)

      delete process.env.DISABLE_TELEMETRY
      expect(
        isFeedbackSurveyDisabled({
          NODE_ENV: 'production',
        }),
      ).toBe(false)
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevDisableTelemetry === undefined)
        delete process.env.DISABLE_TELEMETRY
      else process.env.DISABLE_TELEMETRY = prevDisableTelemetry
      if (prevOtel === undefined)
        delete process.env.CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL
      else process.env.CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL = prevOtel
      if (prevEssential === undefined)
        delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = prevEssential
    }
  })
})

/**
 * Cont.23 schema-only densables (2.1.207): pure env helpers, no product
 * consumers. Keep truthy/falsy/default coverage so accidental product rewires
 * don't hide behind missing unit tests.
 */
describe('cont.23 schema-only densables (no product consumer)', () => {
  test('shouldSkipProjectBackfill truthy / falsy / default', () => {
    expect(
      shouldSkipProjectBackfill({ CLAUDE_CODE_SKIP_PROJECT_BACKFILL: '1' }),
    ).toBe(true)
    expect(
      shouldSkipProjectBackfill({ CLAUDE_CODE_SKIP_PROJECT_BACKFILL: 'true' }),
    ).toBe(true)
    expect(
      shouldSkipProjectBackfill({ CLAUDE_CODE_SKIP_PROJECT_BACKFILL: '0' }),
    ).toBe(false)
    expect(
      shouldSkipProjectBackfill({ CLAUDE_CODE_SKIP_PROJECT_BACKFILL: 'false' }),
    ).toBe(false)
    expect(shouldSkipProjectBackfill({})).toBe(false)
  })

  test('shouldSkipRepoUpload truthy / falsy / default', () => {
    expect(shouldSkipRepoUpload({ CLAUDE_CODE_SKIP_REPO_UPLOAD: '1' })).toBe(
      true,
    )
    expect(shouldSkipRepoUpload({ CLAUDE_CODE_SKIP_REPO_UPLOAD: 'yes' })).toBe(
      true,
    )
    expect(shouldSkipRepoUpload({ CLAUDE_CODE_SKIP_REPO_UPLOAD: '0' })).toBe(
      false,
    )
    expect(shouldSkipRepoUpload({ CLAUDE_CODE_SKIP_REPO_UPLOAD: 'off' })).toBe(
      false,
    )
    expect(shouldSkipRepoUpload({})).toBe(false)
  })

  test('isAgentRuleDisabled truthy / falsy / default', () => {
    expect(isAgentRuleDisabled({ CLAUDE_CODE_AGENT_RULE_DISABLED: '1' })).toBe(
      true,
    )
    expect(
      isAgentRuleDisabled({ CLAUDE_CODE_AGENT_RULE_DISABLED: 'true' }),
    ).toBe(true)
    expect(isAgentRuleDisabled({ CLAUDE_CODE_AGENT_RULE_DISABLED: '0' })).toBe(
      false,
    )
    expect(isAgentRuleDisabled({ CLAUDE_CODE_AGENT_RULE_DISABLED: 'no' })).toBe(
      false,
    )
    expect(isAgentRuleDisabled({})).toBe(false)
  })
})

describe('skip-auth + anthropicAws/mantle densable', () => {
  test('shouldSkipAnthropicAwsAuth / shouldSkipMantleAuth / HFI', () => {
    expect(
      shouldSkipAnthropicAwsAuth({ CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH: '1' }),
    ).toBe(true)
    expect(shouldSkipAnthropicAwsAuth({})).toBe(false)
    expect(shouldSkipMantleAuth({ CLAUDE_CODE_SKIP_MANTLE_AUTH: '1' })).toBe(
      true,
    )
    expect(
      shouldSkipHfiVersionCheck({ CLAUDE_CODE_SKIP_HFI_VERSION_CHECK: '1' }),
    ).toBe(true)
    expect(
      isAnthropicAwsProviderEnabled({ CLAUDE_CODE_USE_ANTHROPIC_AWS: '1' }),
    ).toBe(true)
    expect(isMantleProviderEnabled({ CLAUDE_CODE_USE_MANTLE: '1' })).toBe(true)
    expect(getHfiBearerToken({ CLAUDE_CODE_HFI_BEARER_TOKEN: ' tok ' })).toBe(
      'tok',
    )
  })

  test('extractAuthorizationHeader + apiKeyFromAuthorizationHeader (kTt)', () => {
    const { value, rest } = extractAuthorizationHeader({
      Authorization: 'Bearer abc',
      'X-Api-Key': 'k',
      'Content-Type': 'application/json',
    })
    expect(value).toBe('Bearer abc')
    expect(rest).toEqual({
      'X-Api-Key': 'k',
      'Content-Type': 'application/json',
    })
    expect(apiKeyFromAuthorizationHeader('Bearer abc')).toBe('abc')
    expect(apiKeyFromAuthorizationHeader('raw-token')).toBe('raw-token')
    expect(apiKeyFromAuthorizationHeader(undefined)).toBeUndefined()
  })

  test('GB refresh interval pure helper + official default 6h', () => {
    expect(resolveGbRefreshIntervalMs({})).toBeUndefined()
    expect(
      resolveGbRefreshIntervalMs({
        CLAUDE_CODE_GB_REFRESH_INTERVAL_MS: '1000',
      }),
    ).toBe(1000)
    expect(resolveGbRefreshIntervalMsOrDefault({})).toBe(
      OFFICIAL_GB_REFRESH_INTERVAL_MS,
    )
    expect(OFFICIAL_GB_REFRESH_INTERVAL_MS).toBe(21_600_000)
    expect(
      resolveGbRefreshIntervalMsOrDefault({
        CLAUDE_CODE_GB_REFRESH_INTERVAL_MS: '5000',
      }),
    ).toBe(5000)
  })
})

describe('SDK oauth/host auth refresh densables', () => {
  test('hasSdkOauthRefresh / shouldRegisterSdkOauthRefreshCallback (cRi)', () => {
    expect(hasSdkOauthRefresh({})).toBe(false)
    expect(hasSdkOauthRefresh({ CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: '1' })).toBe(
      true,
    )
    expect(
      shouldRegisterSdkOauthRefreshCallback({
        CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: '1',
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      }),
    ).toBe(true)
    expect(
      shouldRegisterSdkOauthRefreshCallback({
        CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      }),
    ).toBe(false)
    expect(
      shouldRegisterSdkOauthRefreshCallback({
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      }),
    ).toBe(false)
  })

  test('host auth refresh entrypoints (lfm/LQ)', () => {
    expect(
      isSdkHostAuthRefreshEntrypoint({
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p',
      }),
    ).toBe(true)
    expect(
      isSdkHostAuthRefreshEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'cli' }),
    ).toBe(false)
    expect(
      shouldRegisterSdkHostAuthRefreshCallback({
        CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1',
        CLAUDE_CODE_ENTRYPOINT: 'local-agent',
      }),
    ).toBe(true)
    expect(
      shouldRegisterSdkHostAuthRefreshCallback({
        CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      }),
    ).toBe(false)
    expect(hasSdkHostAuthRefresh({})).toBe(false)
    expect(DEFAULT_SDK_AUTH_REFRESH_CONTROL_TIMEOUT_MS).toBe(30_000)
  })
})

describe('download stall/deadline + spawn timestamp densables', () => {
  test('stall timeout YJg OrDefault', () => {
    expect(resolveStallTimeoutMsForTesting({})).toBeUndefined()
    expect(
      resolveStallTimeoutMsForTesting({
        CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING: '12000',
      }),
    ).toBe(12_000)
    expect(resolveStallTimeoutMsForTestingOrDefault({})).toBe(
      DEFAULT_STALL_TIMEOUT_MS_FOR_TESTING,
    )
    expect(DEFAULT_STALL_TIMEOUT_MS_FOR_TESTING).toBe(60_000)
  })

  test('download deadline JJg OrDefault', () => {
    expect(resolveDownloadDeadlineMsForTesting({})).toBeUndefined()
    expect(
      resolveDownloadDeadlineMsForTesting({
        CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING: '90000',
      }),
    ).toBe(90_000)
    expect(resolveDownloadDeadlineMsForTestingOrDefault({})).toBe(
      DEFAULT_DOWNLOAD_DEADLINE_MS_FOR_TESTING,
    )
    expect(DEFAULT_DOWNLOAD_DEADLINE_MS_FOR_TESTING).toBe(300_000)
  })

  test('spawn timestamp $qa densable prefers CCR then CLAUDE_CODE', () => {
    expect(resolveSpawnTimestampMs({})).toBeUndefined()
    expect(
      resolveSpawnTimestampMs({ CLAUDE_CODE_SPAWN_TIMESTAMP_MS: '1000' }),
    ).toBe(1000)
    expect(
      resolveSpawnTimestampMs({
        CCR_SPAWN_TIMESTAMP_MS: '2000',
        CLAUDE_CODE_SPAWN_TIMESTAMP_MS: '1000',
      }),
    ).toBe(2000)
    expect(
      resolveSpawnToFirstCheckpointMs({
        firstCheckpointMs: 1500,
        spawnTimestampMs: 1000,
      }),
    ).toBe(500)
    expect(
      resolveSpawnToFirstCheckpointMs({ firstCheckpointMs: undefined }),
    ).toBeUndefined()
  })

  test('test no git bash / no pwsh gates', () => {
    expect(isTestNoGitBash({ CLAUDE_CODE_TEST_NO_GIT_BASH: '1' })).toBe(true)
    expect(isTestNoGitBash({})).toBe(false)
    expect(isTestNoPwsh({ CLAUDE_CODE_TEST_NO_PWSH: '1' })).toBe(true)
    expect(isTestNoPwsh({})).toBe(false)
  })
})

describe('DISABLE_CRON + BRIEF_UPLOAD densables', () => {
  test('official T9 kairos cron: !DISABLE_CRON && GB', () => {
    expect(isCronDisabled({ CLAUDE_CODE_DISABLE_CRON: '1' })).toBe(true)
    expect(isCronDisabled({})).toBe(false)
    expect(resolveKairosCronEnabled({})).toBe(true)
    expect(resolveKairosCronEnabled({ gbValue: true })).toBe(true)
    expect(resolveKairosCronEnabled({ gbValue: false })).toBe(false)
    expect(
      resolveKairosCronEnabled({
        env: { CLAUDE_CODE_DISABLE_CRON: '1' },
        gbValue: true,
      }),
    ).toBe(false)
    expect(
      resolveKairosCronEnabled({
        env: { CLAUDE_CODE_DISABLE_CRON: '0' },
        gbValue: true,
      }),
    ).toBe(true)
  })

  test('official brief upload eligibility: bridge || BRIEF_UPLOAD || remote env || REMOTE', () => {
    expect(shouldUploadBriefAttachments({})).toBe(false)
    expect(shouldUploadBriefAttachments({ replBridgeEnabled: true })).toBe(true)
    expect(
      shouldUploadBriefAttachments({
        env: { CLAUDE_CODE_BRIEF_UPLOAD: '1' },
      }),
    ).toBe(true)
    expect(
      shouldUploadBriefAttachments({
        env: { CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'ccr' },
      }),
    ).toBe(true)
    expect(
      shouldUploadBriefAttachments({
        env: { CLAUDE_CODE_REMOTE: '1' },
      }),
    ).toBe(true)
    expect(
      shouldUploadBriefAttachments({
        env: { CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: '' },
      }),
    ).toBe(false)
  })

  test('official stt/z6i pewter owl + Ztg brief enforce + KO REPL densables', () => {
    expect(isPewterOwlToolEnabled({})).toBe(false)
    expect(
      isPewterOwlToolEnabled({
        env: { CLAUDE_CODE_PEWTER_OWL_TOOL: '1' },
      }),
    ).toBe(true)
    expect(
      isPewterOwlToolEnabled({
        env: { CLAUDE_CODE_PEWTER_OWL_TOOL: '0' },
      }),
    ).toBe(false)
    expect(isPewterOwlToolEnabled({ gbValue: true })).toBe(true)
    expect(isPewterOwlBriefEnabled({})).toBe(false)
    expect(
      isPewterOwlBriefEnabled({ env: { CLAUDE_CODE_PEWTER_OWL: '1' } }),
    ).toBe(true)
    expect(isPewterOwlBriefEnabled({ gbValue: true })).toBe(true)
    expect(
      getBriefEnforceText({
        gbText: '',
        defaultText: 'default',
      }),
    ).toBe('default')
    expect(
      getBriefEnforceText({
        gbText: 'override',
        defaultText: 'default',
      }),
    ).toBe('override')
    expect(resolveReplModeEnabled({})).toBe(false)
    expect(resolveReplModeEnabled({ env: { CLAUDE_CODE_REPL: '0' } })).toBe(
      false,
    )
    expect(resolveReplModeEnabled({ env: { CLAUDE_CODE_REPL: '1' } })).toBe(
      true,
    )
    expect(resolveReplModeEnabled({ env: { CLAUDE_REPL_MODE: '1' } })).toBe(
      true,
    )
    expect(
      resolveReplModeEnabled({
        env: { CLAUDE_CODE_ENTRYPOINT: 'cli' },
        gbValue: true,
      }),
    ).toBe(true)
    expect(
      resolveReplModeEnabled({
        env: { CLAUDE_CODE_ENTRYPOINT: 'remote' },
        antDefault: true,
      }),
    ).toBe(true)
    expect(
      resolveReplModeEnabled({
        env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' },
        gbValue: true,
      }),
    ).toBe(false)
  })

  test('official brief-mode stop-hook enforce densable', () => {
    expect(
      isBriefModeStopHookDisabled({ DISABLE_BRIEF_MODE_STOP_HOOK: '1' }),
    ).toBe(true)
    expect(isBriefModeStopHookDisabled({})).toBe(false)
    expect(
      messagesIncludeBriefToolUse(
        [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', name: 'SendUserMessage' }],
            },
          },
        ],
        ['SendUserMessage', 'Brief'],
      ),
    ).toBe(true)
    expect(
      messagesIncludeBriefToolUse(
        [
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'hi' }] },
          },
        ],
        ['SendUserMessage'],
      ),
    ).toBe(false)
    expect(
      messagesIncludeBriefEnforceSentinel(
        [
          {
            type: 'user',
            isMeta: true,
            message: {
              content: 'You ended the turn without calling SendUserMessage. x',
            },
          },
        ],
        'You ended the turn without calling SendUserMessage.',
      ),
    ).toBe(true)
    const enforce = resolveBriefModeStopHookEnforce({
      querySource: 'repl_main_thread',
      isBriefEnabled: true,
      toolsIncludeBrief: true,
      messagesSinceLastUser: [],
      assistantMessages: [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hidden' }] },
        },
      ],
      briefToolNames: ['SendUserMessage', 'Brief'],
      sentinel: 'You ended the turn without calling SendUserMessage.',
      enforceText: 'Call it now.',
    })
    expect(enforce).toBe(
      'You ended the turn without calling SendUserMessage. Call it now.',
    )
    expect(
      resolveBriefModeStopHookEnforce({
        querySource: 'repl_main_thread',
        isBriefEnabled: true,
        toolsIncludeBrief: true,
        messagesSinceLastUser: [],
        assistantMessages: [
          {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', name: 'SendUserMessage' }],
            },
          },
        ],
        briefToolNames: ['SendUserMessage', 'Brief'],
        sentinel: 'SENT',
        enforceText: 'x',
      }),
    ).toBeNull()
    expect(
      resolveBriefModeStopHookEnforce({
        querySource: 'agent:foo',
        isBriefEnabled: true,
        toolsIncludeBrief: true,
        messagesSinceLastUser: [],
        assistantMessages: [],
        briefToolNames: ['SendUserMessage'],
        sentinel: 'SENT',
        enforceText: 'x',
      }),
    ).toBeNull()
  })

  test('official NEW_INIT / bundled skills / tools-list brief / planMode / noFlicker densables', () => {
    expect(isNewInitEnvEnabled({ CLAUDE_CODE_NEW_INIT: '1' })).toBe(true)
    expect(resolveNewInitEnabled({})).toBe(false)
    expect(resolveNewInitEnabled({ gbValue: true })).toBe(true)
    expect(
      resolveNewInitEnabled({
        env: { CLAUDE_CODE_NEW_INIT: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(isBundledSkillsDisabled({})).toBe(false)
    expect(
      isBundledSkillsDisabled({
        env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1' },
      }),
    ).toBe(true)
    expect(
      isBundledSkillsDisabled({ settingsDisableBundledSkills: true }),
    ).toBe(true)
    expect(
      shouldToolsListOptInToBrief({
        toolNames: ['Bash', 'SendUserMessage'],
        briefToolNames: ['SendUserMessage', 'Brief'],
        isBriefEntitled: true,
      }),
    ).toBe(true)
    expect(
      shouldToolsListOptInToBrief({
        toolNames: ['Bash', 'SendUserMessage'],
        briefToolNames: ['SendUserMessage', 'Brief'],
        isPewterOwlTool: true,
        isBriefEntitled: true,
      }),
    ).toBe(false)
    expect(
      shouldToolsListOptInToBrief({
        toolNames: ['Bash'],
        briefToolNames: ['SendUserMessage'],
        isBriefEntitled: true,
      }),
    ).toBe(false)
    expect(
      isPlanModeRequiredFromEnv({ CLAUDE_CODE_PLAN_MODE_REQUIRED: '1' }),
    ).toBe(true)
    expect(isNoFlickerEnabled({ CLAUDE_CODE_NO_FLICKER: '1' })).toBe(true)
  })

  test('official skill-shell / fable timeout / exit-after densables', () => {
    expect(isSkillShellExecutionDisabled({})).toBe(false)
    expect(
      isSkillShellExecutionDisabled({
        env: { CLAUDE_CODE_IS_COWORK: '1' },
      }),
    ).toBe(true)
    expect(
      isSkillShellExecutionDisabled({
        policyDisableSkillShellExecution: true,
      }),
    ).toBe(true)
    expect(
      isSkillShellExecutionDisabled({
        settingsDisableSkillShellExecution: true,
      }),
    ).toBe(true)

    const strippedBlock = stripSkillShellCommands(
      'before\n```!\necho hi\n```\nafter',
    )
    expect(strippedBlock).toContain(SKILL_SHELL_DISABLED_PLACEHOLDER)
    expect(strippedBlock).not.toContain('echo hi')
    expect(stripSkillShellCommands('run !`ls -la` now')).toContain(
      SKILL_SHELL_DISABLED_PLACEHOLDER,
    )
    // Non-shell inline code must not be stripped.
    expect(stripSkillShellCommands('use `!!` carefully')).toBe(
      'use `!!` carefully',
    )

    expect(resolveFableBridgeDialogTimeoutMsOrDefault({})).toBe(
      DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS,
    )
    expect(
      resolveFableBridgeDialogTimeoutMsOrDefault({
        CLAUDE_CODE_FABLE_BRIDGE_DIALOG_TIMEOUT_MS: '45000',
      }),
    ).toBe(45000)
    expect(
      resolveFableBridgeDialogTimeoutMsOrDefault({
        CLAUDE_CODE_FABLE_BRIDGE_DIALOG_TIMEOUT_MS: '0',
      }),
    ).toBe(DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS)

    expect(resolveExitAfterStopDelayMs({})).toBeNull()
    expect(
      resolveExitAfterStopDelayMs({
        CLAUDE_CODE_EXIT_AFTER_STOP_DELAY: '5000',
      }),
    ).toBe(5000)
    expect(
      resolveExitAfterStopDelayMs({ CLAUDE_CODE_EXIT_AFTER_STOP_DELAY: '0' }),
    ).toBeNull()
    expect(
      resolveExitAfterStopDelayMs({ CLAUDE_CODE_EXIT_AFTER_STOP_DELAY: 'x' }),
    ).toBeNull()
    expect(isExitAfterFirstRenderEnabled({})).toBe(false)
    expect(
      isExitAfterFirstRenderEnabled({
        CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER: '1',
      }),
    ).toBe(true)

    // Official settings halves for remote-control / workflows densables
    expect(isRemoteControlDisabledBySettings(true)).toBe(true)
    expect(isRemoteControlDisabledBySettings(false)).toBe(false)
    expect(isRemoteControlDisabledBySettings(undefined)).toBe(false)
    expect(
      isWorkflowsSettingsDisabled({
        env: { CLAUDE_CODE_DISABLE_WORKFLOWS: '1' },
      }),
    ).toBe(true)
    expect(
      isWorkflowsSettingsDisabled({ settingsDisableWorkflows: true }),
    ).toBe(true)
    expect(isWorkflowsSettingsDisabled({})).toBe(false)
    expect(isWorkflowKeywordTriggerEnabled(undefined)).toBe(true)
    expect(isWorkflowKeywordTriggerEnabled(false)).toBe(false)
    expect(
      isWorkflowsDisabled(
        {},
        { settingsDisableWorkflows: true, gbEnabled: true },
      ),
    ).toBe(true)

    // Official m6e/k1o/IJ/Lqe skill override densables
    expect(
      isBuiltinPromptSkillDisabledByBundledSetting(
        { type: 'prompt', source: 'builtin' },
        { settingsDisableBundledSkills: true },
      ),
    ).toBe(true)
    expect(
      isBuiltinPromptSkillDisabledByBundledSetting(
        { type: 'prompt', source: 'plugin' },
        { settingsDisableBundledSkills: true },
      ),
    ).toBe(false)
    expect(
      resolveSkillOverrideMode(
        { type: 'prompt', source: 'skills', name: 'foo' },
        { skillOverrides: { foo: 'off' } },
      ),
    ).toBe('off')
    expect(
      resolveSkillOverrideMode(
        { type: 'prompt', source: 'plugin', name: 'foo' },
        { skillOverrides: { foo: 'off' } },
      ),
    ).toBe('on')
    expect(
      resolveSkillOverrideMode(
        { type: 'prompt', source: 'builtin', name: 'init' },
        { settingsDisableBundledSkills: true },
      ),
    ).toBe('user-invocable-only')
    expect(isSkillModelInvocationBlockedByOverride('user-invocable-only')).toBe(
      true,
    )
    expect(isSkillModelInvocationBlockedByOverride('name-only')).toBe(true)
    expect(isSkillFullyDisabledByOverride('off')).toBe(true)
    // Official RQd / OQd densables
    expect(SKILL_OVERRIDE_CYCLE_MODES).toEqual([
      'on',
      'name-only',
      'user-invocable-only',
      'off',
    ])
    expect(cycleSkillOverrideMode('on')).toBe('name-only')
    expect(cycleSkillOverrideMode('name-only')).toBe('user-invocable-only')
    expect(cycleSkillOverrideMode('user-invocable-only')).toBe('off')
    expect(cycleSkillOverrideMode('off')).toBe('on')
    expect(cycleSkillOverrideMode('on', 'policy')).toBe('on')
    expect(cycleSkillOverrideMode('off', 'author')).toBe('user-invocable-only')
    expect(cycleSkillOverrideMode('on', 'author')).toBe('off')
    expect(
      resolveSkillOverrideWriteValue('on', {
        cmdName: 'foo',
        userOverrides: { foo: 'on' },
      }),
    ).toBeUndefined()
    expect(
      resolveSkillOverrideWriteValue('off', {
        cmdName: 'foo',
        userOverrides: { foo: 'on' },
      }),
    ).toBe('off')
    expect(formatSkillOverrideModeLabel('name-only')).toBe('name only')
    expect(clampMaxOutputTokensOverride(null, 32_000, 64_000).status).toBe(
      'default',
    )
    expect(clampMaxOutputTokensOverride(8192, 32_000, 64_000)).toEqual({
      effective: 8192,
      status: 'valid',
    })
    expect(clampMaxOutputTokensOverride(100_000, 32_000, 64_000)).toEqual({
      effective: 64_000,
      status: 'capped',
    })
    expect(clampMaxOutputTokensOverride('abc', 32_000, 64_000).status).toBe(
      'invalid',
    )
    expect(
      isSkillModelListable(
        {
          type: 'prompt',
          source: 'skills',
          name: 'bar',
          loadedFrom: 'skills',
        },
        {},
      ),
    ).toBe(true)
    expect(
      isSkillModelListable(
        {
          type: 'prompt',
          source: 'skills',
          name: 'bar',
          loadedFrom: 'skills',
        },
        { skillOverrides: { bar: 'off' } },
      ),
    ).toBe(false)
    expect(
      isSkillModelListable(
        {
          type: 'prompt',
          source: 'builtin',
          name: 'help',
        },
        {},
      ),
    ).toBe(true)

    // Official Ryt / P7t / peh densables
    expect(isClaudeAiConnectorsDisabledBySources([false, true])).toBe(true)
    expect(isClaudeAiConnectorsDisabledBySources([undefined, false])).toBe(
      false,
    )
    expect(resolveEnableArtifactFromSources([undefined, true, false])).toBe(
      true,
    )
    expect(resolveEnableArtifactFromSources([undefined, undefined])).toBe(
      undefined,
    )
    expect(resolveEnableWorkflowsSetting(true)).toBe(true)
    expect(resolveEnableWorkflowsSetting(undefined)).toBeUndefined()

    expect(isBgExitHandoffDisabled({})).toBe(false)
    expect(
      isBgExitHandoffDisabled({ CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF: '1' }),
    ).toBe(true)

    // Official residual env densables — compact/glob/emit/protect/dirs
    expect(resolveAutoCompactWindowOverride({})).toBeNull()
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000',
      }),
    ).toBe(100000)
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '0',
      }),
    ).toBeNull()
    expect(
      resolveBlockingLimitOverride({
        CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '50000',
      }),
    ).toBe(50000)
    expect(resolveBlockingLimitOverride({})).toBeNull()
    expect(
      resolveGlobTimeoutSeconds({ CLAUDE_CODE_GLOB_TIMEOUT_SECONDS: '45' }),
    ).toBe(45)
    expect(resolveGlobTimeoutSeconds({})).toBeNull()
    expect(
      isEmitToolUseSummariesEnabled({
        CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '1',
      }),
    ).toBe(true)
    expect(
      isEmitSessionStateEventsEnabled({
        CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
      }),
    ).toBe(true)
    expect(isDontInheritEnvEnabled({ CLAUDE_CODE_DONT_INHERIT_ENV: '1' })).toBe(
      true,
    )
    expect(
      isAdditionalProtectionEnabled({
        CLAUDE_CODE_ADDITIONAL_PROTECTION: '1',
      }),
    ).toBe(true)
    expect(
      isAdditionalDirectoriesClaudeMdEnabled({
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
      }),
    ).toBe(true)

    // Official MAX_CONTEXT / SLOW_OP / PLUGIN_GIT / MAX_OUTPUT densables
    expect(resolveMaxContextTokensOverride({})).toBeNull()
    expect(
      resolveMaxContextTokensOverride({
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000',
      }),
    ).toBe(500000)
    expect(
      resolveSlowOperationThresholdMs({
        CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS: '50',
      }),
    ).toBe(50)
    expect(resolveSlowOperationThresholdMs({ NODE_ENV: 'development' })).toBe(
      20,
    )
    expect(resolveSlowOperationThresholdMs({ USER_TYPE: 'ant' })).toBe(300)
    expect(resolvePluginGitTimeoutMs({})).toBe(DEFAULT_PLUGIN_GIT_TIMEOUT_MS)
    expect(
      resolvePluginGitTimeoutMs({
        CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS: '300000',
      }),
    ).toBe(300000)
    expect(resolveMaxOutputTokensOverride({})).toBeNull()
    expect(
      resolveMaxOutputTokensOverride({
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192',
      }),
    ).toBe(8192)

    // Official DISABLE_* densables
    expect(is1mContextEnvDisabled({})).toBe(false)
    expect(
      is1mContextEnvDisabled({ CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' }),
    ).toBe(true)
    expect(isThinkingDisabled({ CLAUDE_CODE_DISABLE_THINKING: '1' })).toBe(true)
    expect(
      isAdaptiveThinkingDisabled({
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
      }),
    ).toBe(true)
    expect(
      isAttachmentsDisabled({ CLAUDE_CODE_DISABLE_ATTACHMENTS: '1' }),
    ).toBe(true)
    expect(isClaudeMdsDisabled({ CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' })).toBe(
      true,
    )
    expect(
      isTerminalTitleDisabled({ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' }),
    ).toBe(true)
    expect(
      isFileCheckpointingDisabled({
        CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: '1',
      }),
    ).toBe(true)
    expect(
      isPolicySkillsDisabled({ CLAUDE_CODE_DISABLE_POLICY_SKILLS: '1' }),
    ).toBe(true)
    expect(
      isNonstreamingFallbackDisabled({
        CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
      }),
    ).toBe(true)
    expect(
      isExperimentalBetasDisabled({
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      }),
    ).toBe(true)
    expect(
      isOfficialMarketplaceAutoinstallDisabled({
        CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
      }),
    ).toBe(true)
    expect(isFastModeDisabled({ CLAUDE_CODE_DISABLE_FAST_MODE: '1' })).toBe(
      true,
    )
    expect(isFastModeDisabled({})).toBe(false)

    // Official residual densables cont. 9
    expect(
      isVirtualScrollDisabled({ CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL: '1' }),
    ).toBe(true)
    expect(
      isMessageActionsDisabled({ CLAUDE_CODE_DISABLE_MESSAGE_ACTIONS: '1' }),
    ).toBe(true)
    expect(
      isPrecompactSkipDisabled({ CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP: '1' }),
    ).toBe(true)
    expect(
      isTokenUsageAttachmentEnabled({
        CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT: '1',
      }),
    ).toBe(true)
    expect(
      isForceInteractiveEnabled({ CLAUDE_CODE_FORCE_INTERACTIVE: '1' }),
    ).toBe(true)
    expect(isTasksEnvEnabled({ CLAUDE_CODE_ENABLE_TASKS: '1' })).toBe(true)
    expect(
      isAwaySummaryEnvEnabled({ CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '1' }),
    ).toBe(true)
    expect(
      isSdkFileCheckpointingEnabled({
        CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      }),
    ).toBe(true)
    expect(resolveGitInstructionsEnvOverride({})).toBeNull()
    expect(
      resolveGitInstructionsEnvOverride({
        CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1',
      }),
    ).toBe(false)
    expect(
      resolveGitInstructionsEnvOverride({
        CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '0',
      }),
    ).toBe(true)
    expect(resolveAutoMemoryEnvOverride({})).toBeNull()
    expect(
      resolveAutoMemoryEnvOverride({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }),
    ).toBe(false)
    expect(
      resolveAutoMemoryEnvOverride({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }),
    ).toBe(true)
    expect(resolvePromptSuggestionEnvOverride({})).toBeNull()
    expect(
      resolvePromptSuggestionEnvOverride({
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '0',
      }),
    ).toBe(false)
    expect(
      resolvePromptSuggestionEnvOverride({
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '1',
      }),
    ).toBe(true)
    expect(resolveMaxRetriesOverride({})).toBeNull()
    expect(resolveMaxRetriesOverride({ CLAUDE_CODE_MAX_RETRIES: '20' })).toBe(
      20,
    )
    expect(
      resolveMaxRetriesOverride({ CLAUDE_CODE_MAX_RETRIES: '-1' }),
    ).toBeNull()

    // Official residual densables cont. 10
    expect(isXaaEnvEnabled({ CLAUDE_CODE_ENABLE_XAA: '1' })).toBe(true)
    expect(isLocalGatesDisabled({ CLAUDE_CODE_DISABLE_LOCAL_GATES: '1' })).toBe(
      true,
    )
    expect(
      resolveDatadogFlushIntervalMs({
        CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS: '500',
      }),
    ).toBe(500)
    expect(resolveDatadogFlushIntervalMs({})).toBeNull()
    expect(
      isIncludePartialMessagesEnabled({
        CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES: '1',
      }),
    ).toBe(true)
    expect(isProactiveEnvEnabled({ CLAUDE_CODE_PROACTIVE: '1' })).toBe(true)
    expect(
      isExcludeDynamicContextEnabled({
        CLAUDE_CODE_EXCLUDE_DYNAMIC_CONTEXT: '1',
      }),
    ).toBe(true)
    expect(isBubblewrapEnabled({ CLAUDE_CODE_BUBBLEWRAP: '1' })).toBe(true)
    expect(
      isSessionDataUploadDisabled({
        CLAUDE_CODE_DISABLE_SESSION_DATA_UPLOAD: '1',
      }),
    ).toBe(true)

    // Official residual densables cont. 11
    expect(
      isStreamlinedOutputEnabled({ CLAUDE_CODE_STREAMLINED_OUTPUT: '1' }),
    ).toBe(true)
    expect(
      isResumeInterruptedTurnEnabled({
        CLAUDE_CODE_RESUME_INTERRUPTED_TURN: '1',
      }),
    ).toBe(true)
    // densable 2.1.221 #15 — falsy values disable (pre-221 Boolean("0") was true)
    expect(
      isResumeInterruptedTurnEnabled({
        CLAUDE_CODE_RESUME_INTERRUPTED_TURN: '0',
      }),
    ).toBe(false)
    expect(
      isResumeInterruptedTurnEnabled({
        CLAUDE_CODE_RESUME_INTERRUPTED_TURN: 'false',
      }),
    ).toBe(false)
    expect(isResumeInterruptedTurnEnabled({})).toBe(false)
    expect(resolveAttributionHeaderEnvOverride({})).toBeNull()
    expect(
      resolveAttributionHeaderEnvOverride({
        CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      }),
    ).toBe(false)
    expect(
      isBgShellPressureReapDisabled({
        CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP: '1',
      }),
    ).toBe(true)
    expect(
      isSaveHookAdditionalContextEnabled({
        CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT: '1',
      }),
    ).toBe(true)
    expect(isCcrMirrorEnvEnabled({ CLAUDE_CODE_CCR_MIRROR: '1' })).toBe(true)
    expect(isTelemetryEnvEnabled({ CLAUDE_CODE_ENABLE_TELEMETRY: '1' })).toBe(
      true,
    )
    expect(isProfileStartupEnabled({ CLAUDE_CODE_PROFILE_STARTUP: '1' })).toBe(
      true,
    )
    expect(resolveOverrideDate({})).toBeNull()
    expect(
      resolveOverrideDate({ CLAUDE_CODE_OVERRIDE_DATE: '2026-07-14' }),
    ).toBe('2026-07-14')

    // Official residual densables cont. 12
    expect(
      isPostForSessionIngressV2Enabled({
        CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2: '1',
      }),
    ).toBe(true)
    expect(
      resolveEffortLevelOverride({ CLAUDE_CODE_EFFORT_LEVEL: 'HIGH' }),
    ).toBe('high')
    expect(resolvePowerShellToolEnvOverride({})).toBeNull()
    expect(
      resolvePowerShellToolEnvOverride({
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
      }),
    ).toBe(true)
    expect(
      resolvePowerShellToolEnvOverride({
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '0',
      }),
    ).toBe(false)
    expect(
      resolveGitBashPath({ CLAUDE_CODE_GIT_BASH_PATH: 'C:\\git\\bash.exe' }),
    ).toBe('C:\\git\\bash.exe')
    expect(
      resolveOtelHeadersHelperDebounceMs({
        CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS: '1000',
      }),
    ).toBe(1000)
    expect(
      resolveApiKeyFileDescriptor({
        CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '3',
      }),
    ).toBe('3')
    expect(resolveWorkerEpoch({ CLAUDE_CODE_WORKER_EPOCH: '7' })).toBe(7)
    expect(
      resolveEnvironmentRunnerVersion({
        CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION: '1.2.3',
      }),
    ).toBe('1.2.3')

    // Official residual densables cont. 13
    expect(isSimpleModeEnvEnabled({ CLAUDE_CODE_SIMPLE: '1' })).toBe(true)
    expect(
      isCoordinatorModeEnvEnabled({ CLAUDE_CODE_COORDINATOR_MODE: '1' }),
    ).toBe(true)
    {
      const env: NodeJS.ProcessEnv = {}
      expect(syncCoordinatorModeEnvFromSession('coordinator', env)).toBe(
        'Entered coordinator mode to match resumed session.',
      )
      expect(env.CLAUDE_CODE_COORDINATOR_MODE).toBe('1')
      expect(
        syncCoordinatorModeEnvFromSession('coordinator', env),
      ).toBeUndefined()
      expect(syncCoordinatorModeEnvFromSession('normal', env)).toBe(
        'Exited coordinator mode to match resumed session.',
      )
      expect(env.CLAUDE_CODE_COORDINATOR_MODE).toBeUndefined()
      expect(syncCoordinatorModeEnvFromSession(undefined, env)).toBeUndefined()
    }
    expect(isBriefEnvEnabled({ CLAUDE_CODE_BRIEF: '1' })).toBe(true)
    expect(resolveShellPrefix({})).toBeNull()
    expect(resolveShellPrefix({ CLAUDE_CODE_SHELL_PREFIX: 'timeout 30' })).toBe(
      'timeout 30',
    )

    // Official residual densables cont. 14
    expect(isExplorePlanAgentsDisabled({})).toBe(false)
    expect(
      isExplorePlanAgentsDisabled({
        CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '1',
      }),
    ).toBe(true)
    expect(isCommandInjectionCheckDisabled({})).toBe(false)
    expect(
      isCommandInjectionCheckDisabled({
        CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK: '1',
      }),
    ).toBe(true)
    expect(isBashSandboxShowIndicatorEnabled({})).toBe(false)
    expect(
      isBashSandboxShowIndicatorEnabled({
        CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR: '1',
      }),
    ).toBe(true)
    expect(resolveAgentListInMessagesEnvOverride({})).toBeNull()
    expect(
      resolveAgentListInMessagesEnvOverride({
        CLAUDE_CODE_AGENT_LIST_IN_MESSAGES: '1',
      }),
    ).toBe(true)
    expect(
      resolveAgentListInMessagesEnvOverride({
        CLAUDE_CODE_AGENT_LIST_IN_MESSAGES: '0',
      }),
    ).toBe(false)
    expect(isAccessibilityEnvEnabled({})).toBe(false)
    expect(isAccessibilityEnvEnabled({ CLAUDE_CODE_ACCESSIBILITY: '1' })).toBe(
      true,
    )

    // Official residual densables cont. 15
    expect(isRemoteEnvEnabled({})).toBe(false)
    expect(isRemoteEnvEnabled({ CLAUDE_CODE_REMOTE: '1' })).toBe(true)
    expect(isCcrV2EnvEnabled({})).toBe(false)
    expect(isCcrV2EnvEnabled({ CLAUDE_CODE_USE_CCR_V2: '1' })).toBe(true)
    expect(isActionEnvEnabled({})).toBe(false)
    expect(isActionEnvEnabled({ CLAUDE_CODE_ACTION: '1' })).toBe(true)
    expect(isUnattendedRetryEnvEnabled({})).toBe(false)
    expect(
      isUnattendedRetryEnvEnabled({ CLAUDE_CODE_UNATTENDED_RETRY: '1' }),
    ).toBe(true)
    expect(resolveBuddyEnvOverride({})).toBeNull()
    expect(resolveBuddyEnvOverride({ CLAUDE_CODE_ENABLE_BUDDY: '1' })).toBe(
      true,
    )
    expect(resolveBuddyEnvOverride({ CLAUDE_CODE_ENABLE_BUDDY: '0' })).toBe(
      false,
    )

    // Official residual densables cont. 16 (USE_*/SKIP_* providers)
    expect(isUseBedrockEnvEnabled({ CLAUDE_CODE_USE_BEDROCK: '1' })).toBe(true)
    expect(isUseVertexEnvEnabled({ CLAUDE_CODE_USE_VERTEX: '1' })).toBe(true)
    expect(isUseFoundryEnvEnabled({ CLAUDE_CODE_USE_FOUNDRY: '1' })).toBe(true)
    expect(isUseOpenAIEnvEnabled({ CLAUDE_CODE_USE_OPENAI: '1' })).toBe(true)
    expect(isUseGeminiEnvEnabled({ CLAUDE_CODE_USE_GEMINI: '1' })).toBe(true)
    expect(isUseGrokEnvEnabled({ CLAUDE_CODE_USE_GROK: '1' })).toBe(true)
    expect(
      isSkipBedrockAuthEnvEnabled({ CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1' }),
    ).toBe(true)
    expect(
      isSkipVertexAuthEnvEnabled({ CLAUDE_CODE_SKIP_VERTEX_AUTH: '1' }),
    ).toBe(true)
    expect(
      isSkipFoundryAuthEnvEnabled({ CLAUDE_CODE_SKIP_FOUNDRY_AUTH: '1' }),
    ).toBe(true)
    expect(
      isSkipAwsCredCacheEnvEnabled({ CLAUDE_CODE_SKIP_AWS_CRED_CACHE: '1' }),
    ).toBe(true)
    expect(isUseBedrockEnvEnabled({})).toBe(false)

    // Official residual densables cont. 17
    expect(isProviderManagedByHostEnvEnabled({})).toBe(false)
    expect(
      isProviderManagedByHostEnvEnabled({
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      }),
    ).toBe(true)
    expect(
      isAutoConnectIdeEnvEnabled({ CLAUDE_CODE_AUTO_CONNECT_IDE: '1' }),
    ).toBe(true)
    expect(
      isRemoteSendKeepalivesEnvEnabled({
        CLAUDE_CODE_REMOTE_SEND_KEEPALIVES: '1',
      }),
    ).toBe(true)
    expect(
      isNativeFileSearchEnvEnabled({ CLAUDE_CODE_USE_NATIVE_FILE_SEARCH: '1' }),
    ).toBe(true)
    expect(
      isExperimentalAgentTeamsDisabled({
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_DISABLED: '1',
      }),
    ).toBe(true)
    expect(isVerifyPlanEnvEnabled({ CLAUDE_CODE_VERIFY_PLAN: '1' })).toBe(true)
    expect(
      isTerminalRecordingEnvEnabled({ CLAUDE_CODE_TERMINAL_RECORDING: '1' }),
    ).toBe(true)
    expect(
      isFineGrainedToolStreamingEnvEnabled({
        CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: '1',
      }),
    ).toBe(true)
    expect(
      isAlwaysEnableEffortEnvEnabled({ CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: '1' }),
    ).toBe(true)
    expect(isCfcEnvEnabled({ CLAUDE_CODE_ENABLE_CFC: '1' })).toBe(true)
    expect(isDumpAutoModeEnvEnabled({ CLAUDE_CODE_DUMP_AUTO_MODE: '1' })).toBe(
      true,
    )
    expect(
      isAutoModeExternalPermissionsEnvEnabled({
        CLAUDE_CODE_AUTO_MODE_EXTERNAL_PERMISSIONS: '1',
      }),
    ).toBe(true)
    expect(
      isPluginZipCacheEnvEnabled({ CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE: '1' }),
    ).toBe(true)
    expect(
      isCoworkPluginsEnvEnabled({ CLAUDE_CODE_USE_COWORK_PLUGINS: '1' }),
    ).toBe(true)
    expect(
      isIdeSkipValidCheckEnvEnabled({ CLAUDE_CODE_IDE_SKIP_VALID_CHECK: '1' }),
    ).toBe(true)
    expect(
      isIdeSkipAutoInstallEnvEnabled({
        CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
      }),
    ).toBe(true)
    expect(isProviderManagedByHostEnvEnabled({})).toBe(false)
  })
})
