/**
 * densable 2.1.239 #51 — ListAgents prompt names teammates + one-way cloud
 * + RC account rows. Listing OHm/Z1w is in listAgents.teammates.239.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { ListAgentsTool } from '../ListPeersTool.js'
import { getListAgentsPrompt } from '../prompt.js'

describe('densable 2.1.239 #51 ListAgents prompt', () => {
  test('gjv teammates / cloud one-way / account sessions', async () => {
    const p = getListAgentsPrompt()
    expect(p).toContain('the teammates on your team')
    expect(p).toContain(
      'a cloud session receives your message but cannot message any session back yet',
    )
    expect(p).toContain('do not ask it to reply')
    expect(p).toContain("your account's other sessions")
    expect(p).toContain('each row labeled by kind')
    expect(await ListAgentsTool.prompt()).toBe(p)
  })
})
