import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyProcessWrapperToLaunch,
  formatProcessWrapperRelaunchRefuseMessage,
  formatProcessWrapperStatusLines,
  parseProcessWrapperValue,
  PROCESS_WRAPPER_ENV_KEY,
  resetProcessWrapperCache,
  validateProcessWrapperArgv,
} from '../processWrapper.js'

afterEach(() => {
  resetProcessWrapperCache()
})

describe('parseProcessWrapperValue (official Psg)', () => {
  test('parses absolute path', () => {
    expect(parseProcessWrapperValue('/usr/local/bin/wrapper')).toEqual([
      '/usr/local/bin/wrapper',
    ])
  })

  test('parses quoted tokens with spaces', () => {
    expect(parseProcessWrapperValue('/bin/wrap --flag "hello world"')).toEqual([
      '/bin/wrap',
      '--flag',
      'hello world',
    ])
  })

  test('parses JSON array form', () => {
    expect(parseProcessWrapperValue('["/bin/wrap","--flag","x"]')).toEqual([
      '/bin/wrap',
      '--flag',
      'x',
    ])
  })

  test('rejects shell metacharacters', () => {
    expect(() => parseProcessWrapperValue('/bin/wrap; rm -rf /')).toThrow(
      /metacharacter/,
    )
  })

  test('rejects unterminated quote', () => {
    expect(() => parseProcessWrapperValue('/bin/wrap "open')).toThrow(
      /unterminated/,
    )
  })

  test('empty / whitespace → []', () => {
    expect(parseProcessWrapperValue('   ')).toEqual([])
  })
})

describe('validateProcessWrapperArgv (official Hsg)', () => {
  test('windows → platformIgnored, empty argv', () => {
    const r = validateProcessWrapperArgv('/bin/true', { platform: 'win32' })
    expect(r.platformIgnored).toBe(true)
    expect(r.argv).toEqual([])
    expect(r.error).toBeNull()
  })

  test('rejects non-absolute launcher', () => {
    const r = validateProcessWrapperArgv('wrapper', { platform: 'darwin' })
    expect(r.error).toContain('absolute path')
  })

  test('rejects empty value', () => {
    const r = validateProcessWrapperArgv('   ', { platform: 'darwin' })
    expect(r.error).toContain('contains no launcher')
  })

  test('accepts executable absolute file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-'))
    const bin = join(dir, 'launcher')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const r = validateProcessWrapperArgv(bin, {
      platform: 'darwin',
      execPath: '/fake/exec',
      claudeBinPath: '/fake/claude',
    })
    expect(r.error).toBeNull()
    expect(r.argv).toEqual([bin])
    expect(r.record).toBe(bin)
  })

  test('rejects own execPath as launcher', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-'))
    const bin = join(dir, 'claude-bin')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const r = validateProcessWrapperArgv(bin, {
      platform: 'darwin',
      execPath: bin,
      claudeBinPath: '/other/claude',
    })
    expect(r.error).toContain('own launch path')
  })
})

describe('applyProcessWrapperToLaunch (official qCe)', () => {
  test('no-op when wrapper unset', () => {
    const launch = { cmd: '/bin/claude', prefixArgs: ['--foo'] }
    expect(
      applyProcessWrapperToLaunch(launch, {} as NodeJS.ProcessEnv),
    ).toEqual(launch)
  })

  test('prefixes when wrapper set and valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-'))
    const bin = join(dir, 'wrap')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const env = {
      [PROCESS_WRAPPER_ENV_KEY]: `${bin} --keep`,
    } as NodeJS.ProcessEnv
    const out = applyProcessWrapperToLaunch(
      { cmd: '/bin/claude', prefixArgs: ['script.js'], target: 'script.js' },
      env,
    )
    expect(out.cmd).toBe(bin)
    expect(out.prefixArgs).toEqual(['--keep', '/bin/claude', 'script.js'])
    expect(out.target).toBe('script.js')
  })
})

describe('formatProcessWrapperStatusLines / relaunch refuse', () => {
  test('empty when unset', () => {
    expect(formatProcessWrapperStatusLines({} as NodeJS.ProcessEnv)).toEqual([])
    expect(
      formatProcessWrapperRelaunchRefuseMessage({} as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  test('refuse line when misconfigured', () => {
    const env = {
      [PROCESS_WRAPPER_ENV_KEY]: 'relative-not-abs',
    } as NodeJS.ProcessEnv
    const lines = formatProcessWrapperStatusLines(env)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('absolute path')
    expect(lines[0]).toContain('nothing will run unwrapped')
    expect(formatProcessWrapperRelaunchRefuseMessage(env)).toContain(
      'absolute path',
    )
  })

  test('Self-exec line when valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-'))
    const bin = join(dir, 'wrap')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const env = {
      [PROCESS_WRAPPER_ENV_KEY]: bin,
    } as NodeJS.ProcessEnv
    const lines = formatProcessWrapperStatusLines(env)
    expect(lines[0]).toContain('Self-exec:')
    expect(lines[0]).toContain(PROCESS_WRAPPER_ENV_KEY)
    expect(formatProcessWrapperRelaunchRefuseMessage(env)).toBeNull()
  })
})
