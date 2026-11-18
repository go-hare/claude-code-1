import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageWithTokenBudget } from '../FileReadTool.js'

describe('FileReadTool image read 128MB cap & non-regular file guard (#899)', () => {
  test('refuses regular image files larger than 128 MB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileread-img-cap-'))
    try {
      const bigPng = join(dir, 'huge.png')
      // Create a sparse file > 128 MB (134,217,728 + 1 bytes)
      writeFileSync(bigPng, Buffer.alloc(1))
      const { truncateSync } = await import('fs')
      truncateSync(bigPng, 134_217_729)

      await expect(readImageWithTokenBudget(bigPng)).rejects.toThrow(
        /File is too large to read as an image \(the limit is 128MB\)/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses non-regular device/pipe sending over 128 MB', async () => {
    if (process.platform === 'win32') return
    // /dev/zero is a character device that never sends EOF
    await expect(readImageWithTokenBudget('/dev/zero')).rejects.toThrow(
      /is a pipe or a device, not a regular file, and it sent more than 128MB without ending/,
    )
  })
})
