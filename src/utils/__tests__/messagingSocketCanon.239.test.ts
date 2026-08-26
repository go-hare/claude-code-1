/**
 * densable 2.1.239 lQ / CWd — canonicalize before capability hash.
 */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { canonicalizeMessagingSocketPath } from '../udsMessaging.js'

function digest(path: string): string {
  const canonical = canonicalizeMessagingSocketPath(path)
  if (canonical === undefined) {
    throw new Error(`expected canonical path for ${path}`)
  }
  return createHash('sha256').update(canonical).digest('hex')
}

describe('densable 2.1.239 lQ canonicalizeMessagingSocketPath', () => {
  test('named pipe folds [A-Z]+ runs onto \\\\.\\pipe\\leaf', () => {
    expect(canonicalizeMessagingSocketPath('\\\\.\\pipe\\ClaudeCode-1')).toBe(
      '\\\\.\\pipe\\claudecode-1',
    )
    expect(
      canonicalizeMessagingSocketPath('\\\\.\\pipe\\LOCAL\\Claude-1'),
    ).toBe('\\\\.\\pipe\\local\\claude-1')
  })

  test('mixed-case pipes share one CWd digest', () => {
    expect(digest('\\\\.\\pipe\\ClaudeCode-1')).toBe(
      digest('\\\\.\\pipe\\claudecode-1'),
    )
  })

  test('IMr refuses .. segments before resolve', () => {
    expect(
      canonicalizeMessagingSocketPath('/tmp/a/../messaging.sock'),
    ).toBeUndefined()
    expect(
      canonicalizeMessagingSocketPath('C:\\tmp\\..\\messaging.sock'),
    ).toBeUndefined()
  })

  test('unix socket resolves without inventing a second hash', () => {
    const abs = '/tmp/cc-socks/1/messaging.sock'
    expect(canonicalizeMessagingSocketPath(abs)).toBe(resolve(abs))
  })
})
