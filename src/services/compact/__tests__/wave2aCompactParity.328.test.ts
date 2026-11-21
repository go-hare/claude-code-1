import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '../../../types/message.js'
import { truncateHeadForPTLRetry } from '../compact.js'

const compactSrc = readFileSync(join(import.meta.dir, '../compact.ts'), 'utf8')
const reactiveSrc = readFileSync(
  join(import.meta.dir, '../reactiveCompact.ts'),
  'utf8',
)

function makeTurn(idx: number, textLen: number): Message[] {
  return [
    {
      type: 'user',
      uuid: `00000000-0000-4000-8000-00000000010${idx}`,
      message: {
        role: 'user',
        content: `prompt-${idx}: ${'a'.repeat(textLen)}`,
      },
    } as unknown as Message,
    {
      type: 'assistant',
      uuid: `00000000-0000-4000-8000-00000000020${idx}`,
      message: {
        id: `msg-${idx}`,
        role: 'assistant',
        content: [
          { type: 'text', text: `reply-${idx}: ${'b'.repeat(textLen)}` },
        ],
      },
    } as unknown as Message,
  ]
}

describe('Wave 2A [P1-#7]: compact.ts guards isApiErrorMessage on non-prefix API errors', () => {
  test('full compact checks !summaryResponse.isApiErrorMessage before <summary> retry and summaryResponse.isApiErrorMessage on api_error guard', () => {
    const fullRetryIdx = compactSrc.indexOf(
      'Compact: the reply has no <summary> block, asking for the summary once more',
    )
    expect(fullRetryIdx).toBeGreaterThan(0)
    const beforeFullRetry = compactSrc.slice(fullRetryIdx - 700, fullRetryIdx)
    expect(beforeFullRetry).toContain('!summaryResponse.isApiErrorMessage')

    const afterFullRetry = compactSrc.slice(fullRetryIdx, fullRetryIdx + 1600)
    expect(afterFullRetry).toContain('summaryResponse.isApiErrorMessage ||')
    expect(afterFullRetry).toContain('startsWithApiErrorPrefix(summary)')
  })

  test('partial compact also guards !summaryResponse.isApiErrorMessage and summaryResponse.isApiErrorMessage || startsWithApiErrorPrefix', () => {
    const partialRetryIdx = compactSrc.lastIndexOf(
      'Compact: the reply has no <summary> block, asking for the summary once more',
    )
    expect(partialRetryIdx).toBeGreaterThan(0)
    const beforePartial = compactSrc.slice(
      partialRetryIdx - 600,
      partialRetryIdx,
    )
    expect(beforePartial).toContain('!summaryResponse.isApiErrorMessage')

    const afterPartial = compactSrc.slice(
      partialRetryIdx,
      partialRetryIdx + 1200,
    )
    expect(afterPartial).toContain('summaryResponse.isApiErrorMessage ||')
    expect(afterPartial).toContain('startsWithApiErrorPrefix(summary)')
  })
})

describe('Wave 2A [P2-#3]: reactiveCompact forwards tokenGap to compactConversation', () => {
  test('truncateHeadForPTLRetry seeds truncation from explicit tokenGap without requiring ptlResponse', () => {
    const messages = [
      ...makeTurn(1, 2000),
      ...makeTurn(2, 2000),
      ...makeTurn(3, 2000),
      ...makeTurn(4, 2000),
    ]
    const trimmed = truncateHeadForPTLRetry(messages, undefined, false, 1500)
    expect(trimmed).not.toBeNull()
    expect(trimmed!.length).toBeLessThan(messages.length)
    // Always retains at least the trailing round
    expect(
      trimmed!.some(m => m.uuid === '00000000-0000-4000-8000-000000000204'),
    ).toBe(true)
  })

  test('reactiveCompact.ts destructures tokenGap and forwards it into compactConversation', () => {
    expect(reactiveSrc).toContain('cacheSafeParams,\n  tokenGap,')
    expect(reactiveSrc).toContain('undefined,\n      tokenGap,')
    expect(compactSrc).toContain('initialTokenGap?: number')
    expect(compactSrc).toContain(
      'if (initialTokenGap !== undefined && initialTokenGap > 0)',
    )
  })
})
