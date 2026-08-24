import { afterEach, describe, expect, test } from 'bun:test'
import {
  getProjectDirNameOverride,
  projectDirNameOverrideCacheKey,
  sanitizeProjectDirNameOverride,
} from '../sessionStoragePortable.js'

describe('CLAUDE_CODE_PROJECT_DIR_NAME densable XLe/bws 2.1.234 #1', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const originalName = process.env.CLAUDE_CODE_PROJECT_DIR_NAME

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalName === undefined) {
      delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME
    } else {
      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = originalName
    }
  })

  test('sanitize accepts safe short names', () => {
    expect(sanitizeProjectDirNameOverride('my-project_01')).toBe(
      'my-project_01',
    )
  })

  test('sanitize rejects empty, too long, reserved, and illegal chars', () => {
    expect(sanitizeProjectDirNameOverride('')).toBeUndefined()
    expect(sanitizeProjectDirNameOverride(null)).toBeUndefined()
    expect(sanitizeProjectDirNameOverride('a'.repeat(65))).toBeUndefined()
    expect(sanitizeProjectDirNameOverride('con')).toBeUndefined()
    expect(sanitizeProjectDirNameOverride('COM1')).toBeUndefined()
    expect(sanitizeProjectDirNameOverride('has space')).toBeUndefined()
    expect(sanitizeProjectDirNameOverride('../x')).toBeUndefined()
  })

  test('override only honored when CLAUDE_CONFIG_DIR is set', () => {
    delete process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'short-name'
    expect(getProjectDirNameOverride()).toBeUndefined()

    process.env.CLAUDE_CONFIG_DIR = '/tmp/isolated-config'
    expect(getProjectDirNameOverride()).toBe('short-name')
  })

  test('ify memo key includes both env vars', () => {
    process.env.CLAUDE_CONFIG_DIR = '/cfg'
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'abc'
    expect(projectDirNameOverrideCacheKey()).toBe('/cfg\0abc')
  })
})
