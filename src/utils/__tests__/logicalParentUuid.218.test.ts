/**
 * densable 2.1.218 #23 — logical_parent_uuid on compact_boundary SDK emit + mappers.
 */
import { describe, expect, test } from 'bun:test'
import { createCompactBoundaryMessage } from '../messages.js'
import { toSDKMessages, toInternalMessages } from '../messages/mappers.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'

describe('densable 2.1.218 #23 logical_parent_uuid', () => {
  test('createCompactBoundaryMessage sets logicalParentUuid', () => {
    const pre = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as const
    const msg = createCompactBoundaryMessage('manual', 1000, pre)
    expect(msg.subtype).toBe('compact_boundary')
    expect((msg as { logicalParentUuid?: string }).logicalParentUuid).toBe(pre)
  })

  test('toSDKMessages emits logical_parent_uuid when present', () => {
    const pre = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const boundary = createCompactBoundaryMessage(
      'auto',
      42,
      pre as `${string}-${string}-${string}-${string}-${string}`,
    )
    const sdk = toSDKMessages([boundary as never])
    const compact = sdk.find(
      m => (m as { subtype?: string }).subtype === 'compact_boundary',
    ) as unknown as {
      subtype: string
      logical_parent_uuid?: string
      compact_metadata: { pre_tokens: number }
    }
    expect(compact).toBeDefined()
    expect(compact.logical_parent_uuid).toBe(pre)
    expect(compact.compact_metadata.pre_tokens).toBe(42)
  })

  test('toInternalMessages plumbs logical_parent_uuid → logicalParentUuid', () => {
    const pre = '11111111-2222-3333-4444-555555555555'
    const sdkMsg = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      session_id: 'sess',
      compact_metadata: { trigger: 'manual', pre_tokens: 9 },
      logical_parent_uuid: pre,
    } as unknown as SDKMessage
    const internal = toInternalMessages([sdkMsg])
    expect(internal.length).toBe(1)
    expect(internal[0]?.type).toBe('system')
    expect(
      (internal[0] as { logicalParentUuid?: string }).logicalParentUuid,
    ).toBe(pre)
  })
})
