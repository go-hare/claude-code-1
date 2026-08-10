import { afterEach, describe, expect, test } from 'bun:test'
import { Cursor } from '../../utils/Cursor.js'
import { executePaste, type OperatorContext } from '../operators.js'
import {
  createInitialPersistentState,
  getOrCreateVimSharedState,
  resetSessionYankRegisterForTests,
} from '../types.js'

describe('densable 2.1.221 #20 vimSharedState (jLf/vES)', () => {
  afterEach(() => {
    resetSessionYankRegisterForTests()
  })

  test('getOrCreateVimSharedState is a lazy singleton', () => {
    const a = getOrCreateVimSharedState()
    const b = getOrCreateVimSharedState()
    expect(a).toBe(b)
    expect(a.register).toBe('')
    expect(a.registerIsLinewise).toBe(false)
    expect(a.lastFind).toBeNull()
  })

  test('setRegister via createInitialPersistentState survives remount', () => {
    const mount1 = createInitialPersistentState()
    mount1.register = 'yanked text'
    mount1.registerIsLinewise = true
    mount1.lastFind = { type: 'f', char: 'x' }

    // Simulate PromptInput remount (new createInitialPersistentState)
    const mount2 = createInitialPersistentState()
    expect(mount2.register).toBe('yanked text')
    expect(mount2.registerIsLinewise).toBe(true)
    expect(mount2.lastFind).toEqual({ type: 'f', char: 'x' })
    // lastChange is per-mount
    expect(mount2.lastChange).toBeNull()
    mount1.lastChange = { type: 'insert', text: 'a' }
    expect(mount2.lastChange).toBeNull()
  })

  test('reset clears singleton for next getOrCreate', () => {
    const a = getOrCreateVimSharedState()
    a.register = 'x'
    resetSessionYankRegisterForTests()
    const b = getOrCreateVimSharedState()
    expect(b).not.toBe(a)
    expect(b.register).toBe('')
  })

  test('executePaste uses registerIsLinewise even without trailing newline', () => {
    let text = 'alpha\nbeta'
    const cursor = Cursor.fromText(text, 80, 0)
    const ctx: OperatorContext = {
      cursor,
      text,
      setText: t => {
        text = t
      },
      setOffset: () => {},
      enterInsert: () => {},
      getRegister: () => 'LINE',
      getRegisterIsLinewise: () => true,
      setRegister: () => {},
      getLastFind: () => null,
      setLastFind: () => {},
      recordChange: () => {},
    }
    executePaste(true, 1, ctx)
    // linewise paste after line 0 inserts a new line "LINE"
    expect(text.split('\n')).toContain('LINE')
    expect(text).toBe('alpha\nLINE\nbeta')
  })
})
