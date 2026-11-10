import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { shouldGenerateAwaySummary } from '../../hooks/useAwaySummary.js'
import { AWAY_SUMMARY_RECAP_MAX_CHARS } from '../awaySummary.js'
import type { Message } from '../../types/message.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')

const enoughTurns: Message[] = [
  { type: 'user', isMeta: false } as Message,
  { type: 'user', isMeta: false } as Message,
  { type: 'user', isMeta: false } as Message,
]

describe('awaySummary 2.1.289 alignment', () => {
  test('awaySummary.ts links child AbortController to signal and uses PROMPT_EN', async () => {
    const src = await Bun.file(join(ROOT, 'src/services/awaySummary.ts')).text()
    expect(AWAY_SUMMARY_RECAP_MAX_CHARS).toBe(400)
    expect(src).toContain('PROMPT_EN')
    expect(src).not.toContain('PROMPT_ZH')
    expect(src).toContain('overrides: { abortController }')
    expect(src).toContain(
      "signal.addEventListener('abort', () => abortController.abort()",
    )
  })

  test('shouldGenerateAwaySummary skips when draft input, pending background work, loop wakeup, inFlight, or >=3 failures', () => {
    const base = {
      awaySummaryEnabled: true,
      gbEnabled: true,
      featureOn: true,
      messages: enoughTurns,
    }
    expect(shouldGenerateAwaySummary(base)).toBe(true)
    expect(shouldGenerateAwaySummary({ ...base, draftInput: 'wip' })).toBe(
      false,
    )
    expect(shouldGenerateAwaySummary({ ...base, pendingAgents: 1 })).toBe(false)
    expect(shouldGenerateAwaySummary({ ...base, pendingWorkflows: 1 })).toBe(
      false,
    )
    expect(
      shouldGenerateAwaySummary({ ...base, hasPendingLoopWakeup: true }),
    ).toBe(false)
    expect(shouldGenerateAwaySummary({ ...base, inFlight: true })).toBe(false)
    expect(shouldGenerateAwaySummary({ ...base, consecutiveFailures: 2 })).toBe(
      true,
    )
    expect(shouldGenerateAwaySummary({ ...base, consecutiveFailures: 3 })).toBe(
      false,
    )
  })
})
