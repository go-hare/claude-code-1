import { describe, expect, test } from 'bun:test'
import { BashTool } from '../../BashTool/BashTool.js'
import { MonitorTool } from '../MonitorTool.js'

describe('MonitorTool.preparePermissionMatcher (#1443)', () => {
  test('returns false-matcher when command is missing or empty', async () => {
    const matcherWs = await MonitorTool.preparePermissionMatcher!({
      description: 'ws monitor',
      ws: { url: 'wss://example.com/events' },
      timeout_ms: 300000,
    })
    expect(matcherWs('tail -f /tmp/a.log')).toBe(false)

    const matcherEmpty = await MonitorTool.preparePermissionMatcher!({
      description: 'empty command',
      command: '',
      timeout_ms: 300000,
    })
    expect(matcherEmpty('tail *')).toBe(false)
  })

  test('delegates to BashTool.preparePermissionMatcher with the same semantics', async () => {
    const cmd = 'tail -f /var/log/app.log'
    const monitorMatcher = await MonitorTool.preparePermissionMatcher!({
      description: 'watch app log',
      command: cmd,
      timeout_ms: 300000,
    })
    const bashMatcher = await BashTool.preparePermissionMatcher!({
      command: cmd,
    })
    for (const pattern of ['tail *', 'tail', 'git *', 'ls *']) {
      expect(monitorMatcher(pattern)).toBe(bashMatcher(pattern))
    }
    expect(monitorMatcher('tail *')).toBe(true)
  })
})
