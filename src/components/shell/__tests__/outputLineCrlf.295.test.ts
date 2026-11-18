import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

describe('CRLF normalization #431', () => {
  test('OutputLine tryJsonFormatContent normalizes CRLF to LF', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dir, '../OutputLine.tsx'),
      'utf8',
    )
    expect(src).toContain(
      "const normalized = content.replace(/\\r\\n/g, '\\n');",
    )
  })

  test('LocalShellTask looksLikePrompt normalizes CRLF before splitting last line', () => {
    const src = fs.readFileSync(
      path.resolve(
        import.meta.dir,
        '../../../tasks/LocalShellTask/LocalShellTask.tsx',
      ),
      'utf8',
    )
    expect(src).toContain(
      "tail.replace(/\\r\\n/g, '\\n').trimEnd().split('\\n').pop()",
    )
  })
})
