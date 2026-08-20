/**
 * densable 2.1.235 #13 — RipgrepUsageError / rejectOnInputError (iaT + YTm).
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  RIPGREP_INPUT_ERROR_RE,
  RipgrepUsageError,
  ripGrep,
} from '../ripgrep.js'

describe('RIPGREP_INPUT_ERROR_RE (iaT)', () => {
  test('matches densable stderr prefixes', () => {
    expect(
      RIPGREP_INPUT_ERROR_RE.test('rg: regex parse error:\n    (?:\n'),
    ).toBe(true)
    expect(
      RIPGREP_INPUT_ERROR_RE.test(
        "rg: error parsing glob '{': unclosed alternate group",
      ),
    ).toBe(true)
    expect(
      RIPGREP_INPUT_ERROR_RE.test('rg: unrecognized file type: nosuch'),
    ).toBe(true)
    expect(RIPGREP_INPUT_ERROR_RE.test('rg: error parsing flag --nope')).toBe(
      true,
    )
    expect(
      RIPGREP_INPUT_ERROR_RE.test(
        'rg: compiled regex exceeds size limit of 10485760',
      ),
    ).toBe(true)
    expect(RIPGREP_INPUT_ERROR_RE.test('rg: No such file or directory')).toBe(
      false,
    )
  })
})

describe('RipgrepUsageError (YTm)', () => {
  test('message + telemetryMessage shape', () => {
    const err = new RipgrepUsageError('rg: regex parse error:\n  (')
    expect(err.name).toBe('RipgrepUsageError')
    expect(err.message).toContain(
      'Search failed — ripgrep rejected the pattern, glob, or file type without searching:',
    )
    expect(err.message).toContain('rg: regex parse error')
    expect(err.telemetryMessage).toBe(
      'ripgrep usage error (input rejected, stderr redacted)',
    )
  })
})

describe('ripGrep rejectOnInputError', () => {
  test('bad regex rejects with RipgrepUsageError when opted in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-usage-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello\n')
      await expect(
        ripGrep(['('], dir, new AbortController().signal, {
          rejectOnInputError: true,
        }),
      ).rejects.toBeInstanceOf(RipgrepUsageError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('bad regex still resolves empty without rejectOnInputError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-usage-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'a.txt'), 'hello\n')
      const lines = await ripGrep(['('], dir, new AbortController().signal)
      expect(lines).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('unrecognized type rejects when opted in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-usage-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello\n')
      await expect(
        ripGrep(
          ['hello', '--type', 'nosuchtype999'],
          dir,
          new AbortController().signal,
          { rejectOnInputError: true },
        ),
      ).rejects.toMatchObject({ name: 'RipgrepUsageError' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
