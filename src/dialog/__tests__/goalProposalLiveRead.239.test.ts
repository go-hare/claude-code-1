/**
 * densable xou — GoalProposal extras are live-read in the renderer.
 * Gold: `wou=wt(nFA),ApN=vou()`; producer payload is `{condition}` only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../..')

describe('GoalProposal extras live-read (densable xou)', () => {
  test('dialog payload is {condition} only; stillWorking/current from live hosts', () => {
    const dialog = readFileSync(
      join(root, 'dialog/dialogs/GoalProposalDialog.tsx'),
      'utf8',
    )
    expect(dialog).toContain('getMainLoopBusy')
    expect(dialog).toContain('useAppState')
    expect(dialog).toContain('activeGoal?.condition')
    expect(dialog).toContain('liveGoal')
    expect(dialog).not.toContain('getGoal')
    expect(dialog).toContain('truncateGoalConditionForRender')
    expect(dialog).toContain('firstLineOf')
    expect(dialog).not.toContain('slice(0, 200)')
    expect(dialog).not.toMatch(/from ['"].*QueryGuard/)
    expect(dialog).not.toContain('currentCondition')
    expect(dialog).not.toContain('payload.stillWorking')
    expect(dialog).toContain(
      'Claude continues with the current work while you decide.',
    )
    expect(dialog).toContain(
      'Claude has finished its current work — approving starts it working again, toward this goal. Esc dismisses without setting it.',
    )
    expect(dialog).toContain('Approving replaces the current goal:')
  })

  test('jsu renderer and ProposeGoal producer pass {condition} only', () => {
    const jsu = readFileSync(join(root, 'dialog/jsuRenderers.tsx'), 'utf8')
    expect(jsu).toContain('payload={{ condition: p.condition }}')
    expect(jsu).not.toContain('currentCondition: p.currentCondition')
    expect(jsu).not.toContain('stillWorking: p.stillWorking')

    const tool = readFileSync(
      join(
        root,
        '../packages/builtin-tools/src/tools/ProposeGoalTool/ProposeGoalTool.ts',
      ),
      'utf8',
    )
    expect(tool).toContain('{ condition: n }')
  })
})
