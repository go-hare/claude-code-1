import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #96 BriefTool upload O_NOFOLLOW / handle read', () => {
  const uploadSrc = readFileSync(join(import.meta.dir, '../upload.ts'), 'utf8')

  test('opens attachment with O_NOFOLLOW | O_NOCTTY | O_NONBLOCK off Windows and checks st.isFile()', () => {
    expect(uploadSrc).toContain('O_NOFOLLOW')
    expect(uploadSrc).toContain('O_NONBLOCK')
    expect(uploadSrc).toContain('O_NOCTTY')
    expect(uploadSrc).toContain('handle.stat({ bigint: true })')
    expect(uploadSrc).toContain('st.isFile()')
    expect(uploadSrc).toContain('handle.readFile()')
    expect(uploadSrc).not.toContain('readFile(fullPath)')
  })
})
