// densable 2.1.239 #35 — mYe / tTe / oSn list budgets.
import { describe, expect, test } from 'bun:test'
import figures from 'figures'

import {
  computeVisibleWindow,
  formatVisibleWindowHint,
  workflowDetailListBudgets,
} from '../WorkflowDetailDialog.js'

describe('computeVisibleWindow', () => {
  test('returns the full range when total fits', () => {
    expect(computeVisibleWindow(0, 5, 10)).toEqual({
      from: 0,
      to: 5,
      above: 0,
      below: 0,
    })
  })

  test('pins the start when focus is at the top', () => {
    expect(computeVisibleWindow(0, 10, 4)).toEqual({
      from: 0,
      to: 4,
      above: 0,
      below: 6,
    })
  })

  test('centers focus and clamps to the tail', () => {
    expect(computeVisibleWindow(7, 10, 4)).toEqual({
      from: 5,
      to: 9,
      above: 5,
      below: 1,
    })
    expect(computeVisibleWindow(9, 10, 4)).toEqual({
      from: 6,
      to: 10,
      above: 6,
      below: 0,
    })
  })
})

describe('formatVisibleWindowHint', () => {
  test('uses spaces when neither edge overflows', () => {
    expect(
      formatVisibleWindowHint({ from: 0, to: 5, above: 0, below: 0 }, 5),
    ).toBe(`  1\u20135 of 5  `)
  })

  test('shows arrows when both edges overflow', () => {
    expect(
      formatVisibleWindowHint({ from: 2, to: 6, above: 2, below: 4 }, 10),
    ).toBe(`${figures.arrowUp} 3\u20136 of 10 ${figures.arrowDown}`)
  })
})

describe('workflowDetailListBudgets', () => {
  test('roomy pane: short list uses the full phase count', () => {
    expect(workflowDetailListBudgets(30, 3)).toEqual({
      tight: false,
      phaseViewport: 3,
      agentViewport: 16,
    })
  })

  test('roomy pane: long list reserves one row for the phase hint', () => {
    expect(workflowDetailListBudgets(30, 20)).toEqual({
      tight: false,
      phaseViewport: 15,
      agentViewport: 3,
    })
  })

  test('tight pane (availableRows < 18) uses the 8-row chrome', () => {
    expect(workflowDetailListBudgets(16, 2)).toEqual({
      tight: true,
      phaseViewport: 2,
      agentViewport: 6,
    })
  })
})
