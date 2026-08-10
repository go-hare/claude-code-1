import { describe, expect, test } from 'bun:test'
import type { Props } from '../MessageRow.js'
import { areMessageRowPropsEqual } from '../MessageRow.js'
import type { MessageLookups } from '../../utils/messages.js'

function baseProps(
  message: Props['message'],
  overrides: Partial<Props> = {},
): Props {
  const lookups = {
    resolvedToolUseIDs: new Set<string>(),
  } as unknown as MessageLookups
  return {
    message,
    isUserContinuation: false,
    hasContentAfter: false,
    tools: [],
    commands: [],
    verbose: false,
    inProgressToolUseIDs: new Set(),
    streamingToolUseIDs: new Set(),
    screen: 'prompt',
    columns: 80,
    latestBashOutputUUID: undefined,
    lastThinkingBlockId: undefined,
    lookups,
    ...overrides,
  } as Props
}

describe('areMessageRowPropsEqual densable bT_ briefHiddenCount', () => {
  test('re-renders when turn_duration briefHiddenCount changes (same uuid ref path)', () => {
    // Even if message reference is the same object, field may change in densable
    // equality path — local stamps via new object so reference differs first;
    // still assert field compare when reference is held constant via cast.
    const a = {
      type: 'system',
      subtype: 'turn_duration',
      uuid: '00000000-0000-4000-8000-000000000001',
      durationMs: 1000,
      briefHiddenCount: 2,
    } as unknown as Props['message']
    const b = {
      ...a,
      briefHiddenCount: 5,
    } as unknown as Props['message']
    // Force same-reference false first path: different objects
    expect(areMessageRowPropsEqual(baseProps(a), baseProps(b))).toBe(false)
  })

  test('equal static turn_duration with same briefHiddenCount bails out', () => {
    const msg = {
      type: 'system',
      subtype: 'turn_duration',
      uuid: '00000000-0000-4000-8000-000000000002',
      durationMs: 500,
      briefHiddenCount: 3,
    } as unknown as Props['message']
    // Same reference → static → equal
    expect(areMessageRowPropsEqual(baseProps(msg), baseProps(msg))).toBe(true)
  })
})

describe('areMessageRowPropsEqual densable message ref equality', () => {
  function assistantText(uuid: string, text: string) {
    return {
      type: 'assistant',
      uuid,
      message: {
        content: [{ type: 'text', text }],
      },
    } as unknown as Props['message']
  }

  // densable has no uuid+text stable bail-out — different refs always re-render
  test('re-renders when message object refs differ even if uuid+text match', () => {
    const a = assistantText('u1', '按优先序开始 2.1.222 对齐')
    const b = assistantText('u1', '按优先序开始 2.1.222 对齐')
    expect(a).not.toBe(b)
    expect(areMessageRowPropsEqual(baseProps(a), baseProps(b))).toBe(false)
  })

  test('re-renders when text body changes under same uuid', () => {
    const a = assistantText('u1', 'first')
    const b = assistantText('u1', 'second')
    expect(areMessageRowPropsEqual(baseProps(a), baseProps(b))).toBe(false)
  })

  test('bails out when same message reference and static', () => {
    const msg = assistantText('u1', 'same')
    expect(areMessageRowPropsEqual(baseProps(msg), baseProps(msg))).toBe(true)
  })
})
