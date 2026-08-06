/**
 * densable 2.1.214 #17 — `--settings` path form:
 * densable `bj(path, Jme=2097152)` via `qvl` / assertRegularFileWithinMaxBytes
 * refuses directory / device / oversize before startup continues.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getErrnoCode, isEISDIR, isNotRegularFileError } from '../errors.js'
import {
  assertRegularFileWithinMaxBytes,
  getFsImplementation,
} from '../fsOperations.js'
import { FLAG_SETTINGS_MAX_BYTES } from '../settings/constants.js'

describe('densable #17 FLAG_SETTINGS_MAX_BYTES / assertRegularFileWithinMaxBytes', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  test('Jme is 2MiB (2097152)', () => {
    expect(FLAG_SETTINGS_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(FLAG_SETTINGS_MAX_BYTES).toBe(2097152)
  })

  test('directory → EISDIR (Tae path → Cannot use settings file)', () => {
    dir = join(tmpdir(), `set214-dir-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const fs = getFsImplementation()
    try {
      assertRegularFileWithinMaxBytes(fs, dir, FLAG_SETTINGS_MAX_BYTES)
      expect.unreachable('should throw')
    } catch (e) {
      expect(isEISDIR(e)).toBe(true)
      expect(getErrnoCode(e)).toBe('EISDIR')
    }
  })

  test('oversize regular file → ERR_FILE_TOO_LARGE', () => {
    dir = join(tmpdir(), `set214-big-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'settings.json')
    // write slightly over 2MiB without filling entire buffer in test heap
    const over = FLAG_SETTINGS_MAX_BYTES + 1
    writeFileSync(path, Buffer.alloc(over, 0x7b), 'utf8')
    const fs = getFsImplementation()
    try {
      assertRegularFileWithinMaxBytes(fs, path, FLAG_SETTINGS_MAX_BYTES)
      expect.unreachable('should throw')
    } catch (e) {
      expect(getErrnoCode(e)).toBe('ERR_FILE_TOO_LARGE')
      expect(isNotRegularFileError(e)).toBe(false)
      const err = e as { size?: number; maxBytes?: number }
      expect(err.size).toBe(over)
      expect(err.maxBytes).toBe(FLAG_SETTINGS_MAX_BYTES)
    }
  })

  test('small regular file passes', () => {
    dir = join(tmpdir(), `set214-ok-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'settings.json')
    writeFileSync(path, '{"env":{}}\n', 'utf8')
    const fs = getFsImplementation()
    expect(() =>
      assertRegularFileWithinMaxBytes(fs, path, FLAG_SETTINGS_MAX_BYTES),
    ).not.toThrow()
  })

  test('main loadSettingsFromFlag wires densable error strings', async () => {
    // Source-contract: keep message templates 1:1 with densable without
    // importing main.tsx (heavy side-effects).
    const mainSrc = await Bun.file(
      join(import.meta.dir, '../../main.tsx'),
    ).text()
    expect(mainSrc).toContain('FLAG_SETTINGS_MAX_BYTES')
    expect(mainSrc).toContain('assertRegularFileWithinMaxBytes')
    expect(mainSrc).toContain(
      'Settings file exceeds the ${FLAG_SETTINGS_MAX_BYTES / 1048576}MiB limit',
    )
    expect(mainSrc).toContain('Cannot use settings file (')
    expect(mainSrc).toContain('Settings file not found:')
    expect(mainSrc).toContain('ERR_FILE_TOO_LARGE')
    expect(mainSrc).toContain('isNotRegularFileError')
    expect(mainSrc).toContain('isEISDIR')
  })
})
