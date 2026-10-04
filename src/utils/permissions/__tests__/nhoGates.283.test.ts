import { afterEach, describe, expect, test } from 'bun:test'
import { WORKFLOW_TOOL_NAME } from '@claude-code/workflow-engine'
import { isSdkDialogHostActive } from '../../../bootstrap/state.js'
import { SettingsSchema } from '../../settings/types.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  autoModeConfigHasDenyRules,
  hasClassifierRoutedSafetyCheck,
  isClassifierRoutedSafetyCheck,
  isDesktopForwardSkipClassifier,
  isServerHeldClassifierAsk,
  isTicklishWhisper,
  pluginOriginCaller,
  SERVER_HELD_CLASSIFIER_REASON,
  shouldHoldConsecutiveDenials,
} from '../nhoGates.js'
import { workflowNeedsUsageConsentPrompt } from '../workflowUsageConsent.js'
import type { ToolUseContext } from '../../../Tool.js'

describe('nhoGates densable 2.1.283 k0/tqn/hn', () => {
  const prev = process.env.CLAUDE_CODE_TICKLISH_WHISPER
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_CODE_TICKLISH_WHISPER
    else process.env.CLAUDE_CODE_TICKLISH_WHISPER = prev
  })

  test('k0 mHo: env CLAUDE_CODE_TICKLISH_WHISPER is truthy', () => {
    process.env.CLAUDE_CODE_TICKLISH_WHISPER = '1'
    expect(isTicklishWhisper()).toBe(true)
    process.env.CLAUDE_CODE_TICKLISH_WHISPER = 'false'
    expect(isTicklishWhisper()).toBe(false)
  })

  test('k0 holds consecutive denials only with requestDialog and whisper', () => {
    process.env.CLAUDE_CODE_TICKLISH_WHISPER = '1'
    const withDialog = {
      requestDialog: async () => {},
    } as unknown as ToolUseContext
    const without = {} as unknown as ToolUseContext
    expect(shouldHoldConsecutiveDenials(without)).toBe(false)
    // gold k2 = sdkDialogHostActive — when the print host is armed, k0 is false.
    if (!isSdkDialogHostActive()) {
      expect(shouldHoldConsecutiveDenials(withDialog)).toBe(true)
    }
  })

  test('prt: any autoMode soft/hard deny length>0 blocks plugin-origin skip', () => {
    expect(autoModeConfigHasDenyRules(undefined)).toBe(false)
    expect(autoModeConfigHasDenyRules(null)).toBe(false)
    expect(autoModeConfigHasDenyRules({})).toBe(false)
    expect(autoModeConfigHasDenyRules({ soft_deny: [], hard_deny: [] })).toBe(
      false,
    )
    // gold prt is length>0, not PHo's r!==$defaults
    expect(autoModeConfigHasDenyRules({ soft_deny: ['$defaults'] })).toBe(true)
    expect(autoModeConfigHasDenyRules({ hard_deny: ['Bash(rm:*)'] })).toBe(true)
    const nho = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(nho).toContain('!autoModeHasDenyRules()')
  })

  test('e3: classifierRouted circuitBreaker blocks tqn skip', () => {
    expect(
      isClassifierRoutedSafetyCheck({ circuitBreaker: 'dangerousRemoval' }),
    ).toBe(true)
    expect(
      isClassifierRoutedSafetyCheck({ circuitBreaker: 'backgroundOperator' }),
    ).toBe(true)
    expect(
      isClassifierRoutedSafetyCheck({
        circuitBreaker: 'suspiciousWindowsPath',
      }),
    ).toBe(true)
    // gold e3: outsideReadsBlocked.classifierRouted is false
    expect(
      isClassifierRoutedSafetyCheck({
        circuitBreaker: 'outsideReadsBlocked',
      }),
    ).toBe(false)
    expect(isClassifierRoutedSafetyCheck({})).toBe(false)
    expect(
      hasClassifierRoutedSafetyCheck({
        type: 'safetyCheck',
        circuitBreaker: 'dangerousRemoval',
      }),
    ).toBe(true)
    expect(
      hasClassifierRoutedSafetyCheck({
        type: 'safetyCheck',
        circuitBreaker: 'outsideReadsBlocked',
      }),
    ).toBe(false)
    expect(
      hasClassifierRoutedSafetyCheck({
        type: 'subcommandResults',
        reasons: new Map([
          [
            'rm',
            {
              decisionReason: {
                type: 'safetyCheck',
                circuitBreaker: 'dangerousRemoval',
              },
            },
          ],
        ]),
      }),
    ).toBe(true)
    const nho = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(nho).toContain(
      '!hasClassifierRoutedSafetyCheck(result.decisionReason)',
    )
    expect(nho).toContain('persistDenialStateUnlessHeld(context, denialState)')
    expect(nho).toContain(
      'isAutoModeOrPlanActingAsAuto(layeredPermissionContext.mode)',
    )
    expect(nho).toContain('isAutoModeOrPlanActingAsAuto(effectiveModeForAuto)')
  })

  test('tqn: hookCaller only on main thread', () => {
    expect(pluginOriginCaller({ hookCaller: 'acme' } as ToolUseContext)).toBe(
      'acme',
    )
    expect(
      pluginOriginCaller({
        hookCaller: 'acme',
        agentId: 'a1',
      } as unknown as ToolUseContext),
    ).toBeUndefined()
    expect(
      pluginOriginCaller({
        hookCaller: 'acme',
        forRemoteExecution: true,
      } as ToolUseContext),
    ).toBeUndefined()
  })

  test('hn: E1t server-held classifier reason', () => {
    expect(SERVER_HELD_CLASSIFIER_REASON).toContain('server-side classifier')
    expect(
      isServerHeldClassifierAsk({
        decisionReason: {
          type: 'other',
          reason: SERVER_HELD_CLASSIFIER_REASON,
        },
      }),
    ).toBe(true)
    expect(
      isServerHeldClassifierAsk({
        decisionReason: { type: 'workingDir', reason: 'outside' },
      }),
    ).toBe(false)
  })

  test('desktop_forward: stamp equals toolUseID, not workingDir/blockedPath/RUI', () => {
    const ctx = {
      desktopForwardToolUseId: 'sendmessage_desktop',
    } as ToolUseContext
    const tool = {}
    expect(
      isDesktopForwardSkipClassifier(
        ctx,
        'sendmessage_desktop',
        { decisionReason: { type: 'other' } },
        tool,
      ),
    ).toBe(true)
    expect(isDesktopForwardSkipClassifier(ctx, 'other-id', {}, tool)).toBe(
      false,
    )
    expect(
      isDesktopForwardSkipClassifier(
        ctx,
        'sendmessage_desktop',
        { decisionReason: { type: 'workingDir' } },
        tool,
      ),
    ).toBe(false)
    expect(
      isDesktopForwardSkipClassifier(
        ctx,
        'sendmessage_desktop',
        { blockedPath: '/tmp/x' },
        tool,
      ),
    ).toBe(false)
    expect(
      isDesktopForwardSkipClassifier(
        ctx,
        'sendmessage_desktop',
        {},
        { requiresUserInteraction: () => true },
      ),
    ).toBe(false)
    expect(
      isDesktopForwardSkipClassifier({} as ToolUseContext, 'x', {}, tool),
    ).toBe(false)
    expect(
      isDesktopForwardSkipClassifier(
        ctx,
        'sendmessage_desktop',
        { decisionReason: { type: 'safetyCheck' } },
        tool,
      ),
    ).toBe(false)
  })

  test('desktop_forward NHo + call-site clear; Qe producer is not invented', () => {
    const nho = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(nho).toContain('isDesktopForwardSkipClassifier(context, toolUseID')
    expect(nho).toContain("'desktop_forward'")
    expect(nho).toContain("SendMessage's forward to Claude Desktop")
    const call = readFileSync(
      join(import.meta.dir, '../../../services/tools/toolExecution.ts'),
      'utf8',
    )
    expect(call).toContain('desktopForwardToolUseId: undefined')
    expect(call).not.toContain('_desktop')
    expect(call).not.toContain('session_id')
  })
})

describe('pHo workflowNeedsUsageConsentPrompt', () => {
  test('SettingsSchema accepts skipWorkflowUsageWarning', () => {
    const parsed = SettingsSchema().safeParse({
      skipWorkflowUsageWarning: true,
    })
    expect(parsed.success).toBe(true)
  })

  test('only Workflow tool can prompt; non-interactive skips', () => {
    const ctx = {
      options: { isNonInteractiveSession: false, mainLoopModel: 'test' },
      getAppState: () => ({
        toolPermissionContext: {},
        effortValue: undefined,
        ultracode: false,
      }),
    } as unknown as ToolUseContext
    expect(workflowNeedsUsageConsentPrompt('Bash', ctx)).toBe(false)
    const ni = {
      ...ctx,
      options: { isNonInteractiveSession: true, mainLoopModel: 'test' },
    } as unknown as ToolUseContext
    expect(workflowNeedsUsageConsentPrompt(WORKFLOW_TOOL_NAME, ni)).toBe(false)
  })

  test('gold yx: ultracode skip only when applied effort is xhigh', () => {
    const src = readFileSync(
      join(import.meta.dir, '../workflowUsageConsent.ts'),
      'utf8',
    )
    expect(src).toContain("=== 'xhigh'")
    expect(src).toContain('resolveAppliedEffort')
  })
})
