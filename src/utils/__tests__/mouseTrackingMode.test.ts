import { describe, expect, test } from 'bun:test'
import {
  isMouseClicksDisabled,
  isMouseTrackingEnabled,
  mouseTrackingProp,
  resolveMouseTrackingMode,
} from '../fullscreen.js'

describe('resolveMouseTrackingMode Lfe densable', () => {
  test('default full', () => {
    expect(resolveMouseTrackingMode({})).toBe('full')
    expect(isMouseTrackingEnabled({})).toBe(true)
    expect(isMouseClicksDisabled({})).toBe(false)
    expect(mouseTrackingProp({})).toBe('full')
  })

  test('DISABLE_MOUSE truthy → off', () => {
    expect(resolveMouseTrackingMode({ CLAUDE_CODE_DISABLE_MOUSE: '1' })).toBe(
      'off',
    )
    expect(isMouseTrackingEnabled({ CLAUDE_CODE_DISABLE_MOUSE: '1' })).toBe(
      false,
    )
    expect(isMouseClicksDisabled({ CLAUDE_CODE_DISABLE_MOUSE: '1' })).toBe(true)
    expect(mouseTrackingProp({ CLAUDE_CODE_DISABLE_MOUSE: '1' })).toBe('off')
  })

  test('DISABLE_MOUSE falsy → full', () => {
    expect(resolveMouseTrackingMode({ CLAUDE_CODE_DISABLE_MOUSE: '0' })).toBe(
      'full',
    )
  })

  test('DISABLE_MOUSE_CLICKS truthy → scroll when mouse unset', () => {
    expect(
      resolveMouseTrackingMode({ CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1' }),
    ).toBe('scroll')
    expect(
      isMouseTrackingEnabled({ CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1' }),
    ).toBe(true)
    expect(
      isMouseClicksDisabled({ CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1' }),
    ).toBe(true)
    // scroll mode must reach AlternateScreen so only 1000+1006 are enabled
    expect(mouseTrackingProp({ CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1' })).toBe(
      'scroll',
    )
  })

  test('DISABLE_MOUSE wins over CLICKS', () => {
    expect(
      resolveMouseTrackingMode({
        CLAUDE_CODE_DISABLE_MOUSE: '1',
        CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1',
      }),
    ).toBe('off')
  })
})
