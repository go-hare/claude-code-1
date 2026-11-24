import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CANCEL_MESSAGE, getSliderGeometry } from '../effortPanelState.js'

const panelSrc = readFileSync(
  join(import.meta.dir, '../EffortPanel.tsx'),
  'utf8',
)
const stateSrc = readFileSync(
  join(import.meta.dir, '../effortPanelState.ts'),
  'utf8',
)

describe('densable 2.1.289 EffortPanel copy', () => {
  test('scale is Faster left / Smarter right on Pane slider track', () => {
    expect(panelSrc).toContain('<Pane>')
    expect(panelSrc).toContain('>Faster</Text>')
    expect(panelSrc).toContain('>Smarter</Text>')
    const geom = getSliderGeometry('claude-opus-4-7')
    expect(geom.levels.map(l => l.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(geom.width).toBe(42)
  })

  test('footer has official 2.1.328 session-only/save hints and separate Ultracode boolean toggle', () => {
    expect(panelSrc).toContain('s to use this session only · Enter to save')
    expect(panelSrc).toContain(
      "action={isSessionOnlyConfirm ? 'use this session only' : 'save'}",
    )
    expect(panelSrc).toContain('Ultracode  on')
    expect(panelSrc).toContain('action="toggle"')
  })

  test('Esc writes Cancelled (CANCEL_MESSAGE)', () => {
    expect(CANCEL_MESSAGE).toBe('Cancelled')
    expect(stateSrc).toContain("export const CANCEL_MESSAGE = 'Cancelled'")
    expect(panelSrc).toContain('onDone(CANCEL_MESSAGE)')
  })
})
