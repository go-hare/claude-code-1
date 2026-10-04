import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('assistant gold row @202887955', () => {
  test('completed markdown is one [dot, column] row; streaming yi keeps an inner row', () => {
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
    // gold @202887955: completed has no extra inner row wrapping bullet+column.
    expect(completed).not.toMatch(/<Box flexDirection="row">\s*<NoSelect/)
    // gold yi @203236672: outer 100% row, inner [dot, column], no flexGrow.
    expect(streaming).not.toMatch(/flexGrow=\{1\}/)
    expect(streaming).toContain('aria-label="claude:"')
    expect(streaming).toContain('<Box flexDirection="column" paddingLeft={2}>')
    expect(streaming).toContain(
      '<Box flexDirection="row" overflow="hidden" position="relative">',
    )
    expect(streaming).toMatch(
      /width="100%"[\s\S]*<Box flexDirection="row" overflow="hidden" position="relative">[\s\S]*minWidth=\{2\}/,
    )
    expect(streaming).toContain('position="absolute"')
    expect(streaming).toContain('paddingLeft={2}')
  })
})
