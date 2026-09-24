/**
 * densable 2.1.251 #6 — UWt / DH / ao / Ut / I / aV (no /proc/self/fd ancestor walk).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  approvedPathSetFor,
  clearApprovedFileToolPathsForTests,
  collectSymlinkHops,
  isProcFdPath,
  noteApprovedFileToolPath,
  openApprovedRead,
  openApprovedWrite,
  refusingReadAfterPermissionMessage,
  refusingSymlinkLeafWriteMessage,
  refusingWriteAfterPermissionMessage,
  takeApprovedFileToolPath,
} from '../fileToolApprovedOpen.js'

async function trySymlink(
  target: string,
  path: string,
  type?: 'dir' | 'file',
): Promise<boolean> {
  try {
    await symlink(target, path, type)
    return true
  } catch {
    return false
  }
}

describe('densable 2.1.251 #6 fileToolApprovedOpen', () => {
  const roots: string[] = []
  afterEach(async () => {
    clearApprovedFileToolPathsForTests()
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  async function tmp(prefix = 'uwt-'): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), prefix))
    roots.push(d)
    return d
  }

  test('I message is the gold parent-directory sentence', () => {
    expect(refusingWriteAfterPermissionMessage('/x')).toBe(
      'Refusing to write /x: its parent-directory symlink resolution changed after permission was checked.',
    )
  })

  test('H message keeps the concurrent-retry tail', () => {
    expect(refusingReadAfterPermissionMessage('/x')).toContain(
      'its symlink resolution changed after permission was checked',
    )
    expect(refusingReadAfterPermissionMessage('/x')).toContain(
      'rewritten concurrently',
    )
  })

  test('Ut detects /proc/self/fd and this-pid /proc/pid/fd leaves only', () => {
    expect(isProcFdPath('/proc/self/fd/3')).toBe(true)
    expect(isProcFdPath(`/proc/${process.pid}/fd/7`)).toBe(true)
    expect(isProcFdPath(`/proc/${process.pid + 1}/fd/7`)).toBe(false)
    expect(isProcFdPath('/home/user/file')).toBe(false)
  })

  test('ao collects symlink hops of the user path (cap), not /proc/self/fd parents', async () => {
    const root = await tmp()
    const real = join(root, 'real.txt')
    await writeFile(real, 'body')
    const link = join(root, 'link.txt')
    if (!(await trySymlink(real, link, 'file'))) return
    const hops = collectSymlinkHops(link)
    expect(hops).toContain(link)
    expect(hops).toContain(real)
    expect(hops.some(h => h.startsWith('/proc/self/fd'))).toBe(false)
  })

  test('UWt refuses when a hop left the approved set after permission', async () => {
    const root = await tmp()
    const a = join(root, 'a.txt')
    const b = join(root, 'b.txt')
    await writeFile(a, 'a')
    await writeFile(b, 'b')
    const link = join(root, 'swap.txt')
    if (!(await trySymlink(a, link, 'file'))) return

    noteApprovedFileToolPath(link)
    const approved = takeApprovedFileToolPath(link)
    await rm(link)
    if (!(await trySymlink(b, link, 'file'))) return

    await expect(openApprovedRead(link, approved)).rejects.toThrow(
      refusingReadAfterPermissionMessage(link),
    )
  })

  test('UWt opens a plain file and returns a readable handle', async () => {
    const root = await tmp()
    const file = join(root, 'plain.txt')
    await writeFile(file, 'hello-uwt')
    noteApprovedFileToolPath(file)
    const approved = takeApprovedFileToolPath(file)
    const opened = await openApprovedRead(file, approved)
    try {
      const text = await readFile(opened.ioPath, 'utf8')
      expect(text).toBe('hello-uwt')
      // win32 realpath may expand 8.3 (ADMINI~1) — compare via read content only
      expect(opened.canonicalPath.toLowerCase()).toContain('plain.txt')
    } finally {
      await opened.close()
    }
  })

  test('DH refuses writing a symbolic-link leaf', async () => {
    if (process.platform === 'win32') return
    const root = await tmp()
    const real = join(root, 'real-leaf.txt')
    await writeFile(real, 'x')
    const link = join(root, 'leaf-link.txt')
    if (!(await trySymlink(real, link, 'file'))) return
    const approved = approvedPathSetFor(link)
    await expect(openApprovedWrite(link, approved)).rejects.toThrow(
      refusingSymlinkLeafWriteMessage(link),
    )
  })

  test('DH leaf:replace rechecks dirname hops joined with the leaf', async () => {
    const root = await tmp()
    await mkdir(join(root, 'dir'))
    const file = join(root, 'dir', 't.txt')
    await writeFile(file, 'old')
    noteApprovedFileToolPath(file)
    const approved = takeApprovedFileToolPath(file)
    const opened = await openApprovedWrite(file, approved, {
      createParents: true,
      leaf: 'replace',
    })
    try {
      await opened.recheckBeforeWrite()
      await writeFile(opened.ioPath, 'new')
      expect(await readFile(file, 'utf8')).toBe('new')
    } finally {
      await opened.close()
    }
  })

  test('DH createParents makes the missing parent under the approved set', async () => {
    const root = await tmp()
    const file = join(root, 'new-nest', 'out.txt')
    // Snapshot before parents exist — ao records deepest ancestor + lexical.
    noteApprovedFileToolPath(file)
    const approved = takeApprovedFileToolPath(file)
    const opened = await openApprovedWrite(file, approved, {
      createParents: true,
    })
    try {
      await opened.recheckBeforeWrite()
      await writeFile(opened.ioPath, 'nested')
      expect(await readFile(file, 'utf8')).toBe('nested')
    } finally {
      await opened.close()
    }
  })
})
