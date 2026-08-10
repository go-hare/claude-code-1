/**
 * densable 2.1.222 #14 — file watcher FS error / teardown rare crash.
 * Pure helpers + source wire-up (avoid chokidar process hang under bun:test).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  filterWatchableFileChangedPaths,
  isRemoteUncWatchPath,
  isUncPath,
  isWslUncPath,
  stripWindowsLongPathPrefix,
} from '../fileChangedWatcher.js'

describe('densable 2.1.222 #14 remote UNC filter (aHe)', () => {
  test('stripWindowsLongPathPrefix (J6n)', () => {
    expect(stripWindowsLongPathPrefix('\\\\?\\UNC\\server\\share')).toBe(
      '\\\\server\\share',
    )
    expect(stripWindowsLongPathPrefix('\\\\?\\C:\\Users\\x')).toBe(
      'C:\\Users\\x',
    )
    expect(stripWindowsLongPathPrefix('C:\\local')).toBe('C:\\local')
  })

  test('isUncPath / isWslUncPath', () => {
    expect(isUncPath('\\\\server\\share')).toBe(true)
    expect(isUncPath('//server/share')).toBe(true)
    expect(isUncPath('C:\\local')).toBe(false)
    expect(isWslUncPath('\\\\wsl$\\Ubuntu\\home')).toBe(true)
    expect(isWslUncPath('\\\\wsl.localhost\\Ubuntu\\home')).toBe(true)
    expect(isWslUncPath('\\\\server\\share')).toBe(false)
  })

  test('isRemoteUncWatchPath drops remote UNC, keeps WSL + local', () => {
    expect(isRemoteUncWatchPath('\\\\fileserver\\proj\\.env')).toBe(true)
    expect(isRemoteUncWatchPath('//fileserver/proj/.env')).toBe(true)
    expect(isRemoteUncWatchPath('\\\\wsl$\\Ubuntu\\home\\u\\.env')).toBe(false)
    expect(isRemoteUncWatchPath('C:\\Users\\me\\.env')).toBe(false)
    expect(isRemoteUncWatchPath('/home/me/.env')).toBe(false)
  })

  test('filterWatchableFileChangedPaths drops remote UNC entries', () => {
    const paths = [
      'C:\\proj\\.env',
      '\\\\remote\\share\\.envrc',
      '\\\\wsl$\\Ubuntu\\home\\x\\.env',
    ]
    const filtered = filterWatchableFileChangedPaths(paths)
    expect(filtered).toContain('C:\\proj\\.env')
    expect(filtered).toContain('\\\\wsl$\\Ubuntu\\home\\x\\.env')
    expect(filtered).not.toContain('\\\\remote\\share\\.envrc')
  })
})

describe('densable 2.1.222 #14 wire-up: error handlers + teardown null-first', () => {
  test('fileChangedWatcher has densable error/ready/fs_error + null-first close', () => {
    const src = readFileSync(
      join(import.meta.dir, '../fileChangedWatcher.ts'),
      'utf8',
    )
    expect(src).toContain('FileChanged: watcher error:')
    expect(src).toContain('file_watcher_start')
    expect(src).toContain('fs_error')
    expect(src).toContain('file_watcher_change_detected')
    expect(src).toContain('hook_exec_failed')
    expect(src).toContain('dropped remote UNC watch path(s)')
    expect(src).toContain('isRemoteUncWatchPath')
    // null-first teardown
    expect(src).toMatch(/const previous = watcher[\s\S]*watcher = null/)
  })

  test('settings changeDetector has densable error log', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../settings/changeDetector.ts'),
      'utf8',
    )
    expect(src).toContain('[settings] watcher error:')
    expect(src).toContain("watcher.on('error'")
  })

  test('keybindings has densable error log + usePolling', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../keybindings/loadUserBindings.ts'),
      'utf8',
    )
    expect(src).toContain('[keybindings] watcher error:')
    expect(src).toContain('usePolling: true')
    expect(src).toContain('interval: 2000')
  })

  test('cronScheduler has densable ScheduledTasks error log', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../cronScheduler.ts'),
      'utf8',
    )
    expect(src).toContain('[ScheduledTasks] watcher error:')
  })

  test('skills watcher already had densable error handler', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../skills/skillChangeDetector.ts'),
      'utf8',
    )
    expect(src).toContain('[skills] watcher error:')
  })
})
