import { describe, expect, test } from 'bun:test'
import { buildRequestReplayRecords } from '../requestReplay.js'

describe('requestReplay capture (#816)', () => {
  test('separates shape (system + tools), blobCandidates (messages), and params', () => {
    const { records, nextHashes, requestId } = buildRequestReplayRecords({
      sessionId: 'sess-123',
      version: '2.1.300',
      querySource: 'repl_main_thread',
      params: {
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        temperature: 1,
        system: [{ type: 'text', text: 'You are Claude.' }],
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      },
    })

    expect(records.shape.system).toEqual([
      { type: 'text', text: 'You are Claude.' },
    ])
    expect(records.shape.tools).toEqual([
      { name: 'Bash', input_schema: { type: 'object' } },
    ])
    expect(records.request.type).toBe('api-request')
    expect(records.request.params).toEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      temperature: 1,
    })
    expect(records.request.keep).toBe(0)
    expect(records.request.tail).toHaveLength(2)
    expect(records.blobCandidates).toHaveLength(2)

    // Subsequent turn reuses prefix via keep & base
    const turn2 = buildRequestReplayRecords({
      sessionId: 'sess-123',
      version: '2.1.300',
      params: {
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        system: [{ type: 'text', text: 'You are Claude.' }],
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
          { role: 'user', content: 'next' },
        ],
      },
      previousChain: {
        lastId: requestId,
        lastHashes: nextHashes,
        sessionId: 'sess-123',
      },
    })

    expect(turn2.records.request.keep).toBe(2)
    expect(turn2.records.request.base).toBe(requestId)
    expect(turn2.records.request.tail).toHaveLength(1)
    expect(turn2.records.blobCandidates).toHaveLength(1)
  })
})
