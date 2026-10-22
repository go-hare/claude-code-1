/**
 * densable 2.1.289 Zmn — unknown Box borderStyle draws with no border.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const BORDER = join(import.meta.dir, '../render-border.ts')

describe('densable 2.1.289 unknown Box borderStyle', () => {
  test('render-border guards missing box.top and logs', () => {
    const src = readFileSync(BORDER, 'utf8')
    expect(src).toContain('typeof box.top !==')
    expect(src).toContain('the Box is drawn with no border')
    expect(src).toContain('logForDebugging')
  })
})
