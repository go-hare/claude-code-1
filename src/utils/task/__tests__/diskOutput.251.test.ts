/**
 * densable 2.1.251 #64 — Bash output create/read: Que exclusive create
 * (O_CREAT|O_EXCL|O_NOFOLLOW / wx); XX read refuses symlink/nlink≠1 and
 * opens O_RDONLY|O_NOFOLLOW + densable vt identity recheck.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { constants as fsConstants, readFileSync } from 'fs'
import {
  link,
  mkdir,
  mkdtemp,
  open as fsOpen,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _clearOutputsForTest,
  _resetTaskOutputDirForTest,
  getTaskOutput,
  getTaskOutputSize,
  initTaskOutput,
  openTaskOutputRead,
  resolveTaskOutputReadPath,
} from '../diskOutput.js'

const dirs: string[] = []

afterEach(async () => {
  await _clearOutputsForTest()
  _resetTaskOutputDirForTest()
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-disk-251-'))
  dirs.push(dir)
  return dir
}

describe('densable 2.1.251 #64 task output XX/Que', () => {
  test('initTaskOutput Que uses O_CREAT|O_EXCL|O_NOFOLLOW / wx', () => {
    const src = readFileSync(join(import.meta.dir, '../diskOutput.ts'), 'utf8')
    expect(src).toContain("? 'wx'")
    expect(src).toContain('fsConstants.O_EXCL')
    expect(src).toContain('O_NOFOLLOW')
    expect(src).toContain('O_CREAT')
  })

  test('Shell bash file-mode create matches Que exclusive flags', () => {
    const src = readFileSync(join(import.meta.dir, '../../Shell.ts'), 'utf8')
    expect(src).toContain("? 'wx'")
    expect(src).toContain('fsConstants.O_EXCL')
    expect(src).toContain('fsConstants.O_CREAT')
    expect(src).toContain('O_NOFOLLOW')
    // no longer truncating pre-existing leaves with plain 'w'
    expect(src).not.toMatch(/\?\s*'w'\s*:/)
  })

  test('getTaskOutput / getTaskOutputSize / getStdout go through XX open-read', () => {
    const disk = readFileSync(join(import.meta.dir, '../diskOutput.ts'), 'utf8')
    const task = readFileSync(join(import.meta.dir, '../TaskOutput.ts'), 'utf8')
    expect(disk).toContain('openTaskOutputRead')
    expect(disk).toContain('tailTaskOutput(')
    expect(disk).toContain('readTaskOutputRange(')
    expect(disk).toContain('O_RDONLY')
    // densable vt post-open identity recheck
    expect(disk).toContain('export async function vt(')
    expect(disk).toContain('output file identity changed')
    expect(disk).toContain('await vt(fh, st, path')
    expect(task).toContain('openTaskOutputRead(this.path)')
  })

  test('resolveTaskOutputReadPath refuses double symlink hop', async () => {
    if (process.platform === 'win32') return
    const dir = await makeDir()
    const real = join(dir, 'real.out')
    const mid = join(dir, 'mid.out')
    const leaf = join(dir, 'leaf.out')
    await writeFile(real, 'ok')
    await symlink(real, mid)
    await symlink(mid, leaf)
    await expect(resolveTaskOutputReadPath(leaf)).rejects.toThrow(
      /not a regular nlink-1 file/,
    )
  })

  test('resolveTaskOutputReadPath refuses unix nlink≠1 hardlink leaf', async () => {
    if (process.platform === 'win32') return
    const dir = await makeDir()
    const a = join(dir, 'a.out')
    const b = join(dir, 'b.out')
    await writeFile(a, 'shared')
    try {
      await link(a, b)
    } catch {
      // some FS (FAT, certain containers) cannot hardlink
      return
    }
    await expect(resolveTaskOutputReadPath(a)).rejects.toThrow(
      /not a regular nlink-1 file/,
    )
    await expect(resolveTaskOutputReadPath(b)).rejects.toThrow(
      /not a regular nlink-1 file/,
    )
  })

  test('resolveTaskOutputReadPath follows one hop to a plain nlink-1 file', async () => {
    if (process.platform === 'win32') return
    const dir = await makeDir()
    const real = join(dir, 'transcript.txt')
    const linkPath = join(dir, 'task.output')
    await writeFile(real, 'hello-xx')
    await symlink(real, linkPath)
    await expect(resolveTaskOutputReadPath(linkPath)).resolves.toBe(real)
  })

  test('openTaskOutputRead opens a plain file and returns content via fh', async () => {
    const dir = await makeDir()
    const path = join(dir, 'plain.out')
    await writeFile(path, 'body-64')
    const fh = await openTaskOutputRead(path)
    expect(fh).not.toBeNull()
    try {
      const buf = Buffer.alloc(32)
      const { bytesRead } = await fh!.read(buf, 0, 32, 0)
      expect(buf.toString('utf8', 0, bytesRead)).toBe('body-64')
    } finally {
      await fh!.close()
    }
  })

  test('exclusive create flags refuse an already-present leaf', async () => {
    const dir = await makeDir()
    const path = join(dir, 't.output')
    await writeFile(path, 'planted')
    const flags =
      process.platform === 'win32'
        ? 'wx'
        : fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0)
    await expect(fsOpen(path, flags)).rejects.toBeDefined()
    expect(await readFile(path, 'utf8')).toBe('planted')
  })

  test('initTaskOutput creates empty exclusive file under task dir', async () => {
    const taskId = `251-excl-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const path = await initTaskOutput(taskId)
    expect(await readFile(path, 'utf8')).toBe('')
    await expect(initTaskOutput(taskId)).rejects.toBeDefined()
  })

  test('getTaskOutput returns empty when path missing', async () => {
    const id = `missing-251-${Date.now()}`
    await expect(getTaskOutput(id)).resolves.toBe('')
    await expect(getTaskOutputSize(id)).resolves.toBe(0)
  })

  test('openTaskOutputRead refuses directory leaf', async () => {
    const dir = await makeDir()
    const asDir = join(dir, 'not-file.out')
    await mkdir(asDir)
    await expect(openTaskOutputRead(asDir)).rejects.toThrow(
      /not a regular nlink-1 file/,
    )
  })
})
