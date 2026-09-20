/**
 * densable 2.1.247 #28 — peer collapse one-line `Message from @: ` preview.
 * Gold: xt label + ly preview (first line; no invented char cap).
 */
import { describe, expect, test } from 'bun:test'
import {
  formatPeerCollapseLabel,
  previewPeerMessageBody,
} from '../crossSessionMessage.js'

describe('densable 2.1.247 #28 xt peer collapse', () => {
  test('label is Message / N messages', () => {
    expect(formatPeerCollapseLabel(1)).toBe('Message')
    expect(formatPeerCollapseLabel()).toBe('Message')
    expect(formatPeerCollapseLabel(3)).toBe('3 messages')
  })

  test('preview is first line only (one-line, no char cap)', () => {
    expect(previewPeerMessageBody('hello\nworld\nmore')).toBe('hello')
    expect(previewPeerMessageBody('  single  ')).toBe('single')
    const long = 'x'.repeat(200)
    expect(previewPeerMessageBody(`${long}\nnext`)).toBe(long)
  })

  test('collapsed copy is Message from @', () => {
    const name = 'peer'
    const preview = previewPeerMessageBody('fix the footer\nextra')
    expect(`${formatPeerCollapseLabel(1)} from @${name}: ${preview}`).toBe(
      'Message from @peer: fix the footer',
    )
  })
})
