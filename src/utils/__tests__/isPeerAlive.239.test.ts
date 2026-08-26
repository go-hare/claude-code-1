/**
 * densable 2.1.239 ump — 250ms bare connect, ELe first, no capability/ping.
 */
import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPeerAlive } from '../udsClient.js'

describe('isPeerAlive (official ump)', () => {
  test('non-local UNC is dead without connecting', async () => {
    expect(await isPeerAlive('\\\\server\\share\\x.sock')).toBe(false)
  })

  test('connect success is alive without a capability token', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'cc-ump-'))
    await chmod(dir, 0o700)
    const sock = join(dir, 's.sock')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(sock, () => resolve())
    })
    try {
      expect(await isPeerAlive(sock)).toBe(true)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('missing socket is dead', async () => {
    if (process.platform === 'win32') return
    expect(
      await isPeerAlive(join(tmpdir(), `cc-ump-missing-${process.pid}.sock`)),
    ).toBe(false)
  })
})
