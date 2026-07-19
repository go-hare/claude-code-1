import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'

describe('listRoutines', () => {
  const prev = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prev
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('returns empty when no routines dirs', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rtn-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const { listRoutines } = await import('../routines.js')
    expect(listRoutines()).toEqual([])
  })

  test('loads markdown routines from user dir', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rtn-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    const routinesDir = join(dir, 'routines')
    mkdirSync(routinesDir, { recursive: true })
    writeFileSync(
      join(routinesDir, 'nightly.md'),
      '---\ndescription: Nightly cleanup\n---\nDo cleanup\n',
    )
    const { listRoutines, loadRoutine } = await import('../routines.js')
    const all = listRoutines()
    expect(all.some(r => r.name === 'nightly')).toBe(true)
    expect(loadRoutine('nightly')?.description).toContain('Nightly')
  })
})
