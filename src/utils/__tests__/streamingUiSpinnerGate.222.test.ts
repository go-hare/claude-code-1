/**
 * densable 2.1.222 streaming UI spinner gate (zm / B2a) + salvage clear contract.
 * Source-contract: REPL showSpinner keeps spinner when raw single-line stream.
 * clearStreamingText must NOT setSalvage(null) — densable cX = pH.clear only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

describe('densable zm streaming spinner gate', () => {
  test('REPL showSpinner uses STREAM_FLAG_HIDE_TRAILING (B2a)', () => {
    const src = readFileSync(
      join(ROOT, 'src/screens/REPL.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain('STREAM_FLAG_HIDE_TRAILING')
    // densable: (!Jbe || (p4&B2a)!==0 || Je)
    expect(src).toContain('!hasStreamingText ||')
    expect(src).toContain(
      '(streamingFlags & STREAM_FLAG_HIDE_TRAILING) !== 0 ||',
    )
    expect(src).toContain('isBriefOnly);')
  })

  test('Messages hasContentAfter is densable y||aem only (no streamingPreview invent)', () => {
    // densable SEA: Tt=collapsed_read_search&&(y||aem(...)); y=hasStreamingText
    // f786a46d invent ||streamingPreview made collapsed groups past-tense for
    // the whole isLoading window (empty ● + "Ran N" while Cooking).
    const src = readFileSync(
      join(ROOT, 'src/components/Messages.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain('!!hasStreamingText ||')
    expect(src).toContain(
      'hasContentAfterIndex(renderableMessages, index, tools, streamingToolUseIDs)',
    )
    expect(src).not.toContain('!!streamingPreview')
    // legacy streamingText must not gate collapse either
    expect(src).not.toMatch(/hasContentAfter\s*=\s*[\s\S]*?!!streamingText/)
  })

  test('StreamingTextPreview hides empty-after-strip (no lone ●)', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/StreamingTextPreview.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain('isEmptyMessageText')
    expect(src).toContain(
      'if (!displayed || isEmptyMessageText(displayed)) return null',
    )
  })

  test('clearStreamingText is densable cX-shaped (no setSalvage in clear body)', () => {
    const src = readFileSync(
      join(ROOT, 'src/screens/REPL.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const m = src.match(
      /const clearStreamingText = useCallback\(\(\) => \{[\s\S]*?\}, \[streamingFlushBuffer, streamingDisplayStore\]\);/,
    )
    expect(m).not.toBeNull()
    const body = m![0]
    expect(body).toContain('streamingFlushBuffer.clear()')
    expect(body).toContain('setTransformed(null)')
    // densable: salvage survives pH.clear; only land/esc/refusal/!Ln drop it
    expect(body).not.toContain('setSalvage')
  })

  test('salvage drop sites remain land / esc / !isLoading j2a / refusal end', () => {
    const src = readFileSync(
      join(ROOT, 'src/screens/REPL.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    // !Ln && j2a effect
    expect(src).toContain(
      '!isLoading && (streamingFlags & STREAM_FLAG_SALVAGE) !== 0',
    )
    // land + esc + refusal end still call setSalvage(null)
    const setSalvageNullCount = (
      src.match(/streamingDisplayStore\.setSalvage\(\s*null\s*\)/g) ?? []
    ).length
    expect(setSalvageNullCount).toBeGreaterThanOrEqual(3)
  })
})
