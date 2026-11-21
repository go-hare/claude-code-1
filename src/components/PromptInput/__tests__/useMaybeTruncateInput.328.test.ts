import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'
import type { PastedContent } from 'src/utils/config.js'
import Ink from '../../../../packages/@ant/ink/src/core/ink.js'
import {
  noteUserEditForTruncation,
  TRUNCATE_INPUT_THRESHOLD,
  useMaybeTruncateInput,
} from '../useMaybeTruncateInput.js'

function makeFakeStream() {
  const ee = new EventEmitter() as unknown as NodeJS.WriteStream &
    NodeJS.ReadStream
  ;(ee as unknown as { isTTY: boolean }).isTTY = false
  ;(ee as unknown as { columns: number }).columns = 80
  ;(ee as unknown as { rows: number }).rows = 24
  ;(ee as unknown as { write: (s: string) => boolean }).write = () => true
  ;(ee as unknown as { setEncoding: () => void }).setEncoding = () => {}
  ;(ee as unknown as { ref: () => void }).ref = () => {}
  ;(ee as unknown as { unref: () => void }).unref = () => {}
  ;(ee as unknown as { read: () => null }).read = () => null
  return ee
}

function Harness(props: {
  input: string
  pastedContents: Record<number, PastedContent>
  onInputChange: (v: string) => void
  setCursorOffset: (n: number) => void
  setPastedContents: (c: Record<number, PastedContent>) => void
  keepsFullTextRef: { current: boolean }
}) {
  useMaybeTruncateInput(props)
  return null
}

async function flushEffects(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('2.1.328 useMaybeTruncateInput keepsFullText state', () => {
  test('truncates restored >10k input even in fullscreen unless keepsFullText is true, and resets on empty', async () => {
    const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER
    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    const ink = new Ink({
      stdout: makeFakeStream(),
      stdin: makeFakeStream(),
      stderr: makeFakeStream(),
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      const keepsFullTextRef = { current: false }
      let latestInput = ''
      let latestPasted: Record<number, PastedContent> = {}
      let latestCursor = 0
      let changeCount = 0

      const onInputChange = (v: string) => {
        changeCount++
        latestInput = v
      }
      const setCursorOffset = (n: number) => {
        latestCursor = n
      }
      const setPastedContents = (c: Record<number, PastedContent>) => {
        latestPasted = c
      }

      const longPrompt = 'x'.repeat(TRUNCATE_INPUT_THRESHOLD + 500)

      // 1. Long restored input in fullscreen MUST truncate when keepsFullText is false
      ink.render(
        React.createElement(Harness, {
          input: longPrompt,
          pastedContents: {},
          onInputChange,
          setCursorOffset,
          setPastedContents,
          keepsFullTextRef,
        }),
      )
      await flushEffects()

      expect(changeCount).toBe(1)
      expect(latestInput.length).toBeLessThan(longPrompt.length)
      expect(Object.keys(latestPasted).length).toBe(1)
      expect(latestCursor).toBe(latestInput.length)
      expect(keepsFullTextRef.current).toBe(true)

      // 2. While keepsFullText is true (e.g. expanded in fullscreen), another >10k value is NOT re-truncated
      const expandedAgain = 'y'.repeat(TRUNCATE_INPUT_THRESHOLD + 600)
      ink.render(
        React.createElement(Harness, {
          input: expandedAgain,
          pastedContents: {},
          onInputChange,
          setCursorOffset,
          setPastedContents,
          keepsFullTextRef,
        }),
      )
      await flushEffects()
      expect(changeCount).toBe(1)

      // 3. Clearing input to '' resets keepsFullText back to false
      ink.render(
        React.createElement(Harness, {
          input: '',
          pastedContents: {},
          onInputChange,
          setCursorOffset,
          setPastedContents,
          keepsFullTextRef,
        }),
      )
      await flushEffects()
      expect(keepsFullTextRef.current).toBe(false)

      // 4. Subsequent >10k restoration truncates again
      ink.render(
        React.createElement(Harness, {
          input: 'z'.repeat(TRUNCATE_INPUT_THRESHOLD + 400),
          pastedContents: {},
          onInputChange,
          setCursorOffset,
          setPastedContents,
          keepsFullTextRef,
        }),
      )
      await flushEffects()
      expect(changeCount).toBe(2)
      expect(keepsFullTextRef.current).toBe(true)
    } finally {
      ink.unmount()
      if (prevNoFlicker === undefined) {
        delete process.env.CLAUDE_CODE_NO_FLICKER
      } else {
        process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker
      }
    }
  })

  test('P1-#13: typing char #10,001 or inserting past threshold sets keepsFullText before effect so prompt never collapses mid-typing', async () => {
    const ink = new Ink({
      stdout: makeFakeStream(),
      stdin: makeFakeStream(),
      stderr: makeFakeStream(),
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      const keepsFullTextRef = { current: false }
      let changeCount = 0
      const onInputChange = () => {
        changeCount++
      }
      const setCursorOffset = () => {}
      const setPastedContents = () => {}

      // Start at 10,000 chars (at threshold)
      const atThreshold = 'a'.repeat(TRUNCATE_INPUT_THRESHOLD)
      ink.render(
        React.createElement(Harness, {
          input: atThreshold,
          pastedContents: {},
          onInputChange,
          setCursorOffset,
          setPastedContents,
          keepsFullTextRef,
        }),
      )
      await flushEffects()
      expect(changeCount).toBe(0)
      expect(keepsFullTextRef.current).toBe(false)

      // User types char #10,001: noteUserEditForTruncation runs synchronously BEFORE React effect
      const typedOverThreshold = `${atThreshold}b`
      noteUserEditForTruncation(typedOverThreshold, keepsFullTextRef)
      expect(keepsFullTextRef.current).toBe(true)

      ink.render(
        React.createElement(Harness, {
          input: typedOverThreshold,
          pastedContents: {},
          onInputChange,
          setCursorOffset,
          setPastedContents,
          keepsFullTextRef,
        }),
      )
      await flushEffects()
      // Must NOT collapse mid-typing!
      expect(changeCount).toBe(0)

      // Clearing back to empty resets keepsFullTextRef synchronously
      noteUserEditForTruncation('', keepsFullTextRef)
      expect(keepsFullTextRef.current).toBe(false)
    } finally {
      ink.unmount()
    }
  })

  test('P1-#13 & plugin autocomplete: PromptInput wires noteUserEditForTruncation, unconditional lastCollapsedPasteIdRef, and applyPluginAutocompleteReplacement', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInput.tsx'),
      'utf8',
    )
    // Typing & insertTextAtCursor mark keepsFullText before useMaybeTruncateInput runs
    expect(src).toContain(
      'noteUserEditForTruncation(processedValue, keepsFullTextRef)',
    )
    expect(src).toContain(
      'noteUserEditForTruncation(newInput, keepsFullTextRef)',
    )
    // History recall keeps isKeystroke: false so restored >10k prompts still truncate
    expect(src).toContain('applyInputChange(value, { isKeystroke: false })')

    // onTextPaste sets lastCollapsedPasteIdRef unconditionally before the footer-hint gate
    const pasteBlockStart = src.indexOf(
      'if (text.length > PASTE_THRESHOLD || numLines > maxLines)',
    )
    const pasteBlockEnd = src.indexOf('} else {', pasteBlockStart)
    const pasteBlock = src.slice(pasteBlockStart, pasteBlockEnd)
    const idAssignIdx = pasteBlock.indexOf(
      'lastCollapsedPasteIdRef.current = pasteId;',
    )
    const hintGateIdx = pasteBlock.indexOf(
      'if (!hadExpandPasteHint && !isLoading && text.length <= TRUNCATE_INPUT_THRESHOLD)',
    )
    expect(idAssignIdx).toBeGreaterThan(-1)
    expect(hintGateIdx).toBeGreaterThan(idAssignIdx)
    // 8s timeout clears ONLY showExpandPasteHint (must NOT clear lastCollapsedPasteIdRef)
    const timeoutBlock = pasteBlock.slice(hintGateIdx)
    expect(timeoutBlock).toContain('setShowExpandPasteHint(false);')
    expect(timeoutBlock).not.toContain(
      'lastCollapsedPasteIdRef.current = null;',
    )

    // Plugin autocomplete replacement has live production callers
    expect(src).toContain('const acceptPluginAutocompleteItem = useCallback(')
    expect(src).toContain('applyPluginAutocompleteReplacement(')
  })
})
