import { describe, expect, test } from 'bun:test'
import {
  groupApiRoundsAfterCompactBoundary,
  groupMessagesByApiRound,
  hasFewerThanTwoApiRounds,
} from '../grouping'

function makeMsg(type: 'user' | 'assistant' | 'system', id: string): any {
  return {
    type,
    message: { id, content: `${type}-${id}` },
  }
}

describe('groupMessagesByApiRound', () => {
  // Boundary fires when: assistant msg with NEW id AND current group has items
  test('splits before first assistant if user messages precede it', () => {
    const messages = [makeMsg('user', 'u1'), makeMsg('assistant', 'a1')]
    const groups = groupMessagesByApiRound(messages)
    // user msgs form group 1, assistant starts group 2
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(1)
    expect(groups[1]).toHaveLength(1)
  })

  test('single assistant message forms one group', () => {
    const messages = [makeMsg('assistant', 'a1')]
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(1)
  })

  test('splits at new assistant message ID', () => {
    const messages = [
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
      makeMsg('assistant', 'a2'),
    ]
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(3)
  })

  test('keeps same-ID assistant messages in same group (streaming chunks)', () => {
    const messages = [
      makeMsg('assistant', 'a1'),
      makeMsg('assistant', 'a1'),
      makeMsg('assistant', 'a1'),
    ]
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  test('returns empty array for empty input', () => {
    expect(groupMessagesByApiRound([])).toEqual([])
  })

  test('handles all user messages (no assistant)', () => {
    const messages = [makeMsg('user', 'u1'), makeMsg('user', 'u2')]
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(1)
  })

  test('three API rounds produce correct groups', () => {
    const messages = [
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
      makeMsg('user', 'u2'),
      makeMsg('assistant', 'a2'),
      makeMsg('user', 'u3'),
      makeMsg('assistant', 'a3'),
    ]
    const groups = groupMessagesByApiRound(messages)
    // [u1], [a1, u2], [a2, u3], [a3] = 4 groups
    expect(groups).toHaveLength(4)
  })

  test('consecutive user messages stay in same group', () => {
    const messages = [makeMsg('user', 'u1'), makeMsg('user', 'u2')]
    expect(groupMessagesByApiRound(messages)).toHaveLength(1)
  })

  test('does not produce empty groups', () => {
    const messages = [makeMsg('assistant', 'a1'), makeMsg('assistant', 'a2')]
    const groups = groupMessagesByApiRound(messages)
    for (const group of groups) {
      expect(group.length).toBeGreaterThan(0)
    }
  })

  test('handles single message', () => {
    expect(groupMessagesByApiRound([makeMsg('user', 'u1')])).toHaveLength(1)
  })

  test('preserves message order within groups', () => {
    const messages = [makeMsg('assistant', 'a1'), makeMsg('user', 'u2')]
    const groups = groupMessagesByApiRound(messages)
    expect(groups[0]![0]!.message!.id).toBe('a1')
    expect(groups[0]![1]!.message!.id).toBe('u2')
  })

  // densable uQt residual — isVirtual / resumedFromIncompleteThinking
  test('isVirtual messages stay in current group without splitting', () => {
    const messages = [
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
      { ...makeMsg('user', 'vu'), isVirtual: true },
      { ...makeMsg('assistant', 'va'), isVirtual: true },
      makeMsg('user', 'u2'),
    ]
    const groups = groupMessagesByApiRound(messages)
    // densable: virtuals do not open boundaries; still one split at a1 after u1
    // [u1], [a1, vu, va, u2]
    expect(groups).toHaveLength(2)
    expect(groups[1]!.map((m: any) => m.message.id)).toEqual([
      'a1',
      'vu',
      'va',
      'u2',
    ])
  })

  test('isVirtual assistant with new id does not start a group', () => {
    const messages = [
      makeMsg('assistant', 'a1'),
      { ...makeMsg('assistant', 'a_virtual'), isVirtual: true },
      makeMsg('user', 'u1'),
    ]
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  test('resumedFromIncompleteThinking does not split on new assistant id', () => {
    const messages = [
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
      {
        ...makeMsg('assistant', 'a2'),
        resumedFromIncompleteThinking: true,
      },
      makeMsg('user', 'u2'),
    ]
    const groups = groupMessagesByApiRound(messages)
    // densable uQt: !resumedFromIncompleteThinking is required for split
    // [u1], [a1, a2_resume, u2]
    expect(groups).toHaveLength(2)
    expect(groups[1]!.map((m: any) => m.message.id)).toEqual([
      'a1',
      'a2',
      'u2',
    ])
  })

  test('non-resumed new assistant id still splits', () => {
    const messages = [
      makeMsg('assistant', 'a1'),
      makeMsg('assistant', 'a2'),
    ]
    expect(groupMessagesByApiRound(messages)).toHaveLength(2)
  })

  test('handles system messages', () => {
    const messages = [makeMsg('system', 's1'), makeMsg('assistant', 'a1')]
    // system msg is non-assistant, goes to current. Then assistant a1 is new ID
    // and current has items, so split.
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(2)
  })

  test('tool_result after assistant stays in same round', () => {
    const messages = [
      makeMsg('assistant', 'a1'),
      makeMsg('user', 'tool_result_1'),
      makeMsg('assistant', 'a1'), // same ID = no new boundary
    ]
    const groups = groupMessagesByApiRound(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })
})

describe('groupApiRoundsAfterCompactBoundary densable yqr/lvu', () => {
  test('filters progress then groups (yqr)', () => {
    const messages = [
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
      { type: 'progress', message: { id: 'p1', content: '...' } },
      makeMsg('user', 'u2'),
      makeMsg('assistant', 'a2'),
    ]
    const groups = groupApiRoundsAfterCompactBoundary(messages as any)
    // progress dropped; splits: [u1], [a1,u2], [a2]
    expect(groups).toHaveLength(3)
    for (const g of groups) {
      expect(g.every((m: any) => m.type !== 'progress')).toBe(true)
    }
  })

  test('slices from last compact_boundary (Zb)', () => {
    const messages = [
      makeMsg('user', 'old'),
      makeMsg('assistant', 'a0'),
      {
        type: 'system',
        subtype: 'compact_boundary',
        message: { id: 'b1', content: 'boundary' },
      },
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
    ]
    const groups = groupApiRoundsAfterCompactBoundary(messages as any)
    // after boundary: [boundary, u1], [a1] or similar — at least 2 groups with a1 present
    const flat = groups.flat()
    expect(flat.some((m: any) => m.message?.id === 'old')).toBe(false)
    expect(flat.some((m: any) => m.message?.id === 'a1')).toBe(true)
  })

  test('hasFewerThanTwoApiRounds densable lvu', () => {
    expect(hasFewerThanTwoApiRounds([makeMsg('user', 'u1')])).toBe(true)
    expect(
      hasFewerThanTwoApiRounds([
        makeMsg('user', 'u1'),
        makeMsg('assistant', 'a1'),
      ]),
    ).toBe(false) // [u1], [a1] => 2 groups
    expect(
      hasFewerThanTwoApiRounds([
        makeMsg('assistant', 'a1'),
        makeMsg('assistant', 'a1'),
      ]),
    ).toBe(true) // same id => 1 group
  })
})
