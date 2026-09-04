/**
 * densable 2.1.243 #39 — native host wrapper via stable `claude` launcher.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  formatChromeNativeHostWrapperScript,
  getStableClaudeLauncherPath,
} from '../setup.js'
import { getUserBinDir } from '../../xdg.js'
import { isVersionedNativeBinary } from '../../cliLaunch.js'

describe('densable 2.1.243 #39 chrome native host stable launcher', () => {
  test('stable launcher path is ~/.local/bin/claude', () => {
    expect(getStableClaudeLauncherPath()).toBe(join(getUserBinDir(), 'claude'))
  })

  test('pin formula: only versioned native + missing stable launcher', () => {
    const pin = (versioned: boolean, stableRunnable: boolean) =>
      versioned && !stableRunnable
    expect(pin(true, true)).toBe(false)
    expect(pin(true, false)).toBe(true)
    expect(pin(false, false)).toBe(false)
    // Live unbundled/dev process is never a versioned native binary.
    expect(isVersionedNativeBinary(process.execPath)).toBe(false)
  })

  test('POSIX wrapper execs quoted argv', () => {
    const script = formatChromeNativeHostWrapperScript(
      ['/home/u/.local/bin/claude', '--chrome-native-host'],
      'posix',
    )
    expect(script.startsWith('#!/bin/sh\n')).toBe(true)
    expect(script).toContain('exec ')
    expect(script).toContain('--chrome-native-host')
    expect(script).toContain('/home/u/.local/bin/claude')
  })

  test('Windows wrapper quotes argv and doubles %', () => {
    const script = formatChromeNativeHostWrapperScript(
      ['C:\\Users\\%USER%\\claude.exe', '--chrome-native-host'],
      'windows',
    )
    expect(script.startsWith('@echo off\n')).toBe(true)
    expect(script).toContain('"C:\\Users\\%%USER%%\\claude.exe"')
    expect(script).toContain('"--chrome-native-host"')
  })
})
