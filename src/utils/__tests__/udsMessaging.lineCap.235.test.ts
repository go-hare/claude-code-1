/**
 * densable 2.1.235 #17 — X1r=1048576 send refuse (tFd/yZt) + recv drop.
 *
 * Do not mock.module udsClient/udsMessaging (process-global pollution).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createConnection } from 'node:net'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  drainInbox,
  isUdsMessageTooLargeError,
  MAX_UDS_LINE_BYTES,
  MAX_UDS_LINE_CHARS,
  setOnEnqueue,
  startUdsMessaging,
  stopUdsMessaging,
  UdsMessageTooLargeError,
  UDS_MESSAGE_TOO_LARGE_ERROR_CLASS,
} from '../udsMessaging.js'
import { sendToUdsSocket } from '../udsClient.js'

let previousConfigDir: string | undefined
let tempConfigDir = ''
const socketParents: string[] = []

async function socketPath(label: string): Promise<string> {
  const suffix = `${process.pid}-${Math.random().toString(16).slice(2)}-${label}`
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\claude-code-test-linecap-${suffix}`
  }
  // Unique private parent per test — avoid sticky broad-perm dirs under /tmp.
  const parent = await mkdtemp(
    join(
      process.platform === 'darwin' ? '/tmp' : tmpdir(),
      `claude-uds-linecap-${label}-`,
    ),
  )
  await chmod(parent, 0o700)
  socketParents.push(parent)
  return join(parent, `${suffix}.sock`)
}

/** Resolve once the server has enqueued a message, so drainInbox sees it. */
async function waitForEnqueue(send: () => Promise<void>): Promise<void> {
  let resolveDone: (() => void) | undefined
  const done = new Promise<void>(resolve => {
    resolveDone = resolve
  })
  setOnEnqueue(() => resolveDone?.())
  await send()
  await Promise.race([
    done,
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error('Timed out waiting for enqueue')),
        5_000,
      ),
    ),
  ])
}

beforeEach(async () => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  tempConfigDir = await mkdtemp(join(tmpdir(), 'uds-linecap-home-'))
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
})

afterEach(async () => {
  setOnEnqueue(null)
  drainInbox()
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
  while (socketParents.length > 0) {
    const parent = socketParents.pop()
    if (parent) await rm(parent, { recursive: true, force: true })
  }
})

describe('densable 2.1.235 #17 UDS line cap (X1r/tFd/yZt)', () => {
  test('MAX_UDS_LINE_CHARS is densable X1r=1048576', () => {
    expect(MAX_UDS_LINE_CHARS).toBe(1_048_576)
  })

  test('tFd/UdsMessageTooLargeError message + errorClass match SEA exactly', () => {
    const n = 1_048_577
    const err = new UdsMessageTooLargeError(n, MAX_UDS_LINE_CHARS)
    expect(err.errorClass).toBe('message_too_large')
    expect(err.errorClass).toBe(UDS_MESSAGE_TOO_LARGE_ERROR_CLASS)
    expect(err.code).toBe('cross-session message exceeds the line cap')
    expect(err.message).toBe(
      `Message too large for cross-session delivery: the serialized message is ${n.toLocaleString('en-US')} characters and the limit is ${MAX_UDS_LINE_CHARS.toLocaleString('en-US')}. Shorten the message text — put bulk content in a file the recipient can read rather than in the message — or split it into smaller messages.`,
    )
    expect(isUdsMessageTooLargeError(err)).toBe(true)
    expect(isUdsMessageTooLargeError(new Error('nope'))).toBe(false)
  })

  test('recv drop log gold is wired in udsMessaging (SEA Line exceeded X1r)', async () => {
    const src = await readFile(
      new URL('../udsMessaging.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain(
      '`[uds-messaging] Line exceeded ${MAX_UDS_LINE_BYTES} bytes; dropping connection`',
    )
    expect(src).toContain('maxFrameBytes: MAX_UDS_LINE_BYTES')
  })

  test('recv byte budget covers the widest UTF-8 encoding of an X1r line', () => {
    // The framer counts bytes off the socket while the send refuse counts
    // UTF-16 code units, so the receive budget must absorb UTF-8's worst case
    // (3 bytes per unit) or multibyte lines would pass send and then be dropped.
    expect(MAX_UDS_LINE_BYTES).toBe(3 * MAX_UDS_LINE_CHARS)

    const widest = '中'.repeat(MAX_UDS_LINE_CHARS)
    expect(widest.length).toBe(MAX_UDS_LINE_CHARS)
    expect(Buffer.byteLength(widest, 'utf8')).toBeLessThanOrEqual(
      MAX_UDS_LINE_BYTES,
    )
  })

  test('multibyte body under X1r is delivered, not silently dropped', async () => {
    const path = await socketPath('multibyte-ok')
    await startUdsMessaging(path, { isExplicit: true })

    // Well under the char cap but over it once encoded as UTF-8 (3 bytes each),
    // which is exactly the range the old chars-vs-bytes mismatch swallowed.
    const body = '中'.repeat(400_000)
    expect(body.length).toBeLessThan(MAX_UDS_LINE_CHARS)
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MAX_UDS_LINE_CHARS)

    await waitForEnqueue(async () => {
      await sendToUdsSocket(path, body)
    })

    const drained = drainInbox()
    expect(drained).toHaveLength(1)
    const data = drained[0]?.message.data
    expect(typeof data).toBe('string')
    // Compare sizes, not contents — a mismatch here must not dump 1.2MB.
    expect(String(data).length).toBeGreaterThanOrEqual(body.length)
    expect(String(data).endsWith(`${body}\n</cross-session-message>`)).toBe(
      true,
    )
  })

  test('sendToUdsSocket refuses oversized wire before framed delivery (yZt / tFd)', async () => {
    const path = await socketPath('send-refuse')
    await startUdsMessaging(path, { isExplicit: true })

    // Body alone at X1r forces JSON+meta+newline over the line cap.
    const huge = 'x'.repeat(MAX_UDS_LINE_CHARS)
    let caught: unknown
    try {
      await sendToUdsSocket(path, huge)
    } catch (e) {
      caught = e
    }

    expect(isUdsMessageTooLargeError(caught)).toBe(true)
    if (!isUdsMessageTooLargeError(caught)) {
      throw new Error('expected UdsMessageTooLargeError')
    }
    expect(caught.errorClass).toBe('message_too_large')
    expect(caught.code).toBe('cross-session message exceeds the line cap')
    expect(caught.message).toContain(
      'Message too large for cross-session delivery: the serialized message is ',
    )
    expect(caught.message).toContain(
      ` and the limit is ${MAX_UDS_LINE_CHARS.toLocaleString('en-US')}.`,
    )
    expect(caught.message).toContain(
      'Shorten the message text — put bulk content in a file the recipient can read rather than in the message — or split it into smaller messages.',
    )
    expect(caught.serializedChars).toBeGreaterThan(MAX_UDS_LINE_CHARS)
    // Refuse is before createConnection write path — inbox stays empty.
    expect(drainInbox()).toEqual([])
  })

  test('recv path drops connection when line exceeds X1r (no inbox enqueue)', async () => {
    const path = await socketPath('recv-drop')
    await startUdsMessaging(path, { isExplicit: true })

    await new Promise<void>((resolve, reject) => {
      const conn = createConnection(path, () => {
        conn.write('x'.repeat(MAX_UDS_LINE_CHARS + 1))
      })
      conn.setTimeout(5_000, () => {
        conn.destroy()
        reject(new Error('Timed out waiting for X1r recv drop'))
      })
      conn.on('close', () => resolve())
      conn.on('error', () => resolve())
    })

    expect(drainInbox()).toEqual([])
  })
})
