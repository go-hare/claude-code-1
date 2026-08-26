/**
 * densable 2.1.232 #46 — cross-session socket dir refuses symlink / foreign ownership.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const udsPath = join(import.meta.dir, '../udsMessaging.ts')
const src = readFileSync(udsPath, 'utf8')

describe('densable 2.1.232 #46 cross-session socket dir', () => {
  test('ensureSocketParent refuses non-directory / symlink parents', () => {
    expect(src).toContain('async function ensureSocketParent')
    expect(src).toContain('socket parent is not a directory')
    // lstat + isDirectory + isSymbolicLink gate before bind
    expect(src).toMatch(
      /!stat\.isDirectory\(\)\s*\|\|\s*stat\.isSymbolicLink\(\)/,
    )
  })

  test('assertPrivateDirectory enforces mode and ownership', () => {
    expect(src).toContain('function assertPrivateDirectory')
    expect(src).toContain('permissions are too broad')
    expect(src).toContain('owner does not match current user')
    // group/other bits must be zero
    expect(src).toMatch(/stat\.mode\)\s*&\s*0o077/)
    expect(src).toContain('process.getuid')
  })

  test('missing parent mkdir is 0o700 and refuse-to-bind prefix is densable-shaped', () => {
    expect(src).toContain('mkdir(dir, { recursive: true, mode: 0o700 })')
    expect(src).toContain(
      '[uds-messaging] Failed to set up sockets directory (refusing to bind):',
    )
  })

  test('capability publish is 239 xWd sessions/ key (not 232 named helper)', () => {
    // 232 locked assertPrivateCapabilityDir. 239 #58 replaced that with
    // writeCapabilityFile → ~/.claude/sessions/${pid}.${hash}.key via od().
    expect(src).not.toContain('assertPrivateCapabilityDir')
    expect(src).toContain('async function writeCapabilityFile')
    expect(src).toContain("join(getClaudeConfigHomeDir(), 'sessions')")
    expect(src).toContain('mkdir(dir, { recursive: true, mode: 0o700 })')
    expect(src).toContain('key_publish_failed')
  })
})
