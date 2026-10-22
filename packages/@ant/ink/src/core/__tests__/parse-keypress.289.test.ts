/**
 * densable 2.1.289 — gold `Wy` / `mx` / `px`.
 * `g==="[P"&&x===0&&mx()?"delete":Ex[g]`
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { setClipboardAttacherCapsGetter } from '../termio/osc.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
} from '../parse-keypress.js'

const SRC = join(import.meta.dir, '../parse-keypress.ts')
const savedTerm = process.env.TERM

afterEach(() => {
  if (savedTerm === undefined) delete process.env.TERM
  else process.env.TERM = savedTerm
  setClipboardAttacherCapsGetter(null)
})

function asKey(item: unknown): ParsedKey {
  expect((item as ParsedKey).kind).toBe('key')
  return item as ParsedKey
}

describe('densable 2.1.289 Wy / mx / px', () => {
  test('source is Wy then mx st / px rxvt; [P] maps delete only on st', async () => {
    const src = await Bun.file(SRC).text()
    expect(src).toContain('function Wy(): string | null')
    expect(src).toContain("return Wy() === 'st'")
    expect(src).toContain("return Wy() === 'rxvt'")
    expect(src).toContain(
      "code === '[P' && modifier === 0 && isStTerm() ? 'delete' : keyName[code]",
    )
  })

  test('TERM=st CSI [P is delete; TERM=xterm is not', () => {
    process.env.TERM = 'st'
    const [stItems] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[P')
    expect(asKey(stItems[0]).name).toBe('delete')

    process.env.TERM = 'xterm'
    const [xItems] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[P')
    expect(asKey(xItems[0]).name).not.toBe('delete')
  })

  test('attacher keyDialect st wins over TERM=xterm', () => {
    process.env.TERM = 'xterm'
    setClipboardAttacherCapsGetter(() => ({ keyDialect: 'st' }))
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[P')
    expect(asKey(items[0]).name).toBe('delete')
  })
})
