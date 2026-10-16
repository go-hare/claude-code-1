import { describe, expect, test } from 'bun:test'
import { isBareLaunchArgv } from '../residualUiEnvGates.js'

describe('isBareLaunchArgv (densable 2.1.289 at)', () => {
  test('empty argv is a bare launch', () => {
    expect(isBareLaunchArgv([])).toBe(true)
  })

  test('debug flags alone stay bare', () => {
    expect(
      isBareLaunchArgv([
        '--debug',
        '-d',
        '--debug-to-stderr',
        '-d2e',
        '--debug=api',
        '--debug-file=/tmp/x.log',
      ]),
    ).toBe(true)
    expect(isBareLaunchArgv(['--debug-file', '/tmp/x.log'])).toBe(true)
  })

  test('a prompt keeps the REPL path', () => {
    expect(isBareLaunchArgv(['fix the bug'])).toBe(false)
  })

  test('any other flag keeps the REPL path', () => {
    expect(isBareLaunchArgv(['--prefill', 'x'])).toBe(false)
    expect(isBareLaunchArgv(['--model', 'opus'])).toBe(false)
    expect(isBareLaunchArgv(['-d', '--resume'])).toBe(false)
  })

  test('trailing --debug-file without a value is not a debug pair', () => {
    expect(isBareLaunchArgv(['--debug-file'])).toBe(false)
  })
})
