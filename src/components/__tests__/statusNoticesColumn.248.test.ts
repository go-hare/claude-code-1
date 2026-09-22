/**
 * densable 2.1.248 #34 — startup warnings one column right of transcript.
 *
 * Gold 247 Ds @231859373 sha=582c619653911cdc:
 *   l(d,{flexDirection:"column",paddingLeft:1,children:[At.warnings.map(...)
 * Gold 248 Fr @201575834 sha=0fa3ee49235f4963:
 *   r(o,{flexDirection:"column",children:[qt.warnings.map(...)
 * Unique delta: drop paddingLeft:1 on the warnings column wrapper.
 * Gp icon width:2 and slot paddingLeft:Cg?1:2 are unchanged — not this bullet.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../StatusNotices.tsx'), 'utf8')

describe('densable 2.1.248 #34 StatusNotices warnings column', () => {
  test('official Fr warnings wrap is flexDirection column with no paddingLeft', () => {
    expect(src).toContain('<Box flexDirection="column">')
    expect(src).not.toContain('paddingLeft={1}')
    expect(src).not.toContain('paddingLeft={2}')
    expect(src).not.toContain('paddingLeft={0}')
  })
})
