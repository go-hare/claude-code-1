import { describe, expect, test } from 'bun:test'
import { getAgentViewUnavailableSlashHint } from '../AgentView.js'

describe('#1430 AgentView /config unavailable hint', () => {
  test('returns defaultToAgentsView hint for /config when enabled', () => {
    expect(getAgentViewUnavailableSlashHint('config', true)).toBe(
      'Run /config in a session. /config defaultToAgentsView=false stops opening here',
    )
  })

  test('returns generic agent view unavailable hint otherwise', () => {
    expect(getAgentViewUnavailableSlashHint('config', false)).toBe(
      "/config isn't available in agent view — open a session and run it there",
    )
    expect(getAgentViewUnavailableSlashHint('compact', true)).toBe(
      "/compact isn't available in agent view — open a session and run it there",
    )
  })
})
