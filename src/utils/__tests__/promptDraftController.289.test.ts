/**
 * densable 2.1.289 PromptDraftController ≈ P$ write rules.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getPromptInputCursorState,
  getPromptInputStoreValue,
  resetPromptInputCursorStoreForTests,
  setPromptInputStoreValue,
} from '../promptInputCursorStore.js'
import {
  PROMPT_DRAFT_ACTIVE_MS,
  PromptDraftController,
} from '../promptDraftController.js'
import { resetHeldClearedDraftForTests } from '../clearedDraftHold.js'

afterEach(() => {
  resetPromptInputCursorStoreForTests()
  resetHeldClearedDraftForTests()
})

describe('PromptDraftController densable 2.1.289', () => {
  test('setValue writes store, calls onEdit(new, old), latches active', () => {
    const edits: Array<[string, string]> = []
    const timers: Array<() => void> = []
    const draft = new PromptDraftController({
      onEdit: (next, prev) => edits.push([next, prev]),
      scheduleTimeout: (fn, ms) => {
        expect(ms).toBe(PROMPT_DRAFT_ACTIVE_MS)
        timers.push(fn)
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: () => {},
    })
    draft.setValue('a')
    expect(getPromptInputStoreValue()).toBe('a')
    expect(draft.value).toBe('a')
    expect(edits).toEqual([['a', '']])
    expect(getPromptInputCursorState().active).toBe(true)
    expect(timers).toHaveLength(1)
    timers[0]!()
    expect(getPromptInputCursorState().active).toBe(false)
    draft.dispose()
  })

  test('setValueRaw writes store only — no onEdit, no active latch', () => {
    const edits: Array<[string, string]> = []
    const draft = new PromptDraftController({
      onEdit: (next, prev) => edits.push([next, prev]),
      scheduleTimeout: () => {
        throw new Error('setValueRaw must not schedule active timer')
      },
    })
    draft.setValueRaw('voice')
    expect(getPromptInputStoreValue()).toBe('voice')
    expect(draft.value).toBe('voice')
    expect(edits).toEqual([])
    expect(getPromptInputCursorState().active).toBe(false)
    expect(draft.changedFromOutside).toBe(true)
    draft.dispose()
  })

  test('onEdit typedIntoEmpty shape: empty→nonempty only from setValue', () => {
    const edits: Array<[string, string]> = []
    const draft = new PromptDraftController({
      onEdit: (next, prev) => edits.push([next, prev]),
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    })
    draft.setValue('x')
    draft.setValue('xy')
    expect(edits[0]).toEqual(['x', ''])
    expect(edits[1]).toEqual(['xy', 'x'])
    draft.dispose()
  })

  test('setValueTyped keeps typedOnly on single-char append', () => {
    const draft = new PromptDraftController({
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    })
    expect(draft.typedOnly).toBe(true)
    draft.setValueTyped('a')
    expect(draft.typedOnly).toBe(true)
    draft.setValueTyped('ab')
    expect(draft.typedOnly).toBe(true)
    draft.setValue('zzz')
    expect(draft.typedOnly).toBe(false)
    draft.dispose()
  })

  test('stash / popStash round-trip via store.stash', () => {
    const draft = new PromptDraftController({
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    })
    draft.setValueWithCursor('hello', 2)
    draft.setMode('bash')
    draft.stash()
    expect(draft.value).toBe('')
    expect(getPromptInputStoreValue()).toBe('')
    expect(getPromptInputCursorState().stash?.text).toBe('hello')
    expect(draft.popStash()).toBe(true)
    expect(draft.value).toBe('hello')
    expect(draft.cursorOffset).toBe(2)
    expect(draft.mode).toBe('bash')
    expect(getPromptInputCursorState().stash).toBeNull()
    draft.dispose()
  })

  test('holdCleared / restoreCleared — input empty keeps hold; clear() drops it', () => {
    const draft = new PromptDraftController({
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    })
    draft.setValue('held')
    draft.holdCleared()
    // densable Ctrl+C path: hold then empty via input source (not clear/outside).
    draft.setValue('')
    expect(draft.value).toBe('')
    expect(draft.restoreCleared()).toBe(true)
    expect(draft.value).toBe('held')
    draft.holdCleared()
    draft.clear()
    expect(draft.restoreCleared()).toBe(false)
    draft.dispose()
  })

  test('subscribe notifies on setValue', () => {
    const draft = new PromptDraftController({
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    })
    let ticks = 0
    const unsub = draft.subscribe(() => {
      ticks++
    })
    draft.setValue('n')
    expect(ticks).toBeGreaterThan(0)
    unsub()
    draft.dispose()
  })

  test('external store seed is picked up as outside change', () => {
    setPromptInputStoreValue('seed')
    const draft = new PromptDraftController()
    expect(draft.value).toBe('seed')
    expect(draft.cursorOffset).toBe(4)
    draft.dispose()
  })

  test('source: REPL drops useState(consumeEarlyInput); PromptInput takes draftController', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    const prompt = readFileSync(
      join(import.meta.dir, '../../components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(repl).not.toMatch(/useState\(\(\)\s*=>\s*consumeEarlyInput\(\)\)/)
    expect(repl).toContain('draftController={draftController}')
    expect(repl).toContain('createPromptDraftController')
    expect(prompt).toContain('draftController?: PromptDraftController')
    expect(prompt).toContain('draftController ? (draftSnapshot?.value')
  })
})
