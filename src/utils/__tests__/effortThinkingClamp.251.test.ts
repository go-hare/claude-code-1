import { describe, expect, test } from 'bun:test'
import {
  decideEffortWhenThinkingDisabled,
  parseEffortUnsupportedWhenThinkingDisabled,
} from '../effortThinkingGuard.js'

describe('decideEffortWhenThinkingDisabled (2.1.251 #13)', () => {
  test('opus-5 xhigh with thinking off is sent as high', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'clamp', from: 'xhigh', to: 'high' })
  })

  test('provider id ending in claude-opus-5 clamps max', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'max',
        thinkingOff: true,
        model: 'us.anthropic.claude-opus-5',
      }),
    ).toEqual({ action: 'clamp', from: 'max', to: 'high' })
  })

  test('opus-5 high is unchanged', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'high',
        thinkingOff: true,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('opus-5 xhigh with thinking on is unchanged', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: false,
        model: 'claude-opus-5',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('other models pass xhigh when thinking is off (gold GMt does not throw)', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        model: 'claude-sonnet-4-6',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('mechanical disabled clamps any model above high', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        mechanical: true,
        model: 'claude-sonnet-4-6',
      }),
    ).toEqual({ action: 'clamp', from: 'xhigh', to: 'high' })
  })

  test('grok-4.6 inherited xhigh with thinking off is not a client throw', () => {
    expect(
      decideEffortWhenThinkingDisabled({
        effort: 'xhigh',
        thinkingOff: true,
        model: 'grok-4.6',
      }),
    ).toEqual({ action: 'pass' })
  })

  test('d6e parses the API 400 level and does not throw', () => {
    expect(
      parseEffortUnsupportedWhenThinkingDisabled({
        status: 400,
        message: "effort 'xhigh' is not supported when thinking is disabled",
      }),
    ).toBe('xhigh')
    expect(
      parseEffortUnsupportedWhenThinkingDisabled({
        status: 500,
        message: "effort 'xhigh' is not supported when thinking is disabled",
      }),
    ).toBeNull()
  })
})
