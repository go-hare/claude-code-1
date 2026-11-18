import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('2.1.292 #225 /add-dir single-line input & key name guard', () => {
  const src = readFileSync(
    join(import.meta.dir, '../AddWorkspaceDirectory.tsx'),
    'utf8',
  )

  test('strips CR/LF via inputFilter so Shift+Enter and pastes cannot insert newlines', () => {
    expect(src).toContain('function stripNewlines(input: string): string')
    expect(src).toContain("input.replace(/[\\r\\n]/g, '')")
    expect(src).toContain('inputFilter={stripNewlines}')
  })

  test('uses e.name instead of e.key for tab/up/down so fast-typed "tab", "up", "down" insert text', () => {
    expect(src).toContain("e.name === 'tab'")
    expect(src).toContain("e.name === 'up'")
    expect(src).toContain("e.name === 'down'")
    expect(src).not.toContain("e.key === 'tab'")
    expect(src).not.toContain("e.key === 'up'")
    expect(src).not.toContain("e.key === 'down'")
  })
})
