/**
 * densable 2.1.289 zu / Tqe / Ase / QueryEngine skipAttachments ternary.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getInFlightClientDataFetch,
  getModelFacts,
  isSmallerContextWindow,
  querySourceSkipsModelFactsReuse,
  resolveModelFacts,
} from '../modelFacts.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 modelFacts zu', () => {
  test('getModelFacts exposes gold zu field names', () => {
    const facts = getModelFacts('claude-sonnet-4-6')
    expect(facts.model).toBe('claude-sonnet-4-6')
    expect(typeof facts.contextWindow).toBe('number')
    expect(typeof facts.maxOutputTokens).toBe('number')
    expect(typeof facts.canonical).toBe('string')
    expect(typeof facts.settingsKey).toBe('string')
    expect(typeof facts.native1mHere).toBe('boolean')
    expect(typeof facts.native1mInCatalog).toBe('boolean')
    expect(typeof facts.optIn1mHonored).toBe('boolean')
    expect(facts.unclampedButBilledPast200k).toBe(true)
    expect(typeof facts.recognized).toBe('boolean')
    expect(facts.bytesPerToken).toBe(4)
    expect(
      facts.clientDataAutoCompactWindow.window === null ||
        typeof facts.clientDataAutoCompactWindow.window === 'number',
    ).toBe(true)
    expect(typeof facts.clientDataAutoCompactWindow.replacesDefault).toBe(
      'boolean',
    )
    expect(typeof facts.thinking.supported).toBe('boolean')
    expect(typeof facts.thinking.rejectsDisabled).toBe('boolean')
    expect(typeof facts.thinking.capsEffortWhenDisabled).toBe('boolean')
    expect(typeof facts.acceptsTemperature).toBe('boolean')
  })

  test('unclampedButBilledPast200k matches gold UZn', () => {
    expect(getModelFacts('claude-sonnet-4-6').unclampedButBilledPast200k).toBe(
      true,
    )
    expect(getModelFacts('claude-opus-4-6').unclampedButBilledPast200k).toBe(
      true,
    )
    expect(getModelFacts('claude-opus-4-8').unclampedButBilledPast200k).toBe(
      true,
    )
    expect(getModelFacts('claude-opus-5').unclampedButBilledPast200k).toBe(true)
    expect(getModelFacts('claude-opus-5-5').unclampedButBilledPast200k).toBe(
      true,
    )
    expect(getModelFacts('claude-haiku-4-5').unclampedButBilledPast200k).toBe(
      false,
    )
  })

  test('resolveModelFacts returns zu even when no client-data wait', async () => {
    const sync = getModelFacts('claude-haiku-4-5')
    const waited = await resolveModelFacts('claude-haiku-4-5', {
      credentials: undefined,
      abortController: { signal: new AbortController().signal },
    })
    expect(waited).toEqual(sync)
  })

  test('isSmallerContextWindow is gold Ase (fallback window < request)', () => {
    const same = isSmallerContextWindow('claude-haiku-4-5', 'claude-haiku-4-5')
    expect(same).toBe(false)
  })

  test('auto_mode querySource skips prefetched facts reuse', () => {
    expect(querySourceSkipsModelFactsReuse('sdk')).toBe(false)
    expect(querySourceSkipsModelFactsReuse('auto_mode')).toBe(true)
    expect(querySourceSkipsModelFactsReuse('auto_mode_investigator')).toBe(true)
  })
})

describe('densable 2.1.289 SDK query() bag plumbing', () => {
  test('QueryEngine converts boolean skipAttachments via gold ternary', () => {
    const qe = readFileSync(join(ROOT, 'src/QueryEngine.ts'), 'utf8')
    expect(qe).toContain('skipAttachments: options?.skipAttachments')
    expect(qe).toContain('options.shouldQuery === false')
    expect(qe).toContain("'all'")
    expect(qe).toContain("'mentions'")
    expect(qe).toContain('promptRenderEpoch')
    expect(qe).toContain('modelFacts')
    expect(qe).toContain('stopHookActive')
  })

  test('QueryParams + queryLoop consume promptRenderEpoch / modelFacts', () => {
    const src = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    expect(src).toContain('promptRenderEpoch?: number')
    expect(src).toContain('modelFacts?:')
    expect(src).toContain('getPromptRenderEpoch()')
    expect(src).toContain('isSmallerContextWindow')
  })

  test('processUserInput Le/Pe skipAttachments all|mentions', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    expect(src).toContain("'all'")
    expect(src).toContain("'mentions'")
    expect(src).toContain('ambientAttachmentsOwed')
  })
})

describe('densable 2.1.289 Syo leftoverQrr fetch map', () => {
  test('Syo is undefined when getter is missing or fetchesClientData is off', () => {
    expect(getInFlightClientDataFetch()).toBeUndefined()
  })

  test('Syo / Ost / yyo / nWe wrap leftoverQrr, not a second store', () => {
    const facts = readFileSync(
      join(ROOT, 'src/utils/model/modelFacts.ts'),
      'utf8',
    )
    expect(facts).toContain('leftoverQrrCacheKeyNow')
    expect(facts).toContain('leftoverQrrHasTimedSlot')
    expect(facts).toContain('peekClientDataFetch')
    const collapse = readFileSync(
      join(ROOT, 'src/utils/collapseReadSearch.ts'),
      'utf8',
    )
    expect(collapse).toContain('setFetchesClientData')
    expect(collapse).toContain('trackClientDataFetch')
    expect(collapse).toContain('leftoverQrrHasTimedSlot')
    expect(collapse).toContain('const at = Date.now()')
    expect(collapse).toContain('{ data, model, at }')
    const leftoverQrrStart = collapse.indexOf(
      'export function leftoverQrr(model?: string)',
    )
    const leftoverQrrFn = collapse.slice(
      leftoverQrrStart,
      collapse.indexOf('densable `yyo`', leftoverQrrStart),
    )
    expect(leftoverQrrFn).toContain(
      '{ data: slot.data ?? null, model: slot.model }',
    )
    expect(leftoverQrrFn).not.toContain('at:')
    const bootstrap = readFileSync(
      join(ROOT, 'src/services/api/bootstrap.ts'),
      'utf8',
    )
    expect(bootstrap).toContain('trackClientDataFetch')
    const startup = readFileSync(
      join(ROOT, 'src/cli/startupAssembly.ts'),
      'utf8',
    )
    expect(startup).toContain('setFetchesClientData(!bareMode)')
    const logout = readFileSync(
      join(ROOT, 'src/commands/logout/logout.tsx'),
      'utf8',
    )
    expect(logout).toContain('clearClientDataFetches')
  })
})

describe('densable 2.1.289 Fi stream_request_start', () => {
  test('Hze maps stream_request_start to system/status/requesting', () => {
    const qe = readFileSync(join(ROOT, 'src/QueryEngine.ts'), 'utf8')
    expect(qe).toContain("case 'stream_request_start'")
    expect(qe).toContain("status: 'requesting'")
    expect(qe).toContain('if (includePartialMessages)')
    const schema = readFileSync(
      join(ROOT, 'src/entrypoints/sdk/coreSchemas.ts'),
      'utf8',
    )
    expect(schema).toContain("z.literal('requesting')")
    const queue = readFileSync(join(ROOT, 'src/utils/sdkEventQueue.ts'), 'utf8')
    expect(queue).toContain("'compacting' | 'requesting' | null")
    const repl = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(repl).toContain("if (status === 'requesting') return")
  })
})
