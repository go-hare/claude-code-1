import { describe, expect, test } from 'bun:test'
import {
  createProgressTracker,
  getTokenCountFromTracker,
  updateProgressFromMessage,
  updateProgressFromStreamTokenEstimate,
} from '../LocalAgentTask.js'

describe('LocalAgentTask v2.1.290 (#15 thinking/progress)', () => {
  test('streamedTokenEstimate tracks response_start and tokens delta, then settles on usage', () => {
    const tracker = createProgressTracker()
    expect(getTokenCountFromTracker(tracker)).toBe(0)

    updateProgressFromStreamTokenEstimate(tracker, {
      type: 'tokens',
      estimatedTokensDelta: 120,
    })
    expect(getTokenCountFromTracker(tracker)).toBe(120)

    updateProgressFromStreamTokenEstimate(tracker, { type: 'response_start' })
    expect(tracker.streamedTokenEstimateAtResponseStart).toBe(120)

    updateProgressFromStreamTokenEstimate(tracker, {
      type: 'tokens',
      estimatedTokensDelta: 30,
    })
    expect(getTokenCountFromTracker(tracker)).toBe(150)

    updateProgressFromMessage(tracker, {
      type: 'assistant',
      uuid: 'u1' as never,
      message: {
        id: 'resp-1',
        role: 'assistant',
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    } as never)

    // streamedTokenEstimateAtResponseStart (120) subtracted when resp-1 usage stamped
    expect(tracker.streamedTokenEstimate).toBe(30)
    expect(tracker.streamedTokenEstimateAtResponseStart).toBe(0)
    expect(tracker.lastStampedResponseId).toBe('resp-1')
    expect(getTokenCountFromTracker(tracker)).toBe(100 + 50 + 30)
  })

  test('updateProgressFromMessage deduplicates recentActivities by toolUseId', () => {
    const tracker = createProgressTracker()
    const msg = {
      type: 'assistant',
      uuid: 'u2' as never,
      message: {
        id: 'resp-2',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'Read',
            input: { file_path: 'a.ts' },
          },
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'Read',
            input: { file_path: 'a.ts' },
          },
        ],
      },
    } as never

    updateProgressFromMessage(tracker, msg)
    expect(tracker.recentActivities).toHaveLength(1)
  })
})
