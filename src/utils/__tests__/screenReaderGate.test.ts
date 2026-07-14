import { afterEach, describe, expect, test } from 'bun:test'
import {
  AX_SCREEN_READER_ENV_KEY,
  formatScreenReaderModeBanner,
  getScreenReaderActivationSource,
  getScreenReaderChildEnv,
  isScreenReaderModeEnabled,
  resetScreenReaderModeCache,
  resolveScreenReaderMode,
  shouldHideNativeCursor,
} from '../screenReaderGate.js'

afterEach(() => {
  resetScreenReaderModeCache()
})

describe('resolveScreenReaderMode / isScreenReaderModeEnabled', () => {
  test('flag --ax-screen-reader enables with source flag', () => {
    const r = resolveScreenReaderMode({
      env: {},
      argv: ['node', 'cli', '--ax-screen-reader'],
      axScreenReaderSetting: false,
      gbValue: true,
    })
    expect(r).toEqual({ enabled: true, source: 'flag' })
    expect(
      isScreenReaderModeEnabled({
        env: {},
        argv: ['node', 'cli', '--ax-screen-reader'],
        axScreenReaderSetting: false,
        gbValue: true,
      }),
    ).toBe(true)
  })

  test('CLAUDE_AX_SCREEN_READER truthy enables via env', () => {
    const r = resolveScreenReaderMode({
      env: { [AX_SCREEN_READER_ENV_KEY]: '1' },
      argv: ['node', 'cli'],
      axScreenReaderSetting: false,
      gbValue: true,
    })
    expect(r).toEqual({ enabled: true, source: 'env' })
  })

  test('CLAUDE_AX_SCREEN_READER falsy disables via env even if settings on', () => {
    const r = resolveScreenReaderMode({
      env: { [AX_SCREEN_READER_ENV_KEY]: '0' },
      argv: ['node', 'cli'],
      axScreenReaderSetting: true,
      gbValue: true,
    })
    expect(r.enabled).toBe(false)
    expect(r.source).toBeUndefined()
  })

  test('settings.axScreenReader enables when env unset', () => {
    const r = resolveScreenReaderMode({
      env: {},
      argv: ['node', 'cli'],
      axScreenReaderSetting: true,
      gbValue: true,
    })
    expect(r).toEqual({ enabled: true, source: 'settings' })
  })

  test('GB tengu_ax_screen_reader false disables even when flag on', () => {
    const r = resolveScreenReaderMode({
      env: {},
      argv: ['node', 'cli', '--ax-screen-reader'],
      axScreenReaderSetting: true,
      gbValue: false,
    })
    expect(r).toEqual({ enabled: false, source: undefined })
  })

  test('flag beats env and settings for source', () => {
    expect(
      getScreenReaderActivationSource({
        env: { [AX_SCREEN_READER_ENV_KEY]: '1' },
        argv: ['node', 'cli', '--ax-screen-reader'],
        axScreenReaderSetting: true,
        gbValue: true,
      }),
    ).toBe('flag')
  })
})

describe('formatScreenReaderModeBanner / FXe child env', () => {
  test('banner includes source when enabled', () => {
    expect(
      formatScreenReaderModeBanner({
        env: { [AX_SCREEN_READER_ENV_KEY]: '1' },
        argv: [],
        axScreenReaderSetting: false,
        gbValue: true,
      }),
    ).toBe('[Screen Reader Mode: on via env]')
  })

  test('banner null when disabled', () => {
    expect(
      formatScreenReaderModeBanner({
        env: {},
        argv: [],
        axScreenReaderSetting: false,
        gbValue: true,
      }),
    ).toBeNull()
  })

  test('child env propagates CLAUDE_AX_SCREEN_READER=1 when on', () => {
    expect(
      getScreenReaderChildEnv({
        env: {},
        argv: ['--ax-screen-reader'],
        axScreenReaderSetting: false,
        gbValue: true,
      }),
    ).toEqual({ [AX_SCREEN_READER_ENV_KEY]: '1' })
    expect(
      getScreenReaderChildEnv({
        env: {},
        argv: [],
        axScreenReaderSetting: false,
        gbValue: true,
      }),
    ).toEqual({})
  })
})

describe('shouldHideNativeCursor', () => {
  test('hides by default', () => {
    expect(
      shouldHideNativeCursor({
        env: {},
        screenReaderEnabled: false,
      }),
    ).toBe(true)
  })

  test('keeps cursor when accessibility env on', () => {
    expect(
      shouldHideNativeCursor({
        env: { CLAUDE_CODE_ACCESSIBILITY: '1' },
        screenReaderEnabled: false,
      }),
    ).toBe(false)
  })

  test('keeps cursor when screen-reader mode on', () => {
    expect(
      shouldHideNativeCursor({
        env: {},
        screenReaderEnabled: true,
      }),
    ).toBe(false)
  })
})
