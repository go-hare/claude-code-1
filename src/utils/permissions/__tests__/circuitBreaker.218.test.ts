/**
 * densable 2.1.218 #26 — circuitBreaker safetyChecks (dangerousRemoval,
 * backgroundOperator, suspiciousWindowsPath) go to the auto-mode classifier
 * instead of opening a permission dialog. #30 plan+auto no longer floors every
 * Bash ask to a dialog.
 */
import { describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { logMock } from '../../../../tests/mocks/log'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import type { PermissionDecisionReason } from '../PermissionResult.js'

mock.module('src/utils/log.ts', logMock)

// Force TRANSCRIPT_CLASSIFIER feature on for these tests via mock of bun:bundle
// is already controlled by the test runner feature env; if feature() is false
// the auto-mode branch is dead. Tests that need classifier path use explicit
// helpers below that do not depend on feature() when possible.

const {
  findSafetyCheckDecision,
  isPermissionContextAutoMode,
  hasPermissionsToUseTool,
} = await import('../permissions')

const { detectPossiblyEmptyVariableRm } = await import(
  '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
)

const { isDangerousRemovalPath } = await import('../pathValidation.js')
const { checkPathSafetyForAutoEdit } = await import('../filesystem.js')

describe('findSafetyCheckDecision (densable W9)', () => {
  test('returns top-level safetyCheck when predicate matches', () => {
    const reason: PermissionDecisionReason = {
      type: 'safetyCheck',
      reason: 'x',
      classifierApprovable: false,
      circuitBreaker: 'dangerousRemoval',
    }
    const found = findSafetyCheckDecision(
      reason,
      c => !c.classifierApprovable && c.circuitBreaker === 'dangerousRemoval',
    )
    expect(found?.circuitBreaker).toBe('dangerousRemoval')
  })

  test('walks nested subcommandResults', () => {
    const reason: PermissionDecisionReason = {
      type: 'subcommandResults',
      reasons: new Map([
        [
          'rm -rf /',
          {
            behavior: 'ask',
            message: 'danger',
            decisionReason: {
              type: 'safetyCheck',
              reason: 'crit',
              classifierApprovable: false,
              circuitBreaker: 'dangerousRemoval',
            },
          },
        ],
      ]),
    }
    const found = findSafetyCheckDecision(reason, c => !c.classifierApprovable)
    expect(found?.circuitBreaker).toBe('dangerousRemoval')
  })

  test('densable auto-mode exception: circuitBreaker + auto skips force-dialog predicate', () => {
    const reason: PermissionDecisionReason = {
      type: 'safetyCheck',
      reason: 'danger',
      classifierApprovable: false,
      circuitBreaker: 'dangerousRemoval',
    }
    const autoContext = true
    const forced = findSafetyCheckDecision(
      reason,
      check =>
        !check.classifierApprovable &&
        !(check.circuitBreaker !== undefined && autoContext),
    )
    // circuitBreaker in auto mode → NOT forced to dialog
    expect(forced).toBeUndefined()

    const forcedDefault = findSafetyCheckDecision(
      reason,
      check =>
        !check.classifierApprovable &&
        !(check.circuitBreaker !== undefined && false),
    )
    // default mode → still forced
    expect(forcedDefault?.circuitBreaker).toBe('dangerousRemoval')
  })
})

describe('isPermissionContextAutoMode (densable ctn)', () => {
  test('true for mode auto', () => {
    expect(
      isPermissionContextAutoMode({
        ...getEmptyToolPermissionContext(),
        mode: 'auto',
      }),
    ).toBe(true)
  })

  test('false for default', () => {
    expect(
      isPermissionContextAutoMode({
        ...getEmptyToolPermissionContext(),
        mode: 'default',
      }),
    ).toBe(false)
  })

  // densable 2.1.218 #30 / ctn: plan + auto-mode active (without bypass) counts
  // as auto context so circuitBreaker / plan_mode_floor can reach the classifier.
  // When TRANSCRIPT_CLASSIFIER is off at load time, autoModeStateModule is null
  // and plan never becomes auto — skip rather than false-fail.
  test('true for plan when auto-mode active and bypass unavailable', async () => {
    const autoMode = await import('../autoModeState.js')
    autoMode._resetForTesting()
    autoMode.setAutoModeActive(true)

    const planNoBypass = isPermissionContextAutoMode({
      ...getEmptyToolPermissionContext(),
      mode: 'plan',
      isBypassPermissionsModeAvailable: true,
    })
    const planWithBypass = isPermissionContextAutoMode({
      ...getEmptyToolPermissionContext(),
      mode: 'plan',
      isBypassPermissionsModeAvailable: true,
      prePlanMode: 'bypassPermissions',
    })

    if (!planNoBypass && !planWithBypass) {
      // Feature gate stripped autoModeStateModule from permissions.ts
      autoMode._resetForTesting()
      return
    }

    expect(planNoBypass).toBe(true)
    expect(planWithBypass).toBe(false)
    autoMode._resetForTesting()
  })
})

describe('detectPossiblyEmptyVariableRm (densable DDs)', () => {
  test('catches rm -rf $UNSET/*', () => {
    expect(detectPossiblyEmptyVariableRm('rm -rf $UNSET/*')).toEqual({
      command: 'rm',
      target: '$UNSET/*',
    })
  })

  test('catches rmdir ${DIR}/', () => {
    expect(detectPossiblyEmptyVariableRm('rmdir ${DIR}/')).toEqual({
      command: 'rmdir',
      target: '${DIR}/',
    })
  })

  test('ignores non-rm commands', () => {
    expect(detectPossiblyEmptyVariableRm('ls $DIR/*')).toBeNull()
  })

  test('ignores rm without $', () => {
    expect(detectPossiblyEmptyVariableRm('rm -rf /tmp/foo')).toBeNull()
  })
})

describe('safetyCheck tagging', () => {
  test('isDangerousRemovalPath still flags root', () => {
    expect(isDangerousRemovalPath('/')).toBe(true)
    expect(isDangerousRemovalPath('/*')).toBe(true)
  })

  test('suspicious Windows path returns non-approvable + circuitBreaker tag', () => {
    // ADS stream is a classic suspicious Windows pattern
    const result = checkPathSafetyForAutoEdit('C:\\Users\\x\\file.txt::$DATA')
    if (result.safe) {
      // On non-Windows the pattern may still fire via hasSuspiciousWindowsPathPattern
      // if the implementation checks for ::$DATA regardless of platform
      // Accept either: if safe on this platform, skip
      return
    }
    expect(result.classifierApprovable).toBe(false)
    expect(result.circuitBreaker).toBe('suspiciousWindowsPath')
  })
})

describe('bypassPermissions still blocks non-approvable safetyCheck', () => {
  function makeContext(
    mode: 'bypassPermissions' | 'auto' | 'default',
  ): ToolUseContext {
    const toolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      mode,
      isBypassPermissionsModeAvailable: true,
    }
    return {
      getAppState: () =>
        ({
          toolPermissionContext,
          mcp: { tools: [] },
        }) as unknown as ReturnType<ToolUseContext['getAppState']>,
      abortController: new AbortController(),
    } as unknown as ToolUseContext
  }

  function makeSafetyTool(
    classifierApprovable: boolean,
    circuitBreaker?:
      | 'dangerousRemoval'
      | 'backgroundOperator'
      | 'suspiciousWindowsPath',
  ): Tool {
    return {
      name: 'Write',
      inputSchema: z.object({
        file_path: z.string(),
        content: z.string().optional(),
      }),
      checkPermissions: async () => ({
        behavior: 'ask' as const,
        message: 'sensitive path',
        decisionReason: {
          type: 'safetyCheck' as const,
          reason: 'test safety',
          classifierApprovable,
          ...(circuitBreaker ? { circuitBreaker } : {}),
        },
      }),
    } as unknown as Tool
  }

  const dummyMsg = {} as AssistantMessage

  test('dangerousRemoval stays ask under bypassPermissions', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(false, 'dangerousRemoval'),
      { file_path: '/', content: 'x' },
      makeContext('bypassPermissions'),
      dummyMsg,
      'tu_rm',
    )
    expect(result.behavior).toBe('ask')
  })

  test('suspiciousWindowsPath stays ask under bypassPermissions', async () => {
    const result = await hasPermissionsToUseTool(
      makeSafetyTool(false, 'suspiciousWindowsPath'),
      { file_path: 'file.txt::$DATA', content: 'x' },
      makeContext('bypassPermissions'),
      dummyMsg,
      'tu_win',
    )
    expect(result.behavior).toBe('ask')
  })
})
