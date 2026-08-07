/**
 * densable 2.1.216 — .claude symlink escape write guard (compat surface)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink, writeFile } from 'fs/promises'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ClaudeDirSymlinkEscapeError,
  SymlinkWriteRefusedError,
  assertProjectClaudeDirWritable,
} from '../claudeDirWriteGuard.js'

describe('assertProjectClaudeDirWritable (densable 2.1.216)', () => {
  let dir: string
  const dirs: string[] = []

  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })

  async function tmp(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'claude-dir-guard-'))
    dirs.push(dir)
    return dir
  }

  test('missing .claude is OK', async () => {
    const root = await tmp()
    await expect(assertProjectClaudeDirWritable(root)).resolves.toBeUndefined()
  })

  test('regular .claude directory is OK', async () => {
    const root = await tmp()
    await mkdir(join(root, '.claude'))
    await expect(assertProjectClaudeDirWritable(root)).resolves.toBeUndefined()
  })

  test('symlink escaping project root is refused', async () => {
    const root = await tmp()
    const outside = await tmp()
    await symlink(outside, join(root, '.claude'))
    await expect(assertProjectClaudeDirWritable(root)).rejects.toBeInstanceOf(
      SymlinkWriteRefusedError,
    )
    await expect(assertProjectClaudeDirWritable(root)).rejects.toBeInstanceOf(
      ClaudeDirSymlinkEscapeError,
    )
    await expect(assertProjectClaudeDirWritable(root)).rejects.toThrow(
      /symlinked or non-directory path/,
    )
  })

  test('symlink staying inside project is still refused by O_NOFOLLOW chain', async () => {
    // densable YNn: any symlink segment is refused (not only escape).
    const root = await tmp()
    const target = join(root, 'inner-claude')
    await mkdir(target)
    await symlink(target, join(root, '.claude'))
    await expect(assertProjectClaudeDirWritable(root)).rejects.toBeInstanceOf(
      SymlinkWriteRefusedError,
    )
  })

  test('broken symlink is refused', async () => {
    const root = await tmp()
    await symlink(join(root, 'does-not-exist'), join(root, '.claude'))
    await expect(assertProjectClaudeDirWritable(root)).rejects.toBeInstanceOf(
      SymlinkWriteRefusedError,
    )
  })

  test('file named .claude (non-symlink) is refused as non-directory', async () => {
    const root = await tmp()
    await writeFile(join(root, '.claude'), 'not-a-dir')
    await expect(assertProjectClaudeDirWritable(root)).rejects.toBeInstanceOf(
      SymlinkWriteRefusedError,
    )
  })
})
