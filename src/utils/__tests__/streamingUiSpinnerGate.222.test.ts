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

  test('streamingTextStore resolve uses isEmptyMessageText (DISPLAYED matches visible)', () => {
    // A: store-level gate so STREAM_FLAG_DISPLAYED is not set for strip-only
    // / (no content) — otherwise zm hides Cooking while XEl paints nothing.
    const src = readFileSync(
      join(ROOT, 'src/utils/streamingTextStore.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain("from './emptyMessageText.js'")
    expect(src).toContain('!isEmptyMessageText(merged)')
    expect(src).toContain(
      'merged !== null && !isEmptyMessageText(merged) ? merged : null',
    )
  })

  test('gold handleTerminalFocus: atlas on blur→focus, no FOCUS_IN repaint', () => {
    const app = readFileSync(
      join(ROOT, 'packages/@ant/ink/src/components/App.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const focusHandler = app.match(
      /handleTerminalFocus = \(isFocused: boolean\): void => \{([\s\S]*?)\n {2}\};/,
    )
    expect(focusHandler).not.toBeNull()
    const focusCode = focusHandler![1]!
      .split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n')
    expect(focusCode).toContain("prev === 'blurred'")
    expect(focusCode).toContain('proactiveAtlasResetOnFocus()')
    expect(focusCode).toContain('waitUntilAttachStable()')
    expect(focusCode).not.toContain('repaintAfterFocus')
    expect(focusCode).not.toContain('forceRedraw')

    const ink = readFileSync(
      join(ROOT, 'packages/@ant/ink/src/core/ink.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(ink).toContain('repaintAfterFocus(): void')
    const m = ink.match(/repaintAfterFocus\(\): void \{([\s\S]*?)\n {2}\}/)
    expect(m).not.toBeNull()
    const body = m![1]!
    expect(body).toContain('this.prevFrameContaminated = true')
    expect(body).toContain('this.onRender()')
    expect(body).not.toContain('forceRedraw')

    const reassert = ink.match(
      /reassertTerminalModes = \(includeAltScreen = false\): void => \{([\s\S]*?)\n {2}\};/,
    )
    expect(reassert).not.toBeNull()
    const reassertBody = reassert![1]!
    expect(reassertBody).toContain(
      'if (includeAltScreen) {\n      this.reenterAltScreen();\n      return;\n    }',
    )
    const soft = reassertBody.split('if (includeAltScreen)')[1] ?? ''
    const afterHard = soft.split('return;')[1] ?? ''
    expect(afterHard).toContain('this.repaintAfterFocus()')
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
