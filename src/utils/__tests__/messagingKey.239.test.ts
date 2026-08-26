/**
 * densable 2.1.239 HYb / IWd — sessions/${pid}.${hash}.key + peerToken.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import {
  deriveMessagingKeyName,
  hashMessagingSocketPath,
  hasLiveRegisteredInbox,
  isMessagingLiveOwnerRequired,
  resolveMessagingCapability,
  startUdsMessaging,
  stopUdsMessaging,
} from '../udsMessaging.js'

const PEER = '0123456789abcdef0123456789abcdef'

let previousConfigDir: string | undefined
let tempConfigDir = ''

function socket(label: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\claude-key-${process.pid}-${label}`
  }
  return join(tempConfigDir, `${label}.sock`)
}

beforeEach(async () => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  tempConfigDir = await mkdtemp(join(tmpdir(), 'uds-key-239-'))
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
})

afterEach(async () => {
  await stopUdsMessaging()
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  if (tempConfigDir) {
    await rm(tempConfigDir, { recursive: true, force: true })
    tempConfigDir = ''
  }
})

describe('densable 2.1.239 HYb / IWd messaging key', () => {
  test('HYb is pid.hash.key from CWd', () => {
    const path = socket('canon')
    const digest = hashMessagingSocketPath(path)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(deriveMessagingKeyName(process.pid, path)).toBe(
      `${process.pid}.${digest}.key`,
    )
  })

  test('HYb refuses a non-canonical socket', () => {
    expect(() => deriveMessagingKeyName(1, '/tmp/a/../messaging.sock')).toThrow(
      'refusing to derive a messaging key name for a non-canonical socket path',
    )
  })

  test('mixed-case pipes share one CWd digest', () => {
    expect(hashMessagingSocketPath('\\\\.\\pipe\\ClaudeCode-1')).toBe(
      hashMessagingSocketPath('\\\\.\\pipe\\claudecode-1'),
    )
  })

  test('IWd no-key when sessions/ is missing', async () => {
    expect(await resolveMessagingCapability(socket('missing'))).toEqual({
      kind: 'no-key',
    })
  })

  test('IWd returns peerToken from a live-looking key file', async () => {
    const path = socket('live')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, deriveMessagingKeyName(process.pid, path)),
      JSON.stringify({ peerToken: PEER }),
      'utf8',
    )
    expect(await resolveMessagingCapability(path)).toEqual({
      kind: 'token',
      token: PEER,
    })
  })

  test('IWd unusable when peerToken is not 32 hex', async () => {
    const path = socket('bad')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, deriveMessagingKeyName(process.pid, path)),
      JSON.stringify({ peerToken: 'test-token' }),
      'utf8',
    )
    expect(await resolveMessagingCapability(path)).toEqual({
      kind: 'unusable',
    })
  })

  test('mti requireLiveOwner is Windows-only', () => {
    expect(isMessagingLiveOwnerRequired()).toBe(process.platform === 'win32')
    const send = readFileSync(join(import.meta.dir, '../udsClient.ts'), 'utf8')
    expect(send).toContain('isMessagingLiveOwnerRequired()')
    expect(send).toContain('requireLiveOwner:')
    expect(send).toContain("cap.kind === 'no-key'")
    expect(send).toContain('hasLiveRegisteredInbox(')
  })

  test('rvv is false when no session registry inbox matches', async () => {
    expect(await hasLiveRegisteredInbox(socket('no-reg'))).toBe(false)
  })

  test('rvv is true for a live pid.json inbox without procStart', async () => {
    const path = socket('rvv-live')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, `${process.pid}.json`),
      JSON.stringify({ messagingSocketPath: path }),
      'utf8',
    )
    expect(await hasLiveRegisteredInbox(path)).toBe(true)
  })

  test('rvv does not fall through to qS when procStart mismatches', async () => {
    const path = socket('rvv-mismatch')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, `${process.pid}.json`),
      JSON.stringify({
        messagingSocketPath: path,
        procStart: 'not-this-process-start',
      }),
      'utf8',
    )
    expect(await hasLiveRegisteredInbox(path)).toBe(false)
  })

  test('rvv skips a dead pid.json inbox', async () => {
    const path = socket('rvv-dead')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, '1000000007.json'),
      JSON.stringify({ messagingSocketPath: path }),
      'utf8',
    )
    expect(await hasLiveRegisteredInbox(path)).toBe(false)
  })

  test('cmp Windows no-key + rvv does not throw ENOINBOX', async () => {
    const path = socket('cmp-rvv')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, `${process.pid}.json`),
      JSON.stringify({ messagingSocketPath: path }),
      'utf8',
    )
    const { sendToUdsSocket, UdsUnvouchedPipeError } = await import(
      '../udsClient.js'
    )
    const err = await sendToUdsSocket(path, 'hi').then(
      () => null,
      e => e as Error,
    )
    expect(err).not.toBeInstanceOf(UdsUnvouchedPipeError)
  })

  test('IWd dead-owner when requireLiveOwner and pid is gone', async () => {
    const path = socket('dead')
    const dir = join(tempConfigDir, 'sessions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(
      join(dir, deriveMessagingKeyName(1_000_000_007, path)),
      JSON.stringify({ peerToken: PEER }),
      'utf8',
    )
    expect(
      await resolveMessagingCapability(path, { requireLiveOwner: true }),
    ).toEqual({ kind: 'dead-owner' })
  })

  test('xWd passes sweepPermitted from fBr', () => {
    const src = readFileSync(
      join(import.meta.dir, '../udsMessaging.ts'),
      'utf8',
    )
    expect(src).toContain('{ sweepPermitted }: { sweepPermitted: boolean }')
    expect(src).toContain('sweepPermitted: await isRegistrySweepPermitted()')
    expect(src).toContain('if (!permitted) return')
  })

  test('xWd publishes via od(path, json, 384) (no leftover tmp)', async () => {
    const path = socket('od')
    await startUdsMessaging(path, { isExplicit: true })
    const dir = join(tempConfigDir, 'sessions')
    const names = await readdir(dir)
    expect(names).toContain(deriveMessagingKeyName(process.pid, path))
    expect(names.filter(name => /\.key\.tmp\.[0-9a-f]+$/.test(name))).toEqual(
      [],
    )
    const cap = await resolveMessagingCapability(path)
    expect(cap.kind).toBe('token')
    if (cap.kind === 'token') {
      expect(cap.token).toMatch(/^[0-9a-f]{32}$/)
    }
  })
})
