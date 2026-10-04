/**
 * densable 2.1.239 #44 En_ — org policy webhook product-cut.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('criPolicyWebhook product-cut densable En_', () => {
  test('criPolicyWebhook.ts is gone', () => {
    expect(existsSync(join(import.meta.dir, '../criPolicyWebhook.ts'))).toBe(
      false,
    )
  })

  test('buildFetch does not call En_ precheck', () => {
    const client = readFileSync(
      join(import.meta.dir, '../../services/api/client.ts'),
      'utf8',
    )
    const retry = readFileSync(
      join(import.meta.dir, '../../services/api/withRetry.ts'),
      'utf8',
    )
    expect(client).not.toContain('criPolicyPrecheckFetchInput')
    expect(client).not.toContain('criPolicyWebhook')
    expect(retry).not.toContain('assertCriPolicyAllowsRequest')
    expect(retry).not.toContain('criPolicyWebhook')
  })
})
