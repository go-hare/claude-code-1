/**
 * densable 2.1.216 #6 — vim c-operator + paste dot-repeat (Poa / Hmn / F).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isChangeOperatorRecord, type RecordedChange } from '../types.js'

const ROOT = join(import.meta.dir, '../..')

describe('isChangeOperatorRecord densable Poa', () => {
  test('change operators are true', () => {
    expect(
      isChangeOperatorRecord({
        type: 'operator',
        op: 'change',
        motion: 'w',
        count: 1,
      }),
    ).toBe(true)
    expect(
      isChangeOperatorRecord({
        type: 'operatorFind',
        op: 'change',
        find: 'f',
        char: 'x',
        count: 1,
      }),
    ).toBe(true)
    expect(
      isChangeOperatorRecord({
        type: 'operatorTextObj',
        op: 'change',
        objType: 'w',
        scope: 'inner',
        count: 1,
      }),
    ).toBe(true)
    expect(
      isChangeOperatorRecord({ type: 'openLine', direction: 'below' }),
    ).toBe(true)
  })

  test('delete/yank/insert/paste are false', () => {
    expect(
      isChangeOperatorRecord({
        type: 'operator',
        op: 'delete',
        motion: 'w',
        count: 1,
      }),
    ).toBe(false)
    expect(isChangeOperatorRecord({ type: 'insert', text: 'x' })).toBe(false)
    expect(
      isChangeOperatorRecord({ type: 'paste', after: true, count: 1 }),
    ).toBe(false)
    expect(isChangeOperatorRecord(null)).toBe(false)
  })
})

describe('RecordedChange densable 216 shapes', () => {
  test('operator may carry insertedText; paste + visualChange exist', () => {
    const withInsert: RecordedChange = {
      type: 'operator',
      op: 'change',
      motion: 'w',
      count: 1,
      insertedText: 'hello',
    }
    expect(withInsert.insertedText).toBe('hello')
    const paste: RecordedChange = { type: 'paste', after: true, count: 2 }
    expect(paste.type).toBe('paste')
    const vc: RecordedChange = {
      type: 'visualChange',
      from: 0,
      to: 1,
      linewise: false,
      text: 'z',
    }
    expect(vc.type).toBe('visualChange')
  })
})

describe('source contracts densable Hmn / Poa merge', () => {
  test('executePaste records type paste', () => {
    const src = readFileSync(join(ROOT, 'vim/operators.ts'), 'utf8')
    expect(src).toContain("type: 'paste'")
    expect(src).toContain("recordChange({ type: 'paste'")
  })

  test('useVimInput merges insertedText on change-op Esc', () => {
    const src = readFileSync(join(ROOT, 'hooks/useVimInput.ts'), 'utf8')
    expect(src).toContain('isChangeOperatorRecord')
    expect(src).toContain('changeOpEnteredInsertRef')
    expect(src).toContain('insertedText')
    expect(src).toContain("case 'paste'")
  })
})
