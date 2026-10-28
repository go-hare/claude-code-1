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
    // gold Oa @207919407 / 2.1.312 Pl: [T, N], getDerived. Local clip
    // (`58f3d6d3`) keeps ● out of flow so wrap-stream height 0 hides it.
    expect(streaming).not.toMatch(/flexGrow=\{1\}/)
    expect(streaming).toContain('aria-label="claude:"')
    expect(streaming).toContain('store.getDerived')
    expect(streaming).toContain('transcriptV2 === undefined && (')
    expect(streaming).toContain(
      '<Box flexDirection="row" overflow="hidden" position="relative">',
    )
    expect(streaming).toContain('<Box minWidth={2} position="absolute">')
    expect(streaming).toContain('<Box flexDirection="column" paddingLeft={2}>')
    expect(streaming).toContain('position="absolute"')
    expect(streaming).toContain('paddingLeft={2}')
    const md = readFileSync(join(import.meta.dir, '../../Markdown.tsx'), 'utf8')
    expect(md).toContain('peekCliHighlight')
    expect(md).not.toContain('<Suspense')
    expect(md).not.toContain('getCliHighlightPromise')
    expect(md).not.toContain('MarkdownWithHighlight')
    const hl = readFileSync(
      join(import.meta.dir, '../../../utils/cliHighlight.ts'),
      'utf8',
    )
    expect(hl).toContain("import * as cliHighlight from 'cli-highlight'")
    expect(hl).not.toContain("await import('cli-highlight')")
  })
})
