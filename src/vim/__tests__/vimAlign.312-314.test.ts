import { describe, expect, test } from 'bun:test'
import { Cursor } from '@anthropic/ink'
import { executeOperatorMotion, executeVisualPaste } from '../operators.js'
import { findTextObject } from '../textObjects.js'
import { visualTransition } from '../transitions.js'
import type { FindType, RecordedChange, WantedColumn } from '../types.js'
import type { OperatorContext } from '../operators.js'

function makeCtx(
  initialText: string,
  initialOffset: number,
  columns = 80,
): {
  ctx: OperatorContext & {
    wantedColumn?: WantedColumn | null
    onEnterVisual?: (
      kind: 'char' | 'line',
      wanted?: WantedColumn | null,
    ) => void
  }
  getText: () => string
  getOffset: () => number
  getRegister: () => { value: string; linewise: boolean }
  changes: RecordedChange[]
} {
  let text = initialText
  let offset = initialOffset
  let register = ''
  let registerLinewise = false
  let lastFind: { type: FindType; char: string } | null = null
  const changes: RecordedChange[] = []

  const ctx: OperatorContext & {
    wantedColumn?: WantedColumn | null
  } = {
    get cursor() {
      return Cursor.fromText(text, columns, offset)
    },
    get text() {
      return text
    },
    setText(newText: string) {
      text = newText
    },
    setOffset(newOffset: number) {
      offset = newOffset
    },
    enterInsert(newOffset: number) {
      offset = newOffset
    },
    getRegister() {
      return register
    },
    getRegisterIsLinewise() {
      return registerLinewise
    },
    setRegister(content: string, linewise: boolean) {
      register = content
      registerLinewise = linewise
    },
    getLastFind() {
      return lastFind
    },
    setLastFind(type: FindType, char: string) {
      lastFind = { type, char }
    },
    recordChange(change: RecordedChange) {
      changes.push(change)
    },
  }

  return {
    ctx,
    getText: () => text,
    getOffset: () => offset,
    getRegister: () => ({ value: register, linewise: registerLinewise }),
    changes,
  }
}

describe('Vim gj/gk operator rowsRunOut guard (2.1.312 #1328)', () => {
  test('d5gj only moves cursor when fewer than 5 wrapped lines remain', () => {
    const h = makeCtx('line1\nline2', 1)
    executeOperatorMotion('delete', 'gj', 5, h.ctx)
    expect(h.getText()).toBe('line1\nline2')
    expect(h.getOffset()).toBe(7)
    expect(h.changes).toEqual([])
  })

  test('y5gk and c5gk only move cursor when count exceeds lines above', () => {
    const h = makeCtx('line1\nline2', 7)
    h.ctx.setRegister('prev', false)
    executeOperatorMotion('yank', 'gk', 5, h.ctx)
    expect(h.getRegister().value).toBe('prev')
    expect(h.getOffset()).toBe(1)

    const h2 = makeCtx('line1\nline2', 7)
    executeOperatorMotion('change', 'gk', 5, h2.ctx)
    expect(h2.getText()).toBe('line1\nline2')
    expect(h2.getOffset()).toBe(1)
    expect(h2.changes).toEqual([])
  })
})

describe('Vim dw/dW/yw/yW and w/W on empty lines (2.1.314 #1402)', () => {
  test('w and W stop on empty lines', () => {
    const c = Cursor.fromText('foo\n\nbar', 80, 0)
    const afterW = c.nextVimWord()
    expect(afterW.offset).toBe(4) // stops on the empty line '\n'
    expect(afterW.nextVimWord().offset).toBe(5) // then moves to 'bar'

    const cBig = Cursor.fromText('foo\n\nbar', 80, 0)
    const afterBigW = cBig.nextWORD()
    expect(afterBigW.offset).toBe(4)
    expect(afterBigW.nextWORD().offset).toBe(5)
  })

  test('dw and yw do not carry past end of line', () => {
    const h = makeCtx('hello world\nnext', 6)
    executeOperatorMotion('delete', 'w', 1, h.ctx)
    expect(h.getText()).toBe('hello \nnext')
    expect(h.getRegister().value).toBe('world')

    const hYank = makeCtx('hello world\nnext', 6)
    executeOperatorMotion('yank', 'W', 1, hYank.ctx)
    expect(hYank.getRegister().value).toBe('world')
  })
})

describe('Vim visual p with linewise register over char selection (2.1.314 #1406)', () => {
  test('p over char selection inserts linewise register with surrounding newlines', () => {
    const h = makeCtx('alpha beta gamma', 6)
    h.ctx.setRegister('LINE\n', true)
    const res = visualTransition(
      { type: 'idle' },
      'p',
      6,
      false, // char selection covering 'b' (anchor=6, cursor=6)
      h.ctx,
    )
    expect(res.exitVisual).toBe(true)
    res.execute?.()
    expect(h.getText()).toBe('alpha \nLINE\neta gamma')
    expect(h.getRegister()).toEqual({ value: 'b', linewise: false })
  })

  test('executeVisualPaste over linewise selection replaces lines', () => {
    const h = makeCtx('one\ntwo\nthree', 4)
    h.ctx.setRegister('TWO\n', true)
    executeVisualPaste(4, h.ctx, true)
    expect(h.getText()).toBe('one\nTWO\nthree')
    expect(h.getRegister()).toEqual({ value: 'two\n', linewise: true })
  })
})

describe('Vim aw/iw at end of line (2.1.314 #1407)', () => {
  test('aw and iw at end of line do not consume the line break', () => {
    const text = 'hello world\nnext'
    // cursor on 'd' of 'world' (offset 10)
    const iw = findTextObject(text, 10, 'w', true)
    expect(iw).not.toBeNull()
    expect(text.slice(iw!.start, iw!.end)).toBe('world')

    const aw = findTextObject(text, 10, 'w', false)
    expect(aw).not.toBeNull()
    // Includes preceding space on the same line, NOT the '\n' after 'world'
    expect(text.slice(aw!.start, aw!.end)).toBe(' world')
  })
})
