/**
 * densable Z7 / L1 / UYn — refresh skillsSyncVetoed, then read it.
 *
 * Veto when syncClaudeAiSkills is false, a settings read throws, or the
 * installed policy verdict's deny kind is org_denied / latched /
 * unregistered. A present host with a null session cache is Rh cache_miss,
 * which UYn does not veto. CLAUDE_CODE_SYNC_SKILLS is a different gate.
 */
import { randomUUID } from 'crypto'
import { lstat, lutimes, open, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  leftoverPolicyLimitsHost,
  type PolicyLimitsHostCache,
} from '../cli/leftoverTulip.js'
import { getErrnoCode } from './errors.js'
import { logForDebugging } from './debug.js'
import { resolveSyncReuseWithinMs } from './residualFinalEnvGates.js'
import { getBootstrapSession } from './sessionRoot.js'
import { SETTING_SOURCES } from './settings/constants.js'
import { getSettingsForSource } from './settings/settings.js'

export {
  DEFAULT_SYNC_REUSE_WITHIN_MS,
  resolveSyncReuseWithinMs,
} from './residualFinalEnvGates.js'

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

// ---------------------------------------------------------------------------
// Official 2.1.325 #1296 — 10-minute cross-session sync reuse stamp (.last-complete-round)
// ---------------------------------------------------------------------------

export const SYNC_REUSE_STAMP_FILENAME = '.last-complete-round'
const STAMP_UUID_RE = /^[0-9a-f-]{36}$/
const STAMP_BUCKET_RE = /^[A-Za-z0-9_.-]{1,64}$/
const STAMP_MAX_BYTES = 1024

export type SyncReuseStamp = {
  token: string
  listedFor: string[]
}

export type SyncReuseCheckResult =
  | { reuse: false }
  | { reuse: true; ageMs: number; withinMs: number }

export function getSyncReuseStampPath(syncDir: string): string {
  return join(syncDir, SYNC_REUSE_STAMP_FILENAME)
}

function serializeSyncReuseStamp(stamp: SyncReuseStamp): string {
  return `${stamp.token} ${stamp.listedFor.join(',')}`
}

/** Official `fNn` @289477200 — read and validate `.last-complete-round` stamp. */
export async function readSyncReuseStamp(
  syncDir: string,
): Promise<SyncReuseStamp | null> {
  const stampPath = getSyncReuseStampPath(syncDir)
  try {
    const fh = await open(stampPath, 'r')
    try {
      const buf = Buffer.allocUnsafe(STAMP_MAX_BYTES)
      const { bytesRead } = await fh.read(buf, 0, STAMP_MAX_BYTES, 0)
      const content = buf.toString('utf8', 0, bytesRead).trim()
      const [token = '', listedRaw = ''] = content.split(' ', 2)
      if (!STAMP_UUID_RE.test(token)) return null
      return {
        token,
        listedFor: listedRaw
          ? listedRaw.split(',').filter(s => STAMP_BUCKET_RE.test(s))
          : [],
      }
    } finally {
      await fh.close().catch(() => {})
    }
  } catch {
    return null
  }
}

/** Official `DQo` / `pNn` — write/touch or clear the cross-session sync reuse stamp. */
export async function settleSyncReuseStamp(
  syncDir: string,
  kind: string,
  succeeded: boolean,
  prevStamp: SyncReuseStamp | null,
  bucketName: string,
): Promise<SyncReuseStamp | null> {
  const stampPath = getSyncReuseStampPath(syncDir)
  if (!succeeded) {
    const existing = await readSyncReuseStamp(syncDir)
    await rm(stampPath, { force: true }).catch(() => {})
    return existing ? null : null
  }
  try {
    if (prevStamp !== null) {
      const updated: SyncReuseStamp = {
        token: prevStamp.token,
        listedFor:
          prevStamp.listedFor.includes(bucketName) ||
          !STAMP_BUCKET_RE.test(bucketName)
            ? prevStamp.listedFor
            : [...prevStamp.listedFor, bucketName],
      }
      const created = await writeFile(
        stampPath,
        serializeSyncReuseStamp(updated),
        { flag: 'wx' },
      ).then(
        () => true,
        err => {
          if (getErrnoCode(err) !== 'EEXIST') throw err
          return false
        },
      )
      if (created) return updated
      const now = new Date()
      await lutimes(stampPath, now, now)
      return await readSyncReuseStamp(syncDir)
    }
    const fresh: SyncReuseStamp = {
      token: randomUUID(),
      listedFor: STAMP_BUCKET_RE.test(bucketName) ? [bucketName] : [],
    }
    const payload = serializeSyncReuseStamp(fresh)
    await rm(stampPath, { force: true })
    await writeFile(stampPath, payload, { flag: 'wx' }).catch(async err => {
      if (getErrnoCode(err) !== 'EEXIST') throw err
      await rm(stampPath, { force: true })
      await writeFile(stampPath, payload, { flag: 'wx' })
    })
    return fresh
  } catch (err) {
    logForDebugging(
      `${kind}_sync_reuse_stamp_failed: ${getErrnoCode(err) ?? 'unknown'}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * Official `Sho` + `yho` (#1296) — check whether the sync stamp in `syncDir`
 * is fresh within `resolveSyncReuseWithinMs(env)` (or explicit `withinMs`).
 */
export async function checkSyncReuseWithinMs(
  syncDir: string,
  withinMs: number | undefined = resolveSyncReuseWithinMs(),
  nowMs: number = Date.now(),
): Promise<SyncReuseCheckResult> {
  if (withinMs === undefined || withinMs <= 0) {
    return { reuse: false }
  }
  let mtimeMs: number
  try {
    const st = await lstat(getSyncReuseStampPath(syncDir))
    if (!st.isFile()) return { reuse: false }
    mtimeMs = Math.floor(st.mtimeMs)
  } catch {
    return { reuse: false }
  }
  const ageMs = nowMs - mtimeMs
  if (ageMs < 0 || ageMs >= withinMs) {
    return { reuse: false }
  }
  return { reuse: true, ageMs: Math.round(ageMs), withinMs }
}
