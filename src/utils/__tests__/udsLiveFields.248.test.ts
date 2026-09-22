/**
 * densable 2.1.248 leftover uds live fields — peerProtocol / jobId / status.
 * Official mapper @181016699 · register peerProtocol:_2t · tMe statusUpdatedAt.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PEER_PROTOCOL, registryJobIdFromEnv } from '../concurrentSessions.js'
import { peerSessionFromRegistry } from '../udsClient.js'

const REGISTER = readFileSync(
  join(import.meta.dir, '../concurrentSessions.ts'),
  'utf8',
)
const UDS = readFileSync(join(import.meta.dir, '../udsClient.ts'), 'utf8')

describe('densable 2.1.248 uds live record fields', () => {
  test('register stamps official _2t peerProtocol and CLAUDE_JOB_DIR jobId', () => {
    expect(PEER_PROTOCOL).toBe(1)
    expect(REGISTER).toContain('peerProtocol: PEER_PROTOCOL')
    expect(REGISTER).toContain('registryJobIdFromEnv')
    expect(REGISTER).toContain('statusUpdatedAt: now')
    expect(registryJobIdFromEnv('/tmp/jobs/abcd1234')).toBe('abcd1234')
    const prevJobDir = process.env.CLAUDE_JOB_DIR
    delete process.env.CLAUDE_JOB_DIR
    try {
      expect(registryJobIdFromEnv(undefined)).toBeUndefined()
      expect(registryJobIdFromEnv('')).toBeUndefined()
    } finally {
      if (prevJobDir === undefined) delete process.env.CLAUDE_JOB_DIR
      else process.env.CLAUDE_JOB_DIR = prevJobDir
    }
  })

  test('listAllLiveSessions mapper reads peerProtocol / jobId / status', () => {
    expect(UDS).toContain('peerSessionFromRegistry')
    expect(UDS).toContain('@181016699')
    const row = peerSessionFromRegistry(42, {
      sessionId: 'sess-1',
      jobId: 'abcd1234',
      kind: 'interactive',
      status: 'busy',
      waitingFor: 'input',
      startedAt: 10,
      updatedAt: 20,
      statusUpdatedAt: 21,
      peerProtocol: 1,
      parkedJobId: 'park-1',
    })
    expect(row).toMatchObject({
      pid: 42,
      sessionId: 'sess-1',
      jobId: 'abcd1234',
      status: 'busy',
      waitingFor: 'input',
      peerProtocol: 1,
      parkedJobId: 'park-1',
      statusUpdatedAt: 21,
      alive: true,
    })
    expect(
      peerSessionFromRegistry(1, { status: 'nope', peerProtocol: 'x' }).status,
    ).toBeUndefined()
    expect(
      peerSessionFromRegistry(1, { status: 'nope', peerProtocol: 'x' })
        .peerProtocol,
    ).toBeUndefined()
  })
})
