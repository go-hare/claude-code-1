import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  detectBufferTextEncoding,
  formatNonTextFileRefusal,
  preserveBom,
  readFileSyncWithMetadata,
} from '../fileRead.js'

describe('#690 fileRead & BOM preservation', () => {
  test('detectBufferTextEncoding detects utf16le, utf16be, nul, not_utf8, and valid utf8', () => {
    expect(
      detectBufferTextEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00])),
    ).toEqual({
      encoding: 'utf16le',
    })
    expect(
      detectBufferTextEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61])),
    ).toEqual({
      encoding: 'utf8',
      notText: 'utf16be',
    })
    expect(detectBufferTextEncoding(Buffer.from([0x61, 0x00, 0x62]))).toEqual({
      encoding: 'utf8',
      notText: 'nul',
    })
    // Windows-1252 / Latin-1 0x93 smart quote (invalid UTF-8)
    expect(
      detectBufferTextEncoding(Buffer.from([0x93, 0x68, 0x69, 0x94])),
    ).toEqual({
      encoding: 'utf8',
      notText: 'not_utf8',
    })
    expect(
      detectBufferTextEncoding(Buffer.from('hello world', 'utf8')),
    ).toEqual({
      encoding: 'utf8',
    })
  })

  test('preserveBom keeps leading U+FEFF on non-empty rewrites', () => {
    expect(preserveBom('\uFEFFold', 'new')).toBe('\uFEFFnew')
    expect(preserveBom('\uFEFFold', '\uFEFFnew')).toBe('\uFEFFnew')
    expect(preserveBom('\uFEFFold', '')).toBe('')
    expect(preserveBom('old', 'new')).toBe('new')
    expect(preserveBom(null, 'new')).toBe('new')
  })

  test('readFileSyncWithMetadata reads UTF-16LE BOM and flags non-UTF8 files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileread-690-'))
    try {
      const utf16Path = join(dir, 'utf16le.txt')
      const bom = Buffer.from([0xff, 0xfe])
      const body = Buffer.from('hello', 'utf16le')
      writeFileSync(utf16Path, Buffer.concat([bom, body]))
      const meta16 = readFileSyncWithMetadata(utf16Path)
      expect(meta16.encoding).toBe('utf16le')
      expect(meta16.notText).toBeUndefined()
      expect(meta16.content).toBe('\uFEFFhello')

      const latinPath = join(dir, 'win1252.txt')
      writeFileSync(latinPath, Buffer.from([0x93, 0x61, 0x94]))
      const metaLatin = readFileSyncWithMetadata(latinPath)
      expect(metaLatin.notText).toBe('not_utf8')
      expect(formatNonTextFileRefusal('not_utf8')).toContain('Windows-1252')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
