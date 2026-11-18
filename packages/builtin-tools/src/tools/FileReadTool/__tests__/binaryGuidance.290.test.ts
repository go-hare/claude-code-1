import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #133: FileReadTool binary guidance', () => {
  test('uses exact official 325 binary file guidance message', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'FileReadTool.ts'),
      'utf8',
    )
    expect(src).toContain(
      'This tool cannot read binary files. The file appears to be a binary ${ext} file. Use a skill for this file type if one is available, or a shell command or script that can read the format.',
    )
  })
})
