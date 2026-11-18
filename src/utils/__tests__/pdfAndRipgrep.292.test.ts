import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { open } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readBytesFromHandle, readPDF, readPDFFromHandle } from '../pdf.js'
import {
  RipgrepAbnormalExitError,
  RipgrepOutputTooLargeError,
  RipgrepSpawnResourceError,
  RipgrepTargetUnreadableError,
  RipgrepUsageError,
} from '../ripgrep.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('#202 pdf.ts held FileHandle reading', () => {
  test('readPDFFromHandle reads PDF from held FileHandle without reopening by path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-held-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'sample.pdf')
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
    writeFileSync(filePath, pdfBytes)

    const handle = await open(filePath, 'r')
    try {
      // Unlink the path after opening so any path-based reopen would fail
      rmSync(filePath)
      const res = await readPDFFromHandle(handle, filePath)
      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.type).toBe('pdf')
        expect(res.data.file.originalSize).toBe(pdfBytes.length)
        expect(Buffer.from(res.data.file.base64, 'base64')).toEqual(pdfBytes)
      }
    } finally {
      await handle.close()
    }
  })

  test('readPDF accepts a FileHandle directly and rejects non-PDF header', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-bad-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'not.pdf')
    writeFileSync(filePath, '<html>not a pdf</html>')

    const handle = await open(filePath, 'r')
    try {
      const res = await readPDF(handle, filePath)
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error.reason).toBe('corrupted')
        expect(res.error.message).toContain('missing %PDF- header')
      }
    } finally {
      await handle.close()
    }
  })

  test('readBytesFromHandle respects AbortSignal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-abort-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'abort.pdf')
    writeFileSync(filePath, '%PDF-1.4\n')

    const handle = await open(filePath, 'r')
    try {
      const ac = new AbortController()
      ac.abort(new Error('stopped'))
      await expect(readBytesFromHandle(handle, 9, ac.signal)).rejects.toThrow(
        'stopped',
      )
    } finally {
      await handle.close()
    }
  })
})

describe('#214 ripgrep rejectOnInputError error classes', () => {
  test('RipgrepTargetUnreadableError formats permission denied (EACCES=13) and I/O error (EIO=5)', () => {
    const eacces = new RipgrepTargetUnreadableError(13)
    expect(eacces.name).toBe('RipgrepTargetUnreadableError')
    expect(eacces.message).toContain('permission denied, os error 13')
    expect(eacces.message).toContain(
      'Tell the user that the path could not be read.',
    )

    const eio = new RipgrepTargetUnreadableError(5)
    expect(eio.message).toContain('os error 5')
  })

  test('RipgrepAbnormalExitError, RipgrepOutputTooLargeError, RipgrepSpawnResourceError, RipgrepUsageError match SEA', () => {
    const abnormal = new RipgrepAbnormalExitError()
    expect(abnormal.name).toBe('RipgrepAbnormalExitError')
    expect(abnormal.message).toContain('not a "no matches" result')

    const tooLarge = new RipgrepOutputTooLargeError('stderr')
    expect(tooLarge.name).toBe('RipgrepOutputTooLargeError')
    expect(tooLarge.message).toContain('error output')

    const spawnErr = Object.assign(new Error('spawn EAGAIN'), {
      code: 'EAGAIN',
      syscall: 'spawn rg',
    })
    const resource = RipgrepSpawnResourceError.from(spawnErr, true)
    expect(resource).toBeInstanceOf(RipgrepSpawnResourceError)
    expect(resource?.message).toContain('EAGAIN')
    expect(RipgrepSpawnResourceError.from(spawnErr, false)).toBeUndefined()

    const usage = new RipgrepUsageError('rg: regex parse error: bad')
    expect(usage.name).toBe('RipgrepUsageError')
    expect(usage.message).toContain('regex parse error')
  })
})
