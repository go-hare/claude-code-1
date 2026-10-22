/**
 * densable 2.1.289 Gqe 7th arg `l` — Ms refuse is pn(l,v,h).
 * Gold upload callers pass "Uploading an asset reads file contents".
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const GATE = join(import.meta.dir, '../uploadReadGate.ts')
const PERMS = join(
  import.meta.dir,
  '../../../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.ts',
)

describe('densable 2.1.289 Gqe pathDeniedCopy l', () => {
  test('Gqe arity includes pathDeniedCopy; Ms uses pn(l,v,h)', () => {
    const src = readFileSync(GATE, 'utf8')
    expect(src).toContain('pathDeniedCopy: string')
    expect(src).toContain("suffix = ''")
    expect(src).toContain('pn(pathDeniedCopy, wholeDeny, suffix)')
    expect(src).not.toContain(
      'pn(`Permission to read ${spelled} has been denied`, wholeDeny)',
    )
  })

  test('upload_asset Gqe passes Uploading an asset reads file contents', () => {
    const src = readFileSync(PERMS, 'utf8')
    expect(src).toContain("'Uploading an asset reads file contents'")
  })
})
