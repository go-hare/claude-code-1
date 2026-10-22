/**
 * densable Z7 / L1 / UYn — refresh skillsSyncVetoed, then read it.
 *
 * Veto when syncClaudeAiSkills is false, a settings read throws, or the
 * installed policy verdict's deny kind is org_denied / latched /
 * unregistered. A present host with a null session cache is Rh cache_miss,
 * which UYn does not veto. CLAUDE_CODE_SYNC_SKILLS is a different gate.
 */
import {
  leftoverPolicyLimitsHost,
  type PolicyLimitsHostCache,
} from '../cli/leftoverTulip.js'
import { getBootstrapSession } from './sessionRoot.js'
import { SETTING_SOURCES } from './settings/constants.js'
import { getSettingsForSource } from './settings/settings.js'

const ACCOUNT_SKILLS_POLICY_KEY = 'allow_account_skills_sync'

export type AccountSkillsDenyKind =
  | 'unregistered'
  | 'org_denied'
  | 'latched'
  | 'cache_miss'
  | null

/**
 * Gold hA + Rh for allow_account_skills_sync.
 * `verdict === null` is hA's missing verdict object (unregistered).
 * The live policy host is that object once the module has loaded.
 */
export function accountSkillsPolicyDenyKind(
  verdict: PolicyLimitsHostCache | null = leftoverPolicyLimitsHost(),
): AccountSkillsDenyKind {
  if (verdict === null) return 'unregistered'
  const cache = verdict.sessionCache
  const entry = cache?.[ACCOUNT_SKILLS_POLICY_KEY]
  if (entry?.allowed === true) return null
  if (entry?.allowed === false) return 'org_denied'
  // cEn latches only when a latched taint hits this key. An empty host
  // has no such taint, so a null cache stays cache_miss.
  const latched =
    verdict.hintedTaints.includes('hipaa') &&
    !verdict.complianceTaints.includes('hipaa')
  if (latched && cache === null) return 'latched'
  return 'cache_miss'
}

function denyKindVetoes(kind: AccountSkillsDenyKind): boolean {
  return kind === 'unregistered' || kind === 'org_denied' || kind === 'latched'
}

export function refreshAccountSkillsSyncVeto(): boolean {
  let veto = false
  try {
    for (const source of SETTING_SOURCES) {
      if (getSettingsForSource(source)?.syncClaudeAiSkills === false) {
        veto = true
        break
      }
    }
  } catch {
    veto = true
  }
  if (denyKindVetoes(accountSkillsPolicyDenyKind())) veto = true
  getBootstrapSession().sessionFlags.replaceSkillsSyncVetoed(veto)
  return getBootstrapSession().sessionFlags.skillsSyncVetoed()
}
