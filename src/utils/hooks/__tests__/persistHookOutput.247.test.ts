import { describe, expect, test } from 'bun:test'
import { persistHookOutput } from '../persistHookOutput.js'

describe('densable leftover lre / persistHookOutput', () => {
  test('returns input when under leftover 1e4 threshold', async () => {
    const text = 'x'.repeat(10_000)
    expect(await persistHookOutput(text, 'id', 'stdout')).toBe(text)
  })

  test('fail fallback uses leftover Hook truncated marker', async () => {
    const src = await Bun.file(
      new URL('../persistHookOutput.ts', import.meta.url),
    ).text()
    expect(src).toContain(
      '[Hook ${source} truncated at ${threshold} chars — persist-to-disk failed: ${persisted.error}]',
    )
    expect(src).toContain('threshold = HOOK_OUTPUT_PERSIST_THRESHOLD_CHARS')
  })
})
