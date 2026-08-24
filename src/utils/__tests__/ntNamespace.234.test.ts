/**
 * densable 2.1.234 #6 — NT-namespace / UNC pre-approval helpers + surfaces.
 */
import { describe, expect, test } from 'bun:test'
import {
  hasPathDotSegment,
  isDeviceOrNtNamespacePath,
  isNetworkNtOrAutomountPath,
  isNetworkUncPath,
  isNtObjectNamespacePath,
  isNtObjectNamespacePathNormalized,
  isUncOrNtObjectPath,
  isUnsafeNetworkOrNtIncludePath,
  isWslUncPath,
  isWindowsDeviceNamespacePath,
} from '../path.js'
import {
  isCrossHostSessionHomeShape,
  isUnsafeSessionRestorePath,
} from '../sessionRestore.js'
import { isSafeShellCwdReadBack } from '../Shell.js'
import { isForbiddenWorkflowScriptPath } from '../../../packages/workflow-engine/src/engine/paths.js'

describe('densable Jw/su/Yhe/yR/qh helpers (234 #6)', () => {
  test('Jw matches \\??\\ and /??/', () => {
    expect(isNtObjectNamespacePath('\\??\\UNC\\evil\\share')).toBe(true)
    expect(isNtObjectNamespacePath('/??/C:/Windows')).toBe(true)
    expect(isNtObjectNamespacePath('\\\\?\\C:\\Windows')).toBe(false)
    expect(isNtObjectNamespacePath('C:\\Users')).toBe(false)
  })

  test('Yhe matches \\\\?\\ / \\\\.\\ device namespace', () => {
    expect(isWindowsDeviceNamespacePath('\\\\?\\C:\\Windows')).toBe(true)
    expect(isWindowsDeviceNamespacePath('\\\\.\\pipe\\x')).toBe(true)
    expect(isWindowsDeviceNamespacePath('//?/C:/Windows')).toBe(true)
    expect(isWindowsDeviceNamespacePath('\\??\\C:\\Windows')).toBe(false)
  })

  test('publish gate Yhe||Jw', () => {
    expect(isDeviceOrNtNamespacePath('\\??\\UNC\\x\\y')).toBe(true)
    expect(isDeviceOrNtNamespacePath('\\\\?\\C:\\x')).toBe(true)
    expect(isDeviceOrNtNamespacePath('C:\\plain')).toBe(false)
  })

  test('su / qh / db', () => {
    expect(isUncOrNtObjectPath('\\\\server\\share')).toBe(true)
    expect(isUncOrNtObjectPath('\\??\\C:\\x')).toBe(true)
    expect(isWslUncPath('\\\\wsl$\\Ubuntu\\home')).toBe(true)
    expect(isWslUncPath('\\\\wsl.localhost\\Ubuntu\\home')).toBe(true)
    expect(isNetworkUncPath('\\\\server\\share')).toBe(true)
    expect(isNetworkUncPath('\\\\wsl$\\Ubuntu\\home')).toBe(false)
  })

  test('yR dot segments', () => {
    expect(hasPathDotSegment('C:\\a\\..\\b')).toBe(true)
    expect(hasPathDotSegment('C:\\a\\.\\b')).toBe(true)
    expect(hasPathDotSegment('C:\\a\\b')).toBe(false)
  })

  test('Dwe normalize still catches ??', () => {
    expect(isNtObjectNamespacePathNormalized('\\??\\C:\\x')).toBe(true)
    expect(isNetworkNtOrAutomountPath('\\??\\UNC\\evil\\s')).toBe(true)
  })

  test('sTe/include keeps WSL; s7t forbids WSL', () => {
    const wsl = '\\\\wsl$\\Ubuntu\\home\\u\\CLAUDE.md'
    const wslLocalhost = '\\\\wsl.localhost\\Ubuntu\\home\\u\\a.txt'
    const net = '\\\\server\\share\\a.txt'
    const nt = '\\??\\C:\\Windows\\a.txt'
    // include/edit (su&&!db||Jw) — WSL kept
    expect(isUnsafeNetworkOrNtIncludePath(wsl)).toBe(false)
    expect(isUnsafeNetworkOrNtIncludePath(wslLocalhost)).toBe(false)
    expect(isUnsafeNetworkOrNtIncludePath(net)).toBe(true)
    expect(isUnsafeNetworkOrNtIncludePath(nt)).toBe(true)
    // workflow s7t (su||Jw) — WSL forbidden
    expect(isNetworkNtOrAutomountPath(wsl)).toBe(true)
    expect(isNetworkNtOrAutomountPath(wslLocalhost)).toBe(true)
  })
})

describe('densable lMp shell cwd read-back (234 #6)', () => {
  test('rejects NT-namespace and network UNC', () => {
    expect(isSafeShellCwdReadBack('\\??\\C:\\Windows', 'C:\\proj')).toBe(false)
    expect(isSafeShellCwdReadBack('\\\\server\\share\\x', 'C:\\proj')).toBe(
      false,
    )
  })

  test('rejects dot-segment and relative', () => {
    expect(isSafeShellCwdReadBack('C:\\a\\..\\b', 'C:\\proj')).toBe(false)
    expect(isSafeShellCwdReadBack('relative', 'C:\\proj')).toBe(false)
  })

  test('accepts absolute local', () => {
    expect(isSafeShellCwdReadBack('C:\\Users\\x\\proj', 'C:\\Users\\x')).toBe(
      true,
    )
  })
})

describe('densable k0c/dvr sessionRestore (234 #6)', () => {
  test('unsafe transcript/worktree paths', () => {
    expect(isUnsafeSessionRestorePath('\\\\server\\share\\sess')).toBe(true)
    expect(isUnsafeSessionRestorePath('\\??\\C:\\Claude\\projects')).toBe(true)
    expect(isUnsafeSessionRestorePath('C:\\Users\\x\\.claude\\projects')).toBe(
      false,
    )
  })

  test('cross-host session home shape', () => {
    expect(isCrossHostSessionHomeShape('\\\\evil\\share\\home')).toBe(true)
    expect(isCrossHostSessionHomeShape('\\??\\UNC\\evil\\share')).toBe(true)
  })
})

describe('densable s7t workflow scriptPath (234 #6)', () => {
  test('forbids UNC / NT scriptPath', () => {
    expect(isForbiddenWorkflowScriptPath('\\\\server\\share\\w.js')).toBe(true)
    expect(isForbiddenWorkflowScriptPath('\\??\\C:\\w.js')).toBe(true)
    expect(isForbiddenWorkflowScriptPath('/abs/local/w.js')).toBe(false)
  })
})
