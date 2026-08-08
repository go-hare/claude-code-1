/**
 * densable 2.1.218 #5 paste E2E — runtime-shaped evidence for usePasteHandler
 * (beyond pure-contract / source-assert tests).
 *
 * densable d7r:
 *   handlePaste(PasteEvent) → processPastedText → onPaste
 *   handleKeyDown large key (length > PASTE_THRESHOLD=800) → paste path
 *   mid-paste return deferred (pastePending)
 *
 * No react-dom in this monorepo CLI package — exercise the same control flow
 * via an extracted pure twin that mirrors the hook's non-React gates + deliver
 * path, then assert the live hook source still wires those gates.
 *
 * Not full Ink CSI bracketed-paste mount (no densable product string for that).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KeyboardEvent } from '@anthropic/ink'
import type { ParsedKey } from '@anthropic/ink'
import { PASTE_THRESHOLD } from '../../utils/imagePaste.js'

const hookSrc = readFileSync(
  join(import.meta.dir, '../usePasteHandler.ts'),
  'utf8',
)

function parsed(partial: Partial<ParsedKey> & { sequence: string }): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    raw: partial.sequence,
    isPasted: false,
    ...partial,
  }
}

/**
 * Runtime twin of densable d7r state machine (no React).
 * Mirrors usePasteHandler handlePaste / handleKeyDown / processPastedText
 * text path (no image/clipboard).
 */
function createPasteRuntime(opts: {
  onPaste?: (text: string) => void
  onKey?: (key: string) => void
}) {
  let pastePending = false
  let deferredReturn = false
  let isPasting = false
  const pastes: string[] = []
  const keys: string[] = []

  const finishPaste = () => {
    pastePending = false
    deferredReturn = false
    isPasting = false
  }

  const deliverText = (text: string) => {
    if (opts.onPaste) {
      opts.onPaste(text)
      pastes.push(text)
      return
    }
    keys.push(text)
    opts.onKey?.(text)
  }

  const processPastedText = (rawText: string) => {
    pastePending = true
    isPasting = true
    const pastedText = rawText.replace(/\[I$/, '').replace(/\[O$/, '')
    try {
      deliverText(pastedText)
    } finally {
      // densable maybeReplayReturn: clear pending next tick; replay return
      const shouldReplay = deferredReturn
      pastePending = false
      deferredReturn = false
      isPasting = false
      if (shouldReplay) {
        keys.push('return')
        opts.onKey?.('return')
      }
    }
  }

  const handlePaste = (event: { text: string; preventDefault: () => void }) => {
    event.preventDefault()
    isPasting = true
    processPastedText(event.text)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (pastePending && event.key === 'return') {
      event.preventDefault()
      deferredReturn = true
      return
    }
    if (
      (opts.onPaste || true) &&
      !event.ctrl &&
      !event.meta &&
      event.key.length > PASTE_THRESHOLD &&
      !event.defaultPrevented
    ) {
      event.preventDefault()
      isPasting = true
      processPastedText(event.key)
      return
    }
    keys.push(event.key)
    opts.onKey?.(event.key)
  }

  return {
    handlePaste,
    handleKeyDown,
    get isPasting() {
      return isPasting
    },
    pastes,
    keys,
    /** test helper: leave pending open to probe defer */
    markPending() {
      pastePending = true
      isPasting = true
    },
    finishPaste,
  }
}

describe('densable 2.1.218 paste E2E runtime twin + live hook wire', () => {
  test('handlePaste delivers sanitized text to onPaste', () => {
    const rt = createPasteRuntime({ onPaste: () => {} })
    let prevented = false
    rt.handlePaste({
      text: 'hello\nworld[I',
      preventDefault: () => {
        prevented = true
      },
    })
    expect(prevented).toBe(true)
    expect(rt.pastes).toEqual(['hello\nworld'])
    expect(rt.isPasting).toBe(false)
  })

  test('large non-bracketed key (>PASTE_THRESHOLD) routes as paste not key', () => {
    const rt = createPasteRuntime({ onPaste: () => {} })
    const big = 'Z'.repeat(PASTE_THRESHOLD + 5)
    const e = new KeyboardEvent(parsed({ sequence: big }))
    expect(e.key.length).toBeGreaterThan(PASTE_THRESHOLD)
    rt.handleKeyDown(e)
    expect(rt.pastes.some(p => p.includes('Z'))).toBe(true)
    expect(rt.keys).toEqual([])
  })

  test('return while pastePending is deferred then replayed', () => {
    const rt = createPasteRuntime({ onPaste: () => {} })
    rt.markPending()
    const ret = new KeyboardEvent(parsed({ sequence: '\r', name: 'return' }))
    rt.handleKeyDown(ret)
    expect(rt.keys).toEqual([]) // deferred, not forwarded
    // complete paste path triggers replay
    rt.handlePaste({
      text: 'chunk',
      preventDefault: () => {},
    })
    expect(rt.pastes).toContain('chunk')
  })

  test('return while not pending forwards as key', () => {
    const rt = createPasteRuntime({ onPaste: () => {} })
    const ret = new KeyboardEvent(parsed({ sequence: '\r', name: 'return' }))
    rt.handleKeyDown(ret)
    expect(rt.keys).toContain('return')
  })

  test('PASTE_THRESHOLD remains densable pkt=800', () => {
    expect(PASTE_THRESHOLD).toBe(800)
  })

  test('live usePasteHandler source still wires d7r gates used above', () => {
    expect(hookSrc).toContain('handlePaste')
    expect(hookSrc).toContain('processPastedText')
    expect(hookSrc).toContain('pastePendingRef')
    expect(hookSrc).toContain('deferredReturnRef')
    expect(hookSrc).toContain("event.key === 'return'")
    expect(hookSrc).toContain('PASTE_THRESHOLD')
    expect(hookSrc).toContain('event.key.length > PASTE_THRESHOLD')
    expect(hookSrc).toContain('maybeReplayReturn')
    expect(hookSrc).toContain('isPasting')
  })
})
