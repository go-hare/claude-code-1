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
    expect(body.indexOf('onHoldCleared?.()')).toBeLessThan(body.indexOf("onChange('')"))
  })

  test('PromptInput restores held draft on empty historyUp before history', () => {
    const src = readFileSync(PROMPT, 'utf8')
    expect(src).toContain('restoreCleared(liveInputRef.current)')
    expect(src).toContain("text: 'Draft restored'")
    expect(src).toContain('onHoldCleared:')
    expect(src).toContain('holdCleared({')
    const hist = src.indexOf('function handleHistoryUp')
    const restore = src.indexOf('restoreCleared(liveInputRef.current)', hist)
    const historyCall = src.indexOf('onHistoryUp()', hist)
    expect(restore).toBeGreaterThan(hist)
    expect(historyCall).toBeGreaterThan(restore)
  })
})
