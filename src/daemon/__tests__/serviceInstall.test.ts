import { describe, test, expect } from 'bun:test'
import {
  DAEMON_SERVICE_ID,
  isDaemonServiceInstallSupported,
} from '../serviceInstall.js'

describe('isDaemonServiceInstallSupported', () => {
  test('false when CLAUDE_CONFIG_DIR is set', () => {
    expect(
      isDaemonServiceInstallSupported({
        ...process.env,
        CLAUDE_CONFIG_DIR: '/tmp/custom-claude',
      }),
    ).toBe(false)
  })

  test('service id constant', () => {
    expect(DAEMON_SERVICE_ID).toBe('com.anthropic.claude-daemon')
  })
})
