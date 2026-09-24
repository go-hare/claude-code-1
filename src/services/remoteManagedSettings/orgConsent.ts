/**
 * densable 2.1.224 #24 / 2.1.251 #43 — org-scoped managed-settings consent.
 *
 * Gold (`gold-251-g` #43):
 *   se @190732026 — consent path under config home
 *   oe @190732059 — load records (storageV5 readText | an().readRange)
 *   ie @190733145 — same org+account hash or null
 *   ae @190733303 — persist records (r.write | an().atomicWrite mode 384)
 *   Zor @179883181 — org_record / consented_payload compare
 *
 * File: `remote-settings-consent.json` under Claude config home
 * StorageV5 state id: `remote-settings-consent` (Ee.state(re))
 * Shape: { version: 1, records: { [organizationUuid]: { accountUuid, dangerousSettingsHash, updatedAt } } }
 */
import { createHash } from 'crypto'
import { open, unlink } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import {
  extractDangerousSettings,
  type DangerousSettings,
  hasDangerousSettings,
} from '../../components/ManagedSettingsSecurityDialog/utils.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage, isENOENT } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { atomicWriteFileWithMode } from '../../utils/storageV5/atomicWrite.js'
import type {
  StorageV5,
  StorageV5Result,
} from '../../utils/storageV5/createLocalFsBackend.js'
import { isHoverRestOn } from '../../utils/storageV5/hoverRestPin.js'

const CONSENT_FILENAME = 'remote-settings-consent.json'
/** densable `re` — storageV5 state id for Ee.state(re) */
const CONSENT_STATE_ID = 'remote-settings-consent'
const CONSENT_VERSION = 1
const MAX_RECORDS = 20
/** densable He — skip rewrite if same hash within 24h */
const FRESH_MS = 86_400_000
/** densable x — max readable consent body (1 MiB) */
const CONSENT_MAX_BYTES = 1_048_576

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

/** densable Ee.state / Se.state — storageV5 state key */
export function consentStorageKey(): { namespace: 'state'; id: string } {
  return { namespace: 'state', id: CONSENT_STATE_ID }
}

/**
 * densable storage surface for oe/ae when M() (hover-rest) is on.
 * Matches StorageV5.readText / write used by gold oe/ae.
 */
export type ConsentStorage = Pick<StorageV5, 'readText' | 'write'>

const OrgConsentRecordSchema = lazySchema(() =>
  z.object({
    accountUuid: z.string(),
    dangerousSettingsHash: z.string(),
    updatedAt: z.number(),
  }),
)

const ConsentFileSchema = lazySchema(() =>
  z.object({
    version: z.literal(CONSENT_VERSION),
    records: z.record(z.string(), z.unknown()),
  }),
)

/** densable Ne — version from a newer writer */
const NewerConsentFileSchema = lazySchema(() =>
  z.object({ version: z.number().gt(CONSENT_VERSION) }),
)

/** densable `se` — consent records path under config home. */
function se(): string {
  return join(getClaudeConfigHomeDir(), CONSENT_FILENAME)
}

/** densable Ge — storage error label for logs */
function Ge(error: unknown): string {
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>
    if (typeof rec.telemetryCode === 'string') return rec.telemetryCode
    if (typeof rec.code === 'string') return rec.code
    if (typeof rec.message === 'string') return rec.message
  }
  return errorMessage(error)
}

/**
 * densable an().readRange(path, 0, max+1) stand-in for the legacy FS arm.
 * Gold opens via an(); tip uses fs open + bounded read (same bytes contract).
 */
async function readConsentRange(
  path: string,
  maxPlusOne: number,
): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(maxPlusOne)
    const { bytesRead } = await handle.read(buf, 0, maxPlusOne, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * densable `an` — leftover FS ops object.
 * Only atomicWrite is required by ae; mode 384 is the official owner-rw arm.
 */
function an(): {
  atomicWrite: (path: string, value: string, mode: number) => Promise<void>
} {
  return {
    atomicWrite: (path, value, mode) =>
      atomicWriteFileWithMode(path, value, mode),
  }
}

/**
 * densable fEt / ve — sha256 of dangerous projection.
 * 251 VU carries sandboxSettings separately (eAn/c5); include it so Zor
 * same-hash skip and sandbox-only changes stay consistent with c5.
 */
export function hashDangerousSettings(dangerous: DangerousSettings): string {
  const payload = {
    shellSettings: dangerous.shellSettings,
    sandboxSettings: dangerous.sandboxSettings,
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

/** densable consentIdentity — oauth org+account for org_record keying */
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

/**
 * densable oe — load consent records.
 * Hover-rest + storage → readText([Ee.state(re)]); else an().readRange(se(),0,x+1).
 */
async function readConsentFile(storage?: ConsentStorage): Promise<{
  records: Map<string, OrgConsentRecord>
  newerVersion: boolean
  unreadable: boolean
}> {
  let raw: string | undefined
  // densable M() && e !== void 0
  if (isHoverRestOn() && storage !== undefined) {
    let readResult: StorageV5Result<{
      items: Array<{ found: boolean; value?: string }>
    }>
    try {
      readResult = await storage.readText([consentStorageKey()])
    } catch (a) {
      logForDebugging(
        `Remote settings: Consent records unreadable - ${errorMessage(a)}`,
      )
      return { records: new Map(), newerVersion: false, unreadable: true }
    }
    if (!readResult.ok) {
      logForDebugging(
        `Remote settings: Consent records unreadable - ${Ge(readResult.error)}`,
      )
      return { records: new Map(), newerVersion: false, unreadable: true }
    }
    const item = readResult.value.items[0]
    if (!item?.found) {
      return { records: new Map(), newerVersion: false, unreadable: false }
    }
    raw = item.value
  } else {
    try {
      const range = await readConsentRange(se(), CONSENT_MAX_BYTES + 1)
      if (range.length > CONSENT_MAX_BYTES) {
        logForDebugging(
          `Remote settings: Consent records file exceeds ${CONSENT_MAX_BYTES} bytes; treating it as unreadable`,
        )
        return { records: new Map(), newerVersion: false, unreadable: true }
      }
      raw = range.toString('utf8')
    } catch (r) {
      // densable unreadable:!Y(r) — Y = isENOENT
      return {
        records: new Map(),
        newerVersion: false,
        unreadable: !isENOENT(r),
      }
    }
  }

  try {
    const parsed: unknown = jsonParse(raw ?? '')
    const file = ConsentFileSchema().safeParse(parsed)
    if (!file.success) {
      return {
        records: new Map(),
        newerVersion: NewerConsentFileSchema().safeParse(parsed).success,
        unreadable: false,
      }
    }
    const records = new Map<string, OrgConsentRecord>()
    for (const [org, rec] of Object.entries(file.data.records)) {
      const one = OrgConsentRecordSchema().safeParse(rec)
      if (one.success) records.set(org, one.data)
    }
    return { records, newerVersion: false, unreadable: false }
  } catch {
    return { records: new Map(), newerVersion: false, unreadable: true }
  }
}

/** densable ie */
export async function getOrgDangerousSettingsHash(
  identity: ConsentIdentity,
  storage?: ConsentStorage,
): Promise<string | null> {
  const { records } = await readConsentFile(storage)
  const rec = records.get(identity.organizationUuid)
  if (!rec || rec.accountUuid !== identity.accountUuid) return null
  return rec.dangerousSettingsHash
}

/**
 * densable ae — record org consent after approved/no_check apply.
 * Hover-rest + storage → r.write(Ee.state(re), P, {mode:384});
 * else an().atomicWrite(se(), P, 384).
 */
export async function recordOrgConsent(
  identity: ConsentIdentity | null | undefined,
  settings: SettingsJson | null | undefined,
  storage?: ConsentStorage,
): Promise<void> {
  if (!identity) return
  try {
    const { records, newerVersion, unreadable } = await readConsentFile(storage)
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
    const payload = jsonStringify({
      version: CONSENT_VERSION,
      records: Object.fromEntries(sorted),
    })
    // densable M() && r !== void 0
    if (isHoverRestOn() && storage !== undefined) {
      const written = await storage.write(consentStorageKey(), payload, {
        mode: 384,
      })
      if (!written.ok) {
        logForDebugging(
          `Remote settings: Failed to record org consent - ${Ge(written.error)}`,
        )
      }
      return
    }
    // densable an().atomicWrite(se(), P, 384)
    await an().atomicWrite(se(), payload, 384)
  } catch (e) {
    logForDebugging(
      `Remote settings: Failed to record org consent - ${errorMessage(e)}`,
    )
  }
}

/**
 * densable Zor — consented_payload → wt; org_record → !c5(new) false,
 * hash match false, else wt(consentedPayload).
 */
export function hasDangerousSettingsChangedAgainstBaseline(
  baseline: ConsentBaseline,
  newSettings: SettingsJson | null | undefined,
): boolean {
  switch (baseline.source) {
    case 'consented_payload':
      return hasDangerousSettingsChangedLegacy(baseline.settings, newSettings)
    case 'org_record': {
      const next = extractDangerousSettings(newSettings)
      if (!hasDangerousSettings(next)) return false
      if (hashDangerousSettings(next) === baseline.dangerousSettingsHash) {
        return false
      }
      return hasDangerousSettingsChangedLegacy(
        baseline.consentedPayload,
        newSettings,
      )
    }
  }
}

/** densable wt — content compare of dangerous projections (incl. sandboxSettings) */
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
      sandboxSettings: oldDangerous.sandboxSettings,
      envVars: oldDangerous.envVars,
      hooks: oldDangerous.hooks,
      claudeMd: oldDangerous.claudeMd,
    }) !==
    jsonStringify({
      shellSettings: newDangerous.shellSettings,
      sandboxSettings: newDangerous.sandboxSettings,
      envVars: newDangerous.envVars,
      hooks: newDangerous.hooks,
      claudeMd: newDangerous.claudeMd,
    })
  )
}

/** densable rt baseline builder — ie then org_record else consented_payload */
export async function buildConsentBaseline(
  consentedPayload: SettingsJson | null,
  storage?: ConsentStorage,
): Promise<ConsentBaseline> {
  const identity = getConsentIdentity()
  if (identity) {
    const hash = await getOrgDangerousSettingsHash(identity, storage)
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
    await unlink(se())
  } catch {
    // ignore
  }
}
