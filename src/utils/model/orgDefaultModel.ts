/**
 * Official 2.1.196 densable: organization default model.
 *
 * Bootstrap response may include `org_model_default` (name + timestamps +
 * override_user_selection). When present and the session is first-party, the
 * /model Default row shows " · Org default" and that model is used when the
 * user has not pinned one (or when override_user_selection forces it).
 *
 * densable 2.1.236 adds `ANTHROPIC_DEFAULT_MODEL` (`zxt` / attribution `"env"`)
 * between org default and tier default — unlike `ANTHROPIC_MODEL`, it does not
 * pin/persist; `/model` still overrides.
 */

import {
  getInitialEnvDefaultModel,
  getResolvedOrgDefault,
  setResolvedOrgDefault,
} from '../../bootstrap/state.js'
import { getGlobalConfig } from '../config.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelAllowed } from './modelAllowlist.js'
import { getAPIProvider } from './providers.js'

export type OrgModelDefaultCache = {
  name: string
  updated_at: string
  data_source: string
  override_user_selection: boolean
  /** Bound at cache-write time so a different org cannot inherit the value. */
  orgUuid?: string
}

export type ModelDefaultAttribution =
  | 'org'
  | 'enforced'
  | 'entitlement'
  | 'env'
  | 'tier'

export type ResolvedDefaultModel = {
  setting: string
  attribution: ModelDefaultAttribution
}

/**
 * Read + validate the disk cache of org_model_default (official t_i).
 */
export function getOrgModelDefaultCache(): OrgModelDefaultCache | null {
  const config = getGlobalConfig()
  const cached = config.orgModelDefaultCache
  if (
    cached == null ||
    typeof cached !== 'object' ||
    typeof cached.name !== 'string' ||
    typeof cached.updated_at !== 'string' ||
    typeof cached.data_source !== 'string' ||
    typeof cached.override_user_selection !== 'boolean'
  ) {
    return null
  }
  const orgUuid = config.oauthAccount?.organizationUuid
  // Bound cache must match current org identity exactly:
  // - org-old cache must not leak into personal/API-key sessions (no org)
  // - unbound legacy cache must not be inherited once the user has an org
  // - org-A cache must not apply while signed into org-B
  if ((cached.orgUuid ?? null) !== (orgUuid ?? null)) {
    return null
  }
  // Strip control characters from the model name (official densable).
  const cleaned = cached.name.replace(
    // biome-ignore lint/complexity/useRegexLiterals: control ranges as string avoid noControlCharactersInRegex
    new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g'),
    '',
  )
  if (cleaned !== cached.name) {
    return { ...cached, name: cleaned }
  }
  return cached
}

/**
 * Resolve the org default model name for first-party sessions (official zUe).
 * Returns null when unset / non-firstParty / invalid.
 */
export function getResolvedOrgDefaultModel(): string | null {
  if (getAPIProvider() !== 'firstParty') {
    return null
  }
  const cached = getOrgModelDefaultCache()
  if (!cached) {
    return null
  }
  const name = cached.name.trim()
  return name.length > 0 ? name : null
}

/**
 * Session-level resolved org default with lazy cache (official KVo/wgt/G5t org arm).
 */
export function resolveOrgDefaultSetting(): string | null {
  const existing = getResolvedOrgDefault()
  if (existing !== undefined) {
    return existing
  }
  const resolved = getResolvedOrgDefaultModel()
  setResolvedOrgDefault(resolved)
  return resolved
}

/**
 * Attribution badge for the Default row in /model (official Elh/Urc/N1n + 236 aRn).
 * - org → " · Org default"
 * - enforced/entitlement → " · Set by your organization"
 * - env → " · Set by ANTHROPIC_DEFAULT_MODEL"
 * - tier → no badge
 */
export function getDefaultModelAttributionBadge(
  attribution: ModelDefaultAttribution,
): string {
  if (attribution === 'org') {
    return ' · Org default'
  }
  if (attribution === 'enforced' || attribution === 'entitlement') {
    return ' · Set by your organization'
  }
  if (attribution === 'env') {
    return ' · Set by ANTHROPIC_DEFAULT_MODEL'
  }
  return ''
}

/**
 * densable 2.1.236 `zxt()` — resolve ANTHROPIC_DEFAULT_MODEL for Default row /
 * new-session start. Portable guards only (no invent of SEA A7e catalog /
 * allowlist-cascade `lRn`).
 *
 * Returns null when unset / inert (`default`/`inherit` / plan aliases /
 * enforceAvailableModels / not allowlisted).
 */
export function resolveAnthropicDefaultModelEnv(): string | null {
  const latched = getInitialEnvDefaultModel()
  const raw =
    latched === undefined ? process.env.ANTHROPIC_DEFAULT_MODEL : latched
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (trimmed.length === 0) return null
  const lower = trimmed.toLowerCase()
  if (lower === 'default' || lower === 'inherit') return null
  // densable Z0e — plan-mode aliases are not valid DEFAULT_MODEL values.
  if (lower === 'opusplan' || lower === 'haiku') return null
  const settings = getSettings_DEPRECATED() || {}
  // densable: lRn active OR enforceAvailableModels → inert for env default.
  if (settings.enforceAvailableModels === true) return null
  if (!isModelAllowed(trimmed)) return null
  return trimmed
}

/**
 * Whether the org default should override a user-pinned model selection.
 */
export function shouldOrgDefaultOverrideUserSelection(): boolean {
  const cached = getOrgModelDefaultCache()
  return cached?.override_user_selection === true
}
