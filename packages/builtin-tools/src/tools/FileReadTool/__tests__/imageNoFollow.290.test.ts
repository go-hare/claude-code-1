import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageWithTokenBudget } from '../FileReadTool.js'

// Minimal 1x1 valid PNG
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)

describe('FileReadTool O_NOFOLLOW image read (#44)', () => {
  test('reads regular image file successfully', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileread-img-'))
    try {
      const imgPath = join(dir, 'ok.png')
      writeFileSync(imgPath, TINY_PNG)
      const res = await readImageWithTokenBudget(imgPath)
      expect(res.type).toBe('image')
      expect(res.file.base64.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  if (process.platform !== 'win32') {
    test('refuses symlink with ELOOP via O_NOFOLLOW', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fileread-img-sym-'))
      try {
        const target = join(dir, 'target.png')
        const link = join(dir, 'link.png')
        writeFileSync(target, TINY_PNG)
        symlinkSync(target, link)
        await expect(readImageWithTokenBudget(link)).rejects.toThrow(
          /ELOOP|symbolic link/i,
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
