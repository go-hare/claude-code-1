/**
 * densable 2.1.246 #34 — Win/mac headless may sweep ~/.claude/sessions.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getIsInteractive, setIsInteractive } from '../../bootstrap/state.js'
import {
  _resetRegistrySweepPermittedForTests,
  isRegistrySweepPermitted,
} from '../concurrentSessions.js'

const SRC = readFileSync(
  join(import.meta.dir, '../concurrentSessions.ts'),
  'utf8',
)

describe('densable 2.1.246 #34 probeRegistrySweepPermitted', () => {
  const savedInteractive = getIsInteractive()
  const savedSandbox = process.env.IS_SANDBOX
  const savedMount = process.env.CONTAINER_SANDBOX_MOUNT_POINT

  afterEach(() => {
    setIsInteractive(savedInteractive)
    if (savedSandbox === undefined) {
      delete process.env.IS_SANDBOX
    } else {
      process.env.IS_SANDBOX = savedSandbox
    }
    if (savedMount === undefined) {
      delete process.env.CONTAINER_SANDBOX_MOUNT_POINT
    } else {
      process.env.CONTAINER_SANDBOX_MOUNT_POINT = savedMount
    }
    _resetRegistrySweepPermittedForTests()
  })

  test('source-lock: wsl first; headless only denied off win/mac', () => {
    expect(SRC).toContain("if (platform === 'wsl') return false")
    expect(SRC).toContain(
      "if (!getIsInteractive() && platform !== 'windows' && platform !== 'macos')",
    )
    expect(SRC).toContain('CONTAINER_SANDBOX_MOUNT_POINT')
    expect(SRC).toContain("USERNAME === 'ContainerAdministrator'")
    expect(SRC).toContain("USERNAME === 'ContainerUser'")
  })

  test('win/mac headless non-sandbox is permitted', async () => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return
    setIsInteractive(false)
    delete process.env.IS_SANDBOX
    delete process.env.CONTAINER_SANDBOX_MOUNT_POINT
    _resetRegistrySweepPermittedForTests()
    expect(await isRegistrySweepPermitted()).toBe(true)
  })

  test('windows container mount still denied', async () => {
    if (process.platform !== 'win32') return
    setIsInteractive(true)
    delete process.env.IS_SANDBOX
    process.env.CONTAINER_SANDBOX_MOUNT_POINT = 'C:\\sandbox'
    _resetRegistrySweepPermittedForTests()
    expect(await isRegistrySweepPermitted()).toBe(false)
  })
})
