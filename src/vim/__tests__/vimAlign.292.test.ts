import { describe, expect, test } from 'bun:test'
import { Cursor } from '@anthropic/ink'
import {
  executeIndent,
  executeToggleCase,
  executeVisualOp,
  repeatVisualOp,
  type OperatorContext,
} from '../operators.js'
import { transition, visualTransition } from '../transitions.js'
import type { FindType, RecordedChange, WantedColumn } from '../types.js'

function makeCtx(initialText: string, initialOffset: number, columns = 80) {
  let text = initialText
  let offset = initialOffset
  let register = ''
  let registerIsLinewise = false
  let lastFind: { type: FindType; char: string } | null = null
  let lastChange: RecordedChange | null = null
  let insertedOffset: number | null = null

  const ctx: OperatorContext & {
    wantedColumn?: WantedColumn | null
    getState: () => {
      text: string
      offset: number
      register: string
      registerIsLinewise: boolean
      lastChange: RecordedChange | null
      insertedOffset: number | null
    }
  } = {
    get cursor() {
      return Cursor.fromText(text, columns, offset)
    },
    get text() {
      return text
    },
    setText(t: string) {
      text = t
    },
    setOffset(o: number) {
      offset = o
    },
    enterInsert(o: number) {
      insertedOffset = o
      offset = o
    },
    getRegister() {
      return register
    },
    getRegisterIsLinewise() {
      return registerIsLinewise
    },
    setRegister(content: string, linewise: boolean) {
      register = content
      registerIsLinewise = linewise
    },
    getLastFind() {
      return lastFind
    },
    setLastFind(type: FindType, char: string) {
      lastFind = { type, char }
    },
    recordChange(change: RecordedChange) {
      lastChange = change
    },
    getState() {
      return {
        text,
        offset,
        register,
        registerIsLinewise,
        lastChange,
        insertedOffset,
      }
    },
  }
  return ctx
}

describe('Vim alignment #224, #319, #320, #396', () => {
  test('#224 findCharacter (f/t/F/T) does not cross logical line boundaries', () => {
    const cursor = Cursor.fromText('abc\ndef', 80, 0)
    expect(cursor.findCharacter('d', 'f', 1)).toBeNull()
    expect(cursor.findCharacter('e', 't', 1)).toBeNull()

    const cursorLine2 = Cursor.fromText('abc\ndef', 80, 5)
    expect(cursorLine2.findCharacter('a', 'F', 1)).toBeNull()
    expect(cursorLine2.findCharacter('b', 'T', 1)).toBeNull()
  })

  test('#224 j/k preserves preferred column across shorter lines', () => {
    const ctx = makeCtx('abcdef\nxy\n123456', 4) // col 4 ('e')
    const r1 = transition({ type: 'idle' }, 'j', ctx)
    r1.execute?.()
    expect(ctx.getState().offset).toBe(8) // 'y' on line 2 (clamped)
    expect(r1.wanted?.column).toBe(4)

    ctx.wantedColumn = r1.wanted
    const r2 = transition({ type: 'idle' }, 'j', ctx)
    r2.execute?.()
    expect(ctx.getState().offset).toBe(14) // '5' on line 3 (restored col 4)
  })

  test('#319 executeIndent on all-spaces line keeps cursor inside line', () => {
    const ctx = makeCtx('  ', 0)
    executeIndent('>', 1, ctx)
    const st = ctx.getState()
    expect(st.text).toBe('    ')
    expect(st.offset).toBe(3) // last space, not 4 (past end)
    expect(st.offset).toBeLessThan(st.text.length)

    executeIndent('<', 1, ctx)
    const st2 = ctx.getState()
    expect(st2.text).toBe('  ')
    expect(st2.offset).toBe(1)
  })

  test('#396 executeToggleCase (~) stops at newline and clamps cursor at line end', () => {
    const ctx = makeCtx('ab\ncd', 1)
    executeToggleCase(3, ctx)
    const st = ctx.getState()
    expect(st.text).toBe('aB\ncd') // did not cross into 'cd'
    expect(st.offset).toBe(1) // clamped to 'B', not on '\n'

    const ctxSingle = makeCtx('ab', 1)
    executeToggleCase(1, ctxSingle)
    expect(ctxSingle.getState().text).toBe('aB')
    expect(ctxSingle.getState().offset).toBe(1) // clamped to 'B', not 2
  })

  test('#320 Visual line delete (V + d) lands on first non-blank and dot-repeat acts on cursor line', () => {
    const ctx = makeCtx('first\n  second\n    third', 1)
    const res = visualTransition({ type: 'idle' }, 'd', 1, true, ctx)
    expect(res.exitVisual).toBe(true)
    res.execute?.()
    const st = ctx.getState()
    expect(st.text).toBe('  second\n    third')
    expect(st.register).toBe('first\n')
    expect(st.registerIsLinewise).toBe(true)
    expect(st.offset).toBe(2) // first non-blank 's' of '  second'
    expect(st.lastChange).toEqual({
      type: 'visualOp',
      op: 'delete',
      span: 1,
      linewise: true,
    })

    // Dot-repeat deletes the cursor's current line ('  second')
    repeatVisualOp('delete', 1, true, ctx)
    const st2 = ctx.getState()
    expect(st2.text).toBe('    third')
    expect(st2.offset).toBe(4) // first non-blank 't'
  })
})
