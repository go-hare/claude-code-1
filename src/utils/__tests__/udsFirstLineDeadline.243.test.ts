/**
 * densable 2.1.243 #57 — inbox closes a connection that sends no complete
 * line within firstLineDeadlineMs (official It(), not idle-on-any-data).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  startUdsMessaging,
  stopUdsMessaging,
  UDS_FIRST_LINE_DEADLINE_MS,
} from '../udsMessaging.js'

const src = readFileSync(join(import.meta.dir, '../udsMessaging.ts'), 'utf8')

let previousConfigDir: string | undefined
let tempConfigDir = ''

function socketPath(label: string): string {
  const suffix = `${process.pid}-${Math.random().toString(16).slice(2)}-${label}`
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\claude-code-test-${suffix}`
  }
  const base =
    process.platform === 'darwin'
      ? '/tmp/claude-uds-test'
      : join(tmpdir(), 'cc-uds-test')
  return join(base, `${suffix}.sock`)
}

beforeEach(async () => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  tempConfigDir = await mkdtemp(join(tmpdir(), 'uds-first-line-243-'))
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

describe('densable 2.1.243 #57 inbox first-complete-line deadline', () => {
  test('default deadline is official 30s and It() is not socket.setTimeout idle', () => {
    expect(UDS_FIRST_LINE_DEADLINE_MS).toBe(30_000)
    expect(src).toContain(
      'Closing a connection that sent no complete line within',
    )
    expect(src).toContain('silent_connection_deadline')
    expect(src).toContain("logEvent('cross_session_inbox_auth'")
    expect(src).not.toMatch(/socket\.setTimeout\(\s*UDS_IDLE_TIMEOUT_MS/)
    expect(src).toContain('a connection that sends no complete line within')
  })

  test('connection with no complete line is destroyed at firstLineDeadlineMs', async () => {
    const path = socketPath('silent')
    await startUdsMessaging(path, {
      isExplicit: true,
      requireAuth: false,
      firstLineDeadlineMs: 250,
    })

    const closed = await new Promise<boolean>((resolve, reject) => {
      let settled = false
      let connectedAt = 0
      const conn = createConnection(path)
      const fail = setTimeout(() => {
        if (settled) return
        settled = true
        conn.destroy()
        reject(
          new Error('silent connection was not closed by first-line deadline'),
        )
      }, 2_000)
      conn.on('connect', () => {
        connectedAt = Date.now()
        // Send bytes without a newline — official It() stays armed.
        conn.write('hello-without-newline')
      })
      conn.on('close', () => {
        if (settled) return
        settled = true
        clearTimeout(fail)
        const elapsed = connectedAt === 0 ? 0 : Date.now() - connectedAt
        if (elapsed >= 200 && elapsed < 1_500) resolve(true)
        else {
          reject(
            new Error(
              `closed in ${elapsed}ms after connect, expected first-line deadline`,
            ),
          )
        }
      })
      conn.on('error', () => {
        // destroy can emit error; close still follows
      })
    })
    expect(closed).toBe(true)
  })

  test('a complete line clears the deadline so the socket stays open', async () => {
    const path = socketPath('newline')
    await startUdsMessaging(path, {
      isExplicit: true,
      requireAuth: false,
      firstLineDeadlineMs: 400,
    })

    const stayedOpen = await new Promise<boolean>((resolve, reject) => {
      const conn = createConnection(path)
      const fail = setTimeout(() => {
        conn.destroy()
        reject(
          new Error('connection closed before the complete-line hold window'),
        )
      }, 2_000)
      conn.on('connect', () => {
        conn.write(`${JSON.stringify({ type: 'ping' })}\n`)
        setTimeout(() => {
          const open = !conn.destroyed
          clearTimeout(fail)
          conn.destroy()
          if (open) resolve(true)
          else
            reject(new Error('connection was destroyed after a complete line'))
        }, 550)
      })
      conn.on('error', () => {
        // pong/close after our destroy is fine
      })
    })
    expect(stayedOpen).toBe(true)
  })
})
