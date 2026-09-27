import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setCwdState, setOriginalCwd } from '../../../bootstrap/state.js'
import { resetSettingsCache } from '../settingsCache.js'
import { updateSettingsForSource } from '../settings.js'

const suiteCwd = process.cwd()
const ALLOW = { permissions: { allow: ['Bash(ls)'] } }

afterEach(() => {
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  resetSettingsCache()
})

function pointLocalSettingsAt(dir: string): void {
  setCwdState(dir)
  setOriginalCwd(dir)
  process.chdir(dir)
  resetSettingsCache()
}

function localSettingsPath(dir: string): string {
  return join(dir, '.claude', 'settings.local.json')
}

function expectAllowWritten(filePath: string): void {
  const saved = JSON.parse(readFileSync(filePath, 'utf8')) as {
    permissions?: { allow?: string[] }
  }
  expect(saved.permissions?.allow).toEqual(['Bash(ls)'])
}

describe('densable 2.1.252 di empty-file skip', () => {
  test('empty settings.local.json is treated as missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-local-252-'))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    const filePath = localSettingsPath(dir)
    writeFileSync(filePath, '')
    pointLocalSettingsAt(dir)

    const result = updateSettingsForSource('localSettings', ALLOW)
    expect(result.error).toBeNull()
    expectAllowWritten(filePath)
  })

  test('whitespace-only settings.local.json is treated as missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-local-252-'))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    const filePath = localSettingsPath(dir)
    writeFileSync(filePath, '   \n')
    pointLocalSettingsAt(dir)

    const result = updateSettingsForSource('localSettings', ALLOW)
    expect(result.error).toBeNull()
    expectAllowWritten(filePath)
  })

  test('non-empty invalid JSON still returns Invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bad-local-252-'))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    const filePath = localSettingsPath(dir)
    writeFileSync(filePath, '{')
    pointLocalSettingsAt(dir)

    const result = updateSettingsForSource('localSettings', ALLOW)
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain(
      `Invalid JSON syntax in settings file at ${filePath}`,
    )
  })

  test('missing file still succeeds when .claude is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miss-local-252-'))
    pointLocalSettingsAt(dir)

    const result = updateSettingsForSource('localSettings', ALLOW)
    expect(result.error).toBeNull()
    expectAllowWritten(localSettingsPath(dir))
  })
})
