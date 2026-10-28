/**
 * densable 2.1.289 p8 @208494288 fullscreen upsell copy.
 *
 * Gold: ye title + three dimColor · bullets + qn confirm/cancel labels.
 * Analog: Dialog + Select (Ink Dialog has no confirmLabel).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dialogSrc = readFileSync(
  join(import.meta.dir, '../FullscreenUpsellDialog.tsx'),
  'utf8',
)

describe('densable 2.1.289 p8 fullscreen upsell copy', () => {
  test('title, bullets, and confirm/cancel labels match gold', () => {
    expect(dialogSrc).toContain('Try the new fullscreen renderer?')
    expect(dialogSrc).toContain(
      '· Flicker-free output — fixes the flashing you see during long responses',
    )
    expect(dialogSrc).toContain(
      '· Mouse support — click to move your cursor or expand results',
    )
    expect(dialogSrc).toContain('· Selected text auto-copies to your clipboard')
    expect(dialogSrc).toContain("label: 'Yes, try it'")
    expect(dialogSrc).toContain("label: 'Not now'")
  })

  test('does not keep pre-289 prose / Enable label', () => {
    expect(dialogSrc).not.toContain('Flicker-free rendering')
    expect(dialogSrc).not.toContain('Enable flicker-free rendering')
    expect(dialogSrc).not.toContain(
      'Claude Code can use flicker-free full-screen rendering',
    )
  })

  test('accept still callTui on + markFullscreenUpsellFullySeen', () => {
    expect(dialogSrc).toContain("await callTui('on', carryFromAppStore(store))")
    expect(dialogSrc).toContain('markFullscreenUpsellFullySeen')
  })
})
