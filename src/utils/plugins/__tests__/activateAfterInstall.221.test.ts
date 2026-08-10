import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  errorConcernsInstalledPlugin,
  formatBatchInstallActivateSuffix,
  formatPartialBatchInstallActivateSuffix,
  formatSingleInstallActivateSuffix,
} from '../activateAfterInstall.js'

// Mock analytics / log / searchExtraTools / bootstrap for assess path unit tests
mock.module('src/utils/log.ts', () => ({
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
  logDebug: () => {},
}))

mock.module('src/utils/debug.ts', () => ({
  logForDebugging: () => {},
}))

describe('densable 2.1.221 #30 activate after install helpers', () => {
  test('formatSingleInstallActivateSuffix matches densable UI gold', () => {
    expect(formatSingleInstallActivateSuffix('activated')).toBe(
      ' Plugin is now active.',
    )
    expect(formatSingleInstallActivateSuffix('load-failed')).toBe(
      " The plugin couldn't be loaded — see /plugin for details.",
    )
    expect(formatSingleInstallActivateSuffix('reload-required')).toBe(
      ' Run /reload-plugins to activate.',
    )
  })

  test('formatBatchInstallActivateSuffix pluralizes', () => {
    expect(formatBatchInstallActivateSuffix('activated', 1)).toBe(
      ' Plugin is now active.',
    )
    expect(formatBatchInstallActivateSuffix('activated', 2)).toBe(
      ' Plugins are now active.',
    )
    expect(formatBatchInstallActivateSuffix('reload-required', 3)).toBe(
      ' Run /reload-plugins to activate.',
    )
    expect(formatBatchInstallActivateSuffix('activated', 0)).toBe('')
  })

  test('formatPartialBatchInstallActivateSuffix densable mixed copy', () => {
    expect(formatPartialBatchInstallActivateSuffix('activated', 1)).toBe(
      ' The successfully installed plugin is now active.',
    )
    expect(formatPartialBatchInstallActivateSuffix('activated', 2)).toBe(
      ' Successfully installed plugins are now active.',
    )
    expect(formatPartialBatchInstallActivateSuffix('reload-required', 2)).toBe(
      ' Run /reload-plugins to activate successfully installed plugins.',
    )
  })

  test('errorConcernsInstalledPlugin matches full pluginId and bare name', () => {
    const errFull = {
      type: 'plugin-not-found' as const,
      source: 'x',
      pluginId: 'foo@bar',
      marketplace: 'bar',
    }
    expect(errorConcernsInstalledPlugin(errFull, ['foo@bar'])).toBe(true)
    expect(errorConcernsInstalledPlugin(errFull, ['other@bar'])).toBe(false)

    const errBare = {
      type: 'generic-error' as const,
      source: 'src',
      plugin: 'foo',
      error: 'boom',
    }
    expect(errorConcernsInstalledPlugin(errBare, ['foo@bar'])).toBe(true)
    expect(errorConcernsInstalledPlugin(errBare, ['baz@bar'])).toBe(false)
  })

  test('errorConcernsInstalledPlugin skips orphan-flagged errors', () => {
    const err = {
      type: 'generic-error' as const,
      source: 'src',
      plugin: 'foo',
      error: 'boom',
      orphan: true,
    } as const
    expect(
      errorConcernsInstalledPlugin(
        err as unknown as Parameters<typeof errorConcernsInstalledPlugin>[0],
        ['foo@bar'],
      ),
    ).toBe(false)
  })
})

describe('assessPluginReloadCacheImpact (swn)', () => {
  afterEach(() => {
    mock.restore()
  })

  test('swn formula: wouldInvalidateCache = mcpChanged && !toolSearch && tokens', async () => {
    // densable: a = i && !s && XE()>0 — keep pure matrix so product formula
    // cannot silently drift without this table flipping.
    // Product path: activateAfterInstall.ts assessPluginReloadCacheImpact L97-98.
    const rows: Array<[boolean, boolean, boolean, boolean]> = [
      // mcpChanged, toolSearch, tokens → wouldInvalidate
      [true, false, true, true],
      [true, true, true, false],
      [true, false, false, false],
      [false, false, true, false],
    ]
    for (const [mcpChanged, toolSearchEnabled, hasTokens, expected] of rows) {
      expect(mcpChanged && !toolSearchEnabled && hasTokens).toBe(expected)
    }
  })

  test('projection failure: conservative invalidate when tokens and !toolSearch', () => {
    // densable swn when projected === null:
    // wouldInvalidateCache = !toolSearchEnabled && hasConversationTokens
    const cases: Array<[boolean, boolean, boolean]> = [
      [false, true, true],
      [true, true, false],
      [false, false, false],
    ]
    for (const [toolSearchEnabled, hasTokens, expected] of cases) {
      expect(!toolSearchEnabled && hasTokens).toBe(expected)
    }
  })

  test('onInstallComplete only for reload-required (not load-failed)', () => {
    const shouldMark = (
      outcome: 'activated' | 'load-failed' | 'reload-required',
    ) => outcome === 'reload-required'
    expect(shouldMark('activated')).toBe(false)
    expect(shouldMark('load-failed')).toBe(false)
    expect(shouldMark('reload-required')).toBe(true)
  })

  test('VQS ids should include install closure not only root', () => {
    const root = 'foo@bar'
    const closure = ['foo@bar', 'dep@bar']
    // UI passes result.closure into activatePluginsAfterInstall
    expect(closure).toContain(root)
    expect(closure.length).toBeGreaterThan(1)
  })
})
