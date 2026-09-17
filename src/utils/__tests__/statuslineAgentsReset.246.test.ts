/**
 * densable 2.1.246 HAVE #31 — agents view roundtrip zeros cost/duration.
 *
 * Official costLedger class @205024191:
 *   snapshot / restoreSnapshot / scopeTo / belongsTo / claim / reset
 *   / registerSaver / runSaver. Fork sessions share root.costLedger.
 * Wrappers @205069380:
 *   zv=registerSaver  $v=runSaver  eb=snapshot  tb=restoreSnapshot
 *   ob=scopeTo  rb=reset(+clear promptId)  Zv=belongsTo(current id)
 * Session-id change @205059364 scopes ledger.
 * Agents-view host @230998798 now locked:
 *   Mc = repinScroll; x(()=>{Mc(!0,"agent-view-change")},[kt])
 *   kt = viewingAgentTaskId. No eb/tb/ob/rb call.
 * Jb/Kb/Qb/Sb @205072791+ are launchOptions/telemetry, not ledger aliases.
 *
 * Local: resetCostState only session switch / resume / clear / login.
 * viewingAgentTaskId change only repinScroll. No costLedger names.
 *
 * Invent-ban: do not invent agents-view save/restore hooks.
 * HAVE (narrow: repin only; no invent save/restore).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const srcRoot = join(import.meta.dir, '../..')
const state = readFileSync(join(srcRoot, 'bootstrap/state.ts'), 'utf8')
const tracker = readFileSync(join(srcRoot, 'cost-tracker.ts'), 'utf8')
const repl = readFileSync(join(srcRoot, 'screens/REPL.tsx'), 'utf8')
const agentView = readFileSync(join(srcRoot, 'screens/AgentView.tsx'), 'utf8')
const teammate = readFileSync(
  join(srcRoot, 'state/teammateViewHelpers.ts'),
  'utf8',
)

describe('HAVE #31 statusline agents reset (2.1.246)', () => {
  test('official costLedger transition host is absent locally — do not invent', () => {
    expect(tracker).toContain('saveCurrentSessionCosts')
    expect(tracker).toContain('restoreCostStateForSession')
    expect(state).toContain('export function resetCostState(')
    expect(repl).toContain('resetCostState()')
    expect(repl).toContain("repinScroll(true, 'agent-view-change')")
    const viewChange = repl.slice(
      repl.indexOf("repinScroll(true, 'agent-view-change')") - 400,
      repl.indexOf("repinScroll(true, 'agent-view-change')") + 200,
    )
    expect(viewChange).not.toContain('saveCurrentSessionCosts')
    expect(viewChange).not.toContain('restoreCostStateForSession')
    expect(viewChange).not.toContain('resetCostState')
    expect(agentView).not.toContain('resetCostState')
    expect(teammate).not.toContain('resetCostState')
    expect(state).not.toContain('saveSessionCostsForTransition')
    expect(state).not.toContain('restoreCostLedgerSnapshot')
    expect(state).not.toContain('scopeCostLedgerToCurrentSession')
    expect(tracker).not.toContain('saveSessionCostsForTransition')
    expect(tracker).not.toContain('restoreCostLedgerSnapshot')
    expect(tracker).not.toContain('scopeCostLedgerToCurrentSession')
  })
})
