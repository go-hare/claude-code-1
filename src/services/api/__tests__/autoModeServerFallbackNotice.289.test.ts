/**
 * densable 2.1.289 B5t / POo / lcn billing-notice copy.
 */
import { describe, expect, test } from 'bun:test'

import {
  AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL,
  autoModeClassifierBillingNoticeCopy,
  formatAutoModeClassifierBillingNotice,
} from '../autoModeServerFallbackNotice.js'

describe('autoModeClassifierBillingNoticeCopy (B5t)', () => {
  test('gateway host copy names the host and docs URL', () => {
    const copy = autoModeClassifierBillingNoticeCopy({
      gatewayHost: '204.44.121.220:8413',
    })
    expect(copy.title).toBe(
      "We're changing auto mode to no longer charge for classifier requests in Claude Code.",
    )
    expect(copy.paragraphs[0]).toContain('204.44.121.220:8413')
    expect(copy.paragraphs[1]).toContain(
      'Nothing breaks: auto mode keeps working',
    )
    expect(copy.paragraphs[2]).toBe(
      `To fix it and access the new version of auto mode, ask your gateway to implement: ${AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL}`,
    )
  })

  test('no-host copy is the ineligible-session variant', () => {
    const copy = autoModeClassifierBillingNoticeCopy({})
    expect(copy.paragraphs[0]).toBe("However, this session isn't eligible.")
    expect(copy.paragraphs[2]).toContain(AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL)
  })
})

describe('formatAutoModeClassifierBillingNotice (POo)', () => {
  test('joins title and paragraphs with spaces', () => {
    const payload = { gatewayHost: '204.44.121.220:8413' }
    const formatted = formatAutoModeClassifierBillingNotice(payload)
    const { title, paragraphs } = autoModeClassifierBillingNoticeCopy(payload)
    expect(formatted).toBe([title, ...paragraphs].join(' '))
  })
})
