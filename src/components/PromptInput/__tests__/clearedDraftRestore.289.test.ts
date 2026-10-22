import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROMPT = join(import.meta.dir, '../PromptInput.tsx')
const TEXT = join(import.meta.dir, '../../../hooks/useTextInput.ts')

describe('densable 2.1.289 Ctrl+C draft recover wiring', () => {
  test('useTextInput calls onHoldCleared before clearing on Ctrl+C', () => {
    const src = readFileSync(TEXT, 'utf8')
    expect(src).toContain('onHoldCleared?: () => void')
    const start = src.indexOf('const handleCtrlC = useDoublePress')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 500)
    expect(body.indexOf('onHoldCleared?.()')).toBeGreaterThan(0)
    expect(body.indexOf('onHoldCleared?.()')).toBeLessThan(
      body.indexOf("onChange('')"),
    )
  })

  test('PromptInput restores held draft on empty historyUp before queue/history', () => {
    const src = readFileSync(PROMPT, 'utf8')
    expect(src).toContain('restoreCleared(liveInputRef.current)')
    expect(src).toContain('onHoldCleared:')
    expect(src).toContain('holdCleared({')
    const hist = src.indexOf('function handleHistoryUp')
    const restore = src.indexOf('restoreCleared(liveInputRef.current)', hist)
    const queue = src.indexOf('queueEditIndexAfterHistoryUp', hist)
    const historyCall = src.indexOf('onHistoryUp()', hist)
    expect(restore).toBeGreaterThan(hist)
    expect(queue).toBeGreaterThan(restore)
    expect(historyCall).toBeGreaterThan(restore)
    const restoreBody = src.slice(restore, historyCall)
    expect(restoreBody).not.toContain("text: 'Draft restored'")
    const stash = src.indexOf('const handleStash = useCallback')
    expect(stash).toBeGreaterThan(0)
    expect(src.slice(stash, stash + 1200)).not.toContain(
      "text: 'Draft restored'",
    )
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    const restores = [...repl.matchAll(/setStashedPrompt\(undefined\)/g)]
    expect(restores.length).toBeGreaterThanOrEqual(2)
    for (const hit of restores) {
      const after = repl.slice(hit.index ?? 0, (hit.index ?? 0) + 280)
      expect(after).toContain("text: 'Draft restored'")
    }
  })
})
