import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { checkPathConstraints } from '../pathValidation.js'
import { createOutputFileCleanup } from '../outputFileCleanup.js'

describe('#967 mounted_drive_path rm -r safety check', () => {
  const ctx = getEmptyToolPermissionContext()

  test('rm -rf /Volumes/MyDrive triggers dangerousRemoval ask', () => {
    const res = checkPathConstraints(
      { command: 'rm -rf /Volumes/MyDrive' },
      '/tmp',
      ctx,
    )
    expect(res.behavior).toBe('ask')
    if (res.behavior === 'ask') {
      expect(res.message).toContain('mounted drive')
      expect(res.decisionReason).toMatchObject({
        type: 'safetyCheck',
        circuitBreaker: 'dangerousRemoval',
      })
    }
  })

  test('rm -r /mnt/c triggers dangerousRemoval ask', () => {
    const res = checkPathConstraints({ command: 'rm -r /mnt/c' }, '/tmp', ctx)
    expect(res.behavior).toBe('ask')
    if (res.behavior === 'ask') {
      expect(res.message).toContain('mounted drive')
    }
  })

  test('rm -r /media/user/usb triggers dangerousRemoval ask', () => {
    const res = checkPathConstraints(
      { command: 'rm -r /media/user/usb' },
      '/tmp',
      ctx,
    )
    expect(res.behavior).toBe('ask')
    if (res.behavior === 'ask') {
      expect(res.message).toContain('mounted drive')
    }
  })

  test('deeper path inside /Volumes/MyDrive/sub/dir does not trigger mounted_drive_path', () => {
    const res = checkPathConstraints(
      { command: 'rm -rf /Volumes/MyDrive/sub/dir' },
      '/Volumes/MyDrive/sub',
      ctx,
    )
    if (res.behavior === 'ask') {
      expect(res.message).not.toContain('mounted drive')
    }
  })
})

describe('#992 createOutputFileCleanup ENOSPC vs non-disk-full', () => {
  test('deletes tracked file on normal dispose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-cleanup-'))
    const file = join(dir, 'out.txt')
    writeFileSync(file, 'hello')
    try {
      const cleanup = createOutputFileCleanup()
      cleanup.track({ outputFilePath: file, outputFileSize: 5 })
      await cleanup.dispose()
      expect(existsSync(file)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('keeps tracked file when copyFailed is non-ENOSPC (e.g. EACCES)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-cleanup-'))
    const file = join(dir, 'out.txt')
    writeFileSync(file, 'hello')
    try {
      const cleanup = createOutputFileCleanup()
      cleanup.track({ outputFilePath: file, outputFileSize: 5 })
      const err = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      })
      cleanup.copyFailed(err)
      await cleanup.dispose()
      expect(existsSync(file)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('deletes tracked file when copyFailed is ENOSPC or EDQUOT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-cleanup-'))
    const file = join(dir, 'out.txt')
    writeFileSync(file, 'hello')
    try {
      const cleanup = createOutputFileCleanup()
      cleanup.track({ outputFilePath: file, outputFileSize: 5 })
      const err = Object.assign(new Error('no space'), { code: 'ENOSPC' })
      cleanup.copyFailed(err)
      await cleanup.dispose()
      expect(existsSync(file)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
