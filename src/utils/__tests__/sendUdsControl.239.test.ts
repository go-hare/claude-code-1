/**
 * densable 2.1.239 #58 — receipt / idle-notice go through official cmp
 * (`sendUdsControl`: ELe + IWd/mti + noFollowSymlink + expectPeerPid).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchPeerReceipt } from '../peerReceipts.js'
import { sendUdsControl, UdsControlSendError } from '../udsClient.js'

const UNC = '\\\\server\\share\\x.sock'

describe('sendUdsControl (official cmp / Tli)', () => {
  test('non-local UNC refuses before connect', async () => {
    const err = await sendUdsControl(UNC, {
      action: 'peer_message_status',
    }).then(
      () => null,
      e => e as Error,
    )
    expect(err).toBeInstanceOf(UdsControlSendError)
    expect(err?.message).toContain('Refusing to connect to non-local IPC path')
    expect((err as UdsControlSendError).code).toBe('non-local')
  })

  test('unix symlink reply target is refused', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'cc-cmp-symlink-'))
    await chmod(dir, 0o700)
    const real = join(dir, 'real.sock')
    const link = join(dir, 'link.sock')
    await writeFile(real, 'x')
    await symlink(real, link)
    try {
      const err = await sendUdsControl(link, {
        action: 'peer_idle_notice',
      }).then(
        () => null,
        e => e as Error,
      )
      expect(err).toBeInstanceOf(UdsControlSendError)
      expect(err?.message).toContain('reply target is a symlink')
      expect((err as UdsControlSendError).code).toBe('symlink')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('silent peer resolves on close without waiting for a reply frame', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'cc-cmp-silent-'))
    await chmod(dir, 0o700)
    const sock = join(dir, 's.sock')
    const server = createServer(c => {
      c.on('data', () => {})
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(sock, () => resolve())
    })
    try {
      const start = Date.now()
      await sendUdsControl(sock, { action: 'peer_idle_notice' })
      expect(Date.now() - start).toBeLessThan(2000)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('unix expectPeerPid fail-closed on connect', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'cc-cmp-pid-'))
    await chmod(dir, 0o700)
    const sock = join(dir, 's.sock')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(sock, () => resolve())
    })
    try {
      const err = await sendUdsControl(
        sock,
        { action: 'peer_message_status' },
        { expectPeerPid: 1 },
      ).then(
        () => null,
        e => e as Error,
      )
      expect(err).toBeInstanceOf(UdsControlSendError)
      expect(['endpoint-unverifiable', 'wrong-endpoint']).toContain(
        (err as UdsControlSendError).code,
      )
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('receipt / idle wire onto sendUdsControl', () => {
  test('source-lock: receipt and idle no longer token-gate via IWd-lite', () => {
    const messaging = readFileSync(
      join(import.meta.dir, '../udsMessaging.ts'),
      'utf8',
    )
    const idle = readFileSync(
      join(import.meta.dir, '../udsIdleNotify.ts'),
      'utf8',
    )
    expect(messaging).toContain('sendUdsControl')
    expect(messaging).not.toMatch(/readUdsCapabilityToken\(target\)/)
    expect(idle).toContain('sendUdsControl')
    expect(idle).not.toContain('readUdsCapabilityToken')
    expect(idle).not.toContain('sendUdsMessage')
  })

  test('dispatchPeerReceipt passes expectPeerPid from verifiedPeerPid', async () => {
    const sent: Array<{ expectPeerPid?: number }> = []
    dispatchPeerReceipt({
      message: {
        origin: {
          kind: 'peer',
          from: 'uds:/tmp/peer.sock',
          msg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          verifiedPeerPid: 4242,
        },
      },
      status: 'held',
      ownSocketPath: '/tmp/own.sock',
      from: 'uds:/tmp/own.sock',
      vetReplyAddress: from => (from.startsWith('uds:') ? from.slice(4) : from),
      send: async (_target, _fields, sendOpts) => {
        sent.push({ expectPeerPid: sendOpts?.expectPeerPid })
      },
    })
    await Bun.sleep(0)
    expect(sent).toEqual([{ expectPeerPid: 4242 }])
  })
})
