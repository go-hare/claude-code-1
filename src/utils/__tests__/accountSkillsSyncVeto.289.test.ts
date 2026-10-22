import { afterEach, describe, expect, test } from 'bun:test'
import { leftoverPolicyLimitsHost } from '../../cli/leftoverTulip.js'
import {
  accountSkillsPolicyDenyKind,
  refreshAccountSkillsSyncVeto,
} from '../accountSkillsSyncVeto.js'

describe('UYn account skills deny kind', () => {
  const host = leftoverPolicyLimitsHost()
  const savedCache = host.sessionCache
  const savedHints = [...host.hintedTaints]
  const savedCompliance = [...host.complianceTaints]

  afterEach(() => {
    host.sessionCache = savedCache
    host.hintedTaints = savedHints
    host.complianceTaints = savedCompliance
    refreshAccountSkillsSyncVeto()
  })

  test('a missing verdict object is unregistered', () => {
    expect(accountSkillsPolicyDenyKind(null)).toBe('unregistered')
  })

  test('a null session cache is cache_miss and does not veto', () => {
    host.sessionCache = null
    host.hintedTaints = []
    host.complianceTaints = []
    expect(accountSkillsPolicyDenyKind()).toBe('cache_miss')
    expect(refreshAccountSkillsSyncVeto()).toBe(false)
  })

  test('allowed false is org_denied and vetoes', () => {
    host.sessionCache = {
      allow_account_skills_sync: { allowed: false },
    }
    expect(accountSkillsPolicyDenyKind()).toBe('org_denied')
    expect(refreshAccountSkillsSyncVeto()).toBe(true)
  })
})
