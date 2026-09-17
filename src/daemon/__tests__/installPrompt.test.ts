import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isDaemonInstallPromptDismissed,
  setDaemonInstallPromptDismissed,
} from '../installPrompt.js'

describe('daemonInstallPromptDismissed config', () => {
  const prev = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    setDaemonInstallPromptDismissed(false)
  })

  afterEach(() => {
    setDaemonInstallPromptDismissed(false)
    process.env.NODE_ENV = prev
  })

  test('defaults false then set true', () => {
    expect(isDaemonInstallPromptDismissed()).toBe(false)
    setDaemonInstallPromptDismissed(true)
    expect(isDaemonInstallPromptDismissed()).toBe(true)
  })
})

describe('densable 2.1.246 #8 ensure reinstall event', () => {
  test('ensure records daemon_ensure_spawn_waited_reinstall after recovered wait', () => {
    const src = readFileSync(
      join(import.meta.dir, '../installPrompt.ts'),
      'utf8',
    )
    expect(src).toContain('recoveredAfterReinstallWait')
    expect(src).toContain("logEvent('daemon_ensure_running'")
    expect(src).toContain('daemon_ensure_spawn_waited_reinstall: true')
  })
})
