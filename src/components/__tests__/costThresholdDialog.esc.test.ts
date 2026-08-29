/**
 * densable oXg — Esc/dismiss does not persist hasAcknowledgedCostThreshold.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { costThresholdSpec } from '../../dialog/specs/jsuKinds.js'

describe('cost threshold Esc vs ack (densable oXg)', () => {
  test('Wxt default is cancelled', () => {
    expect(costThresholdSpec.default).toBe('cancelled')
  })

  test('REPL opens via oXg / requestDialog, not focused haveShownCostDialog', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).not.toContain('haveShownCostDialog')
    expect(repl).not.toContain('setShowCostDialog')
    expect(repl).not.toContain("focusedInputDialog === 'cost'")
    expect(repl).toContain('costThresholdReachedLoggedRef')
    expect(repl).toContain('openCostThresholdIfNeeded')
    expect(repl).toContain('COST_THRESHOLD_KIND')
    expect(repl).toContain('tengu_cost_threshold_reached')
    expect(repl).toContain('hasAcknowledgedCostThreshold')
    const analytics = repl.indexOf('tengu_cost_threshold_reached')
    const billing = repl.indexOf('hasConsoleBillingAccess()', analytics)
    expect(billing).toBeGreaterThan(analytics)
  })

  test('NMs renderer answers cancelled on Esc', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../dialog/jsuRenderers.tsx'),
      'utf8',
    )
    expect(src).toContain("onDone={() => answer('acknowledged')}")
    expect(src).toContain("onCancel={() => answer('cancelled')}")
  })
})
