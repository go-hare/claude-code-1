import { describe, expect, test } from 'bun:test'
import {
  classifyNpmInstallFailure,
  mergeAutoUpdaterResult,
} from '../autoUpdater.js'

describe('densable 2.1.235 #9 update-footer failureHint', () => {
  test('classifyNpmInstallFailure detects windows exe lock', () => {
    const stderr =
      'npm ERR! code EBUSY\n' +
      'npm ERR! resource busy or locked, rename C:\\Users\\x\\AppData\\Roaming\\npm\\claude.exe'
    expect(classifyNpmInstallFailure(stderr, 'win32')).toEqual({
      status: 'install_failed',
      failureHint: 'windows_running_exe_lock',
    })
  })

  test('classifyNpmInstallFailure detects permission denied as no_permissions', () => {
    expect(
      classifyNpmInstallFailure(
        'Error: EACCES: permission denied, mkdir',
        'linux',
      ),
    ).toEqual({ status: 'no_permissions' })
  })

  test('classifyNpmInstallFailure defaults to install_failed', () => {
    expect(classifyNpmInstallFailure('random npm boom', 'darwin')).toEqual({
      status: 'install_failed',
    })
  })

  test('mergeAutoUpdaterResult bumps consecutiveExeLockFailures on lock hint', () => {
    const first = mergeAutoUpdaterResult(null, {
      version: '2.1.235',
      status: 'install_failed',
      failureHint: 'windows_running_exe_lock',
    })
    expect(first.consecutiveExeLockFailures).toBe(1)
    const second = mergeAutoUpdaterResult(first, {
      version: '2.1.235',
      status: 'install_failed',
      failureHint: 'windows_running_exe_lock',
    })
    expect(second.consecutiveExeLockFailures).toBe(2)
  })

  test('mergeAutoUpdaterResult preserves count while in_progress and resets otherwise', () => {
    const prev = mergeAutoUpdaterResult(null, {
      version: '2.1.235',
      status: 'install_failed',
      failureHint: 'windows_running_exe_lock',
    })
    const inProgress = mergeAutoUpdaterResult(prev, {
      version: '2.1.235',
      status: 'in_progress',
    })
    expect(inProgress.consecutiveExeLockFailures).toBe(1)
    const success = mergeAutoUpdaterResult(inProgress, {
      version: '2.1.236',
      status: 'success',
    })
    expect(success.consecutiveExeLockFailures).toBe(0)
    expect(success.failureHint).toBeUndefined()
  })

  test('mergeAutoUpdaterResult is identity when unchanged', () => {
    const a = mergeAutoUpdaterResult(null, {
      version: '1.0.0',
      status: 'success',
    })
    const b = mergeAutoUpdaterResult(a, {
      version: '1.0.0',
      status: 'success',
    })
    expect(b).toBe(a)
  })
})
