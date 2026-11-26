import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import {
  clearSendUserFileArgsStashForTesting,
  SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR,
  SendUserFileTool,
} from '@claude-code/builtin-tools/tools/SendUserFileTool/SendUserFileTool.js'
import {
  buildTool,
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import {
  checkFolderTrustFailClosed,
  checkFolderTrustForNonTtyLaunch,
  CONFIG_UNREADABLE_TRUST_REASON,
  FOLDER_NOT_TRUSTED_NON_TTY_REASON,
  resetTrustDialogAcceptedCacheForTesting,
} from '../../config.js'
import { createAssistantMessage } from '../../messages.js'
import {
  assertNotCrossMachineSavedChatRead,
  CrossMachineSavedChatReadError,
  formatCrossMachineSavedChatRefusalMessage,
  isSavedChatFilePath,
  SAVED_CHAT_CROSS_MACHINE_REFUSAL_REASON,
  SAVED_CHAT_FILE_PREFIX,
} from '../../sessionStorage.js'
import {
  ORG_HELPER_OUTPUT_LIMIT_ERROR,
  ORG_HELPER_OUTPUT_LIMIT_LOG,
  OrganizationHelperOutputLimitError,
  spawnOrganizationHelper,
} from '../../settings/orgHelperExecutor.js'
import {
  assertProjectSettingsReadableForServing,
  createAcceptedSettingsUnreadableResult,
  ProjectSettingsServeUnreadableError,
  probeProjectSettingsForServing,
  readProjectSettingsSlotWithRetry,
  SERVED_SETTINGS_ACCEPTED_UNREADABLE_MESSAGE,
  SERVED_SETTINGS_UNREADABLE_MESSAGE,
} from '../../settings/settings.js'
import {
  APPROVAL_CARD_DECLINED_MESSAGE,
  APPROVAL_CARD_MAX_WAIT_MS,
  APPROVAL_CARD_MIN_READ_DELAY_MS,
  APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE,
  APPROVAL_CARD_TOO_FAST_MESSAGE,
  APPROVAL_CARD_UNREADABLE_ANSWER_MESSAGE,
  consumeApprovalCardToken,
  isIssuedApprovalCardToken,
  requestApprovalCardWithReadDelay,
} from '../approvalCardReadDelay.js'
import {
  BYPASS_DISABLED_BY_HELD_TO_AUTO_MESSAGE,
  checkAndDisableBypassPermissionsIfNeeded,
  getBypassPermissionsDisabledReason,
  isModeBlockedByHeldToAuto,
  resetBypassPermissionsCheck,
} from '../bypassPermissionsKillswitch.js'
import {
  createDenialTrackingState,
  hasPersonDeclinedInChain,
  recordPersonDeclinedInChain,
  recordSuccess,
} from '../denialTracking.js'
import { getNextPermissionMode } from '../getNextPermissionMode.js'
import { clampPermissionModeToCeiling } from '../PermissionMode.js'
import {
  isBypassPermissionsModeDisabled,
  setPermissionModeWithGuards,
} from '../permissionSetup.js'
import { applyPermissionUpdate } from '../PermissionUpdate.js'
import {
  AGENT_CALL_SAFETY_CHECK_DENY,
  applyFirstFileSendGuard,
  applyPriorRefusalOrSafetyCheckEscalation,
  applyProjectDocSaveVerdict,
  buildProjectDocApprovalAsk,
  buildProjectDocMutationAskForReason,
  buildUnjudgedHandoffDeny,
  FIRST_FILE_SEND_REFUSAL_MESSAGES,
  hasPermissionsToUseTool,
  hasPersonDeclinedInTurn,
  hasPriorRefusedProjectDocMutation,
  isNonMcpReadOnlyToolCall,
  PRIOR_REFUSAL_ASK_MESSAGE,
  PRIOR_REFUSAL_DECISION_REASON,
  PROJECT_DOC_ASK_MESSAGE,
  PROJECT_DOC_EVERY_CALL_REASON,
  PROJECT_DOC_FLAGGED_REASON,
  PROJECT_DOC_PRIOR_REFUSAL_REASON,
  PROJECT_DOC_SAFETY_UNAVAILABLE_MESSAGE,
  recordPersonDeclinedInTurn,
  SAFETY_CHECK_FLAGGED_ASK_MESSAGE,
  SAFETY_CHECK_FLAGGED_DECISION_REASON,
} from '../permissions.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const origHeldToAuto = process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO

afterEach(() => {
  if (origHeldToAuto === undefined) {
    delete process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO
  } else {
    process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO = origHeldToAuto
  }
  resetBypassPermissionsCheck()
  clearSendUserFileArgsStashForTesting()
  resetTrustDialogAcceptedCacheForTesting()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      chmodSync(dir, 0o755)
    } catch {
      // ignore
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

function makeMockContext(opts?: {
  mode?: ToolPermissionContext['mode']
  shouldAvoidPermissionPrompts?: boolean
  chainId?: string
  isBypassPermissionsModeAvailable?: boolean
  alwaysAllowRules?: ToolPermissionContext['alwaysAllowRules']
  toolUseId?: string
  forRemoteExecution?: boolean
  remoteCall?: unknown
}): ToolUseContext {
  let state: {
    toolPermissionContext: ToolPermissionContext
    denialTracking: ReturnType<typeof createDenialTrackingState>
    replBridgeEnabled: boolean
    sessionHooks: Map<string, unknown>
  } = {
    toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      mode: opts?.mode ?? 'default',
      shouldAvoidPermissionPrompts: opts?.shouldAvoidPermissionPrompts ?? false,
      isBypassPermissionsModeAvailable:
        opts?.isBypassPermissionsModeAvailable ?? false,
      ...(opts?.alwaysAllowRules
        ? { alwaysAllowRules: opts.alwaysAllowRules }
        : {}),
    },
    denialTracking: createDenialTrackingState(),
    replBridgeEnabled: false,
    sessionHooks: new Map(),
  }
  return {
    abortController: new AbortController(),
    readFileState: new Map() as unknown as ToolUseContext['readFileState'],
    getAppState: () =>
      state as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: (
      updater: (
        prev: ReturnType<ToolUseContext['getAppState']>,
      ) => ReturnType<ToolUseContext['getAppState']>,
    ) => {
      state = updater(
        state as unknown as ReturnType<ToolUseContext['getAppState']>,
      ) as unknown as typeof state
    },
    options: {
      isNonInteractiveSession: false,
      tools: [],
      mcpClients: [],
      commands: [],
      debug: false,
      verbose: false,
      mainLoopModel: 'claude-sonnet-4-6',
      maxThinkingTokens: 0,
      mcpResources: {},
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    messages: [],
    queryTracking: opts?.chainId
      ? { chainId: opts.chainId, depth: 0 }
      : undefined,
    toolUseId: opts?.toolUseId,
    forRemoteExecution: opts?.forRemoteExecution,
    ...(opts?.remoteCall !== undefined ? { remoteCall: opts.remoteCall } : {}),
  } as unknown as ToolUseContext
}

function makeSimpleTool(opts: {
  name: string
  readOnly?: boolean
  isMcp?: boolean
  allow?: boolean
}): Tool {
  const schema = z.object({ value: z.string().optional() })
  return buildTool({
    name: opts.name,
    inputSchema: schema,
    isMcp: opts.isMcp ?? false,
    isReadOnly: () => opts.readOnly ?? false,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 10_000,
    async description() {
      return opts.name
    },
    async prompt() {
      return opts.name
    },
    userFacingName() {
      return opts.name
    },
    renderToolUseMessage() {
      return opts.name
    },
    mapToolResultToToolResultBlockParam(_content, toolUseID) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: 'ok' }
    },
    async checkPermissions(input) {
      if (opts.allow) {
        return { behavior: 'allow', updatedInput: input }
      }
      return {
        behavior: 'ask',
        message: `Allow ${opts.name}?`,
        updatedInput: input,
      }
    },
    async call() {
      return { data: {} }
    },
  }) as unknown as Tool
}

// ============================================================================
// 1. Prior-Refusal Escalation Guard (04_prior_refusal_a.js, 04b_prior_refusal_b.js)
// ============================================================================
describe('2.1.331 Area 1: Prior-Refusal Escalation Guard', () => {
  test('denialTracking records personDeclinedInChains per turn and survives recordSuccess', () => {
    let s = createDenialTrackingState()
    expect(hasPersonDeclinedInChain(s, 'turn-1')).toBe(false)
    s = recordPersonDeclinedInChain(s, 'turn-1')
    expect(hasPersonDeclinedInChain(s, 'turn-1')).toBe(true)
    expect(hasPersonDeclinedInChain(s, 'turn-2')).toBe(false)
    // Idempotent
    expect(recordPersonDeclinedInChain(s, 'turn-1')).toBe(s)
    // Persists across consecutive-denial resets
    s = recordSuccess({ ...s, consecutiveDenials: 2 })
    expect(s.consecutiveDenials).toBe(0)
    expect(hasPersonDeclinedInChain(s, 'turn-1')).toBe(true)
  })

  test('exact official KJr / VJr copy escalates subsequent non-read-only allow in same turn', async () => {
    const ctx = makeMockContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
      chainId: 'chain-abc',
    })
    const writeTool = makeSimpleTool({
      name: 'WriteAction',
      readOnly: false,
      allow: true,
    })
    const readTool = makeSimpleTool({
      name: 'ReadOnlyBuiltin',
      readOnly: true,
      allow: true,
    })
    const mcpReadTool = makeSimpleTool({
      name: 'mcp__srv__get',
      readOnly: true,
      isMcp: true,
      allow: true,
    })

    // Before refusal: auto-allowed
    const before = await hasPermissionsToUseTool(
      writeTool,
      { value: 'a' },
      ctx,
      createAssistantMessage({ content: [] }),
      'tu-1',
    )
    expect(before.behavior).toBe('allow')

    // Person declines an action in this turn
    recordPersonDeclinedInTurn(ctx, ctx.setAppState)
    expect(hasPersonDeclinedInTurn(ctx)).toBe(true)

    // Subsequent non-read-only action escalates to personOnly ask with exact KJr/VJr copy
    const escalated = await hasPermissionsToUseTool(
      writeTool,
      { value: 'b' },
      ctx,
      createAssistantMessage({ content: [] }),
      'tu-2',
    )
    expect(escalated.behavior).toBe('ask')
    if (escalated.behavior === 'ask') {
      expect(escalated.message).toBe(PRIOR_REFUSAL_ASK_MESSAGE)
      expect(escalated.message).toBe(
        "This action needs a person's approval, because an action was declined earlier in this turn.",
      )
      expect(escalated.decisionReason).toEqual({
        type: 'other',
        reason: PRIOR_REFUSAL_DECISION_REASON,
      })
      expect(
        escalated.decisionReason?.type === 'other' &&
          escalated.decisionReason.reason,
      ).toBe(
        'An action was declined earlier, so this one needs your approval too.',
      )
      expect(escalated.afterClassifierBlock).toBe(true)
      expect(escalated.askRequiresUserInteraction).toBe(true)
      expect(escalated.personOnly).toBe(true)
      expect(escalated.hooksMayRefuse).toBe(true)
      expect(escalated.hooksMayAllow).toBe(false)
      expect(escalated.defaultToNo).toBe(true)
      expect(escalated.suppressAlwaysAllowRule).toBe(true)
      expect(escalated.suggestions).toBeUndefined()
    }

    // Built-in read-only tool is NOT escalated (`S_t`)
    expect(isNonMcpReadOnlyToolCall(readTool, { value: 'c' })).toBe(true)
    const readRes = await hasPermissionsToUseTool(
      readTool,
      { value: 'c' },
      ctx,
      createAssistantMessage({ content: [] }),
      'tu-3',
    )
    expect(readRes.behavior).toBe('allow')

    // MCP tool claiming readOnly IS still escalated (`S_t` rejects MCP)
    expect(isNonMcpReadOnlyToolCall(mcpReadTool, { value: 'd' })).toBe(false)
    const mcpRes = await hasPermissionsToUseTool(
      mcpReadTool,
      { value: 'd' },
      ctx,
      createAssistantMessage({ content: [] }),
      'tu-4',
    )
    expect(mcpRes.behavior).toBe('ask')
    if (mcpRes.behavior === 'ask') {
      expect(mcpRes.message).toBe(PRIOR_REFUSAL_ASK_MESSAGE)
      expect(mcpRes.personOnly).toBe(true)
    }

    // Next turn (different chainId) is not affected
    const nextTurnCtx = {
      ...ctx,
      queryTracking: { chainId: 'chain-next', depth: 0 },
    } as ToolUseContext
    const nextTurnRes = await hasPermissionsToUseTool(
      writeTool,
      { value: 'e' },
      nextTurnCtx,
      createAssistantMessage({ content: [] }),
      'tu-5',
    )
    expect(nextTurnRes.behavior).toBe('allow')
  })

  test('prior refusal under shouldAvoidPermissionPrompts fails closed with exact YJr refusal', async () => {
    const ctx = makeMockContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
      shouldAvoidPermissionPrompts: true,
      chainId: 'chain-headless',
    })
    recordPersonDeclinedInTurn(ctx, ctx.setAppState)
    const writeTool = makeSimpleTool({
      name: 'WriteAction',
      readOnly: false,
      allow: true,
    })

    const res = await hasPermissionsToUseTool(
      writeTool,
      { value: 'x' },
      ctx,
      createAssistantMessage({ content: [] }),
      'tu-headless',
    )
    expect(res.behavior).toBe('deny')
    if (res.behavior === 'deny') {
      expect(res.message).toBe(
        `${PRIOR_REFUSAL_ASK_MESSAGE} Nobody can be asked here, so it has not run. Don't try to do the same thing another way.`,
      )
      expect(res.decisionReason).toEqual({
        type: 'asyncAgent',
        reason: 'Permission prompts are not available in this context',
      })
    }
  })

  test('applyPriorRefusalOrSafetyCheckEscalation handles safety-check flag, agentCall, and unjudged handoff', () => {
    const ctx = makeMockContext({ mode: 'default', chainId: 'c1' })
    const tool = makeSimpleTool({ name: 'Bash', readOnly: false, allow: true })

    // Flagged by safety check (zJr / JJr)
    const flagged = applyPriorRefusalOrSafetyCheckEscalation(
      tool,
      { behavior: 'allow', updatedInput: { value: 'rm -rf' } },
      ctx,
      'tu-f1',
      true,
    )
    expect(flagged.behavior).toBe('ask')
    if (flagged.behavior === 'ask') {
      expect(flagged.message).toBe(SAFETY_CHECK_FLAGGED_ASK_MESSAGE)
      expect(flagged.decisionReason).toEqual({
        type: 'classifier',
        classifier: 'auto-mode',
        reason: SAFETY_CHECK_FLAGGED_DECISION_REASON,
      })
      expect(flagged.personOnly).toBe(true)
      expect(flagged.defaultToNo).toBe(true)
    }

    // agentCall denied with XJr
    const modCtx = {
      ...ctx,
      agentCall: { toolUseId: 'tu-mod' },
    } as unknown as ToolUseContext
    const modRes = applyPriorRefusalOrSafetyCheckEscalation(
      tool,
      { behavior: 'allow', updatedInput: {} },
      modCtx,
      'tu-mod',
      false,
    )
    expect(modRes).toEqual(AGENT_CALL_SAFETY_CHECK_DENY)

    // Handed-off unjudged allow denied with QJr
    const unjudged = applyPriorRefusalOrSafetyCheckEscalation(
      tool,
      { behavior: 'allow', updatedInput: {} },
      ctx,
      'tu-u1',
      false,
      true,
    )
    expect(unjudged).toEqual(buildUnjudgedHandoffDeny('Bash'))
  })

  test('project doc save/delete prior refusal uses exact Mtl / Dtl / Aki / gVo / Ie semantics', () => {
    // Mtl + defaultToNo on repeat
    const repeatWrite = buildProjectDocMutationAskForReason(false, 'repeat')
    expect(repeatWrite.message).toBe(PROJECT_DOC_ASK_MESSAGE)
    expect(repeatWrite.defaultToNo).toBe(true)
    expect(repeatWrite.suppressAlwaysAllowRule).toBe(true)
    expect(repeatWrite.decisionReason).toEqual({
      type: 'other',
      reason: `${PROJECT_DOC_PRIOR_REFUSAL_REASON} If a doc with this name exists, this replaces it.`,
    })

    // Dtl on every_call delete
    const everyDelete = buildProjectDocMutationAskForReason(true, 'every_call')
    expect(everyDelete.defaultToNo).toBeUndefined()
    expect(everyDelete.decisionReason).toEqual({
      type: 'other',
      reason: `${PROJECT_DOC_EVERY_CALL_REASON} A deleted doc cannot be restored.`,
    })

    // gVo fault -> deny with Cki
    const faultRes = applyProjectDocSaveVerdict(
      { behavior: 'allow', updatedInput: { path: 'doc.md' } },
      false,
      'fault',
    )
    expect(faultRes.behavior).toBe('deny')
    if (faultRes.behavior === 'deny') {
      expect(faultRes.message).toBe(PROJECT_DOC_SAFETY_UNAVAILABLE_MESSAGE)
    }

    // gVo flagged -> escalated ask with RVi + defaultToNo + afterClassifierBlock
    const flaggedRes = applyProjectDocSaveVerdict(
      buildProjectDocApprovalAsk(true),
      true,
      'flagged',
      { asClassifier: true },
    )
    expect(flaggedRes.behavior).toBe('ask')
    if (flaggedRes.behavior === 'ask') {
      expect(flaggedRes.defaultToNo).toBe(true)
      expect(flaggedRes.afterClassifierBlock).toBe(true)
      expect(flaggedRes.decisionReason).toEqual({
        type: 'classifier',
        classifier: 'auto-mode',
        reason: `${PROJECT_DOC_FLAGGED_REASON} A deleted doc cannot be restored.`,
      })
    }

    // Ie tracks earlier refusal and ignores safety-unavailable (Cki) errors
    const msgs = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'Projects',
              input: { method: 'project_write', path: 'notes.md' },
            },
          ],
        },
      },
      {
        type: 'user',
        toolDenialKind: 'user_reject',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: 'User rejected tool use',
              is_error: true,
            },
          ],
        },
      },
    ]
    expect(
      hasPriorRefusedProjectDocMutation(msgs, {
        method: 'project_write',
        path: 'notes.md',
      }),
    ).toBe(true)
    expect(
      hasPriorRefusedProjectDocMutation(msgs, {
        method: 'project_write',
        path: 'other.md',
      }),
    ).toBe(false)

    // Cki fault does NOT count as a refusal
    const faultMsgs = [
      msgs[0]!,
      {
        type: 'user',
        toolDenialKind: 'classifier',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: PROJECT_DOC_SAFETY_UNAVAILABLE_MESSAGE,
              is_error: true,
            },
          ],
        },
      },
    ]
    expect(hasPriorRefusedProjectDocMutation(faultMsgs)).toBe(false)
  })
})

// ============================================================================
// 2. Held-to-Auto Bypass Block (07_held_to_auto.js)
// ============================================================================
describe('2.1.331 Area 2: Held-to-Auto Bypass Block', () => {
  test('clampPermissionModeToCeiling (kv) enforces rank ceiling and excludes acceptEdits under auto', () => {
    expect(clampPermissionModeToCeiling('plan', 'auto')).toBe('plan')
    expect(clampPermissionModeToCeiling('default', 'auto')).toBe('default')
    expect(clampPermissionModeToCeiling('dontAsk', 'auto')).toBe('dontAsk')
    expect(clampPermissionModeToCeiling('auto', 'auto')).toBe('auto')
    expect(clampPermissionModeToCeiling('acceptEdits', 'auto')).toBeUndefined()
    expect(
      clampPermissionModeToCeiling('bypassPermissions', 'auto'),
    ).toBeUndefined()
    expect(
      clampPermissionModeToCeiling('bypassPermissions', 'bypassPermissions'),
    ).toBe('bypassPermissions')
  })

  test('CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO blocks bypassPermissions with exact 2.1.331 message', async () => {
    delete process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO
    expect(isModeBlockedByHeldToAuto('bypassPermissions')).toBe(false)

    process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO = '1'
    expect(isModeBlockedByHeldToAuto('bypassPermissions')).toBe(true)
    expect(isModeBlockedByHeldToAuto('acceptEdits')).toBe(true)
    expect(isModeBlockedByHeldToAuto('auto')).toBe(false)
    expect(isModeBlockedByHeldToAuto('default')).toBe(false)
    expect(isModeBlockedByHeldToAuto('plan')).toBe(false)

    expect(getBypassPermissionsDisabledReason()).toBe(
      BYPASS_DISABLED_BY_HELD_TO_AUTO_MESSAGE,
    )
    expect(getBypassPermissionsDisabledReason()).toBe(
      'Bypass permissions mode is not available in a session held to auto mode',
    )
    expect(isBypassPermissionsModeDisabled()).toBe(true)

    // setPermissionModeWithGuards rejects entering bypassPermissions with exact message
    const baseCtx: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'auto',
      isBypassPermissionsModeAvailable: true,
    }
    const guardResult = setPermissionModeWithGuards(
      'bypassPermissions',
      baseCtx,
      () => {},
    )
    expect(guardResult).toEqual({
      ok: false,
      error:
        'Bypass permissions mode is not available in a session held to auto mode',
    })

    // applyPermissionUpdate rejects setMode bypassPermissions and acceptEdits
    const afterBypassUpdate = applyPermissionUpdate(baseCtx, {
      type: 'setMode',
      mode: 'bypassPermissions',
      destination: 'session',
    })
    expect(afterBypassUpdate.mode).toBe('auto')
    const afterAcceptEditsUpdate = applyPermissionUpdate(baseCtx, {
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'session',
    })
    expect(afterAcceptEditsUpdate.mode).toBe('auto')

    // Shift+Tab cycle skips acceptEdits and bypassPermissions when held to auto
    expect(
      getNextPermissionMode({
        ...baseCtx,
        mode: 'default',
      }),
    ).toBe('plan')
    expect(
      getNextPermissionMode({
        ...baseCtx,
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
        isAutoModeAvailable: false,
      }),
    ).toBe('default')

    // checkAndDisableBypassPermissionsIfNeeded strips bypassPermissions & queues exact warning
    let appState: {
      toolPermissionContext: ToolPermissionContext
      notifications: { queue: Array<{ key: string; text: string }> }
    } = {
      toolPermissionContext: {
        ...baseCtx,
        mode: 'bypassPermissions',
        isBypassPermissionsModeAvailable: true,
      },
      notifications: { queue: [] },
    }
    await checkAndDisableBypassPermissionsIfNeeded(
      appState.toolPermissionContext,
      updater => {
        appState = updater(appState as never) as unknown as typeof appState
      },
    )
    expect(appState.toolPermissionContext.mode).toBe('default')
    expect(
      appState.toolPermissionContext.isBypassPermissionsModeAvailable,
    ).toBe(false)
    expect(
      appState.notifications.queue.some(
        n => n.text === BYPASS_DISABLED_BY_HELD_TO_AUTO_MESSAGE,
      ),
    ).toBe(true)
  })
})

// ============================================================================
// 3. SendUserFile TOCTOU Argument Check (05_send_file_toctou.js)
// ============================================================================
describe('2.1.331 Area 3: SendUserFile TOCTOU Argument Check', () => {
  test('refuses sending when file paths change between checkPermissions and call', async () => {
    const dir = makeTempDir('send-toctou-')
    const safeFile = join(dir, 'report.txt')
    const secretFile = join(dir, 'secret.txt')
    writeFileSync(safeFile, 'safe report')
    writeFileSync(secretFile, 'top secret')

    const ctx = makeMockContext({ toolUseId: 'tu-send-1' })

    // Permission check lists safeFile
    const perm = await SendUserFileTool.checkPermissions!(
      { files: [safeFile] },
      ctx,
    )
    expect(perm.behavior).toBe('allow')

    // Attacker/hook mutates argument to secretFile before execution
    const result = await SendUserFileTool.call({ files: [secretFile] }, ctx)
    expect(result.data.sent).toBe(false)
    expect(result.data.error).toBe(SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR)
    expect(result.data.error).toBe(
      'No file was sent: the arguments of this call changed after Claude Code had listed its files for the user. Make the call again.',
    )
  })

  test('allows sending when file paths match what checkPermissions listed (order-independent)', async () => {
    const dir = makeTempDir('send-ok-')
    const fileA = join(dir, 'a.txt')
    const fileB = join(dir, 'b.txt')
    writeFileSync(fileA, 'alpha')
    writeFileSync(fileB, 'beta')

    const ctx = makeMockContext({ toolUseId: 'tu-send-2' })
    await SendUserFileTool.checkPermissions!({ files: [fileA, fileB] }, ctx)

    // Same file set in reversed order passes canonical check
    const result = await SendUserFileTool.call({ files: [fileB, fileA] }, ctx)
    expect(result.data.sent).toBe(true)
    expect(result.data.error).toBeUndefined()
  })

  test('applyFirstFileSendGuard (Vks/Lvo/_kl) denies on arguments_changed and nobody_to_ask', () => {
    const ctx = makeMockContext({ mode: 'default' })
    const mcpTool = Object.assign(
      makeSimpleTool({ name: 'mcp__drive__upload', isMcp: true, allow: true }),
      {
        firstFileSend: () => ({}), // missing question -> arguments_changed
      },
    )

    const changed = applyFirstFileSendGuard(
      mcpTool,
      { value: 'mutated' },
      { behavior: 'allow', updatedInput: { value: 'mutated' } },
      undefined,
      ctx,
    )
    expect(changed.behavior).toBe('deny')
    if (changed.behavior === 'deny') {
      expect(changed.message).toBe(
        FIRST_FILE_SEND_REFUSAL_MESSAGES.arguments_changed,
      )
    }

    const dontAskCtx = makeMockContext({ mode: 'dontAsk' })
    const nobody = applyFirstFileSendGuard(
      mcpTool,
      { value: 'ok' },
      { behavior: 'allow', updatedInput: { value: 'ok' } },
      undefined,
      dontAskCtx,
    )
    expect(nobody.behavior).toBe('deny')
    if (nobody.behavior === 'deny') {
      expect(nobody.message).toBe(
        FIRST_FILE_SEND_REFUSAL_MESSAGES.nobody_to_ask,
      )
    }
  })
})

// ============================================================================
// 4. Config & Project Settings Fail-Closed + Org Helper Output Limit
//    (08_config_trust_failclosed.js, 08b_project_settings_serve.js, 09b_org_helper_limit.js)
// ============================================================================
describe('2.1.331 Area 4: Config/Project Settings Fail-Closed + Org Helper Output Limit', () => {
  test('checkFolderTrustForNonTtyLaunch (TQn) fails closed when config read throws', async () => {
    const reason = await checkFolderTrustForNonTtyLaunch({
      enableConfigsFn: () => {
        throw new Error('EACCES: permission denied')
      },
    })
    expect(reason).toBe(CONFIG_UNREADABLE_TRUST_REASON)
    expect(reason).toBe(
      "Claude Code couldn't read its config, so it can't tell whether this folder is trusted",
    )

    // Untrusted folder returns default non-TTY reason
    const untrusted = await checkFolderTrustForNonTtyLaunch({
      enableConfigsFn: () => {},
      isTrustedFn: () => false,
    })
    expect(untrusted).toBe(FOLDER_NOT_TRUSTED_NON_TTY_REASON)

    // Trusted folder returns undefined
    const trusted = await checkFolderTrustForNonTtyLaunch({
      enableConfigsFn: () => {},
      isTrustedFn: () => true,
    })
    expect(trusted).toBeUndefined()

    // checkFolderTrustFailClosed fails closed on throw or undefined config
    const failRes = checkFolderTrustFailClosed({
      readConfigFn: () => {
        throw new Error('corrupt config')
      },
    })
    expect(failRes).toEqual({
      trusted: false,
      configUnreadable: true,
      reason: CONFIG_UNREADABLE_TRUST_REASON,
    })
  })

  test('assertProjectSettingsReadableForServing (D_s / PH) fails closed on unreadable settings or cannot_tell', () => {
    let attempts = 0
    expect(() =>
      assertProjectSettingsReadableForServing(
        {
          project: '/repo/.claude/settings.json',
          local: null,
          legacy: null,
          linkedAway: [],
        },
        () => {
          attempts++
          return 'unreadable'
        },
        () => false,
        { sleepFn: () => {} },
      ),
    ).toThrow(ProjectSettingsServeUnreadableError)
    // Retried MH = 3 times
    expect(attempts).toBe(3)

    // Exact official 2.1.331 message
    try {
      assertProjectSettingsReadableForServing(
        {
          project: '/repo/.claude/settings.json',
          local: null,
          legacy: null,
          linkedAway: [],
        },
        () => ({ text: '{}' }),
        () => 'cannot_tell',
        { sleepFn: () => {} },
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectSettingsServeUnreadableError)
      expect((err as Error).message).toBe(SERVED_SETTINGS_UNREADABLE_MESSAGE)
      expect((err as Error).message).toBe(
        'A project settings file could not be read as serving began, so nothing is served',
      )
    }

    // Transient unreadable recovers on attempt 2 (PH retry)
    let callCount = 0
    const recovered = readProjectSettingsSlotWithRetry(
      () => {
        callCount++
        return callCount === 1 ? 'unreadable' : { text: '{"ok":true}' }
      },
      () => false,
      '/repo/.claude/settings.json',
      false,
      { sleepFn: () => {} },
    )
    expect(recovered).toEqual({ read: { text: '{"ok":true}' }, leadNow: false })
    expect(callCount).toBe(2)

    // DH accepted-unreadable fatal error shape
    const dh = createAcceptedSettingsUnreadableResult(
      '/repo/.claude/settings.json',
    )
    expect(dh.settings).toBeNull()
    expect(dh.loadState).toBe('didNotLoad')
    expect(dh.errors[0]?.message).toBe(
      SERVED_SETTINGS_ACCEPTED_UNREADABLE_MESSAGE,
    )
  })

  test('probeProjectSettingsForServing passes on readable/absent files and fails closed on unreadable file', () => {
    const dir = makeTempDir('serve-settings-')
    // Absent settings files -> succeeds
    const emptySnaps = probeProjectSettingsForServing(dir, {
      sleepFn: () => {},
    })
    expect(emptySnaps.every(s => s.read === 'absent')).toBe(true)

    // Create unreadable directory where settings.json is expected (EISDIR -> unreadable, works even as root!)
    const claudeDir = join(dir, '.claude')
    const fakeFileAsDir = join(claudeDir, 'settings.json')
    mkdtempSync(join(dir, 'dummy-'))
    const { mkdirSync } = require('fs') as typeof import('fs')
    mkdirSync(fakeFileAsDir, { recursive: true })
    expect(() =>
      probeProjectSettingsForServing(dir, { sleepFn: () => {} }),
    ).toThrow(SERVED_SETTINGS_UNREADABLE_MESSAGE)
  })

  test('spawnOrganizationHelper (U) caps stdout and stderr output and kills helper on overflow', async () => {
    expect(ORG_HELPER_OUTPUT_LIMIT_LOG).toBe(
      'Organization helper wrote more than its output limit',
    )

    // Within limit succeeds
    const ok = await spawnOrganizationHelper(
      process.execPath,
      ['-e', 'process.stdout.write("hello-token")'],
      { maxBuffer: 1024, timeout: 5000 },
    )
    expect(ok.code).toBe(0)
    expect(ok.stdout).toBe('hello-token')

    // Exceeding stdout maxBuffer kills child and rejects with exact official error
    await expect(
      spawnOrganizationHelper(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(4096))'],
        { maxBuffer: 512, timeout: 5000 },
      ),
    ).rejects.toThrow(ORG_HELPER_OUTPUT_LIMIT_ERROR)

    // Exceeding stderr maxBuffer also kills child and rejects
    try {
      await spawnOrganizationHelper(
        process.execPath,
        ['-e', 'process.stderr.write("e".repeat(2048))'],
        { maxBuffer: 256, timeout: 5000 },
      )
      throw new Error('expected output limit error')
    } catch (err) {
      expect(err).toBeInstanceOf(OrganizationHelperOutputLimitError)
      expect((err as Error).message).toBe(
        'The helper wrote more than its output limit.',
      )
    }
  })
})

// ============================================================================
// 5. Cross-Machine Saved Chat Refusal (09_cross_machine_transcript.js)
// ============================================================================
describe('2.1.331 Area 5: Cross-Machine Saved Chat Refusal', () => {
  test('isSavedChatFilePath (P1o) matches artifact-chat.* case-insensitively on POSIX and Windows paths', () => {
    expect(SAVED_CHAT_FILE_PREFIX).toBe('artifact-chat.')
    expect(isSavedChatFilePath('/tmp/artifact-chat.123.md')).toBe(true)
    expect(isSavedChatFilePath('/tmp/ARTIFACT-CHAT.abc.txt')).toBe(true)
    expect(isSavedChatFilePath('C:\\Users\\alice\\artifact-chat.xyz.md')).toBe(
      true,
    )
    expect(isSavedChatFilePath('/tmp/not-artifact-chat.md')).toBe(false)
    expect(isSavedChatFilePath('/tmp/artifact-chat/normal.md')).toBe(false)
  })

  test('assertNotCrossMachineSavedChatRead refuses remoteCall and forRemoteExecution with exact telemetryMessage', () => {
    // Local call allowed
    expect(() =>
      assertNotCrossMachineSavedChatRead(['/tmp/artifact-chat.1.md'], {}),
    ).not.toThrow()

    // Remote call refused with exact official message & reason
    try {
      assertNotCrossMachineSavedChatRead(['/tmp/artifact-chat.1.md'], {
        remoteCall: { origin: 'other-machine' },
        toolName: 'Read',
      })
      throw new Error('expected refusal')
    } catch (err) {
      expect(err).toBeInstanceOf(CrossMachineSavedChatReadError)
      const typed = err as CrossMachineSavedChatReadError
      expect(typed.telemetryMessage).toBe(
        SAVED_CHAT_CROSS_MACHINE_REFUSAL_REASON,
      )
      expect(typed.telemetryMessage).toBe(
        'Read of a saved chat file refused for another machine',
      )
      expect(typed.message).toBe(
        formatCrossMachineSavedChatRefusalMessage('Read'),
      )
      expect(typed.message).toBe(
        "The Read tool doesn't send files saved from claude.ai chats to a session on another machine. To read this file, use a Claude Code session on the machine where the file is.",
      )
    }

    // Symlink spelling to saved chat also refused
    expect(() =>
      assertNotCrossMachineSavedChatRead(
        ['/tmp/harmless.md', '/tmp/artifact-chat.99.md'],
        { forRemoteExecution: true },
      ),
    ).toThrow(CrossMachineSavedChatReadError)
  })

  test('FileReadTool.call refuses cross-machine read of saved chat file (direct and via symlink)', async () => {
    const dir = makeTempDir('saved-chat-')
    const chatFile = join(dir, 'artifact-chat.42.md')
    const linkFile = join(dir, 'harmless.md')
    writeFileSync(chatFile, 'private claude.ai chat transcript')
    symlinkSync(chatFile, linkFile)

    const remoteCtx = makeMockContext({
      remoteCall: { sessionId: 'remote-1' },
    })

    // Direct read refused
    await expect(
      FileReadTool.call({ file_path: chatFile }, remoteCtx),
    ).rejects.toThrow(
      "The Read tool doesn't send files saved from claude.ai chats to a session on another machine.",
    )

    // Symlinked read refused
    await expect(
      FileReadTool.call({ file_path: linkFile }, remoteCtx),
    ).rejects.toThrow(CrossMachineSavedChatReadError)

    // Local read succeeds
    const localCtx = makeMockContext()
    const localResult = await FileReadTool.call(
      { file_path: chatFile },
      localCtx,
    )
    expect(localResult.data.type).toBe('text')
  })
})

// ============================================================================
// 6. Approval Card Minimum Read Delay 3500ms (10_allow_card_read_delay.js)
// ============================================================================
describe('2.1.331 Area 6: Approval Card Minimum Read Delay (3500ms)', () => {
  test('rejects Allow received faster than 3500ms with exact official copy', async () => {
    expect(APPROVAL_CARD_MIN_READ_DELAY_MS).toBe(3500)
    expect(APPROVAL_CARD_MAX_WAIT_MS).toBe(600_000)

    let clock = 10_000
    let seenRequest: unknown
    const result = await requestApprovalCardWithReadDelay(
      {
        now: () => clock,
        sessionChanged: () => false,
        rulesStillAllow: () => true,
        askPerson: async req => {
          seenRequest = req
          clock += 3499 // 1ms too fast
          return { kind: 'chose', value: 'allow' }
        },
      },
      {
        question: 'Push your commits and open a pull request, as you?',
        row: 'To org/repo (private) on github.com',
        payload: { branchShown: 'feat/test', push: 'summary' },
      },
    )

    expect(result).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_TOO_FAST_MESSAGE,
    })
    expect(result).toEqual({
      word: 'stopped',
      text: 'That Allow came before the card could be read.',
    })
    expect(seenRequest).toMatchObject({
      source: 'ship_local_put_up',
      header: '/ship',
      personOnly: true,
      defaultToNo: true,
    })
  })

  test('accepts Allow at >= 3500ms and issues a frozen one-time WeakSet token', async () => {
    let clock = 20_000
    const result = await requestApprovalCardWithReadDelay(
      {
        now: () => clock,
        sessionChanged: () => false,
        rulesStillAllow: async () => true,
        askPerson: async () => {
          clock += 3500 // exact threshold
          return { kind: 'chose', value: 'allow' }
        },
      },
      {
        question: 'Push?',
        row: 'row details',
        payload: { branchShown: 'main', push: 'push-spec' },
      },
    )

    expect('word' in result).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(isIssuedApprovalCardToken(result)).toBe(true)
    // One-time consumption
    expect(consumeApprovalCardToken(result)).toBe(true)
    expect(isIssuedApprovalCardToken(result)).toBe(false)
    expect(consumeApprovalCardToken(result)).toBe(false)
    // Forged object rejected
    expect(
      consumeApprovalCardToken({ branchShown: 'main', push: 'push-spec' }),
    ).toBe(false)
  })

  test('stops with exact stale/changed copy on > 600000ms, session change, rule change, or missing askPerson', async () => {
    // Too late (> 600000ms)
    let clock = 50_000
    const tooLate = await requestApprovalCardWithReadDelay(
      {
        now: () => clock,
        sessionChanged: () => false,
        rulesStillAllow: () => true,
        askPerson: async () => {
          clock += 600_001
          return { kind: 'chose', value: 'allow' }
        },
      },
      { question: 'Push?', row: 'row', payload: { ok: true } },
    )
    expect(tooLate).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE,
    })
    expect(tooLate).toEqual({
      word: 'stopped',
      text: 'That answer came too late, or this session changed meanwhile.',
    })

    // Session changed mid-flight
    let changed = false
    clock = 100_000
    const midFlight = await requestApprovalCardWithReadDelay(
      {
        now: () => clock,
        sessionChanged: () => changed,
        rulesStillAllow: () => true,
        askPerson: async () => {
          clock += 4000
          changed = true
          return { kind: 'chose', value: 'allow' }
        },
      },
      { question: 'Push?', row: 'row', payload: { ok: true } },
    )
    expect(midFlight).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE,
    })

    // Rules no longer allow
    clock = 100_000
    const rulesChanged = await requestApprovalCardWithReadDelay(
      {
        now: () => clock,
        sessionChanged: () => false,
        rulesStillAllow: async () => false,
        askPerson: async () => {
          clock += 4000
          return { kind: 'chose', value: 'allow' }
        },
      },
      { question: 'Push?', row: 'row', payload: { ok: true } },
    )
    expect(rulesChanged).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE,
    })

    // Missing askPerson
    const noAsk = await requestApprovalCardWithReadDelay(
      {
        sessionChanged: () => false,
        rulesStillAllow: () => true,
      },
      { question: 'Push?', row: 'row', payload: { ok: true } },
    )
    expect(noAsk).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE,
    })

    // Deny / host_closed / unreadable answers
    const denied = await requestApprovalCardWithReadDelay(
      {
        sessionChanged: () => false,
        rulesStillAllow: () => true,
        askPerson: async () => ({ kind: 'chose', value: 'deny' }),
      },
      { question: 'Push?', row: 'row', payload: {} },
    )
    expect(denied).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_DECLINED_MESSAGE,
    })

    const hostClosed = await requestApprovalCardWithReadDelay(
      {
        sessionChanged: () => false,
        rulesStillAllow: () => true,
        askPerson: async () => ({ kind: 'unanswered', reason: 'host_closed' }),
      },
      { question: 'Push?', row: 'row', payload: {} },
    )
    expect(hostClosed).toEqual({ word: 'no_answer', text: '' })

    const unreadable = await requestApprovalCardWithReadDelay(
      {
        sessionChanged: () => false,
        rulesStillAllow: () => true,
        askPerson: async () => ({ kind: 'unanswered', reason: 'no_selection' }),
      },
      { question: 'Push?', row: 'row', payload: {} },
    )
    expect(unreadable).toEqual({
      word: 'stopped',
      text: APPROVAL_CARD_UNREADABLE_ANSWER_MESSAGE,
    })
  })
})
