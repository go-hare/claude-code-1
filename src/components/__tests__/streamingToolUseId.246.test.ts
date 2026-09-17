import { describe, expect, test } from 'bun:test'
import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  filterStreamingToolUsesWithoutInProgress,
  hasNonEmptyStreamingToolUseId,
  resolveMintedStreamingToolUseId,
} from '../Messages.js'
import type { StreamingToolUse } from '../../utils/messages.js'

function stu(id: string | undefined, name = 'Bash'): StreamingToolUse {
  const contentBlock = {
    type: 'tool_use' as const,
    name,
    input: {},
  } as BetaToolUseBlock
  if (id !== undefined) {
    contentBlock.id = id
  } else {
    // Simulate proxy/stream block with no id field.
    delete (contentBlock as { id?: string }).id
  }
  return {
    index: 0,
    unparsedToolInput: '',
    contentBlock,
  }
}

describe('hasNonEmptyStreamingToolUseId (densable 246 $M)', () => {
  test('accepts non-empty string', () => {
    expect(hasNonEmptyStreamingToolUseId('toolu_abc')).toBe(true)
  })
  test('rejects empty / non-string', () => {
    expect(hasNonEmptyStreamingToolUseId('')).toBe(false)
    expect(hasNonEmptyStreamingToolUseId(undefined)).toBe(false)
    expect(hasNonEmptyStreamingToolUseId(null)).toBe(false)
  })
})

describe('filterStreamingToolUsesWithoutInProgress (densable 246 jM)', () => {
  test('keeps tool_use with missing id', () => {
    const missing = stu(undefined)
    const out = filterStreamingToolUsesWithoutInProgress(
      [missing],
      new Set(['other']),
      new Set(),
    )
    expect(out).toEqual([missing])
  })

  test('drops ids already in progress or normalized', () => {
    const a = stu('toolu_a')
    const b = stu('toolu_b')
    const out = filterStreamingToolUsesWithoutInProgress(
      [a, b],
      new Set(['toolu_a']),
      new Set(['toolu_b']),
    )
    expect(out).toEqual([])
  })

  test('dedupes duplicate streaming ids', () => {
    const a1 = stu('toolu_a')
    const a2 = stu('toolu_a')
    const out = filterStreamingToolUsesWithoutInProgress(
      [a1, a2],
      new Set(),
      new Set(),
    )
    expect(out).toEqual([a1])
  })
})

describe('resolveMintedStreamingToolUseId (densable 246 _e)', () => {
  test('reuses mint across wrapper remakes of the same contentBlock', () => {
    const missing = stu(undefined)
    const map = new WeakMap<object, string>()
    let n = 0
    const mint = () => `minted-${++n}`

    const first = resolveMintedStreamingToolUseId(map, missing, mint)
    const remade: StreamingToolUse = {
      index: missing.index,
      unparsedToolInput: '{"x":1}',
      contentBlock: missing.contentBlock,
    }
    const second = resolveMintedStreamingToolUseId(map, remade, mint)

    expect(first.minted).toBe(true)
    expect(second.minted).toBe(true)
    expect(first.id).toBe('minted-1')
    expect(second.id).toBe('minted-1')
    expect(n).toBe(1)
  })

  test('does not mint when id is already present', () => {
    const map = new WeakMap<object, string>()
    const out = resolveMintedStreamingToolUseId(map, stu('toolu_real'))
    expect(out).toEqual({ id: 'toolu_real', minted: false })
  })
})
