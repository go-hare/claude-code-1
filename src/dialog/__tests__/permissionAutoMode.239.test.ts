import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  canOfferWorkflowAutoMode,
  isWorkflowAutoModeOffered,
  shouldShowWorkflowAutoModeOption,
  WORKFLOW_AUTO_MODE_DESCRIPTION,
  WORKFLOW_AUTO_MODE_LABEL,
  WORKFLOW_PERMISSION_PROMPT_TRIGGER,
  workflowAutoModeSelectOption,
} from '../permissionAutoMode.js'
import { sanitizeDisplayText } from '../../utils/displaySanitize.js'

describe('m0n / DPo workflow auto-mode', () => {
  test('offered only for workflow-agent + default|acceptEdits + FKe', () => {
    const ctx = { mode: 'default', isAutoModeAvailable: true }
    expect(isWorkflowAutoModeOffered({ type: 'workflow-agent' }, ctx)).toBe(
      canOfferWorkflowAutoMode(ctx),
    )
    expect(isWorkflowAutoModeOffered({ type: 'remote-agent' }, ctx)).toBe(false)
    expect(
      canOfferWorkflowAutoMode({ mode: 'plan', isAutoModeAvailable: true }),
    ).toBe(false)
  })

  test('Iiu/Cmy show gate: offered && !withheld && !Riu', () => {
    expect(shouldShowWorkflowAutoModeOption(true, false, false)).toBe(true)
    expect(shouldShowWorkflowAutoModeOption(true, true, false)).toBe(false)
    expect(shouldShowWorkflowAutoModeOption(true, false, true)).toBe(false)
    expect(shouldShowWorkflowAutoModeOption(false, false, false)).toBe(false)
  })

  test('DPo workflow label + kOo', () => {
    const opt = workflowAutoModeSelectOption()
    expect(opt.label).toBe(WORKFLOW_AUTO_MODE_LABEL)
    expect(opt.description).toBe(WORKFLOW_AUTO_MODE_DESCRIPTION)
    expect(opt.value).toBe('yes-enable-auto-mode')
  })

  test('m0n xge 4th arg is workflow_permission_prompt → qLe', () => {
    expect(WORKFLOW_PERMISSION_PROMPT_TRIGGER).toBe(
      'workflow_permission_prompt',
    )
    const auto = readFileSync(
      join(import.meta.dir, '../permissionAutoMode.ts'),
      'utf8',
    )
    expect(auto).toContain('WORKFLOW_PERMISSION_PROMPT_TRIGGER')
    expect(auto).toContain('setPermissionModeWithGuards(')
    const setup = readFileSync(
      join(import.meta.dir, '../../utils/permissions/permissionSetup.ts'),
      'utf8',
    )
    expect(setup).toContain("logEvent('permission_mode_changed'")
    expect(setup).toContain('emitPermissionRecheck')
  })

  test('qLe leftover triggers: auto_default_nudge / auto_gate_denied / exit_plan_mode', () => {
    const setup = readFileSync(
      join(import.meta.dir, '../../utils/permissions/permissionSetup.ts'),
      'utf8',
    )
    expect(setup).toContain(
      "export const AUTO_GATE_DENIED_TRIGGER = 'auto_gate_denied'",
    )
    expect(setup).toContain(
      "export const EXIT_PLAN_MODE_TRIGGER = 'exit_plan_mode'",
    )
    // inAuto kick-out only — plan+auto branch must not qLe
    const kick = setup.slice(setup.indexOf('const kickOutOfAutoIfNeeded'))
    const inAuto = kick.slice(
      kick.indexOf('if (inAuto)'),
      kick.indexOf('// Plan with auto'),
    )
    expect(inAuto).toContain('AUTO_GATE_DENIED_TRIGGER')
    const planAuto = kick.slice(
      kick.indexOf('// Plan with auto'),
      kick.indexOf('// Notification decisions'),
    )
    expect(planAuto).not.toContain('AUTO_GATE_DENIED_TRIGGER')
    expect(planAuto).not.toContain('logPermissionModeChanged')

    const nudge = readFileSync(
      join(import.meta.dir, '../openAutoDefaultNudge.ts'),
      'utf8',
    )
    expect(nudge).toContain(
      "export const AUTO_DEFAULT_NUDGE_TRIGGER = 'auto_default_nudge'",
    )
    expect(nudge).toContain('AUTO_DEFAULT_NUDGE_TRIGGER')
    expect(nudge).toContain('setPermissionModeWithGuards')
    expect(nudge).not.toContain('AutoDefaultNudgeAcceptHooks')
    expect(nudge).toContain('addNotification({')
    expect(nudge).not.toContain('notifications.queue')
    expect(nudge).toContain('autoDefaultNudgeChoice')
    expect(nudge).not.toContain("if (result === 'cancelled') return")

    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('maybeRequestAutoDefaultNudge(')
    expect(repl).toContain('store.setState')
    expect(repl).toContain('addNotification')

    const ide = readFileSync(
      join(import.meta.dir, '../../services/mcp/vscodeIdeBridgeCallbacks.ts'),
      'utf8',
    )
    expect(ide).not.toContain('setPermissionModeWithGuards')
    expect(ide).not.toContain('AUTO_DEFAULT_NUDGE_TRIGGER')

    const teu = readFileSync(
      join(
        import.meta.dir,
        '../../components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(teu).toContain('EXIT_PLAN_MODE_TRIGGER')
    expect(teu).toContain(
      "logPermissionModeChanged('plan', mode, EXIT_PLAN_MODE_TRIGGER)",
    )
    expect(teu).toContain(
      "logPermissionModeChanged('plan', 'auto', EXIT_PLAN_MODE_TRIGGER)",
    )
    expect(teu).toContain(
      "logPermissionModeChanged('plan', keepContextMode, EXIT_PLAN_MODE_TRIGGER)",
    )
    const ultraplan = teu.slice(
      teu.indexOf("if (value === 'ultraplan')"),
      teu.indexOf('// V1: pass plan'),
    )
    expect(ultraplan).not.toContain('logPermissionModeChanged')
    const stay = teu.slice(
      teu.indexOf("// Handle 'no'"),
      teu.indexOf('const editor = getExternalEditor'),
    )
    expect(stay).not.toContain('logPermissionModeChanged')

    const tool = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts',
      ),
      'utf8',
    )
    expect(tool).toContain('EXIT_PLAN_MODE_TRIGGER')
    expect(tool).toContain(
      "logPermissionModeChanged('plan', restoreMode, EXIT_PLAN_MODE_TRIGGER)",
    )
  })
})

describe('_g / cAv / Wwe', () => {
  test('_g is identity for Bash', () => {
    expect(sanitizeDisplayText('Bash')).toBe('Bash')
  })

  test('cAv changes over-long tool names', () => {
    const long = 'A'.repeat(5000)
    expect(sanitizeDisplayText(long)).not.toBe(long)
  })
})
