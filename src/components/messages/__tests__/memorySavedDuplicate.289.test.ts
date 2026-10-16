import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 memory_saved Saved banner', () => {
  test('Pg file rows only when verbose || transcript', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SystemTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('verbose={verbose || !!isTranscriptMode}')
    expect(src).toContain(
      '{verbose ? writtenPaths.map(p => <MemoryFileRow key={p} path={p} />) : null}',
    )
    expect(src).toContain('aria-hidden')
  })

  test('stopHooks skips extractMemories on internal querySource', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../query/stopHooks.ts'),
      'utf8',
    )
    expect(src).toContain('isInternalExtractQuerySource(querySource)')
    expect(src).toContain("querySource === 'away_summary'")
    expect(src).toContain("querySource === 'extract_memories'")
    expect(src).not.toContain('export function isInternalExtractQuerySource')
  })

  test('extractMemories skips a second Saved banner for the same paths', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../services/extractMemories/extractMemories.ts',
      ),
      'utf8',
    )
    expect(src).toContain('lastAnnouncedMemoryKey')
    expect(src).toContain('skipping Saved banner')
  })
})
