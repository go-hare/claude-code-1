import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearHeldClearedDraft,
  holdCleared,
  peekHeldClearedDraftForTests,
  resetHeldClearedDraftForTests,
  restoreCleared,
} from '../clearedDraftHold.js'

describe('densable 2.1.289 holdCleared / restoreCleared', () => {
  afterEach(() => {
    resetHeldClearedDraftForTests()
  })

  test('holdCleared stores non-empty draft including pastes', () => {
    holdCleared({
      text: 'hello [Pasted text #1]',
      mode: 'prompt',
      pastedContents: {
        1: { id: 1, type: 'text', content: 'paste' },
      },
    })
    const held = peekHeldClearedDraftForTests()
    expect(held?.text).toBe('hello [Pasted text #1]')
    expect(held?.pastedContents[1]?.content).toBe('paste')
  })

  test('holdCleared ignores whitespace-only', () => {
    holdCleared({ text: '   ', mode: 'prompt', pastedContents: {} })
    expect(peekHeldClearedDraftForTests()).toBeNull()
  })

  test('restoreCleared only when current value is empty', () => {
    holdCleared({ text: 'draft', mode: 'bash', pastedContents: {} })
    expect(restoreCleared('still typing')).toBeNull()
    expect(peekHeldClearedDraftForTests()?.text).toBe('draft')
    const restored = restoreCleared('')
    expect(restored?.text).toBe('draft')
    expect(restored?.mode).toBe('bash')
    expect(peekHeldClearedDraftForTests()).toBeNull()
  })

  test('clearHeldClearedDraft drops the hold (outside empty)', () => {
    holdCleared({ text: 'x', mode: 'prompt', pastedContents: {} })
    clearHeldClearedDraft()
    expect(restoreCleared('')).toBeNull()
  })
})
