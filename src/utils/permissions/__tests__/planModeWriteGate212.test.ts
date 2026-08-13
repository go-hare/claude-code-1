/**
 * densable 2.1.212 #7:
 * Plan mode must not auto-run file-modifying Bash (touch/rm/…) or writes
 * without a permission prompt / SDK canUseTool.
 *
 * Gates:
 * - checkWritePermissionForTool: mode==="plan" → ask (after safety)
 * - hasPermissionsToUseTool: skip acceptEdits fast-path when mode==="plan"
 * - plan_mode_floor: non-RO tools stay ask under plan (no classifier auto)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import {
  checkWritePermissionForTool,
  generateSuggestions,
} from '../filesystem.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { _resetForTesting } from '../autoModeState.js'
import {
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'

// getPlansDirectory / write gates use getCwd + settings; seed bootstrap so
// co-suite pollution (undefined STATE.cwd) cannot TypeError path.relative.
const suiteCwd = process.cwd()
beforeEach(() => {
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setProjectRoot(suiteCwd)
})

function baseCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  } as ToolPermissionContext
}

afterEach(() => {
  _resetForTesting()
})

describe('checkWritePermissionForTool densable plan gate (#7)', () => {
  test('plan mode asks for write even inside working dir', () => {
    const cwd = process.cwd()
    const filePath = `${cwd.replace(/\\/g, '/')}/tmp-plan-gate-fixture.ts`
    const result = checkWritePermissionForTool(
      FileEditTool,
      {
        file_path: filePath,
        old_string: 'a',
        new_string: 'b',
      },
      baseCtx({ mode: 'plan' }),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toContain('while in plan mode')
      expect(result.decisionReason).toEqual({ type: 'mode', mode: 'plan' })
    }
  })

  test('default mode still asks (not auto-allow) for write without rules', () => {
    const cwd = process.cwd()
    const filePath = `${cwd.replace(/\\/g, '/')}/tmp-plan-gate-fixture2.ts`
    const result = checkWritePermissionForTool(
      FileEditTool,
      {
        file_path: filePath,
        old_string: 'a',
        new_string: 'b',
      },
      baseCtx({ mode: 'default' }),
    )
    expect(result.behavior).toBe('ask')
    // not the plan-mode message
    if (result.behavior === 'ask') {
      expect(result.message ?? '').not.toContain('while in plan mode')
    }
  })

  test('acceptEdits still auto-allows writes in working dir', () => {
    const cwd = process.cwd()
    const filePath = `${cwd.replace(/\\/g, '/')}/tmp-plan-gate-fixture3.ts`
    const result = checkWritePermissionForTool(
      FileEditTool,
      {
        file_path: filePath,
        old_string: 'a',
        new_string: 'b',
      },
      baseCtx({ mode: 'acceptEdits' }),
    )
    expect(result.behavior).toBe('allow')
  })

  test('generateSuggestions suppresses acceptEdits when prePlan elevated', () => {
    const cwd = process.cwd()
    const filePath = `${cwd.replace(/\\/g, '/')}/tmp-plan-gate-fixture4.ts`
    const elevated = generateSuggestions(
      filePath,
      'write',
      baseCtx({ mode: 'plan', prePlanMode: 'auto' }),
    )
    expect(
      elevated.some(
        s =>
          s.type === 'setMode' &&
          (s as { mode?: string }).mode === 'acceptEdits',
      ),
    ).toBe(false)

    const plainPlan = generateSuggestions(
      filePath,
      'write',
      baseCtx({ mode: 'plan', prePlanMode: 'default' }),
    )
    expect(
      plainPlan.some(
        s =>
          s.type === 'setMode' &&
          (s as { mode?: string }).mode === 'acceptEdits',
      ),
    ).toBe(true)
  })
})

describe('Bash modeValidation plan must not acceptEdits-allow', () => {
  test('checkPermissionMode only auto-allows filesystem cmds in acceptEdits', async () => {
    const { checkPermissionMode } = await import(
      '@claude-code/builtin-tools/tools/BashTool/modeValidation.js'
    )
    const plan = checkPermissionMode(
      { command: 'touch foo.txt' },
      baseCtx({ mode: 'plan' }),
    )
    expect(plan.behavior).toBe('passthrough')

    const accept = checkPermissionMode(
      { command: 'touch foo.txt' },
      baseCtx({ mode: 'acceptEdits' }),
    )
    expect(accept.behavior).toBe('allow')
  })
})
