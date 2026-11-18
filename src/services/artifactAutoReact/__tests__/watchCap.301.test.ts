import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('artifactAutoReact arm WATCH_CAP #712', () => {
  test('WATCH_CAP is aligned to 25 (gold BR=25)', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'arm.ts'), 'utf8')
    expect(src).toContain('const WATCH_CAP = 25')
    expect(src).not.toContain('const WATCH_CAP = 5\n')
  })
})
