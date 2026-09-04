import { describe, expect, test } from 'bun:test'
import { isEnterpriseManagedClaudeAiConnector } from '../enterpriseManaged.js'

describe('densable 2.1.243 #7 enterpriseManaged marker', () => {
  test('only claudeai-proxy + claudeai scope + flag', () => {
    expect(
      isEnterpriseManagedClaudeAiConnector({
        transport: 'claudeai-proxy',
        scope: 'claudeai',
        enterpriseManaged: true,
      }),
    ).toBe(true)
    expect(
      isEnterpriseManagedClaudeAiConnector({
        transport: 'http',
        scope: 'claudeai',
        enterpriseManaged: true,
      }),
    ).toBe(false)
    expect(
      isEnterpriseManagedClaudeAiConnector({
        transport: 'claudeai-proxy',
        scope: 'user',
        enterpriseManaged: true,
      }),
    ).toBe(false)
    expect(
      isEnterpriseManagedClaudeAiConnector({
        transport: 'claudeai-proxy',
        scope: 'claudeai',
        enterpriseManaged: false,
      }),
    ).toBe(false)
  })
})
