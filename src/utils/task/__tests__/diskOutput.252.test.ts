/**
 * densable 2.1.252 hotfix #1 — Fk pinWriteTarget Mac realpath alias
 * (same device+inode) plus P recover clause on refuse.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { mkdir, mkdtemp, rm, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatTaskOutputSwapRecover, pinWriteTarget } from '../diskOutput.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-disk-252-'))
  dirs.push(dir)
  return dir
}

describe('densable 2.1.252 #1 pinWriteTarget', () => {
  test('source lock: pinWriteTarget and To recover:', () => {
    const src = readFileSync(join(import.meta.dir, '../diskOutput.ts'), 'utf8')
    expect(src).toContain('pinWriteTarget')
    expect(src).toContain('To recover:')
  })

  test('formatTaskOutputSwapRecover strips trailing slashes', () => {
    const msg = formatTaskOutputSwapRecover('/tmp/claude/')
    expect(msg).toContain('CLAUDE_CODE_TMPDIR')
    expect(msg).toContain('/tmp/claude')
    expect(msg).not.toContain('/tmp/claude/')
    expect(msg).toContain(
      'remove that entry itself (not what it points to) and restart',
    )
  })

  test('leaf symlink onto the same dir inode is treated as an alias', async () => {
    if (process.platform === 'win32') return
    const root = await makeDir()
    const a = join(root, 'A')
    await mkdir(a, { recursive: true })
    const b = join(root, 'B')
    await symlink(a, b)
    await pinWriteTarget(b)
  })

  test('symlink loop is refused with recover', async () => {
    if (process.platform === 'win32') return
    const root = await makeDir()
    const loop = join(root, 'loop')
    await symlink(loop, loop)
    try {
      await pinWriteTarget(loop)
      throw new Error('expected pinWriteTarget to refuse')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      const msg = (e as Error).message
      expect(msg).toContain(
        'task output swap refused (tasks dir moved or linked)',
      )
      expect(msg).toContain('To recover:')
      expect(msg).toContain('CLAUDE_CODE_TMPDIR')
    }
  })
})
