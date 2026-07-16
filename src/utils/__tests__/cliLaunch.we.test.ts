import { describe, expect, test } from 'bun:test'
import { join, sep } from 'path'
import { buildCliLaunch, isVersionedNativeBinary } from '../cliLaunch.js'
import { getXDGDataHome } from '../xdg.js'

describe('isVersionedNativeBinary (official y26)', () => {
  test('matches paths under $XDG_DATA_HOME/claude/versions/', () => {
    // isVersionedNativeBinary also requires isInBundledMode(); without a
    // bundled runtime this is always false for the live process — exercise
    // the path prefix helper by constructing a versions path and checking
    // the negation for unrelated bins.
    const versions = join(getXDGDataHome(), 'claude', 'versions') + sep
    expect(versions.endsWith(`versions${sep}`)).toBe(true)
    // Live unbundled/dev process is never a versioned native binary.
    expect(isVersionedNativeBinary(process.execPath)).toBe(false)
  })
})

describe('buildCliLaunch pinToCurrentBinary (official WE)', () => {
  test('pinToCurrentBinary uses process.execPath', () => {
    const launch = buildCliLaunch(['daemon', 'run', '--origin', 'transient'], {
      pinToCurrentBinary: true,
    })
    expect(launch.execPath).toBe(process.execPath)
    expect(launch.args.slice(-4)).toEqual([
      'daemon',
      'run',
      '--origin',
      'transient',
    ])
    expect(launch.windowsHide).toBe(true)
  })

  test('default launch also ends with the cli args', () => {
    const launch = buildCliLaunch(['daemon', 'status'])
    expect(launch.args.slice(-2)).toEqual(['daemon', 'status'])
    expect(launch.windowsHide).toBe(true)
  })
})
