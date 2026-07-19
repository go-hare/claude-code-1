import { describe, expect, test } from 'bun:test'
import {
  DISABLE_MOUSE_TRACKING,
  ENABLE_MOUSE_TRACKING,
  ENABLE_MOUSE_TRACKING_SCROLL,
  enableMouseTracking,
} from '../termio/dec.js'

describe('enableMouseTracking densable S5e', () => {
  test('full enables 1000+1002+1003+1006', () => {
    expect(enableMouseTracking('full')).toBe(ENABLE_MOUSE_TRACKING)
    expect(ENABLE_MOUSE_TRACKING).toContain('?1000h')
    expect(ENABLE_MOUSE_TRACKING).toContain('?1002h')
    expect(ENABLE_MOUSE_TRACKING).toContain('?1003h')
    expect(ENABLE_MOUSE_TRACKING).toContain('?1006h')
  })

  test('scroll enables only 1000+1006 (no any-motion flood)', () => {
    expect(enableMouseTracking('scroll')).toBe(ENABLE_MOUSE_TRACKING_SCROLL)
    expect(ENABLE_MOUSE_TRACKING_SCROLL).toContain('?1000h')
    expect(ENABLE_MOUSE_TRACKING_SCROLL).toContain('?1006h')
    expect(ENABLE_MOUSE_TRACKING_SCROLL).not.toContain('?1002h')
    expect(ENABLE_MOUSE_TRACKING_SCROLL).not.toContain('?1003h')
  })

  test('off emits empty', () => {
    expect(enableMouseTracking('off')).toBe('')
  })

  test('disable always clears all four modes', () => {
    expect(DISABLE_MOUSE_TRACKING).toContain('?1006l')
    expect(DISABLE_MOUSE_TRACKING).toContain('?1003l')
    expect(DISABLE_MOUSE_TRACKING).toContain('?1002l')
    expect(DISABLE_MOUSE_TRACKING).toContain('?1000l')
  })
})
