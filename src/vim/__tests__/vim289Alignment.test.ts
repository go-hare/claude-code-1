import { describe, expect, test } from 'bun:test'
import { Cursor } from '@anthropic/ink'
import { resolveMotion } from '../motions.js'
import {
  executeIndent,
  executeJoin,
  executeLineOp,
  executeOpenLine,
  executeOperatorFind,
  executeOperatorMotion,
  executeOperatorTextObj,
  executePaste,
  type OperatorContext,
} from '../operators.js'
import { findTextObject } from '../textObjects.js'
import type { RecordedChange } from '../types.js'

function makeCtx(
  initialText: string,
  offset: number,
  columns: number = 80,
): {
  ctx: OperatorContext
  getState: () => {
    text: string
    offset: number
    mode: 'NORMAL' | 'INSERT'
    register: string
    linewise: boolean
    changes: RecordedChange[]
  }
} {
  let text = initialText
  let curOffset = offset
  let mode: 'NORMAL' | 'INSERT' = 'NORMAL'
  let register = ''
  let linewise = false
  let lastFind: { type: 'f' | 'F' | 't' | 'T'; char: string } | null = null
  const changes: RecordedChange[] = []

  const ctx: OperatorContext = {
    get cursor() {
      return Cursor.fromText(text, columns, curOffset)
    },
    get text() {
      return text
    },
    setText: next => {
      text = next
    },
    setOffset: next => {
      curOffset = next
    },
    enterInsert: next => {
      curOffset = next
      mode = 'INSERT'
    },
    getRegister: () => register,
    getRegisterIsLinewise: () => linewise,
    setRegister: (content, isLw) => {
      register = content
      linewise = isLw
    },
    getLastFind: () => lastFind,
    setLastFind: (type, char) => {
      lastFind = { type, char }
    },
    recordChange: change => {
      changes.push(change)
    },
  }

  return {
    ctx,
    getState: () => ({
      text,
      offset: curOffset,
      mode,
      register,
      linewise,
      changes,
    }),
  }
}

describe('Vim 2.1.289 alignment', () => {
  test('findTextObject returns null (no crash) on empty prompt for iw/aw/iW/aW', () => {
    expect(findTextObject('', 0, 'w', true)).toBeNull()
    expect(findTextObject('', 0, 'w', false)).toBeNull()
    expect(findTextObject('', 0, 'W', true)).toBeNull()
    expect(findTextObject('', 0, 'W', false)).toBeNull()

    const { ctx, getState } = makeCtx('', 0)
    expect(() =>
      executeOperatorTextObj('delete', 'inner', 'w', 1, ctx),
    ).not.toThrow()
    expect(getState().text).toBe('')
  })

  test('openLine (O/o), indent (>>), join (J), and linewise paste (p) use logical line on soft-wrapped text', () => {
    const wrapped = 'abcdefghij klmnopqrst\nsecond line'
    // columns=12 wraps first logical line onto visual row 1 at offset 14 ('n')
    const cursorCheck = Cursor.fromText(wrapped, 12, 14)
    expect(cursorCheck.getPosition().line).toBeGreaterThan(0)

    const openAbove = makeCtx(wrapped, 14, 12)
    executeOpenLine('above', openAbove.ctx)
    expect(openAbove.getState().text).toBe(
      '\nabcdefghij klmnopqrst\nsecond line',
    )
    expect(openAbove.getState().offset).toBe(0)

    const openBelow = makeCtx(wrapped, 14, 12)
    executeOpenLine('below', openBelow.ctx)
    expect(openBelow.getState().text).toBe(
      'abcdefghij klmnopqrst\n\nsecond line',
    )

    const indent = makeCtx(wrapped, 14, 12)
    executeIndent('>', 1, indent.ctx)
    expect(indent.getState().text).toBe('  abcdefghij klmnopqrst\nsecond line')

    const join = makeCtx(wrapped, 14, 12)
    executeJoin(1, join.ctx)
    expect(join.getState().text).toBe('abcdefghij klmnopqrst second line')

    const paste = makeCtx(wrapped, 14, 12)
    paste.ctx.setRegister('inserted\n', true)
    executePaste(true, 1, paste.ctx)
    expect(paste.getState().text).toBe(
      'abcdefghij klmnopqrst\ninserted\nsecond line',
    )
  })

  test('1-character inclusive motions de, ce, d$, c$ and cw operate on single-char targets', () => {
    const de = makeCtx('a', 0)
    executeOperatorMotion('delete', 'e', 1, de.ctx)
    expect(de.getState().text).toBe('')

    const cw = makeCtx('a b', 0)
    executeOperatorMotion('change', 'w', 1, cw.ctx)
    expect(cw.getState().text).toBe(' b')
    expect(cw.getState().mode).toBe('INSERT')

    const dDollar = makeCtx('ab\ncd', 1)
    executeOperatorMotion('delete', '$', 1, dDollar.ctx)
    expect(dDollar.getState().text).toBe('a\ncd')

    const cDollar = makeCtx('ab\ncd', 1)
    executeOperatorMotion('change', '$', 1, cDollar.ctx)
    expect(cDollar.getState().text).toBe('a\ncd')
    expect(cDollar.getState().mode).toBe('INSERT')

    const emptyLine = makeCtx('\ncd', 0)
    executeOperatorMotion('delete', '$', 1, emptyLine.ctx)
    expect(emptyLine.getState().text).toBe('\ncd')
  })

  test('$ lands on last character of logical line and Space moves right', () => {
    const c = Cursor.fromText('abc\ndef', 80, 0)
    expect(resolveMotion('$', c, 1).offset).toBe(2)
    expect(resolveMotion(' ', c, 2).offset).toBe(2)
  })

  test('yank operators do not overwrite recorded dot-repeat change', () => {
    const { ctx, getState } = makeCtx('hello world', 0)
    executeOperatorMotion('delete', 'w', 1, ctx)
    expect(getState().changes).toHaveLength(1)

    executeOperatorMotion('yank', 'w', 1, ctx)
    executeLineOp('yank', 1, ctx)
    executeOperatorTextObj('yank', 'inner', 'w', 1, ctx)
    expect(getState().changes).toHaveLength(1)
    expect(getState().changes[0]).toEqual({
      type: 'operator',
      op: 'delete',
      motion: 'w',
      count: 1,
    })
  })

  test('operator find snaps out of paste placeholder chips instead of bisecting them', () => {
    const chip = '[Pasted text #1 +10 lines]'
    const { ctx, getState } = makeCtx(`hi ${chip} bye`, 0)
    executeOperatorFind('delete', 'f', '+', 1, ctx)
    expect(getState().text).toBe(' bye')
  })

  test('Cursor vim word motions skip placeholder chips, modifyText handles NFC boundary merges, and deleteTokenBefore deletes guide/IDE chips', () => {
    const chip = '[Pasted text #1 +10 lines]'
    const text = `${chip} next`
    const atStart = Cursor.fromText(text, 80, 0)
    expect(atStart.nextVimWord().offset).toBe(chip.length + 1)
    expect(atStart.endOfVimWord().offset).toBe(chip.length - 1)
    expect(atStart.endOfWORD().offset).toBe(chip.length - 1)

    const afterChip = Cursor.fromText(text, 80, chip.length)
    expect(afterChip.prevVimWord().offset).toBe(0)

    // NFC merge across boundary: 'e' + '\u0301' -> 'é' (length 1, not 2)
    const base = Cursor.fromText('ex', 80, 1)
    const combined = base.insert('\u0301')
    expect(combined.text).toBe('\u00e9x')
    expect(combined.offset).toBe(1)

    // deleteTokenBefore handles Team setup guide and IDE [⧉ ...] chips
    const guide = '[✦ Team setup guide #2 +5 lines]'
    const atGuideEnd = Cursor.fromText(`pre ${guide}`, 80, 4 + guide.length)
    expect(atGuideEnd.deleteTokenBefore()?.text).toBe('pre ')

    const ideChip = '[⧉ src/index.ts]'
    const atIdeEnd = Cursor.fromText(ideChip, 80, ideChip.length)
    expect(atIdeEnd.deleteTokenBefore()?.text).toBe('')
  })
})
