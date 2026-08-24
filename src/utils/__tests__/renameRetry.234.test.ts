/**
 * densable 2.1.234 #51 — RO target fail-fast on rename retry.
 */
import { describe, expect, test } from 'bun:test'
import {
  isOwnerWriteClearedSync,
  isRenameRetryable,
  OWNER_WRITE_BIT,
  RENAME_MAX_ATTEMPTS,
  RENAME_RETRY_SLEEP_MS,
  renameSyncWithRetry,
  renameWithRetry,
} from '../renameRetry.js'

describe('densable 2.1.234 #51 renameRetry', () => {
  test('constants match SEA gVy/clu/dlu', () => {
    expect(RENAME_MAX_ATTEMPTS).toBe(4)
    expect(RENAME_RETRY_SLEEP_MS).toBe(50)
    expect(OWNER_WRITE_BIT).toBe(0o200)
  })

  test('ulu retries only EPERM|EBUSY|EACCES within attempt budget', () => {
    expect(
      isRenameRetryable(Object.assign(new Error('x'), { code: 'EPERM' }), 0),
    ).toBe(true)
    expect(
      isRenameRetryable(Object.assign(new Error('x'), { code: 'EBUSY' }), 2),
    ).toBe(true)
    expect(
      isRenameRetryable(Object.assign(new Error('x'), { code: 'EACCES' }), 3),
    ).toBe(false)
    expect(
      isRenameRetryable(Object.assign(new Error('x'), { code: 'ENOENT' }), 0),
    ).toBe(false)
  })

  test('fIs RO fail-fast when isOwnerWriteClearedSync returns true', () => {
    // Simulate by calling the helper with a custom rename that always EPERM,
    // and a target path whose lstat mode we control via a temp file.
    // On Windows/Unix: create a file, clear owner write, expect single attempt.
    const fs = require('node:fs') as typeof import('node:fs')
    const os = require('node:os') as typeof import('node:os')
    const path = require('node:path') as typeof import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-ro-'))
    const from = path.join(dir, 'from.tmp')
    const to = path.join(dir, 'to.json')
    fs.writeFileSync(from, 'x')
    fs.writeFileSync(to, 'y')
    // clear owner-write bit (S_IWUSR)
    const st = fs.lstatSync(to)
    fs.chmodSync(to, st.mode & ~OWNER_WRITE_BIT)
    expect(isOwnerWriteClearedSync(to)).toBe(true)

    let attempts = 0
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    expect(() =>
      renameSyncWithRetry(from, to, () => {
        attempts++
        throw err
      }),
    ).toThrow(err)
    expect(attempts).toBe(1)

    // restore write so cleanup works on Windows
    try {
      fs.chmodSync(to, st.mode | OWNER_WRITE_BIT)
    } catch {
      /* ignore */
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('vVy retries when target is writable', async () => {
    let attempts = 0
    const err = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    await expect(
      renameWithRetry('a', 'b-nonexistent-target-xyz', async () => {
        attempts++
        if (attempts < 3) throw err
      }),
    ).resolves.toBe(true)
    expect(attempts).toBe(3)
  })
})
