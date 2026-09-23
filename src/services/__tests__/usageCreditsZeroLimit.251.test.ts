/**
 * densable 2.1.251 #31 — uen $0 / admin-disabled allocation + mhe().
 */
import { describe, expect, test } from 'bun:test'
import type { ClaudeAILimits } from '../claudeAiLimits.js'
import {
  getRateLimitErrorMessage,
  getUsageCreditsAskAdminHint,
} from '../rateLimitMessages.js'

function rejected(
  reason: ClaudeAILimits['overageDisabledReason'],
): ClaudeAILimits {
  return {
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    overageDisabledReason: reason,
  }
}

describe('densable 2.1.251 #31 usage-credits zero limit', () => {
  test('member allocation disabled asks an admin', () => {
    const hint = getUsageCreditsAskAdminHint()
    const message = getRateLimitErrorMessage(
      rejected('member_level_disabled'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `Your usage allocation has been disabled by your admin${hint}`,
    )
    expect(message?.startsWith("You've hit your")).toBe(false)
  })

  test('member zero credit limit uses the same sentence', () => {
    const message = getRateLimitErrorMessage(
      rejected('member_zero_credit_limit'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `Your usage allocation has been disabled by your admin${getUsageCreditsAskAdminHint()}`,
    )
  })

  test("group zero credit limit is the group's $0 sentence", () => {
    const message = getRateLimitErrorMessage(
      rejected('group_zero_credit_limit'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `Your group's usage limit is set to $0${getUsageCreditsAskAdminHint()}`,
    )
  })
})
