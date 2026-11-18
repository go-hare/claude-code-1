import { describe, expect, test } from 'bun:test'
import { applyPreservedSegmentRelinks } from '../sessionStorage.js'
import type { UUID } from 'crypto'

type TranscriptMessage =
  Parameters<typeof applyPreservedSegmentRelinks>[0] extends Map<UUID, infer V>
    ? V
    : never

describe('2.1.300 #791/#794 applyPreservedSegmentRelinks preservedMessages & retried-reply relink', () => {
  const mkUser = (uuid: string, parentUuid: string | null): TranscriptMessage =>
    ({
      type: 'user',
      uuid: uuid as UUID,
      parentUuid: parentUuid as UUID | null,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: uuid },
    }) as unknown as TranscriptMessage

  const mkAssistant = (
    uuid: string,
    parentUuid: string | null,
  ): TranscriptMessage =>
    ({
      type: 'assistant',
      uuid: uuid as UUID,
      parentUuid: parentUuid as UUID | null,
      timestamp: new Date().toISOString(),
      message: {
        id: `msg_${uuid}`,
        role: 'assistant',
        content: [{ type: 'text', text: uuid }],
        usage: {
          input_tokens: 1000,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }) as unknown as TranscriptMessage

  const mkBoundary = (
    uuid: string,
    parentUuid: string | null,
    compactMetadata: Record<string, unknown>,
  ): TranscriptMessage =>
    ({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: uuid as UUID,
      parentUuid: parentUuid as UUID | null,
      timestamp: new Date().toISOString(),
      content: 'Compacted',
      isMeta: false,
      compactMetadata,
    }) as unknown as TranscriptMessage

  test('#791 relinks preservedMessages list and zeroes stale assistant usage', () => {
    const map = new Map<UUID, TranscriptMessage>([
      ['u-old' as UUID, mkUser('u-old', null)],
      ['u-keep' as UUID, mkUser('u-keep', 'u-old')],
      ['a-keep' as UUID, mkAssistant('a-keep', 'u-keep')],
      [
        'cb-1' as UUID,
        mkBoundary('cb-1', null, {
          trigger: 'auto',
          preTokens: 1000,
          preservedMessages: {
            anchorUuid: 'sum-1',
            uuids: ['u-keep', 'a-keep'],
          },
        }),
      ],
      ['sum-1' as UUID, mkUser('sum-1', 'cb-1')],
      ['u-after' as UUID, mkUser('u-after', 'sum-1')],
    ])

    applyPreservedSegmentRelinks(map)

    expect(map.has('u-old' as UUID)).toBe(false)
    expect(map.get('u-keep' as UUID)?.parentUuid).toBe('sum-1' as UUID)
    expect(map.get('a-keep' as UUID)?.parentUuid).toBe('u-keep' as UUID)
    expect(map.get('u-after' as UUID)?.parentUuid).toBe('a-keep' as UUID)
    const aKeep = map.get('a-keep' as UUID)
    expect(
      aKeep?.type === 'assistant' && aKeep.message?.usage?.input_tokens,
    ).toBe(0)
  })

  test('#794 relinks post-boundary message whose parentUuid pointed to pruned pre-boundary retried reply', () => {
    const map = new Map<UUID, TranscriptMessage>([
      ['u-pre' as UUID, mkUser('u-pre', null)],
      ['a-retried' as UUID, mkAssistant('a-retried', 'u-pre')],
      ['u-keep' as UUID, mkUser('u-keep', 'u-pre')],
      [
        'cb-1' as UUID,
        mkBoundary('cb-1', null, {
          trigger: 'auto',
          preTokens: 1000,
          preservedMessages: {
            anchorUuid: 'sum-1',
            uuids: ['u-keep'],
          },
        }),
      ],
      ['sum-1' as UUID, mkUser('sum-1', 'cb-1')],
      ['u-after' as UUID, mkUser('u-after', 'a-retried')],
    ])

    applyPreservedSegmentRelinks(map)

    expect(map.has('a-retried' as UUID)).toBe(false)
    expect(map.get('u-after' as UUID)?.parentUuid).toBe('u-keep' as UUID)
  })
})
