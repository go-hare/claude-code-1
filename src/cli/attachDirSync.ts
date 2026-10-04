/**
 * densable 2.1.283 leftover `_e` attach-prepare wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `_e` as `startAttachSync` @211912012
 * - `I` @211913200 askAttachDirSyncConsent
 * - `M` @211911634 DIR_SYNC_ATTACH_PREPARE_READY_LINE
 * - `T` @211911793 DIR_SYNC_ATTACH_ON_LINE
 * - `Tqe` @182142275 ATTACH_SYNC_COMPLIANCE_LINE
 * - `AO`/`B4` @181906163 CLAUDE_CODE_DIR_SYNC_ENGINE none/off/0/false/no
 * - `Kje` = `isHostedServeDialogsEnabled` (wood∧chinrest). Not soundpost.
 *
 * Gold: `!(flagOn??Kje)()` → undefined. Returns the prepare handle immediately
 * (async IIFE). No FS engine / device-key / settings writes.
 */

import { getOriginalCwd } from 'src/bootstrap/state.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isHostedServeDialogsEnabled } from './violinWood.js'
import {
  attachLaptopDirSyncSession,
  CLOUD_SYNC_CONSENT_DEFAULT,
  CLOUD_SYNC_CONSENT_KIND,
  CLOUD_SYNC_CONSENT_RESULTS,
  dirSyncConsentCopy,
  type HeadlessCloudDialogs,
  remoteFileMode,
} from './cloudSession.js'

/** gold `Tqe` @182142275 — HIPAA / retention refuse line. */
export const ATTACH_SYNC_COMPLIANCE_LINE =
  'File sync is not available for your organization: its data retention policy does not allow it.'

/** gold `M` @211911634 / densable `_e` attach-prepare ready line. */
export const DIR_SYNC_ATTACH_PREPARE_READY_LINE =
  'This folder is set to stay in sync with the cloud session. File sync starts the next time Claude runs something on this computer, if the session can sync.'

/** gold `T` @211911793 */
export const DIR_SYNC_ATTACH_ON_LINE =
  "File sync is on for this session: your changes in this folder are copied into the session's checkout and Claude's changes there are copied here, each time Claude runs something on this computer and when its turn ends."

const DIR_SYNC_ENGINE_OFF = new Set(['none', 'off', '0', 'false', 'no'])

/**
 * gold `AO`/`B4` @181906163 — `CLAUDE_CODE_DIR_SYNC_ENGINE` none/off/0/false/no.
 */
export function isDirSyncEngineOn(): boolean {
  const raw = process.env.CLAUDE_CODE_DIR_SYNC_ENGINE
  if (raw === undefined || raw.trim() === '') return true
  const words = raw
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  const unknown = words.filter(w => !DIR_SYNC_ENGINE_OFF.has(w))
  if (unknown.length > 0) {
    logForDebugging(
      `${unknown.join(', ')} in CLAUDE_CODE_DIR_SYNC_ENGINE; the only words it knows are none/off/0/false/no (no directory sync); unset leaves sync on`,
      { level: 'warn' },
    )
  }
  return !words.some(w => DIR_SYNC_ENGINE_OFF.has(w))
}

export type AttachDirSyncPrepareHandle = {
  sessionId: string
  gitRoot: string
  status: { publish: (line: string, level: string) => void }
  sync: { state: () => Record<string, unknown> }
}

/**
 * densable `I` @211913200 — attach QUe. No dialogs → unasked.
 */
export async function askAttachDirSyncConsent(opts: {
  gitRoot: string
  servedFolder: string
  dialogs?: HeadlessCloudDialogs
  storageV5?: unknown
  signal?: AbortSignal
  storedMode?: string
}): Promise<'yes' | 'no' | 'unasked'> {
  const u =
    'sdk_host_attach' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const f = opts.storedMode ?? (await remoteFileMode(opts.gitRoot))
  if (f === 'container_sync') return 'yes'
  if (f !== 'unspecified') return 'no'
  const a = dirSyncConsentCopy({
    folder: opts.servedFolder,
    launchFolder: opts.servedFolder,
    copy: 'attach',
  })
  if (
    opts.dialogs === undefined ||
    !opts.dialogs.kinds.has(CLOUD_SYNC_CONSENT_KIND) ||
    a === null
  ) {
    logEvent('tengu_dir_sync_mode_prompt_skipped', {
      reason:
        'host_undeclared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface: u,
    })
    return 'unasked'
  }
  logEvent('tengu_dir_sync_mode_prompt_shown', { surface: u })
  const { answer: r, answered: e } = await opts.dialogs.request(
    {
      kind: CLOUD_SYNC_CONSENT_KIND,
      result: CLOUD_SYNC_CONSENT_RESULTS,
      default: CLOUD_SYNC_CONSENT_DEFAULT,
    },
    a,
    { signal: opts.signal },
  )
  if (!e || r === 'not_now') {
    logEvent('tengu_dir_sync_mode_prompt', {
      choice:
        'not_now' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface: u,
    })
    return 'no'
  }
  const h = r === 'sync' ? 'container_sync' : 'device_tools'
  logEvent('tengu_dir_sync_mode_prompt', {
    choice: h as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    surface: u,
  })
  void opts.storageV5
  return h === 'container_sync' ? 'yes' : 'no'
}

/**
 * gold `_e` as `startAttachSync` @211912012.
 * Gold: `!(flagOn??Kje)()` → undefined. No FS engine: consent yes → Me
 * `engine_declined`. Returns the prepare handle immediately (async IIFE).
 */
export function startAttachSync(opts: {
  sessionId: string
  boundToThisMachine: boolean | Promise<boolean>
  sessionHost?: unknown
  sources?: Promise<unknown> | unknown
  dialogs?: HeadlessCloudDialogs
  storageV5?: unknown
  credentials?: unknown
  signal?: AbortSignal
  seams?: {
    flagOn?: () => boolean | Promise<boolean>
    launchDirectory?: () => string
  }
}): AttachDirSyncPrepareHandle | undefined {
  // gold Kje wrap: hosted-serve dialogs (wood∧chinrest). Not soundpost.
  const flagged = (opts.seams?.flagOn ?? isHostedServeDialogsEnabled)()
  if (flagged === false) return
  const r = (opts.seams?.launchDirectory ?? getOriginalCwd)()
  const S: AttachDirSyncPrepareHandle = {
    sessionId: opts.sessionId,
    gitRoot: r,
    status: { publish: () => undefined },
    sync: { state: () => ({ state: 'off', reason: 'not_opted_in' }) },
  }
  const b = (k: string) => {
    logEvent('tengu_dir_sync_attach_prepare', {
      outcome: k as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  void (async () => {
    if (opts.signal?.aborted) return
    const R = await askAttachDirSyncConsent({
      gitRoot: r,
      servedFolder: r,
      dialogs: opts.dialogs,
      storageV5: opts.storageV5,
      signal: opts.signal,
    })
    if (R !== 'yes' || opts.signal?.aborted) {
      b(R === 'unasked' ? 'consent_unasked' : 'consent_no')
      return
    }
    const me = await attachLaptopDirSyncSession({
      sessionId: opts.sessionId,
      boundToThisMachine: opts.boundToThisMachine,
      fileMode: 'container_sync',
      cwd: r,
    })
    if (me?.engine.reason === 'engine_declined') {
      S.status.publish(me.engine.line, 'info')
      b('engine_declined')
      return
    }
    logEvent('tengu_dir_sync_attach_prepare', {
      outcome:
        'ready' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    S.status.publish(DIR_SYNC_ATTACH_PREPARE_READY_LINE, 'info')
  })().catch(() => undefined)
  void opts.sources
  void opts.credentials
  void opts.sessionHost
  return S
}
