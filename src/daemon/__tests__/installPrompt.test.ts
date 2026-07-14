import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
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
