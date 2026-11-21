import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { feature } from 'bun:bundle'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/builtin-tools/tools/SendMessageTool/constants.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import type { PermissionResult } from '../../../types/permissions.js'
import * as settingsModule from '../../settings/settings.js'
import * as settingsConstants from '../../settings/constants.js'
import * as permissionsLoader from '../permissionsLoader.js'
import * as projectGrantsGate from '../projectGrantsGate.js'
import * as yoloClassifierModule from '../yoloClassifier.js'
import {
  containsCodeModeUnicodeEscape,
  hasPermissionsToUseTool,
  mustAskPersonForPermission,
  syncPermissionRulesFromDisk,
} from '../permissions.js'
import { initializeToolPermissionContext } from '../permissionSetup.js'
import {
  AUTO_MODE_UNAVAILABLE_HOST_CODES,
  denyAutoModeUnavailableStop,
} from '../autoModeUnavailable.js'

const hasTranscriptClassifier = feature('TRANSCRIPT_CLASSIFIER') ? true : false
const classifierTest = test.skipIf(!hasTranscriptClassifier)

const spies: Array<{ mockRestore: () => void }> = []
const tempDirs: string[] = []

afterEach(() => {
  while (spies.length > 0) {
    spies.pop()?.mockRestore()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeContext(
  permOverrides: Partial<ToolPermissionContext> = {},
  ctxOverrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const permCtx: ToolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    ...permOverrides,
  }
  const appState = {
    ...getDefaultAppState(),
    toolPermissionContext: permCtx,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map() as any,
    getAppState: () => appState as any,
    setAppState: () => {},
    messages: [],
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    ...ctxOverrides,
  } as unknown as ToolUseContext
}

function makeAssistantMessage(
  extra: Record<string, unknown> = {},
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'uuid-wave1a',
    message: {
      id: 'msg_wave1a',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    ...extra,
  } as unknown as AssistantMessage
}

function makeTool(
  name: string,
  checkPermissionsImpl: (
    input: unknown,
    ctx: ToolUseContext,
  ) => Promise<PermissionResult>,
): Tool {
  return {
    name,
    inputSchema: z.object({}).passthrough(),
    description: async () => `tool ${name}`,
    prompt: async () => `tool ${name}`,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    isReadOnly: () => false,
    userFacingName: () => name,
    checkPermissions: checkPermissionsImpl as any,
    call: (async () => ({ data: 'ok' })) as any,
    mapToolResultToToolResultBlockParam: (content: unknown, id: string) => ({
      tool_use_id: id,
      type: 'tool_result' as const,
      content: String(content),
    }),
  } as unknown as Tool
}

describe('Wave 1A Core Permissions Parity (2.1.328)', () => {
  test('[P0-9] whole-tool alwaysAllowRules never bypass personOnly, classifierApprovable safetyCheck, sandboxOverride, or plan mode ask', async () => {
    // 1. classifierApprovable: true safetyCheck (e.g. .git/, .claude/, .bashrc)
    const editTool = makeTool('Edit', async () => ({
      behavior: 'ask',
      message: 'Editing .git/config requires approval',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Sensitive path .git/config',
        classifierApprovable: true,
      },
    }))
    const defaultAllowAllCtx = makeContext({
      mode: 'default',
      alwaysAllowRules: { userSettings: ['Edit'] },
    })
    const safetyInDefault = await hasPermissionsToUseTool(
      editTool,
      { file_path: '.git/config' },
      defaultAllowAllCtx,
      makeAssistantMessage(),
      'tu-p09-1',
    )
    expect(safetyInDefault.behavior).toBe('ask')

    // Still allowed in bypassPermissions for classifierApprovable safetyCheck
    const bypassCtx = makeContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
    })
    const safetyInBypass = await hasPermissionsToUseTool(
      editTool,
      { file_path: '.git/config' },
      bypassCtx,
      makeAssistantMessage(),
      'tu-p09-2',
    )
    expect(safetyInBypass.behavior).toBe('allow')

    // 2. personOnly: true returns ask BEFORE both alwaysAllowRules and bypassPermissions
    const personOnlyTool = makeTool('Artifact', async () => ({
      behavior: 'ask',
      message: 'Org requires a person to approve each new artifact',
      personOnly: true,
      decisionReason: {
        type: 'other',
        reason: 'org_new_artifact_approval',
      },
    }))
    const personInAllowRule = await hasPermissionsToUseTool(
      personOnlyTool,
      {},
      makeContext({
        mode: 'default',
        alwaysAllowRules: { userSettings: ['Artifact'] },
      }),
      makeAssistantMessage(),
      'tu-p09-3',
    )
    expect(personInAllowRule.behavior).toBe('ask')

    const personInBypass = await hasPermissionsToUseTool(
      personOnlyTool,
      {},
      bypassCtx,
      makeAssistantMessage(),
      'tu-p09-4',
    )
    expect(personInBypass.behavior).toBe('ask')

    // 3. sandboxOverride returns ask BEFORE whole-tool alwaysAllowRules
    const bashTool = makeTool('Bash', async () => ({
      behavior: 'ask',
      message: 'Run outside of the sandbox',
      decisionReason: {
        type: 'sandboxOverride',
        reason: 'dangerouslyDisableSandbox',
      },
    }))
    const sandboxOverrideRes = await hasPermissionsToUseTool(
      bashTool,
      { command: 'echo hi', dangerouslyDisableSandbox: true },
      makeContext({
        mode: 'default',
        alwaysAllowRules: { userSettings: ['Bash'] },
      }),
      makeAssistantMessage(),
      'tu-p09-5',
    )
    expect(sandboxOverrideRes.behavior).toBe('ask')

    // 4. mode === 'plan' returns ask BEFORE whole-tool alwaysAllowRules
    const planTool = makeTool('Write', async () => ({
      behavior: 'ask',
      message: 'Plan mode requires approval',
      decisionReason: { type: 'mode', mode: 'plan' },
    }))
    const planModeRes = await hasPermissionsToUseTool(
      planTool,
      { file_path: 'foo.ts' },
      makeContext({
        mode: 'plan',
        alwaysAllowRules: { userSettings: ['Write'] },
      }),
      makeAssistantMessage(),
      'tu-p09-6',
    )
    expect(planModeRes.behavior).toBe('ask')
  })

  test('[P0-10] mustAskPersonForPermission (FYn) matches hookAskFloor or personOnly ask', () => {
    expect(
      mustAskPersonForPermission(true, {
        behavior: 'allow',
        updatedInput: {},
      }),
    ).toBe(true)
    expect(
      mustAskPersonForPermission(false, {
        behavior: 'ask',
        message: 'needs human',
        personOnly: true,
      }),
    ).toBe(true)
    expect(
      mustAskPersonForPermission(false, {
        behavior: 'ask',
        message: 'normal ask',
      }),
    ).toBe(false)
  })

  classifierTest(
    '[P0-10] auto-mode fast paths (acceptEdits, allowlist, replScriptInner, YOLO classifier) never auto-allow when personOnly: true',
    async () => {
      const yoloSpy = spyOn(
        yoloClassifierModule,
        'classifyYoloAction',
      ).mockResolvedValue({
        shouldBlock: false,
        reason: 'safe',
        model: 'claude-sonnet-4-6',
        durationMs: 5,
        classifierRan: true,
      })
      spies.push(yoloSpy)

      // 1. acceptEdits fast path with personOnly: true -> returns ask (interactive), deny (headless)
      const editTool = makeTool('Edit', async (_input, ctx) => {
        if (ctx.getAppState().toolPermissionContext.mode === 'acceptEdits') {
          return { behavior: 'allow', updatedInput: { file_path: 'a.ts' } }
        }
        return {
          behavior: 'ask',
          message: 'Requires person approval',
          personOnly: true,
        }
      })
      const interactiveEdit = await hasPermissionsToUseTool(
        editTool,
        { file_path: 'a.ts' },
        makeContext({ mode: 'auto' }),
        makeAssistantMessage(),
        'tu-p10-edit-1',
      )
      expect(interactiveEdit.behavior).toBe('ask')

      const headlessEdit = await hasPermissionsToUseTool(
        editTool,
        { file_path: 'a.ts' },
        makeContext({ mode: 'auto', shouldAvoidPermissionPrompts: true }),
        makeAssistantMessage(),
        'tu-p10-edit-2',
      )
      expect(headlessEdit.behavior).toBe('deny')

      // 2. allowlist fast path (Read) with personOnly: true -> returns ask (interactive), deny (headless)
      const readTool = makeTool('Read', async () => ({
        behavior: 'ask',
        message: 'Person-only read',
        personOnly: true,
      }))
      const interactiveRead = await hasPermissionsToUseTool(
        readTool,
        { file_path: 'a.ts' },
        makeContext({ mode: 'auto' }),
        makeAssistantMessage(),
        'tu-p10-read-1',
      )
      expect(interactiveRead.behavior).toBe('ask')

      const headlessRead = await hasPermissionsToUseTool(
        readTool,
        { file_path: 'a.ts' },
        makeContext({ mode: 'auto', shouldAvoidPermissionPrompts: true }),
        makeAssistantMessage(),
        'tu-p10-read-2',
      )
      expect(headlessRead.behavior).toBe('deny')

      // 3. YOLO classifier allow with personOnly: true -> returns ask (interactive)
      const customTool = makeTool('CustomTool', async () => ({
        behavior: 'ask',
        message: 'Person-only custom tool',
        personOnly: true,
      }))
      const classifierPersonOnly = await hasPermissionsToUseTool(
        customTool,
        { x: 1 },
        makeContext({ mode: 'auto' }),
        makeAssistantMessage(),
        'tu-p10-yolo-1',
      )
      expect(classifierPersonOnly.behavior).toBe('ask')

      // 4. replScriptInner with personOnly: true -> returns ask (never auto-allows)
      const replInnerPersonOnly = await hasPermissionsToUseTool(
        customTool,
        { x: 1 },
        makeContext({ mode: 'auto' }, { replScriptInner: true }),
        makeAssistantMessage(),
        'tu-p10-repl-1',
      )
      expect(replInnerPersonOnly.behavior).toBe('ask')
    },
  )

  classifierTest(
    '[P0-11] auto-mode Code Mode guards refuse Agent/SendMessage, sandboxOverride via replScriptInner, inputChangedByHook, and \\uXXXX escapes',
    async () => {
      const yoloSpy = spyOn(
        yoloClassifierModule,
        'classifyYoloAction',
      ).mockResolvedValue({
        shouldBlock: false,
        reason: 'safe',
        model: 'claude-sonnet-4-6',
        durationMs: 5,
        classifierRan: true,
      })
      spies.push(yoloSpy)

      // 1. Agent refused inside replScriptInner
      const agentTool = makeTool(AGENT_TOOL_NAME, async () => ({
        behavior: 'ask',
        message: 'Spawn agent?',
      }))
      const agentRes = await hasPermissionsToUseTool(
        agentTool,
        { prompt: 'do work' },
        makeContext({ mode: 'auto' }, { replScriptInner: true }),
        makeAssistantMessage(),
        'tu-p11-agent',
      )
      expect(agentRes.behavior).toBe('deny')
      if (agentRes.behavior === 'deny') {
        expect(agentRes.message).toContain(AGENT_TOOL_NAME)
      }

      // 2. SendMessage refused inside replScriptInner
      const sendMsgTool = makeTool(SEND_MESSAGE_TOOL_NAME, async () => ({
        behavior: 'ask',
        message: 'Send message?',
      }))
      const sendMsgRes = await hasPermissionsToUseTool(
        sendMsgTool,
        { to: 'worker', message: 'hi' },
        makeContext({ mode: 'auto' }, { replScriptInner: true }),
        makeAssistantMessage(),
        'tu-p11-sendmsg',
      )
      expect(sendMsgRes.behavior).toBe('deny')
      if (sendMsgRes.behavior === 'deny') {
        expect(sendMsgRes.message).toContain(SEND_MESSAGE_TOOL_NAME)
      }

      // 3. sandboxOverride refused via replScriptInner
      const bashTool = makeTool('Bash', async () => ({
        behavior: 'ask',
        message: 'Run outside sandbox',
        decisionReason: {
          type: 'sandboxOverride',
          reason: 'dangerouslyDisableSandbox',
        },
      }))
      const sandboxRes = await hasPermissionsToUseTool(
        bashTool,
        { command: 'ls', dangerouslyDisableSandbox: true },
        makeContext({ mode: 'auto' }, { replScriptInner: true }),
        makeAssistantMessage(),
        'tu-p11-sandbox',
      )
      expect(sandboxRes.behavior).toBe('deny')

      // 4. Outer REPL refused when inputChangedByHook is true
      const replTool = makeTool(REPL_TOOL_NAME, async () => ({
        behavior: 'ask',
        message: 'Run REPL?',
      }))
      const rewriteRes = await hasPermissionsToUseTool(
        replTool,
        { code: 'console.log(1)' },
        makeContext({ mode: 'auto' }, {
          inputChangedByHook: true,
        } as unknown as Partial<ToolUseContext>),
        makeAssistantMessage(),
        'tu-p11-rewrite',
      )
      expect(rewriteRes.behavior).toBe('deny')
      if (rewriteRes.behavior === 'deny') {
        expect(rewriteRes.message).toContain('hook changed')
      }

      // 5. Outer REPL refused when code contains \uXXXX escape
      expect(containsCodeModeUnicodeEscape('const x = "\\u001b"')).toBe(true)
      expect(containsCodeModeUnicodeEscape('const x = "\\x1b"')).toBe(false)
      const escapeRes = await hasPermissionsToUseTool(
        replTool,
        { code: 'const x = "\\u0072m"' },
        makeContext({ mode: 'auto' }),
        makeAssistantMessage(),
        'tu-p11-escape',
      )
      expect(escapeRes.behavior).toBe('deny')
      if (escapeRes.behavior === 'deny') {
        expect(escapeRes.message).toContain('\\uXXXX')
      }
    },
  )

  test('[P0-15] syncPermissionRulesFromDisk preserves cliArg/session deny+ask under managed-only and clears all 5 SettingSource tiers', () => {
    const managedSpy = spyOn(
      permissionsLoader,
      'shouldAllowManagedPermissionRulesOnly',
    ).mockReturnValue(true)
    spies.push(managedSpy)

    const initial: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        cliArg: ['Bash'],
        session: ['Edit'],
        userSettings: ['Read'],
        flagSettings: ['Glob'],
        policySettings: ['Grep'],
      },
      alwaysDenyRules: {
        cliArg: ['WebFetch'],
        session: ['WebSearch'],
        flagSettings: ['StaleFlagDeny'],
        policySettings: ['StalePolicyDeny'],
      },
      alwaysAskRules: {
        cliArg: ['NotebookEdit'],
        session: ['Agent'],
        flagSettings: ['StaleFlagAsk'],
        policySettings: ['StalePolicyAsk'],
      },
    }

    const synced = syncPermissionRulesFromDisk(initial, [
      {
        source: 'policySettings',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'NewPolicyDeny' },
      },
    ])

    // cliArg & session: allow cleared, deny & ask preserved!
    expect(synced.alwaysAllowRules.cliArg).toEqual([])
    expect(synced.alwaysAllowRules.session).toEqual([])
    expect(synced.alwaysDenyRules.cliArg).toEqual(['WebFetch'])
    expect(synced.alwaysDenyRules.session).toEqual(['WebSearch'])
    expect(synced.alwaysAskRules.cliArg).toEqual(['NotebookEdit'])
    expect(synced.alwaysAskRules.session).toEqual(['Agent'])

    // All 5 SettingSource tiers cleared before replay (flagSettings & policySettings stale rules removed)
    expect(synced.alwaysAllowRules.flagSettings).toEqual([])
    expect(synced.alwaysDenyRules.flagSettings).toEqual([])
    expect(synced.alwaysAskRules.flagSettings).toEqual([])
    expect(synced.alwaysAllowRules.policySettings).toEqual([])
    expect(synced.alwaysDenyRules.policySettings).toEqual(['NewPolicyDeny'])
    expect(synced.alwaysAskRules.policySettings).toEqual([])
  })

  test('[P0-15] initializeToolPermissionContext tags additionalDirectories with projectSettings/localSettings instead of cliArg', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wave1a-adddir-'))
    tempDirs.push(base)
    const projectExtra = join(base, 'proj-extra')
    const localExtra = join(base, 'local-extra')
    const cliExtra = join(base, 'cli-extra')
    mkdirSync(projectExtra, { recursive: true })
    mkdirSync(localExtra, { recursive: true })
    mkdirSync(cliExtra, { recursive: true })

    spies.push(
      spyOn(projectGrantsGate, 'isCurrentProjectTrustLatched').mockReturnValue(
        true,
      ),
      spyOn(projectGrantsGate, 'getProjectGrantsGates').mockReturnValue({
        gateProject: true,
        gateLocal: false,
      }),
      spyOn(settingsConstants, 'getEnabledSettingSources').mockReturnValue([
        'userSettings',
        'projectSettings',
        'localSettings',
        'flagSettings',
        'policySettings',
      ]),
      spyOn(settingsModule, 'getSettingsForSource').mockImplementation(src => {
        if (src === 'projectSettings') {
          return {
            permissions: { additionalDirectories: [projectExtra] },
          } as never
        }
        if (src === 'localSettings') {
          return {
            permissions: { additionalDirectories: [localExtra] },
          } as never
        }
        return null
      }),
    )

    const { toolPermissionContext } = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      baseToolsCli: undefined,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: false,
      addDirs: [cliExtra],
    })

    expect(
      toolPermissionContext.additionalWorkingDirectories.get(
        resolve(projectExtra),
      )?.source,
    ).toBe('projectSettings')
    expect(
      toolPermissionContext.additionalWorkingDirectories.get(
        resolve(localExtra),
      )?.source,
    ).toBe('localSettings')
    expect(
      toolPermissionContext.additionalWorkingDirectories.get(resolve(cliExtra))
        ?.source,
    ).toBe('cliArg')
  })

  test('[#1492] denyAutoModeUnavailableStop sets hostCode and endsTurn on decisionReason for all 3 stop reasons', () => {
    expect(AUTO_MODE_UNAVAILABLE_HOST_CODES).toEqual({
      no_verdict: 'auto_mode_stop_no_verdict',
      no_classifier_for_session: 'auto_mode_stop_no_check_in_session',
      no_classifier_for_call: 'auto_mode_stop_no_result_for_calls',
    })
    for (const [reason, expectedCode] of Object.entries(
      AUTO_MODE_UNAVAILABLE_HOST_CODES,
    )) {
      const res = denyAutoModeUnavailableStop(
        { name: 'Bash' } as Tool,
        {},
        false,
        reason as keyof typeof AUTO_MODE_UNAVAILABLE_HOST_CODES,
      )
      expect(res.behavior).toBe('deny')
      expect(res.endsTurn).toBe(true)
      expect(res.decisionReason.hostCode).toBe(expectedCode)
      expect(res.decisionReason.endsTurn).toBe(true)
    }
  })
})
