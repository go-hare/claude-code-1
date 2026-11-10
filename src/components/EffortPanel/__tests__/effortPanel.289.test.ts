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

  test('footer has Enter to confirm and separate Ultracode boolean toggle', () => {
    expect(panelSrc).toContain('Enter to confirm')
    expect(panelSrc).toContain('shortcut="Enter" action="confirm"')
    expect(panelSrc).toContain('Ultracode  on')
    expect(panelSrc).toContain('action="toggle"')
    expect(panelSrc).not.toContain('Enter to save')
  })

  test('Esc writes Cancelled (CANCEL_MESSAGE)', () => {
    expect(CANCEL_MESSAGE).toBe('Cancelled')
    expect(stateSrc).toContain("export const CANCEL_MESSAGE = 'Cancelled'")
    expect(panelSrc).toContain('onDone(CANCEL_MESSAGE)')
  })
})
