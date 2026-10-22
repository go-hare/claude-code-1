/**
 * densable 2.1.289 — Ctrl+S stash drops the Ctrl+C held draft so empty
 * ↑ restores the stash, not that leftover.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROMPT = join(import.meta.dir, '../PromptInput.tsx')

describe('densable 2.1.289 stash clears Ctrl+C hold', () => {
  test('handleStash calls clearHeldClearedDraft before pushing', () => {
    const src = readFileSync(PROMPT, 'utf8')
    const start = src.indexOf('const handleStash = useCallback')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 900)
    const clear = body.indexOf('clearHeldClearedDraft()')
    const push = body.indexOf('setStashedPrompt({ text: input')
    expect(clear).toBeGreaterThan(0)
    expect(push).toBeGreaterThan(clear)
  })
})
