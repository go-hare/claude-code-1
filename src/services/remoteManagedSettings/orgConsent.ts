/**
 * densable 2.1.224 #24 — org-scoped managed-settings consent records.
 *
 * File: `remote-settings-consent.json` under Claude config home
 * Shape: { version: 1, records: { [organizationUuid]: { accountUuid, dangerousSettingsHash, updatedAt } } }
 *
 * Survives re-login wipe of `remote-settings.json` so unchanged org settings
 * do not re-prompt.
 */
import { createHash } from 'crypto'
import { open, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getGlobalConfig } from '../../utils/config.js'
import {
  extractDangerousSettings,
  type DangerousSettings,
  hasDangerousSettings,
} from '../../components/ManagedSettingsSecurityDialog/utils.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'

const CONSENT_FILENAME = 'remote-settings-consent.json'
const CONSENT_VERSION = 1
const MAX_RECORDS = 20
/** densable fYy — skip rewrite if same hash within 24h */
const FRESH_MS = 86_400_000

export type ConsentIdentity = {
  organizationUuid: string
  accountUuid: string
}

export type OrgConsentRecord = {
  accountUuid: string
  dangerousSettingsHash: string
  updatedAt: number
}

export type ConsentBaseline =
  | {
      source: 'org_record'
      dangerousSettingsHash: string
      consentedPayload: SettingsJson | null
    }
  | {
      source: 'consented_payload'
      settings: SettingsJson | null
    }

function consentPath(): string {
  return join(getClaudeConfigHomeDir(), CONSENT_FILENAME)
}

/** densable tQs + rQs — sha256 of sorted dangerous projection */
export function hashDangerousSettings(dangerous: DangerousSettings): string {
  const payload = {
    shellSettings: dangerous.shellSettings,
    envVars: dangerous.envVars,
    hooks: dangerous.hooks,
    claudeMd: dangerous.claudeMd,
  }
  return createHash('sha256').update(jsonStringify(payload)).digest('hex')
}

export function hashSettingsDangerousProjection(
  settings: SettingsJson | null | undefined,
): string {
  return hashDangerousSettings(extractDangerousSettings(settings))
}

export function getConsentIdentity(): ConsentIdentity | null {
  try {
    const account = getGlobalConfig().oauthAccount
    const organizationUuid = account?.organizationUuid
    const accountUuid = account?.accountUuid
    if (
      typeof organizationUuid === 'string' &&
      organizationUuid.length > 0 &&
      typeof accountUuid === 'string' &&
      accountUuid.length > 0
    ) {
      return { organizationUuid, accountUuid }
    }
  } catch {
    // config unavailable
  }
  return null
}

async function readConsentFile(): Promise<{
  records: Map<string, OrgConsentRecord>
  newerVersion: boolean
  unreadable: boolean
}> {
  try {
    const raw = await readFile(consentPath(), 'utf-8')
    const data: unknown = jsonParse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { records: new Map(), newerVersion: false, unreadable: true }
    }
    const obj = data as { version?: unknown; records?: unknown }
    if (typeof obj.version === 'number' && obj.version > CONSENT_VERSION) {
      return { records: new Map(), newerVersion: true, unreadable: false }
    }
    if (
      obj.version !== CONSENT_VERSION ||
      !obj.records ||
      typeof obj.records !== 'object'
    ) {
      return { records: new Map(), newerVersion: false, unreadable: false }
    }
    const records = new Map<string, OrgConsentRecord>()
    for (const [org, rec] of Object.entries(
      obj.records as Record<string, unknown>,
    )) {
      if (!rec || typeof rec !== 'object') continue
      const r = rec as Record<string, unknown>
      if (
        typeof r.accountUuid === 'string' &&
        typeof r.dangerousSettingsHash === 'string' &&
        typeof r.updatedAt === 'number'
      ) {
        records.set(org, {
          accountUuid: r.accountUuid,
          dangerousSettingsHash: r.dangerousSettingsHash,
          updatedAt: r.updatedAt,
        })
      }
    }
    return { records, newerVersion: false, unreadable: false }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return { records: new Map(), newerVersion: false, unreadable: false }
    }
    return { records: new Map(), newerVersion: false, unreadable: true }
  }
}

/** densable zXd */
export async function getOrgDangerousSettingsHash(
  identity: ConsentIdentity,
): Promise<string | null> {
  const { records } = await readConsentFile()
  const rec = records.get(identity.organizationUuid)
  if (!rec || rec.accountUuid !== identity.accountUuid) return null
  return rec.dangerousSettingsHash
}

/** densable WXd — record org consent after approved/no_check apply */
export async function recordOrgConsent(
  identity: ConsentIdentity | null | undefined,
  settings: SettingsJson | null | undefined,
): Promise<void> {
  if (!identity) return
  try {
    const { records, newerVersion, unreadable } = await readConsentFile()
    if (newerVersion || unreadable) {
      logForDebugging(
        `Remote settings: Consent records file is ${newerVersion ? 'from a newer version' : 'unreadable'}; not overwriting it`,
      )
      return
    }
    const dangerous = extractDangerousSettings(settings)
    const empty = !hasDangerousSettings(dangerous)
    const existing = records.get(identity.organizationUuid)
    const sameAccount = existing?.accountUuid === identity.accountUuid
    // densable: if empty dangerous and no existing same-account record, skip
    if (empty && !(existing && sameAccount)) return
    const hash =
      empty && existing
        ? existing.dangerousSettingsHash
        : hashDangerousSettings(dangerous)
    const now = Date.now()
    if (
      sameAccount &&
      existing &&
      existing.dangerousSettingsHash === hash &&
      now - existing.updatedAt < FRESH_MS
    ) {
      return
    }
    records.delete(identity.organizationUuid)
    const sorted = [...records.entries()]
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECORDS - 1)
    sorted.unshift([
      identity.organizationUuid,
      {
        accountUuid: identity.accountUuid,
        dangerousSettingsHash: hash,
        updatedAt: now,
      },
    ])
    const path = consentPath()
    const handle = await open(path, 'w', 0o600)
    try {
      await handle.writeFile(
        jsonStringify({
          version: CONSENT_VERSION,
          records: Object.fromEntries(sorted),
        }),
        { encoding: 'utf-8' },
      )
      await handle.datasync()
    } finally {
      await handle.close()
    }
  } catch (e) {
    logForDebugging(
      `Remote settings: Failed to record org consent - ${e instanceof Error ? e.message : 'unknown'}`,
    )
  }
}

/**
 * densable BXd — true if new settings need a security check vs baseline.
 */
export function hasDangerousSettingsChangedAgainstBaseline(
  baseline: ConsentBaseline,
  newSettings: SettingsJson | null | undefined,
): boolean {
  const newDangerous = extractDangerousSettings(newSettings)
  if (!hasDangerousSettings(newDangerous)) return false

  if (baseline.source === 'consented_payload') {
    return hasDangerousSettingsChangedLegacy(baseline.settings, newSettings)
  }

  // org_record: hash match → no re-prompt even if local cache wiped
  const newHash = hashDangerousSettings(newDangerous)
  if (newHash === baseline.dangerousSettingsHash) return false
  return hasDangerousSettingsChangedLegacy(
    baseline.consentedPayload,
    newSettings,
  )
}

/** densable $Xd / local hasDangerousSettingsChanged content compare */
function hasDangerousSettingsChangedLegacy(
  oldSettings: SettingsJson | null | undefined,
  newSettings: SettingsJson | null | undefined,
): boolean {
  const oldDangerous = extractDangerousSettings(oldSettings)
  const newDangerous = extractDangerousSettings(newSettings)
  if (!hasDangerousSettings(newDangerous)) return false
  if (!hasDangerousSettings(oldDangerous)) return true
  return (
    jsonStringify({
      shellSettings: oldDangerous.shellSettings,
      envVars: oldDangerous.envVars,
      hooks: oldDangerous.hooks,
      claudeMd: oldDangerous.claudeMd,
    }) !==
    jsonStringify({
      shellSettings: newDangerous.shellSettings,
      envVars: newDangerous.envVars,
      hooks: newDangerous.hooks,
      claudeMd: newDangerous.claudeMd,
    })
  )
}

/** Build densable consent baseline for a fetch/apply cycle */
export async function buildConsentBaseline(
  consentedPayload: SettingsJson | null,
): Promise<ConsentBaseline> {
  const identity = getConsentIdentity()
  if (identity) {
    const hash = await getOrgDangerousSettingsHash(identity)
    if (hash !== null) {
      return {
        source: 'org_record',
        dangerousSettingsHash: hash,
        consentedPayload,
      }
    }
  }
  return { source: 'consented_payload', settings: consentedPayload }
}

/** Test helper — wipe consent file */
export async function clearOrgConsentFile(): Promise<void> {
  try {
    await unlink(consentPath())
  } catch {
    // ignore
  }
}
