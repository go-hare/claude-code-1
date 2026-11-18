import { describe, expect, test } from 'bun:test'
import {
  CYBER_SAFEGUARDS_LEARN_MORE_URL,
  formatCyberSafeguardDefenseAccessNote,
  hasCyberVerificationStatus,
  prependCyberVerificationNotice,
} from '../refusalFallback.js'

describe('#735 cyber safeguard notice', () => {
  test('subagent/main cyber note mentions Defense Access and does not ask user to apply', () => {
    const note = formatCyberSafeguardDefenseAccessNote({ category: 'cyber' })
    expect(note).toContain(
      'Defense Access in the Cyber Verification Program reduces these interruptions',
    )
    expect(note).toContain(CYBER_SAFEGUARDS_LEARN_MORE_URL)
    expect(note).not.toContain('apply to the Cyber Verification Program')
  })

  test('hasCyberVerificationStatus & prependCyberVerificationNotice handle active/inactive tiers', () => {
    const activeC = {
      category: 'cyber',
      cyber_verification: { type: 'active', tier: 'c' },
    }
    expect(hasCyberVerificationStatus(activeC)).toBe(true)
    expect(prependCyberVerificationNotice('Learn more', activeC)).toContain(
      'Your Defense Access in the Cyber Verification Program covers defensive work',
    )

    const activeA = {
      category: 'cyber',
      cyber_verification: { type: 'active', tier: 'a' },
    }
    expect(prependCyberVerificationNotice('Learn more', activeA)).toBe(
      'Learn more',
    )

    const inactive = {
      category: 'cyber',
      cyber_verification: {
        type: 'inactive',
        reason: 'not_assigned_but_organization_approved',
      },
    }
    expect(prependCyberVerificationNotice('Learn more', inactive)).toContain(
      'Ask your admin for Defense Access in the Cyber Verification Program',
    )
    expect(formatCyberSafeguardDefenseAccessNote(activeC)).toBe('')
  })
})
