import { describe, expect, test } from 'bun:test'
import { extractInboundMessageFields } from '../inboundMessages.js'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'

describe('extractInboundMessageFields client_platform', () => {
  test('extracts string client_platform for QueuedCommand stamp', () => {
    const msg = {
      type: 'user',
      uuid: '00000000-0000-4000-8000-000000000001',
      client_platform: 'ios',
      message: { role: 'user', content: 'hi from phone' },
    } as unknown as SDKMessage
    const fields = extractInboundMessageFields(msg)
    expect(fields?.content).toBe('hi from phone')
    expect(fields?.clientPlatform).toBe('ios')
  })

  test('omits clientPlatform when absent', () => {
    const msg = {
      type: 'user',
      message: { role: 'user', content: 'local' },
    } as unknown as SDKMessage
    const fields = extractInboundMessageFields(msg)
    expect(fields?.clientPlatform).toBeUndefined()
  })
})
