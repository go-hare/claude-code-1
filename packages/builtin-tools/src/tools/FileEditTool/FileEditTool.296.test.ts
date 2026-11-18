import { describe, expect, mock, test } from 'bun:test'
import { createHash } from 'crypto'
import { mkdtemp, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

mock.module('src/utils/ShellCommand.js', () => ({
  ShellCommand: class {},
  killProcessTree: () => {},
  wrapSpawn: (fn: unknown) => fn,
  createAbortedCommand: () => ({}),
  createFailedCommand: (err: string) => ({ preSpawnError: err }),
  createAdoptedShellCommand: () => ({}),
}))

const {
  detectBufferTextEncoding,
  FileEditTool,
  formatNonTextFileRefusal,
  matchesReadBaseline,
} = await import('./FileEditTool.js')

describe('2.1.295-2.1.296 FileEditTool alignment', () => {
  test('#430 matchesReadBaseline compares sha256 + utf8 byteLength', () => {
    const text = 'hello world\n'
    const baseline = {
      sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(text, 'utf8'),
    }
    expect(matchesReadBaseline(baseline, text)).toBe(true)
    expect(matchesReadBaseline(baseline, 'hello world!\n')).toBe(false)
  })

  test('#430 validateInput rejects stale file even when mtime did not advance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edit-430-'))
    try {
      const filePath = join(dir, 'sample.txt')
      const original = 'line one\nline two\n'
      await writeFile(filePath, original, 'utf8')
      const st = await stat(filePath)

      // Overwrite content, then restore the exact same mtime
      await writeFile(filePath, 'line one\nline changed\n', 'utf8')
      await utimes(filePath, st.atime, st.mtime)

      const readFileState = new Map([
        [
          filePath,
          {
            content: original,
            timestamp: Math.floor(st.mtimeMs),
            offset: 1,
            limit: undefined,
          },
        ],
      ])

      const res = await FileEditTool.validateInput(
        {
          file_path: filePath,
          old_string: 'line one',
          new_string: 'line 1',
        },
        {
          readFileState,
          getAppState: () => ({
            toolPermissionContext: {
              mode: 'default',
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              additionalWorkingDirectories: new Map(),
            },
          }),
        } as any,
      )
      expect(res.result).toBe(false)
      if (!res.result) {
        expect(res.errorCode).toBe(7)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#517 detectBufferTextEncoding detects not_utf8, nul, utf16be, and valid utf8/utf16le', async () => {
    // Windows-1252 / invalid UTF-8 byte 0x93
    const win1252 = Buffer.from([0x93, 0x68, 0x69, 0x94])
    expect(detectBufferTextEncoding(win1252).notText).toBe('not_utf8')

    // NUL byte
    const withNul = Buffer.from([0x61, 0x00, 0x62])
    expect(detectBufferTextEncoding(withNul).notText).toBe('nul')

    // UTF-16BE BOM
    const utf16be = Buffer.from([0xfe, 0xff, 0x00, 0x61])
    expect(detectBufferTextEncoding(utf16be).notText).toBe('utf16be')

    // UTF-16LE BOM
    const utf16le = Buffer.from([0xff, 0xfe, 0x61, 0x00])
    expect(detectBufferTextEncoding(utf16le)).toEqual({ encoding: 'utf16le' })

    // Valid UTF-8
    expect(detectBufferTextEncoding(Buffer.from('hello 世界', 'utf8'))).toEqual(
      {
        encoding: 'utf8',
      },
    )

    expect(formatNonTextFileRefusal('not_utf8')).toContain(
      'Windows-1252, Shift-JIS or GBK',
    )
  })

  test('#517 validateInput refuses non-UTF-8 file with errorCode 15', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edit-517-'))
    try {
      const filePath = join(dir, 'legacy.txt')
      const raw = Buffer.from([0x61, 0x62, 0x93, 0x63])
      await writeFile(filePath, raw)
      const st = await stat(filePath)
      const decoded = raw.toString('utf8')

      const readFileState = new Map([
        [
          filePath,
          {
            content: decoded,
            timestamp: Math.floor(st.mtimeMs),
            offset: 1,
            limit: undefined,
          },
        ],
      ])

      const res = await FileEditTool.validateInput(
        {
          file_path: filePath,
          old_string: 'ab',
          new_string: 'xy',
        },
        {
          readFileState,
          getAppState: () => ({
            toolPermissionContext: {
              mode: 'default',
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              additionalWorkingDirectories: new Map(),
            },
          }),
        } as any,
      )
      expect(res.result).toBe(false)
      if (!res.result) {
        expect(res.errorCode).toBe(15)
        expect(res.message).toContain('not valid UTF-8')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
