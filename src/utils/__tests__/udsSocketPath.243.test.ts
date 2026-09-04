/**
 * densable 2.1.243 #18 — inbox sockets root is XDG_RUNTIME_DIR /
 * CLAUDE_CODE_TMPDIR (userns/rootless own that dir). File-in-the-way → Vi.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  assertValidUnixSocketPath,
  getDefaultUdsSocketPath,
  getUdsRuntimeDir,
  startUdsMessaging,
  stopUdsMessaging,
  UDS_SOCKETS_PATH_HINT,
  UDS_SOCKETS_PATH_NOT_A_DIRECTORY,
  UDS_SOCKETS_PATH_SYMLINK_LOOP,
} from '../udsMessaging.js'

const src = readFileSync(join(import.meta.dir, '../udsMessaging.ts'), 'utf8')

describe('densable 2.1.243 #18 inbox sockets path / userns', () => {
  const prevXdg = process.env.XDG_RUNTIME_DIR
  const prevTmp = process.env.CLAUDE_CODE_TMPDIR

  afterEach(async () => {
    await stopUdsMessaging()
    if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = prevXdg
    if (prevTmp === undefined) delete process.env.CLAUDE_CODE_TMPDIR
    else process.env.CLAUDE_CODE_TMPDIR = prevTmp
  })

  test('official Vi/qi/In strings and XDG-first root', () => {
    expect(UDS_SOCKETS_PATH_HINT).toBe(
      'Point XDG_RUNTIME_DIR or CLAUDE_CODE_TMPDIR at a private (0700) directory you own to use a different location.',
    )
    expect(UDS_SOCKETS_PATH_NOT_A_DIRECTORY).toBe(
      `A component of the sockets path is not a directory (a regular file is in the way). ${UDS_SOCKETS_PATH_HINT}`,
    )
    expect(UDS_SOCKETS_PATH_SYMLINK_LOOP).toBe(
      `The sockets path runs through a symlink loop. ${UDS_SOCKETS_PATH_HINT}`,
    )
    expect(src).toContain('process.env.XDG_RUNTIME_DIR')
    expect(src).toContain('process.env.CLAUDE_CODE_TMPDIR')
    expect(src).toContain('async function walkSocketsPathComponents')
    expect(src).toContain('max ~')
    expect(src).toContain('MAX_UNIX_SOCKET_PATH_LENGTH')
  })

  test('getUdsRuntimeDir prefers XDG_RUNTIME_DIR then CLAUDE_CODE_TMPDIR', () => {
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), 'xdg-owned-243')
    delete process.env.CLAUDE_CODE_TMPDIR
    expect(getUdsRuntimeDir()).toBe(process.env.XDG_RUNTIME_DIR)

    delete process.env.XDG_RUNTIME_DIR
    process.env.CLAUDE_CODE_TMPDIR = join(tmpdir(), 'cc-tmpdir-243')
    expect(getUdsRuntimeDir()).toBe(process.env.CLAUDE_CODE_TMPDIR)
  })

  test('Unix default path is under the runtime root + cc-socks leaf', async () => {
    if (process.platform === 'win32') return
    await stopUdsMessaging()
    const root = await mkdtemp(join(tmpdir(), 'uds-xdg-243-'))
    process.env.XDG_RUNTIME_DIR = root
    delete process.env.CLAUDE_CODE_TMPDIR
    const path = getDefaultUdsSocketPath()
    expect(path.startsWith(root)).toBe(true)
    expect(path).toContain('cc-socks')
    expect(path.endsWith('messaging.sock')).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  test('ENAMETOOLONG wording points at TMPDIR / XDG_RUNTIME_DIR', () => {
    if (process.platform === 'win32') return
    const longPath = `/tmp/${'x'.repeat(200)}.sock`
    expect(() => assertValidUnixSocketPath(longPath)).toThrow(/max ~104/)
    expect(() => assertValidUnixSocketPath(longPath)).toThrow(
      /CLAUDE_CODE_TMPDIR or \$XDG_RUNTIME_DIR/,
    )
  })

  test('a regular file in the sockets path throws official Vi', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'uds-vi-243-'))
    const blocker = join(dir, 'not-a-dir')
    await writeFile(blocker, 'in-the-way')
    const path = join(blocker, 'messaging.sock')
    await expect(
      startUdsMessaging(path, { isExplicit: true, requireAuth: false }),
    ).rejects.toThrow(UDS_SOCKETS_PATH_NOT_A_DIRECTORY)
    await rm(dir, { recursive: true, force: true })
  })
})
