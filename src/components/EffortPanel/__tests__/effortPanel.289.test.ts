import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CANCEL_MESSAGE } from '../effortPanelState.js'

const panelSrc = readFileSync(
  join(import.meta.dir, '../EffortPanel.tsx'),
  'utf8',
)
const stateSrc = readFileSync(
  join(import.meta.dir, '../effortPanelState.ts'),
  'utf8',
)

describe('densable 2.1.289 EffortPanel copy', () => {
  test('scale is Faster left / Smarter right', () => {
    expect(panelSrc).toContain('>Faster</Text>')
    expect(panelSrc).toContain('>Smarter</Text>')
    expect(panelSrc).toContain("text: 'Faster'")
    expect(panelSrc).toContain("text: 'Smarter'")
  })

  test('footer is Enter to confirm; Ultracode Tab to toggle', () => {
    expect(panelSrc).toContain('Enter to confirm')
    expect(panelSrc).toContain('Ultracode · Tab to toggle')
    expect(panelSrc).not.toContain('Enter to save')
  })

  test('Esc writes Cancelled (CANCEL_MESSAGE)', () => {
    expect(CANCEL_MESSAGE).toBe('Cancelled')
    expect(stateSrc).toContain("export const CANCEL_MESSAGE = 'Cancelled'")
    expect(panelSrc).toContain('onDone(CANCEL_MESSAGE)')
  })
})
