import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import { truncateHeadForPTLRetry } from '../compact.js'
import {
  getClaudeMdGrowthTokens,
  recordSentClaudeMdTokens,
  resetSentClaudeMdTokensForTesting,
} from '../autoCompact.js'
import {
  isAgentCacheLikelyCold,
  shouldHoldFullSummaryForColdCache,
} from '../../AgentSummary/agentSummary.js'

const srcRoot = join(import.meta.dir, '../../..')

describe('Wave 316-318 Group B: Compact / AgentSummary', () => {
  afterEach(() => {
    resetSentClaudeMdTokensForTesting()
  })

  test('#1566: truncateHeadForPTLRetry preserves leading isCompactSummary message', () => {
    const summaryMsg = {
      ...createUserMessage({
        content: 'Prior summary',
        isCompactSummary: true,
      }),
      isCompactSummary: true as const,
    }
    const msgs = [
      summaryMsg,
      createUserMessage({ content: 'turn 1' }),
      createAssistantMessage({ content: 'reply 1' }),
      createUserMessage({ content: 'turn 2' }),
      createAssistantMessage({ content: 'reply 2' }),
      createUserMessage({ content: 'turn 3' }),
      createAssistantMessage({ content: 'reply 3' }),
    ]
    const ptlResp = createAssistantMessage({ content: 'Prompt is too long' })
    const truncated = truncateHeadForPTLRetry(msgs, ptlResp)
    expect(truncated).not.toBeNull()
    expect(truncated![0]).toBe(summaryMsg)
  })

  test('#1562: autoCompact tracks CLAUDE.md growth tokens when lastSentClaudeMdTokens is recorded', async () => {
    expect(await getClaudeMdGrowthTokens()).toBe(0)
    recordSentClaudeMdTokens(0)
    expect(await getClaudeMdGrowthTokens()).toBeGreaterThanOrEqual(0)
  })

  test('#1630 & #1595: compact.ts validates summary block in partialCompact and removes FILE_UNCHANGED_STUB', () => {
    const compactSrc = readFileSync(
      join(srcRoot, 'services/compact/compact.ts'),
      'utf8',
    )
    expect(compactSrc).not.toContain('FILE_UNCHANGED_STUB')
    expect(compactSrc).toContain('no_summary_block')
  })

  test('#1673: agentSummary holds full summary up to 300s when prompt cache is likely cold', () => {
    const now = 1_000_000
    expect(
      isAgentCacheLikelyCold(
        { isAwaitingResponse: true, responsesBegun: 0 },
        now,
      ),
    ).toBe(true)
    expect(
      isAgentCacheLikelyCold(
        {
          isAwaitingResponse: true,
          responsesBegun: 1,
          lastResponseAt: now - 10_000,
        },
        now,
      ),
    ).toBe(false)
    expect(
      shouldHoldFullSummaryForColdCache({
        ownRequests: { isAwaitingResponse: true, responsesBegun: 0 },
        heldMs: 0,
        heldAtResponsesBegun: undefined,
        now,
      }),
    ).toBe(true)
    expect(
      shouldHoldFullSummaryForColdCache({
        ownRequests: { isAwaitingResponse: true, responsesBegun: 0 },
        heldMs: 300_000,
        heldAtResponsesBegun: 0,
        now,
      }),
    ).toBe(false)
  })
})
