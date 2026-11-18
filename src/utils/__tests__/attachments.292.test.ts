import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('2.1.292 #228 attachments stat before walkPermissionPaths', () => {
  let tempRoot: string
  let linkCwd: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'att-228-'))
    const realCwd = join(tempRoot, 'real-cwd')
    mkdirSync(realCwd, { recursive: true })
    writeFileSync(join(realCwd, 'existing.txt'), 'hello\n')
    linkCwd = join(tempRoot, 'link-cwd')
    symlinkSync(realCwd, linkCwd)
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('attachments.ts calls stat(absoluteFilename) before walkPermissionPaths', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '..', 'attachments.ts'),
    ).text()
    const statIdx = src.indexOf('stats = await stat(absoluteFilename)')
    const walkIdx = src.indexOf(
      'const walked = walkPermissionPaths(absoluteFilename)',
    )
    expect(statIdx).toBeGreaterThan(-1)
    expect(walkIdx).toBeGreaterThan(-1)
    expect(statIdx).toBeLessThan(walkIdx)
    expect(src).toContain('if (isENOENT(statError))')
  })

  test('stat on non-existent @-word under symlinked cwd throws ENOENT before walkPermissionPaths', async () => {
    const { stat } = await import('fs/promises')
    const { isENOENT } = await import('../errors.js')
    const missing = join(linkCwd, 'nonexistent-at-word')
    let caught: unknown
    try {
      await stat(missing)
    } catch (e) {
      caught = e
    }
    expect(isENOENT(caught)).toBe(true)
  })
})
