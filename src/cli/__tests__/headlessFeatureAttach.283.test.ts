import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AbortError } from '../../utils/errors.js'
import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: string[] = []
mock.module('../../utils/debug.js', () => ({
  ...debugMock(),
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))
mock.module('../../utils/debug.ts', () => ({
  ...debugMock(),
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))

const { attachHeadlessFeatures, HEADLESS_FEATURE_KEYS, noteHeadlessFeatureHookError } =
  await import('../headlessFeatureAttach.js')

afterEach(() => {
  debugLogs.length = 0
})

describe('HEADLESS_FEATURE_KEYS (gold Me)', () => {
  test('is settings, hooks, plugins, tools', () => {
    expect(HEADLESS_FEATURE_KEYS).toEqual(['settings', 'hooks', 'plugins', 'tools'])
  })
})

describe('noteHeadlessFeatureHookError (gold ge)', () => {
  test('abort logs gold aborted message and does not throw', () => {
    expect(() =>
      noteHeadlessFeatureHookError(new AbortError('cancelled')),
    ).not.toThrow()
    expect(debugLogs).toEqual(['[headlessFeatures] a feature hook was aborted'])
  })
})

describe('attachHeadlessFeatures (gold qe)', () => {
  test('abort → gold aborted log and no throw', async () => {
    const packs = await attachHeadlessFeatures(
      [
        async () => {
          throw new AbortError('cancelled')
        },
      ],
      { trigger: 'init' },
    )
    expect(packs).toEqual([])
    expect(debugLogs).toContain(
      '[headlessFeatures] a feature did not attach (init): cancelled',
    )
    expect(debugLogs).toContain('[headlessFeatures] a feature hook was aborted')
  })

  test('other error → gold did not attach (${trigger}) log', async () => {
    const packs = await attachHeadlessFeatures(
      [
        async () => {
          throw new Error('boom')
        },
      ],
      { trigger: 'maintenance' },
    )
    expect(packs).toEqual([])
    expect(debugLogs).toContain(
      '[headlessFeatures] a feature did not attach (maintenance): boom',
    )
    expect(debugLogs).not.toContain(
      '[headlessFeatures] a feature hook was aborted',
    )
  })

  test('undefined packs dropped; successful packs kept', async () => {
    const packs = await attachHeadlessFeatures(
      [
        async () => ({ name: 'kept' }),
        async () => undefined,
        () => ({ name: 'also-kept' }),
      ],
      { trigger: 'init' },
    )
    expect(packs).toEqual([{ name: 'kept' }, { name: 'also-kept' }])
    expect(debugLogs).toEqual([])
  })
})
