import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('assistant gold row @202887955', () => {
  test('completed and streaming markdown columns have no flexGrow (gold yi)', () => {
    const completed = readFileSync(
      join(import.meta.dir, '../AssistantTextMessage.tsx'),
      'utf8',
    )
    const streaming = readFileSync(
      join(import.meta.dir, '../../StreamingTextPreview.tsx'),
      'utf8',
    )
    expect(completed).toContain('flexDirection="row"')
    expect(completed).toContain('width="100%"')
    expect(completed).toContain('alignItems="flex-start"')
    expect(completed).toContain('aria-label="claude:"')
    expect(completed).toContain('<Box flexDirection="column">')
    expect(completed).not.toMatch(/flexGrow=\{1\}/)
    expect(completed).not.toContain('justifyContent')
    // gold yi @203236672 column is flexDirection column only — no flexGrow.
    expect(streaming).not.toMatch(/flexGrow=\{1\}/)
    expect(streaming).toContain('aria-label="claude:"')
    expect(streaming).toContain('<Box flexDirection="column">')
  })
})
