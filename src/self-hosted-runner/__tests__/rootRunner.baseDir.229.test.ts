/**
 * densable 2.1.229 #29 — Windows requires explicit --base-dir / env.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { resolve as pathResolve } from 'node:path'
import { assertWindowsBaseDirSource, parseRootArgs } from '../rootRunner.js'

const saved: Record<string, string | undefined> = {}

function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
})

describe('densable 2.1.229 n_g Windows baseDir', () => {
  test('parseRootArgs tracks default/env/flag baseDirSource', () => {
    setEnv('SELF_HOSTED_RUNNER_BASE_DIR', undefined)
    expect(parseRootArgs([]).baseDirSource).toBe('default')

    setEnv('SELF_HOSTED_RUNNER_BASE_DIR', '/tmp/from-env')
    const fromEnv = parseRootArgs([])
    expect(fromEnv.baseDirSource).toBe('env')
    expect(fromEnv.baseDir).toBe(pathResolve('/tmp/from-env'))

    const fromFlag = parseRootArgs(['--base-dir', '/tmp/from-flag'])
    expect(fromFlag.baseDirSource).toBe('flag')
    expect(fromFlag.baseDir).toBe(pathResolve('/tmp/from-flag'))
  })

  test('assertWindowsBaseDirSource rejects default on win32', () => {
    expect(() => assertWindowsBaseDirSource('default', 'win32')).toThrow(
      /required on Windows/,
    )
    expect(() => assertWindowsBaseDirSource('default', 'win32')).toThrow(
      /POSIX container path/,
    )
  })

  test('assertWindowsBaseDirSource allows env/flag on win32', () => {
    expect(() => assertWindowsBaseDirSource('env', 'win32')).not.toThrow()
    expect(() => assertWindowsBaseDirSource('flag', 'win32')).not.toThrow()
  })

  test('assertWindowsBaseDirSource allows default on darwin/linux', () => {
    expect(() => assertWindowsBaseDirSource('default', 'darwin')).not.toThrow()
    expect(() => assertWindowsBaseDirSource('default', 'linux')).not.toThrow()
  })
})
