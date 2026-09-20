/**
 * densable 2.1.247 #2 — `nt` / `rt` / `Ne` / `Ae` / `v` @222228746
 * (`gold-spinner-tips-fn.txt`).
 *
 * Contract is the official function body. Changelog is index only.
 */
import { constants as fsConstants } from 'fs'
import { open as openFile, realpath } from 'fs/promises'
import { isAbsolute } from 'path'
import { z } from 'zod/v4'
import { logEvent } from '../analytics/index.js'
import { getRemoteManagedSettingsSyncFromCache } from '../remoteManagedSettings/syncCacheState.js'
import { getErrnoCode, isENOENT, toError } from '../../utils/errors.js'
import { stripBOM } from '../../utils/jsonRead.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { getPlatform } from '../../utils/platform.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  isSettingSourceEnabled,
  type SettingSource,
} from '../../utils/settings/constants.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import type { Tip } from './types.js'

/** densable `Ee` */
export const ORG_TIP_ID_PREFIX = 'org-tip:'
/** densable `x` */
export const CUSTOM_TIP_ID_PREFIX = 'custom-tip-'
/** densable `be` */
export const ORG_TIP_FILE_ID_PREFIX = 'org-tip:file:'
/** densable `P` */
export const ORG_TIP_TEXT_MAX = 500
/** densable `Fe` */
export const ORG_TIP_CAP = 200
/** densable `_` */
export const ORG_TIPS_FILE_MAX_BYTES = 262144
/** densable `w` */
export const DEFAULT_ORG_TIP_LABEL = 'Tip'
/** densable `we` */
export const ORG_TIP_LABEL_MAX = 40
/** densable `ye` */
export const ORG_TIP_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
/** densable `J` */
export const TRUSTED_SPINNER_TIP_SOURCES: readonly SettingSource[] = [
  'policySettings',
  'flagSettings',
  'userSettings',
]
/** densable `Re=[...X]` — remaining `SETTING_SOURCES` after `J`. */
export const PROJECT_SPINNER_TIP_SOURCES: readonly SettingSource[] = [
  'projectSettings',
  'localSettings',
]
/** densable `Ie` */
const TRANSIENT_TIPS_FILE_ERRNOS = new Set([
  'EAGAIN',
  'EBUSY',
  'EINTR',
  'EIO',
  'EMFILE',
  'ENFILE',
])
/** densable `xe` — official class; biome character-class split is invent. */
const TIP_INVISIBLE_RE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: densable xe gold
  /[\p{Cc}\p{Cf}\u2028\u2029\u180e\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu

export type OrgSpinnerTipsResult = {
  tips: Tip[]
  trustedCount: number
}

type SpinnerTipOverride = {
  excludeDefault?: boolean
  tips?: unknown[]
  tipsFile?: string
  label?: string
}

type OverrideFromSource = {
  source: SettingSource
  override: SpinnerTipOverride
}

type OrgTipsFileRead = {
  entries: unknown[]
  transient: boolean
}

type TipsFileLoadFail =
  | 'not_regular_file'
  | 'too_large'
  | 'wrong_shape'
  | 'not_found'
  | 'parse_failed'
  | 'read_failed'

/**
 * Process-lifetime owner for densable `Ce.of(e)` when the caller has no
 * React/WeakMap host. Same `q` instance → same path cache.
 */
export const ORG_TIPS_CACHE_OWNER: object = {}

/** densable `h` — UNC-shaped (`//` or `\\`). */
function isUncPath(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

/** densable `A` — code-point cap (no ellipsis). */
function capTipLabel(text: string, max: number): string {
  return [...text].slice(0, max).join('')
}

/**
 * densable `Z` — collapse ASCII/unicode line breaks, strip `xe`, squeeze
 * spaces, trim. `B(e)` is String coerce.
 */
export function sanitizeSpinnerTipText(input: string): string {
  return String(input)
    .replace(/[\t\n\r\u2028\u2029]+/g, ' ')
    .replace(TIP_INVISIBLE_RE, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** densable `Pe` */
function resolveOverrideLabel(label: string | undefined): string {
  if (label === undefined) return DEFAULT_ORG_TIP_LABEL
  const trimmed = capTipLabel(sanitizeSpinnerTipText(label), ORG_TIP_LABEL_MAX)
  return trimmed === '' ? DEFAULT_ORG_TIP_LABEL : trimmed
}

function logTipsFileLoad(result?: TipsFileLoadFail): void {
  if (!result) {
    logEvent('tips_org_tips_file_load', {})
    return
  }
  logEvent('tips_org_tips_file_load', {
    [result]: true,
  })
}

const orgTipsFileEntrySchema = lazySchema(() =>
  z.union([z.string(), z.record(z.string(), z.unknown())]),
)

const orgTipsFileEntriesSchema = lazySchema(() =>
  z.union([
    z.array(orgTipsFileEntrySchema()),
    z
      .object({ tips: z.array(orgTipsFileEntrySchema()) })
      .transform(e => e.tips),
  ]),
)

/** densable `Ne` */
async function loadOrgTipsFile(path: string): Promise<OrgTipsFileRead> {
  try {
    const noFollow =
      getPlatform() === 'windows'
        ? 0
        : fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
    const handle = await openFile(
      await realpath(path),
      fsConstants.O_RDONLY | noFollow,
    )
    let raw: string
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) {
        logTipsFileLoad('not_regular_file')
        logForDebugging(
          `spinnerTipsOverride.tipsFile ${path} is not a regular file; ignoring it`,
          { level: 'warn' },
        )
        return { entries: [], transient: false }
      }
      if (stat.size > ORG_TIPS_FILE_MAX_BYTES) {
        logTipsFileLoad('too_large')
        logForDebugging(
          `spinnerTipsOverride.tipsFile ${path} is larger than ${ORG_TIPS_FILE_MAX_BYTES} bytes; ignoring it`,
          { level: 'warn' },
        )
        return { entries: [], transient: false }
      }
      const buf = Buffer.alloc(ORG_TIPS_FILE_MAX_BYTES + 1)
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
      if (bytesRead > ORG_TIPS_FILE_MAX_BYTES) {
        logTipsFileLoad('too_large')
        return { entries: [], transient: false }
      }
      raw = stripBOM(buf.toString('utf8', 0, bytesRead))
    } finally {
      await handle.close()
    }
    const parsed = orgTipsFileEntriesSchema().safeParse(JSON.parse(raw))
    const entries = parsed.success ? parsed.data : undefined
    if (entries === undefined) {
      logTipsFileLoad('wrong_shape')
      logForDebugging(
        `spinnerTipsOverride.tipsFile ${path} must be a JSON array of tips (or {"tips": [...]}); ignoring it`,
        { level: 'warn' },
      )
      return { entries: [], transient: false }
    }
    logTipsFileLoad()
    return { entries, transient: false }
  } catch (err) {
    const errno = getErrnoCode(err)
    const reason: TipsFileLoadFail = isENOENT(err)
      ? 'not_found'
      : errno === 'ELOOP' || errno === 'EISDIR'
        ? 'not_regular_file'
        : err instanceof SyntaxError
          ? 'parse_failed'
          : 'read_failed'
    logTipsFileLoad(reason)
    logForDebugging(
      isENOENT(err)
        ? `spinnerTipsOverride.tipsFile ${path} does not exist; no file tips loaded`
        : `spinnerTipsOverride.tipsFile ${path} could not be read: ${toError(err).message}`,
      { level: 'warn' },
    )
    return {
      entries: [],
      transient: errno !== undefined && TRANSIENT_TIPS_FILE_ERRNOS.has(errno),
    }
  }
}

/** densable `q` */
class OrgTipsFileCache {
  #e = new Map<string, Promise<OrgTipsFileRead>>()
  get size(): number {
    return this.#e.size
  }
  read(path: string): Promise<OrgTipsFileRead> {
    const hit = this.#e.get(path)
    if (hit) return hit
    const pending = loadOrgTipsFile(path).then(result => {
      if (result.transient) this.#e.delete(path)
      return result
    })
    this.#e.set(path, pending)
    return pending
  }
}

/** densable `N` / `Ce` */
class WeakOwnerCache<T> {
  #e = new WeakMap<object, T>()
  constructor(private readonly factory: () => T) {}
  of(owner: object): T {
    const hit = this.#e.get(owner)
    if (hit) return hit
    const created = this.factory()
    this.#e.set(owner, created)
    return created
  }
}

const orgTipsFileCaches = new WeakOwnerCache(() => new OrgTipsFileCache())

/** densable `Le` */
function remoteManagedTipsFileIgnored(): boolean {
  if (getRemoteManagedSettingsSyncFromCache()?.spinnerTipsOverride?.tipsFile) {
    logForDebugging(
      'spinnerTipsOverride.tipsFile from remote managed settings is ignored; ship inline tips or install the file path via managed-settings.json',
      { level: 'warn' },
    )
    return true
  }
  return false
}

/**
 * densable `Ae` — absolute or `~/` local path; reject UNC; expand.
 */
export function resolveOrgTipsFilePath(
  tipsFile: string | undefined,
): string | undefined {
  if (!tipsFile) return
  if (!isAbsolute(tipsFile) && tipsFile !== '~' && !tipsFile.startsWith('~/')) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile must be an absolute or ~/ path (got "${tipsFile}"); ignoring it`,
      { level: 'warn' },
    )
    return
  }
  if (isUncPath(tipsFile)) {
    logForDebugging(
      'spinnerTipsOverride.tipsFile must be a local path, not a network (UNC) path; ignoring it',
      { level: 'warn' },
    )
    return
  }
  try {
    const expanded = expandPath(tipsFile)
    return isUncPath(expanded) ? undefined : expanded
  } catch (err) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile "${tipsFile}" is not a usable path: ${toError(err).message}`,
      { level: 'warn' },
    )
    return
  }
}

/** densable `R` */
function collectOverrides(
  sources: readonly SettingSource[],
): OverrideFromSource[] {
  const out: OverrideFromSource[] = []
  for (const source of sources) {
    if (!isSettingSourceEnabled(source)) continue
    const override = getSettingsForSource(source)?.spinnerTipsOverride
    if (override) out.push({ source, override })
  }
  return out
}

/** densable `Q` */
function firstDefinedOverrideField<K extends keyof SpinnerTipOverride>(
  rows: OverrideFromSource[],
  field: K,
): SpinnerTipOverride[K] {
  return rows.find(row => row.override[field] !== undefined)?.override[field]
}

/** densable `rt` / `LC` */
export function shouldExcludeDefaultSpinnerTips(): boolean {
  const trusted = collectOverrides(TRUSTED_SPINNER_TIP_SOURCES)
  if (firstDefinedOverrideField(trusted, 'excludeDefault') !== true) {
    return false
  }
  return (
    trusted.some(row => !!row.override.tipsFile) ||
    trusted.some(row => (row.override.tips?.length ?? 0) > 0)
  )
}

type PushTip = (
  id: string,
  text: string,
  cooldownSessions: number,
  priority: number,
  label: string,
) => void

/** densable `v` */
function acceptTipEntry(
  entry: unknown,
  fallbackId: string,
  label: string,
  push: PushTip,
): void {
  if (typeof entry === 'string') {
    push(fallbackId, entry, 0, 0, label)
    return
  }
  if (typeof entry !== 'object' || entry === null) {
    logForDebugging(
      'spinnerTipsOverride: tip object without a "text" string; dropped',
      { level: 'warn' },
    )
    return
  }
  const rec = entry as Record<string, unknown>
  if (typeof rec.text !== 'string') {
    logForDebugging(
      'spinnerTipsOverride: tip object without a "text" string; dropped',
      { level: 'warn' },
    )
    return
  }
  if (typeof rec.id !== 'string' || !ORG_TIP_ID_RE.test(rec.id)) {
    logForDebugging(
      'spinnerTipsOverride: tip object needs an "id" of 1-64 letters, digits, ".", "_" or "-"; dropped',
      { level: 'warn' },
    )
    return
  }
  const cooldown =
    typeof rec.cooldownSessions === 'number' &&
    Number.isInteger(rec.cooldownSessions) &&
    rec.cooldownSessions >= 0
      ? Math.min(rec.cooldownSessions, 1000)
      : 0
  const priority =
    typeof rec.priority === 'number' && Number.isFinite(rec.priority)
      ? Math.max(-10, Math.min(10, Math.trunc(rec.priority)))
      : 0
  push(`${ORG_TIP_ID_PREFIX}${rec.id}`, rec.text, cooldown, priority, label)
}

/** densable `nt` / `MC` */
export async function loadOrgSpinnerTips(
  owner: object = ORG_TIPS_CACHE_OWNER,
): Promise<OrgSpinnerTipsResult> {
  const trusted = collectOverrides(TRUSTED_SPINNER_TIP_SOURCES)
  const project = collectOverrides(PROJECT_SPINNER_TIP_SOURCES)
  if (trusted.length === 0 && project.length === 0) {
    return { tips: [], trustedCount: 0 }
  }
  const label = resolveOverrideLabel(
    firstDefinedOverrideField(trusted, 'label'),
  )
  const fileRow = trusted.find(row => !!row.override.tipsFile)
  const fileSource = fileRow?.source
  const filePath = resolveOrgTipsFilePath(
    fileSource === 'policySettings' && remoteManagedTipsFileIgnored()
      ? undefined
      : fileRow?.override.tipsFile,
  )
  for (const { source, override } of project) {
    if (override.tipsFile || override.label !== undefined) {
      logForDebugging(
        `spinnerTipsOverride.tipsFile/label in ${source} are ignored; set them in user or managed settings`,
        { level: 'warn' },
      )
    }
  }
  const fileEntries = filePath
    ? (await orgTipsFileCaches.of(owner).read(filePath)).entries
    : []
  const seen = new Set<string>()
  const tips: Tip[] = []
  const push: PushTip = (id, text, cooldownSessions, priority, tipLabel) => {
    if (tips.length >= ORG_TIP_CAP) return
    const sanitized = sanitizeSpinnerTipText(text)
    if (sanitized === '') {
      logForDebugging(
        `spinnerTipsOverride: tip "${id}" is empty after sanitizing; dropped`,
        { level: 'warn' },
      )
      return
    }
    if (sanitized.length > ORG_TIP_TEXT_MAX) {
      logForDebugging(
        `spinnerTipsOverride: tip "${id}" is longer than ${ORG_TIP_TEXT_MAX} characters; dropped`,
        { level: 'warn' },
      )
      return
    }
    if (seen.has(id)) {
      logForDebugging(
        `spinnerTipsOverride: duplicate tip id "${id}"; keeping the first`,
        { level: 'warn' },
      )
      return
    }
    seen.add(id)
    tips.push({
      id,
      label: tipLabel,
      content: async () => sanitized,
      cooldownSessions,
      priority,
      isRelevant: async () => true,
      providerAgnostic: true,
    })
  }
  let customIndex = 0
  for (const { source, override } of trusted) {
    for (const entry of override.tips ?? []) {
      acceptTipEntry(
        entry,
        `${CUSTOM_TIP_ID_PREFIX}${customIndex++}`,
        label,
        push,
      )
    }
    if (source === fileSource) {
      fileEntries.forEach((entry, index) =>
        acceptTipEntry(entry, `${ORG_TIP_FILE_ID_PREFIX}${index}`, label, push),
      )
    }
  }
  const trustedCount = tips.length
  for (const { source, override } of project) {
    for (const entry of override.tips ?? []) {
      const fallbackId = `${CUSTOM_TIP_ID_PREFIX}${customIndex++}`
      if (typeof entry === 'string') {
        acceptTipEntry(entry, fallbackId, DEFAULT_ORG_TIP_LABEL, push)
      } else {
        logForDebugging(
          `spinnerTipsOverride: object tip entries in ${source} are ignored; only plain strings are read from project settings`,
          { level: 'warn' },
        )
      }
    }
  }
  return { tips, trustedCount }
}
