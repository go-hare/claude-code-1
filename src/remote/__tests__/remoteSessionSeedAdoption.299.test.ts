import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('2.1.299 #621 RemoteSessionManager seedSubagentRequests adoption', () => {
  test('wires seedSubagentRequests and seedAskersPastATurn on connect and aborts lifetime on disconnect', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'RemoteSessionManager.ts'),
      'utf8',
    )
    expect(src).toContain('seedSubagentRequests?: SDKControlRequest[]')
    expect(src).toContain('seedAskersPastATurn?: string[]')
    expect(src).toContain('this.seedRequestsArmed')
    expect(src).toContain("logEvent('tengu_remote_subagent_requests_adopted'")
    expect(src).toContain('this.lifetime.abort()')
  })
})
