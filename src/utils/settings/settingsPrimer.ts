/**
 * Official SKn @179523748 sha=435524f56ab1199e (densable 2.1.248).
 * Leftover name SettingsPrimer (never mint class identifier SKn).
 *
 * `$pn` @179527115 → leftover `settingsPrime`.
 * `Npn` @179522585 → leftover `seedUserSettings`.
 * Gold: gold-248-SKn-primer.txt / gold-248-SKn-leftover-map.txt /
 *       gold-248-Vjt-T-O-seed.txt / gold-248-wKn-v-seed.txt /
 *       gold-248-_Ke-Gqe-parent.txt / gold-248-Gqe-z-load.txt /
 *       gold-248-settings-call-sites.txt
 *
 * LANDED: Vjt/T/O/k_/k/wKn/v/Ngn/Tur/_Ke/Gqe/z/kC/Zve/Npn (+ Pc/S/W/y/cyn/$Me/F/Fte/
 *         kur/Dgn/Mgn/N/Ogn/j/b). Call sites: init `$pn`/`Npn`/`_Ke`; setup+ExitWorktree
 *         `nHe`; deeplink L0n invent-ban.
 */
import { createHash } from 'crypto'
import { basename, dirname, join, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { findCanonicalGitRoot } from '../git.js'
import { logError } from '../log.js'
import type { StorageV5 } from '../storageV5/createLocalFsBackend.js'
import type {
  HostFilePath,
  HostFilesError,
  HostFilesResult,
} from '../storageV5/createLocalHostFiles.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
import { FLAG_SETTINGS_MAX_BYTES } from './constants.js'
import type { SettingSource } from './constants.js'
import { getManagedFilePath } from './managedPath.js'
import { primeRemoteSettingsBackendView } from './remoteSettingsBackendView.js'
import {
  getSettingsOwner,
  resetSettingsCache,
  type SettingsOwner,
} from './settingsCache.js'
import type { SettingsJson } from './types.js'
import type { ValidationError } from './validation.js'

type ParsedSettings = {
  settings: SettingsJson | null
  errors: ValidationError[]
}

/** Official `P=3` in SKn chunk preamble @179522486. */
const CONSECUTIVE_THROW_DISPOSE = 3
/** Official `E=8` in SKn chunk preamble @179522490. */
const LOGGED_THROW_MESSAGE_CAP = 8

type PrimerState =
  | { kind: 'unprimed' }
  | { kind: 'absent' }
  | { kind: 'oversize' }
  | {
      kind: 'seeded'
      contentHash: string
      size: number
      parsed: ParsedSettings
    }
  | { kind: 'failing'; code: string; failureClass?: string }
  | { kind: 'broken' }

/** Official Fte @179442060. */
export function emptyParsedSettings(): ParsedSettings {
  return { settings: null, errors: [] }
}

/** Official Qve(path) @179441964. */
export function logBrokenSettingsSymlink(path: string): void {
  logForDebugging(
    `Broken symlink or missing file encountered for settings.json at path: ${path}`,
  )
}

/**
 * Official U @179535049 — apply wKn probe into LocalStoreProbes.
 */
export function applyOwnershipProbe(
  store: SettingsOwner,
  probe: { root: string; uids: unknown } | undefined,
): void {
  if (
    probe !== undefined &&
    store.localStoreProbes.primeCanonicalRootOwnerUids(probe.root, probe.uids)
  ) {
    logForDebugging(
      'settingsPrime: ownership of the local settings root read ahead through the backend',
    )
  }
}

/** Official A_ @179441371 — 2 MiB settings prime/read cap (= FLAG_SETTINGS_MAX_BYTES). */
const SETTINGS_PRIME_MAX_BYTES = FLAG_SETTINGS_MAX_BYTES

/** Official ZSt @178605173 — hostFiles space not served. */
const HOST_SPACE_UNSUPPORTED = 'Unsupported'

/** Official jW.default @179444507. */
const DEFAULT_USER_SETTINGS_BASENAME = 'settings.json'

/** Official Se.userSettings() @178789320. */
function userSettingsStorageKey(): { namespace: 'settings'; layer: 'user' } {
  return { namespace: 'settings', layer: 'user' }
}

/** Official Pc @178607517. */
function hostPath(space: HostFilePath['space'], path: string): HostFilePath {
  return { space, path }
}

/** Official Mn @179296998. */
function contentHashSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Official t4t @179013505 + $ue @179013697. */
function decodeSettingsBytes(bytes: Uint8Array): string {
  let encoding: BufferEncoding = 'utf8'
  if (bytes.byteLength >= 2 && bytes[0] === 255 && bytes[1] === 254) {
    encoding = 'utf16le'
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString(encoding)
    .replaceAll('\r\n', '\n')
}

/** Official FMe @179441524 via leftover parseSettingsFileContent (dynamic). */
async function parseSettingsContent(
  content: string,
  path: string,
): Promise<ParsedSettings> {
  const { parseSettingsFileContent } = await import('./settings.js')
  return parseSettingsFileContent(content, path)
}

/** Official Nyt @179504816. */
function describePrimeReadKind(state: PrimerState): string {
  if (state.kind !== 'failing') return state.kind
  return state.code === HOST_SPACE_UNSUPPORTED
    ? 'the backend does not serve this space'
    : `backend read failed: ${state.code}`
}

function failingFromHostError(error: HostFilesError): PrimerState {
  return {
    kind: 'failing',
    code: error.telemetryCode ?? error.code,
    failureClass: error.failureClass,
  }
}

/**
 * Official k @179522501 — `To("userSettings")` when basename === `jW.default`.
 * Dynamic import avoids settings.ts cycle (settingsCache ↔ primer).
 * Gold @179522501 — gold-248-Vjt-T-O-seed.txt
 */
async function userSettingsPrimePath(): Promise<string | undefined> {
  const { getSettingsFilePathForSource } = await import('./settings.js')
  const t = getSettingsFilePathForSource('userSettings')
  return t !== undefined && basename(t) === DEFAULT_USER_SETTINGS_BASENAME
    ? t
    : undefined
}

/**
 * Official cyn @179442667 — decide cwd vs canonical git root.
 * Leftover: getCwd + findCanonicalGitRoot + getOriginalCwd (Mo).
 */
function decideCanonicalLocalRoot(
  cwd: string,
  gitRootFinder: (cwd: string) => string | null | undefined,
):
  | { decided: string }
  | { decided: undefined; root: string; cwdResolved: string } {
  const r = gitRootFinder(cwd)
  if (!r) return { decided: resolve(cwd) }
  const o = resolve(r)
  const i = resolve(cwd)
  if (o === i) return { decided: o }
  let s: string
  try {
    s = resolve(getOriginalCwd())
  } catch {
    return { decided: i }
  }
  if (o === s) return { decided: i }
  return { decided: undefined, root: o, cwdResolved: i }
}

/**
 * Official Ngn @179506113 — canonical local settings root when undecided.
 */
function canonicalLocalSettingsRoot(): string | undefined {
  const t = decideCanonicalLocalRoot(getCwd(), findCanonicalGitRoot)
  return t.decided === undefined ? t.root : undefined
}

/** Official S @179535230 — Promise.allSettled unwrap. */
function unwrapSettled<T>(t: PromiseSettledResult<T>): T {
  if (t.status === 'rejected') throw t.reason
  return t.value
}

/** Official y @179535953 — owner uid from hostFiles.stat value. */
function ownerUidFromStat(t: {
  kind?: string
  uid?: unknown
}): number | undefined {
  if (t.kind === 'absent') return undefined
  return typeof t.uid === 'number' ? t.uid : undefined
}

/** Official w @179536005 — HostFilesError code for skip reasons. */
function hostFilesErrorCode(t: HostFilesError): string {
  return t.code === 'Failed'
    ? (t.telemetryCode ?? t.failureClass ?? t.code)
    : t.code
}

/**
 * Official W @179535299 — fold three hostFiles.stat results into uids or skipped.
 */
function ownershipUidsFromStats(
  t: HostFilesResult<Record<string, unknown>>,
  e: HostFilesResult<Record<string, unknown>>,
  s: HostFilesResult<Record<string, unknown>>,
):
  | { skipped: string }
  | {
      uids: {
        rootUid: number
        gitEntryUid: number
        claudeEntryUid: number | null
      }
    } {
  if (!t.ok) {
    return {
      skipped: `stat of the root failed: ${hostFilesErrorCode(t.error)}`,
    }
  }
  if (!e.ok) {
    return {
      skipped: `lstat of .git failed: ${hostFilesErrorCode(e.error)}`,
    }
  }
  if (!s.ok) {
    return {
      skipped: `lstat of .claude failed: ${hostFilesErrorCode(s.error)}`,
    }
  }
  const i = ownerUidFromStat(t.value)
  if (i === undefined) {
    return {
      skipped:
        t.value.kind === 'absent'
          ? 'the root is absent'
          : 'no owner uid for the root',
    }
  }
  const r = ownerUidFromStat(e.value)
  if (r === undefined) {
    return {
      skipped:
        e.value.kind === 'absent'
          ? "no .git entry (left to the probe's per-call throw)"
          : 'no owner uid for .git',
    }
  }
  let a: number | null = null
  if (s.value.kind !== 'absent') {
    const o = ownerUidFromStat(s.value)
    if (o === undefined) return { skipped: 'no owner uid for .claude' }
    a = o
  }
  return { uids: { rootUid: i, gitEntryUid: r, claudeEntryUid: a } }
}

/**
 * Official wKn @179534300 — ownership read-ahead.
 * Leftover: isHoverRestOn, Ngn→canonicalLocalSettingsRoot, Pc→hostPath,
 * hostFiles.serves/stat, S→unwrapSettled, W→ownershipUidsFromStats.
 * Gold: gold-248-wKn-v-seed.txt
 */
async function ownershipProbeAhead(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<{ root: string; uids: unknown } | undefined> {
  if (!isHoverRestOn()) return
  if (
    typeof process.getuid !== 'function' &&
    typeof process.geteuid !== 'function'
  ) {
    return
  }
  const s = canonicalLocalSettingsRoot()
  if (s === undefined || store.localStoreProbes.hasCanonicalRootOwnerUids(s)) {
    return
  }
  const i = storageV5.hostFiles
  if (!i.serves('workspace')) {
    logForDebugging(
      'settingsPrime: ownership of the local settings root not read ahead (the backend does not serve the workspace); the probe runs as today',
    )
    return
  }
  const [r, a, o] = await Promise.allSettled([
    i.stat(hostPath('workspace', s)),
    i.stat(hostPath('workspace', join(s, '.git')), { follow: false }),
    i.stat(hostPath('workspace', join(s, '.claude')), { follow: false }),
  ])
  const g = unwrapSettled(r)
  const d = unwrapSettled(a)
  const u = unwrapSettled(o)
  const c = ownershipUidsFromStats(g, d, u)
  if ('skipped' in c) {
    logForDebugging(
      `settingsPrime: ownership of the local settings root not read ahead (${c.skipped}); the probe runs as today`,
    )
    return
  }
  return { root: s, uids: c.uids }
}

/**
 * Official nyn @179416890 — densable stub returns undefined.
 * Leftover: no separate override getter beyond getManagedFilePath env gate.
 */
function explicitManagedSettingsPath(): string | undefined {
  return undefined
}

/** Official F @179529xxx — empty drop-in listing for attested-absent seed. */
const EMPTY_MANAGED_LISTING: readonly string[] = Object.freeze([])

/**
 * Official v @179529582 — seed attested system-absent managed tier into store.
 * Leftover: hostFiles.serving, managedSettingsRoots ($Me/nx), SettingsOwner
 * walk/seed/clear, emptyParsedSettings (Fte).
 * Gold: gold-248-wKn-v-seed.txt
 */
function seedAttestedSystemTier(
  storageV5: StorageV5,
  store: SettingsOwner,
  epoch: number,
):
  | {
      listings: { dir: string; names: readonly string[] }[]
      layers: { path: string; parsed: ParsedSettings }[]
    }
  | undefined {
  if (
    storageV5.hostFiles.serving('system') !== 'absent' ||
    store.systemAttestationContradicted
  ) {
    return
  }
  if (explicitManagedSettingsPath() !== undefined) {
    if (!store.systemSpaceServingLogged) {
      store.systemSpaceServingLogged = true
      logForDebugging(
        "settingsPrime: the host attests no OS policy folder ('system' absent) but this process was handed a managed-settings directory explicitly (CLAUDE_CODE_MANAGED_SETTINGS_PATH); its files are read by the policy walk itself",
      )
    }
    return
  }
  const i = managedSettingsRoots().map(r => ({
    dropInDir: join(r, 'managed-settings.d'),
    basePath: join(r, 'managed-settings.json'),
  }))
  if (
    i.some(({ basePath: r, dropInDir: a }) => store.walkReadManagedFileIn(r, a))
  ) {
    store.systemAttestationContradicted = true
    for (const { basePath: r, dropInDir: a } of i) {
      store.clearFolderListing(a, epoch)
      store.unseedParsedFile(r, 'policySettings', epoch)
    }
    logError(
      Error(
        "settings: a managed-settings file was read from a folder the host attested absent ('system' space); the attestation is ignored for the rest of this process and the policy walk reads the host's files itself",
      ),
    )
    return
  }
  if (!store.systemSpaceServingLogged) {
    store.systemSpaceServingLogged = true
    logForDebugging(
      "settingsPrime: the host attests this machine has no OS policy folder ('system' absent); the policy walk is served an empty managed-settings file tier without reading the host",
    )
  }
  for (const { basePath: r, dropInDir: a } of i) {
    store.seedFolderListing(a, [...EMPTY_MANAGED_LISTING], epoch)
    if (!store.walkRead(r)) {
      store.seedParsedFile(r, 'policySettings', emptyParsedSettings(), epoch)
    }
  }
  return {
    listings: i.map(({ dropInDir: r }) => ({
      dir: r,
      names: EMPTY_MANAGED_LISTING,
    })),
    layers: i.map(({ basePath: r }) => ({
      path: r,
      parsed: emptyParsedSettings(),
    })),
  }
}

/**
 * Official $Me(nx()) @179438431 — when wslInherits unset → `[T_()]` = getManagedFilePath.
 */
function managedSettingsRoots(): string[] {
  return [getManagedFilePath()]
}

/**
 * Official Pn @179502461 — hostFiles absent probe for user settings path.
 */
async function probeUserSettingsAbsentOnHost(
  hostFiles: StorageV5['hostFiles'],
  path: string,
): Promise<PrimerState> {
  let r: HostFilesResult<{ kind: string }>
  try {
    r = (await hostFiles.stat(hostPath('home', path))) as HostFilesResult<{
      kind: string
    }>
  } catch (o) {
    return { kind: 'failing', code: errorMessage(o) }
  }
  if (r.ok) {
    return r.value.kind === 'absent'
      ? { kind: 'absent' }
      : { kind: 'failing', code: r.value.kind }
  }
  // Official dEe @178605274
  if (
    r.error.code === 'Failed' &&
    r.error.telemetryCode === HOST_SPACE_UNSUPPORTED
  ) {
    return { kind: 'absent' }
  }
  return failingFromHostError(r.error)
}

/**
 * Official gt @179503993 — hostFiles stat+readBytes → bytes | absent | failing | oversize.
 */
async function readHostFileBytes(
  hostFiles: StorageV5['hostFiles'],
  key: HostFilePath,
): Promise<
  | { kind: 'bytes'; bytes: Uint8Array; contentHash: string; size: number }
  | PrimerState
> {
  const r = await hostFiles.stat(key)
  if (!r.ok) return failingFromHostError(r.error)
  if (r.value.kind === 'absent') return { kind: 'absent' }
  if (r.value.kind !== 'file')
    return { kind: 'failing', code: String(r.value.kind) }
  const size =
    typeof (r.value as { size?: unknown }).size === 'number'
      ? (r.value as { size: number }).size
      : undefined
  if (size !== undefined && size > SETTINGS_PRIME_MAX_BYTES) {
    return { kind: 'oversize' }
  }
  const o = await hostFiles.readBytes(key)
  if (!o.ok) return failingFromHostError(o.error)
  if (!o.value.found) return { kind: 'absent' }
  if (o.value.bytes > SETTINGS_PRIME_MAX_BYTES) return { kind: 'oversize' }
  return {
    kind: 'bytes',
    bytes: o.value.value,
    contentHash: contentHashSha256(o.value.value),
    size: o.value.bytes,
  }
}

/**
 * Official wn @179503828 — host file → seeded parse (userNamed / non-policy).
 */
async function readNamedHostSettings(
  hostFiles: StorageV5['hostFiles'],
  key: HostFilePath,
  path: string,
  _policySource: boolean,
): Promise<PrimerState> {
  const u = await readHostFileBytes(hostFiles, key)
  if (u.kind !== 'bytes') return u
  return {
    kind: 'seeded',
    contentHash: u.contentHash,
    size: u.size,
    parsed: await parseSettingsContent(decodeSettingsBytes(u.bytes), path),
  }
}

/**
 * Official En @179503487 — project/local via userNamed space.
 */
async function readUserNamedSettingsFile(
  hostFiles: StorageV5['hostFiles'],
  path: string,
): Promise<PrimerState> {
  if (!hostFiles.serves('userNamed')) {
    return { kind: 'failing', code: HOST_SPACE_UNSUPPORTED }
  }
  return readNamedHostSettings(
    hostFiles,
    hostPath('userNamed', path),
    path,
    false,
  )
}

/**
 * Official On @179503602 — managed settings via system space.
 */
async function readSystemManagedSettingsFile(
  hostFiles: StorageV5['hostFiles'],
  path: string,
  prior: { contentHash: string; parsed: ParsedSettings } | undefined,
): Promise<PrimerState> {
  const o = await readHostFileBytes(hostFiles, hostPath('system', path))
  if (o.kind !== 'bytes') return o
  const parsed =
    prior !== undefined && prior.contentHash === o.contentHash
      ? prior.parsed
      : await parseSettingsContent(decodeSettingsBytes(o.bytes), path)
  return {
    kind: 'seeded',
    contentHash: o.contentHash,
    size: o.size,
    parsed,
  }
}

/** Official Gyt @179438486. */
function isManagedDropInName(name: string): boolean {
  return name.endsWith('.json') && !name.startsWith('.')
}

/**
 * Official _Xn @179504453 — list managed-settings.d through system space.
 */
async function listManagedDropIns(
  hostFiles: StorageV5['hostFiles'],
  dir: string,
): Promise<
  | { kind: 'listed'; names: string[] }
  | { kind: 'failing'; code: string; failureClass?: string }
> {
  const r = await hostFiles.listFolder(hostPath('system', dir))
  if (!r.ok) {
    if (r.error.code === 'Failed' && r.error.telemetryCode === 'ENOTDIR') {
      return { kind: 'listed', names: [] }
    }
    return failingFromHostError(r.error) as {
      kind: 'failing'
      code: string
      failureClass?: string
    }
  }
  if (!r.value.found) return { kind: 'listed', names: [] }
  return {
    kind: 'listed',
    names: r.value.entries
      .filter(
        o =>
          (o.kind === 'file' || o.kind === 'link') &&
          isManagedDropInName(o.name),
      )
      .map(o => o.name)
      .sort(),
  }
}

type LayerReader = {
  source: SettingSource
  path: string
  label: string
  whenAbsent: 'seedAbsence' | 'fileServes'
  read: () => Promise<PrimerState>
}

/** Official Ogn @179505056. */
function projectLocalLayerReader(
  storageV5: StorageV5,
  source: SettingSource,
  path: string,
  label: string,
): LayerReader {
  return {
    source,
    path,
    label,
    whenAbsent: 'seedAbsence',
    read: () => readUserNamedSettingsFile(storageV5.hostFiles, path),
  }
}

/** Official Lgn @179505162. */
function managedLayerReader(
  storageV5: StorageV5,
  path: string,
  label: string,
  store: SettingsOwner,
): LayerReader {
  return {
    source: 'policySettings',
    path,
    label,
    whenAbsent: 'fileServes',
    read: () => {
      const prior = store.managedFileReads.get(path) as
        | { contentHash: string; parsed: ParsedSettings }
        | undefined
      return readSystemManagedSettingsFile(storageV5.hostFiles, path, prior)
    },
  }
}

/**
 * Official QB @179442546 — cyn then prefer root when undecided & _o.
 * Leftover: decideCanonicalLocalRoot; `_o` densable root-exists gate → always
 * prefer `root` when undecided (matches tip when git root is real).
 */
function resolveCanonicalSettingsRoot(
  cwd: string,
  gitRootFinder: (cwd: string) => string | null | undefined,
): string {
  const r = decideCanonicalLocalRoot(cwd, gitRootFinder)
  if (r.decided !== undefined) return r.decided
  return r.root
}

/**
 * Official xC @179444878 — relative settings path under project/local.
 */
function relativeProjectLocalSettingsPath(
  source: 'projectSettings' | 'localSettings',
): string {
  return source === 'projectSettings'
    ? join('.claude', 'settings.json')
    : join('.claude', 'settings.local.json')
}

/**
 * Official Zve @179445024 sha=1c947a36288d2ed3 —
 * `if(QB(e.cwd,e.canonicalGitRoot)===A(e.cwd))return;return _(A(e.cwd),xC("localSettings"))`
 * Leftover name: legacyLocalSettingsPath.
 */
export function legacyLocalSettingsPath(
  cwd: string = getCwd(),
  gitRootFinder: (
    cwd: string,
  ) => string | null | undefined = findCanonicalGitRoot,
): string | undefined {
  const resolvedCwd = resolve(cwd)
  if (resolveCanonicalSettingsRoot(cwd, gitRootFinder) === resolvedCwd) {
    return undefined
  }
  return join(resolvedCwd, relativeProjectLocalSettingsPath('localSettings'))
}

/**
 * Official kC @179506276 — `return Zve(H())`.
 */
export function legacyLocalSettingsPathFromHost(): string | undefined {
  return legacyLocalSettingsPath()
}

/**
 * Official R @179527886 — project/local layer readers including legacy local
 * via kC/Zve when distinct from primary localSettings path.
 */
async function projectLocalLayerReaders(
  storageV5: StorageV5,
): Promise<LayerReader[]> {
  const { getSettingsFilePathForSource, projectSettingsAliasesUserSettings } =
    await import('./settings.js')
  const e: LayerReader[] = []
  for (const s of ['projectSettings', 'localSettings'] as const) {
    if (s === 'projectSettings' && projectSettingsAliasesUserSettings())
      continue
    const i = getSettingsFilePathForSource(s)
    if (i !== undefined) {
      e.push(
        projectLocalLayerReader(
          storageV5,
          s,
          i,
          s === 'projectSettings' ? 'project settings' : 'local settings',
        ),
      )
    }
    if (s === 'localSettings') {
      const r = legacyLocalSettingsPathFromHost()
      if (r !== undefined && r !== i) {
        e.push(
          projectLocalLayerReader(storageV5, s, r, 'legacy local settings'),
        )
      }
    }
  }
  return e
}

/** Official x @179533151 — install project/local seed results into store. */
function installProjectLocalSeeds(
  store: SettingsOwner,
  layers: LayerReader[],
  results: PrimerState[],
  epoch: number,
): void {
  for (const [r, a] of layers.entries()) {
    const o = results[r]!
    const g =
      o.kind === 'seeded'
        ? o.parsed
        : o.kind === 'absent' && a.whenAbsent === 'seedAbsence'
          ? emptyParsedSettings()
          : undefined
    if (g !== undefined && store.walkReadDiffers(a.path, g)) {
      logForDebugging(
        `settingsPrime: ${a.label} not installed (the file read already saw different content this generation)`,
      )
    } else if (o.kind === 'seeded') {
      store.seedParsedFile(a.path, a.source, o.parsed, epoch)
    } else if (g !== undefined) {
      logBrokenSettingsSymlink(a.path)
      store.seedParsedFile(a.path, a.source, g, epoch)
    } else {
      logForDebugging(
        `settingsPrime: ${a.label} not seeded (${describePrimeReadKind(o)}); the file read serves`,
      )
    }
  }
}

/**
 * Official Vjt @179502007 — backend user-settings read/seed result.
 * Gold: gold-248-Vjt-T-O-seed.txt
 */
async function readUserSettingsFromBackend(
  storageV5: StorageV5,
  path: string,
  prior: PrimerState | undefined,
): Promise<PrimerState> {
  const o = await storageV5.read([
    {
      key: userSettingsStorageKey(),
      offset: 0,
      length: SETTINGS_PRIME_MAX_BYTES + 1,
    },
  ])
  if (!o.ok) {
    return {
      kind: 'failing',
      code: o.error.code,
      failureClass:
        'failureClass' in o.error
          ? (o.error.failureClass as string | undefined)
          : undefined,
    }
  }
  const u = o.value.items[0]!
  if (!u.found) return probeUserSettingsAbsentOnHost(storageV5.hostFiles, path)
  if (u.totalBytes > SETTINGS_PRIME_MAX_BYTES) return { kind: 'oversize' }
  if (u.value == null) {
    return { kind: 'failing', code: 'empty_value' }
  }
  const bytes = u.value
  const d = contentHashSha256(bytes)
  const p =
    prior !== undefined && prior.kind === 'seeded' && prior.contentHash === d
      ? prior.parsed
      : await parseSettingsContent(decodeSettingsBytes(bytes), path)
  return {
    kind: 'seeded',
    contentHash: d,
    size: u.totalBytes,
    parsed: p,
  }
}

/** Official T @179529407 — project/local seedLogged. */
async function seedProjectLocalLayers(
  storageV5: StorageV5,
  store: SettingsOwner,
  epoch: number,
): Promise<boolean> {
  const i = await projectLocalLayerReaders(storageV5)
  if (i.length === 0) return true
  const r = await Promise.all(i.map(a => a.read()))
  if (store.epoch !== epoch) return false
  installProjectLocalSeeds(store, i, r, epoch)
  return true
}

/** Official M @179532274 — clear managed reads when system space not served. */
function clearManagedSettingsSeeds(store: SettingsOwner, epoch: number): void {
  for (const s of [...store.managedFileReads.keys()]) {
    store.managedFileReads.delete(s)
    store.unseedParsedFile(s, 'policySettings', epoch)
  }
  for (const s of managedSettingsRoots()) {
    store.clearFolderListing(join(s, 'managed-settings.d'), epoch)
  }
}

/**
 * Official vKn @179528210 — managed-settings file tier read-ahead via system space.
 */
async function readManagedSettingsTierAhead(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<
  | {
      listings: { dir: string; names: string[] }[]
      unlisted: string[]
      layers: LayerReader[]
      walksAtReadStart: number
      reads: Promise<PrimerState[]>
    }
  | undefined
> {
  const s = storageV5.hostFiles
  if (!s.serves('system')) {
    if (!store.systemSpaceServingLogged) {
      store.systemSpaceServingLogged = true
      logForDebugging(
        "settingsPrime: the managed-settings file tier is not read ahead (the backend does not serve 'system'); the policy walk reads the host's files itself",
      )
    }
    return undefined
  }
  const i = managedSettingsRoots()
  const r = store.policyWalkCount
  const a = i.map(c =>
    managedLayerReader(
      storageV5,
      join(c, 'managed-settings.json'),
      'managed settings',
      store,
    ),
  )
  const [o, g] = await Promise.all([
    Promise.all(
      i.map(c => listManagedDropIns(s, join(c, 'managed-settings.d'))),
    ),
    Promise.all(a.map(c => c.read())),
  ])
  const d: {
    listings: { dir: string; names: string[] }[]
    unlisted: string[]
    layers: LayerReader[]
    walksAtReadStart: number
  } = {
    listings: [],
    unlisted: [],
    layers: [...a],
    walksAtReadStart: r,
  }
  const u: LayerReader[] = []
  for (const [c, m] of i.entries()) {
    const h = o[c]!
    const p = join(m, 'managed-settings.d')
    if (h.kind === 'failing') {
      logForDebugging(
        `settingsPrime: ${p} not listed through the backend (backend listing failed: ${h.code}${h.failureClass ? ` (${h.failureClass})` : ''}); the folder read serves`,
      )
      d.unlisted.push(p)
      continue
    }
    if (h.names.length === 0) {
      logForDebugging(
        `settingsPrime: ${p} has no drop-ins to read ahead; the folder read confirms`,
      )
      d.unlisted.push(p)
      continue
    }
    d.listings.push({ dir: p, names: h.names })
    for (const C of h.names) {
      u.push(
        managedLayerReader(
          storageV5,
          join(p, C),
          'managed settings drop-in',
          store,
        ),
      )
    }
  }
  d.layers.push(...u)
  return {
    ...d,
    reads: Promise.all(u.map(c => c.read())).then(c => [...g, ...c]),
  }
}

/** Official A @179532476. */
function installManagedFolderListings(
  store: SettingsOwner,
  bag: {
    listings: { dir: string; names: string[] }[]
    unlisted: string[]
    walksAtReadStart: number
  },
  epoch: number,
): { kept: { dir: string; names: string[] }[]; verdicts: Map<string, string> } {
  for (const a of bag.unlisted) store.clearFolderListing(a, epoch)
  const i: { dir: string; names: string[] }[] = []
  const r = new Map<string, string>()
  for (const a of bag.listings) {
    const o = store.folderInstallVerdict(a.dir, a.names, bag.walksAtReadStart)
    r.set(a.dir, o)
    if (o === 'raced') {
      store.clearFolderListing(a.dir, epoch)
      logForDebugging(
        `settingsPrime: ${a.dir} listing not installed (a read this generation went by another membership while it was in flight); the walk's membership or its own folder read serves until the next reset`,
      )
    } else if (o === 'deferred') {
      logForDebugging(
        `settingsPrime: ${a.dir} membership changed after this generation's policy walk; it applies from the next reset, as today`,
      )
      i.push(a)
    } else if (store.seedFolderListing(a.dir, a.names, epoch)) {
      i.push(a)
    }
  }
  return { kept: i, verdicts: r }
}

/** Official B @179531220. */
function installManagedLayerSeeds(
  store: SettingsOwner,
  bag: {
    layers: LayerReader[]
    walksAtReadStart: number
  },
  results: PrimerState[],
  verdicts: Map<string, string>,
  epoch: number,
): void {
  const o = new Set<string>()
  for (const [g, d] of bag.layers.entries()) {
    const u = results[g]!
    if (u.kind !== 'seeded') {
      logForDebugging(
        `settingsPrime: ${d.label} not seeded (${describePrimeReadKind(u)}); the file read serves`,
      )
      store.managedFileReads.delete(d.path)
      store.unseedParsedFile(d.path, d.source, epoch)
      continue
    }
    o.add(d.path)
    store.managedFileReads.set(d.path, {
      contentHash: u.contentHash,
      parsed: u.parsed,
    })
    const c = verdicts.get(dirname(d.path))
    const m =
      c !== undefined && c !== 'install'
        ? c
        : store.policyInstallVerdict(d.path, u.parsed, bag.walksAtReadStart)
    if (m === 'raced') {
      store.dropRetainedLayer(d.path)
      logForDebugging(
        `settingsPrime: ${d.label} not installed (the walk read different content while this read was in flight); re-verified next generation`,
      )
      continue
    }
    if (m === 'deferred') {
      logForDebugging(
        `settingsPrime: ${d.label} changed after this generation's policy walk; it applies from the next reset, as today`,
      )
      continue
    }
    store.seedParsedFile(d.path, d.source, u.parsed, epoch)
  }
  for (const g of [...store.managedFileReads.keys()]) {
    if (!o.has(g)) {
      store.managedFileReads.delete(g)
      store.unseedParsedFile(g, 'policySettings', epoch)
    }
  }
}

/** Official O @179531012 — managed-settings seedLogged. */
async function seedManagedSettingsTier(
  storageV5: StorageV5,
  store: SettingsOwner,
  epoch: number,
): Promise<boolean> {
  if (seedAttestedSystemTier(storageV5, store, epoch) !== undefined) {
    return store.epoch === epoch
  }
  const i = await readManagedSettingsTierAhead(storageV5, store)
  if (i === undefined) {
    clearManagedSettingsSeeds(store, epoch)
    return true
  }
  const r = await i.reads
  if (store.epoch !== epoch) return false
  const { verdicts: a } = installManagedFolderListings(store, i, epoch)
  installManagedLayerSeeds(store, i, r, a, epoch)
  return true
}

/**
 * Official k_ @179508981 — reload merged settings after prime.
 * Leftover: getSettingsWithErrors (= ra().mergedSettings ?? dyn load).
 * Sync require avoids settings.ts import cycle (same pattern as settings.ts
 * residualFinalEnvGates).
 */
function reloadMergedSettingsAfterPrime(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSettingsWithErrors } =
    require('./settings.js') as typeof import('./settings.js')
  getSettingsWithErrors()
}
/**
 * Official Tur @179534256 — apply ownership probe from wKn ahead.
 */
async function primeLocalSettingsStoreRootOwnership(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<void> {
  applyOwnershipProbe(store, await ownershipProbeAhead(storageV5, store))
}

/**
 * Official L @179522914 — Tur wrap used by z retain load.
 */
async function ownershipProbeAheadLogged(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<void> {
  try {
    await primeLocalSettingsStoreRootOwnership(storageV5, store)
  } catch (s) {
    logForDebugging(
      `settingsPrime: ownership read-ahead for the local settings root failed: ${errorMessage(s)}; the probe runs as today`,
      { level: 'warn' },
    )
  }
}

/** Official Mgn @179503367 — user settings layer reader for retain. */
function userSettingsLayerReader(
  storageV5: StorageV5,
  path: string,
): LayerReader {
  return {
    source: 'userSettings',
    path,
    label: 'user settings',
    whenAbsent: 'seedAbsence',
    read: () => readUserSettingsFromBackend(storageV5, path, undefined),
  }
}

/**
 * Official kur @179527816 — user + project/local layer readers.
 * R is async here (dyn import); official R is sync.
 */
async function backendSettingsLayers(
  storageV5: StorageV5,
): Promise<LayerReader[]> {
  const e = await userSettingsPrimePath()
  return [
    ...(e === undefined ? [] : [userSettingsLayerReader(storageV5, e)]),
    ...(await projectLocalLayerReaders(storageV5)),
  ]
}

/**
 * Official Dgn @179502701 — re-seed one layer and retain when installed.
 */
async function reseedAndRetainLayer(
  store: SettingsOwner,
  layer: LayerReader,
): Promise<(() => void) | undefined> {
  if (!isHoverRestOn()) return
  const r = store.epoch
  try {
    const o = await layer.read()
    const u =
      o.kind === 'seeded'
        ? o.parsed
        : o.kind === 'absent' && layer.whenAbsent === 'seedAbsence'
          ? emptyParsedSettings()
          : undefined
    if (u === undefined) {
      logForDebugging(
        `settings: ${layer.label} not re-seeded (${describePrimeReadKind(o)}); the file read serves`,
      )
      return
    }
    if (
      layer.source !== 'userSettings' &&
      store.walkReadDiffers(layer.path, u)
    ) {
      logForDebugging(
        `settings: ${layer.label} not re-seeded (the file read already saw different content this generation); the file read serves`,
      )
      return
    }
    if (o.kind === 'absent') logBrokenSettingsSymlink(layer.path)
    return store.seedParsedFile(layer.path, layer.source, u, r)
      ? store.retainLayer(layer.path, u)
      : undefined
  } catch (o) {
    logForDebugging(
      `settings: ${layer.label} not re-seeded: ${errorMessage(o)}; the file read serves`,
      { level: 'warn' },
    )
    return
  }
}

/**
 * Official N @179533672 — managed-settings re-seed + retain disposers.
 */
async function reseedManagedSettingsForRetain(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<Array<() => void>> {
  if (!isHoverRestOn()) return []
  const s = store.epoch
  try {
    const i = seedAttestedSystemTier(storageV5, store, s)
    if (i !== undefined) {
      return [
        ...i.listings.map(({ dir: g, names: d }) =>
          store.retainFolderListing(g, [...d]),
        ),
        ...i.layers.map(({ path: g, parsed: d }) => store.retainLayer(g, d)),
      ]
    }
    const r = await readManagedSettingsTierAhead(storageV5, store)
    if (r === undefined) {
      clearManagedSettingsSeeds(store, s)
      return []
    }
    const a = await r.reads
    if (store.epoch !== s) return []
    const { kept, verdicts: o } = installManagedFolderListings(store, r, s)
    const retainedLayers: Array<() => void> = []
    // Mirror official B: install then retain successfully seeded layers.
    const before = new Set(store.managedFileReads.keys())
    installManagedLayerSeeds(store, r, a, o, s)
    for (const g of kept) {
      retainedLayers.push(store.retainFolderListing(g.dir, g.names))
    }
    for (const layer of r.layers) {
      const parsed = store.parsedFiles.get(layer.path)
      if (parsed === undefined) continue
      if (
        !store.primedFiles.has(layer.path) &&
        !before.has(layer.path) &&
        !store.managedFileReads.has(layer.path)
      ) {
        continue
      }
      if (
        store.managedFileReads.has(layer.path) ||
        store.primedFiles.has(layer.path)
      ) {
        retainedLayers.push(store.retainLayer(layer.path, parsed))
      }
    }
    return retainedLayers
  } catch (i) {
    logForDebugging(
      `settings: managed settings not re-seeded: ${errorMessage(i)}; the file reads serve`,
      { level: 'warn' },
    )
    return []
  }
}

/**
 * Official z @179527519 — whenIdle → Tur → re-seed/retain → Yl(retain).
 */
async function loadSettingsUnderPrimeInner(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<(() => void) | undefined> {
  await store.primer?.whenIdle()
  if (store.primer !== undefined) {
    await ownershipProbeAheadLogged(storageV5, store)
  }
  const s =
    store.primer === undefined
      ? []
      : (
          await Promise.all([
            ...(
              await backendSettingsLayers(storageV5)
            ).map(i => reseedAndRetainLayer(store, i)),
            reseedManagedSettingsForRetain(storageV5, store),
          ])
        )
          .flat()
          .filter((i): i is () => void => i !== undefined)
  resetSettingsCache(s.length > 0 ? { userLayer: 'retain' } : undefined)
  if (s.length === 0) return
  return () => {
    for (const i of s) i()
  }
}

/**
 * Official Gqe @179527369 — serialize via backendReadResetTail.
 * Leftover: loadSettingsUnderPrime / resetSettingsCacheWithBackendRead.
 */
export async function loadSettingsUnderPrime(
  storageV5: StorageV5 | undefined,
): Promise<(() => void) | undefined> {
  if (storageV5 === undefined) {
    resetSettingsCache()
    return
  }
  const e = getSettingsOwner()
  const s = e.backendReadResetTail
  let i!: () => void
  e.backendReadResetTail = new Promise(r => {
    i = r
  })
  await s
  try {
    return await loadSettingsUnderPrimeInner(storageV5, e)
  } finally {
    i()
  }
}

/** Official export alias Gqe as resetSettingsCacheWithBackendRead. */
export const resetSettingsCacheWithBackendRead = loadSettingsUnderPrime

/**
 * Official _Ke @179162866 — storage backendView priming before SKn.
 * Leftover → primeRemoteSettingsBackendView (Ut/uo).
 */
async function primeStorageBackendView(storageV5: StorageV5): Promise<unknown> {
  return primeRemoteSettingsBackendView(storageV5)
}

/**
 * Official SKn — leftover SettingsPrimer.
 */
export class SettingsPrimer {
  storageV5: StorageV5
  store: SettingsOwner
  inFlight: Promise<void> | null = null
  followUpQueued = false
  disposed = false
  state: PrimerState = { kind: 'unprimed' }
  consecutiveThrows = 0
  runsInState = 0
  loggedThrowMessages = new Set<string>()
  loggedOwnershipThrowMessages = new Set<string>()
  loggedHostFilesThrowMessages = new Set<string>()
  unsubscribe: () => void

  constructor(storageV5: StorageV5, store: SettingsOwner) {
    this.storageV5 = storageV5
    this.store = store
    this.unsubscribe = store.onInvalidate(() => {
      if (!this.disposed) {
        this.seedAttestedTier()
        this.schedule()
      }
    })
    this.seedAttestedTier()
    this.schedule()
  }

  seedAttestedTier(): void {
    try {
      seedAttestedSystemTier(this.storageV5, this.store, this.store.epoch)
    } catch (t) {
      this.logThrowOnce(t, this.loggedHostFilesThrowMessages)
    }
  }

  schedule(): void {
    if (this.inFlight !== null) {
      this.followUpQueued = true
      return
    }
    this.inFlight = this.run().finally(() => {
      if (this.disposed) return
      this.inFlight = null
      if (this.followUpQueued) {
        this.followUpQueued = false
        this.schedule()
      }
    })
  }

  async run(): Promise<void> {
    const t = ownershipProbeAhead(this.storageV5, this.store).then(
      e => {
        this.loggedOwnershipThrowMessages.clear()
        return e
      },
      e => {
        if (!this.disposed)
          this.logThrowOnce(e, this.loggedOwnershipThrowMessages)
        return undefined
      },
    )
    try {
      const e = this.store.epoch
      try {
        const r = await userSettingsPrimePath()
        if (r !== undefined) {
          if (!(await this.seedFromBackend(r, e))) return
        }
      } catch (r) {
        if (!this.disposed) this.onThrow(r)
        return
      }
      const s = await t
      if (this.disposed) return
      applyOwnershipProbe(this.store, s)
      if (
        (
          await Promise.all([
            this.seedLogged(e, seedProjectLocalLayers),
            this.seedLogged(e, seedManagedSettingsTier),
          ])
        ).includes(false)
      )
        return
      this.consecutiveThrows = 0
      try {
        reloadMergedSettingsAfterPrime()
        this.loggedThrowMessages.clear()
      } catch (r) {
        if (!this.disposed) this.logThrowOnce(r)
      }
    } finally {
      await t
    }
  }

  async seedLogged(
    epoch: number,
    seeder: (
      storageV5: StorageV5,
      store: SettingsOwner,
      epoch: number,
    ) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await seeder(this.storageV5, this.store, epoch)
    } catch (s) {
      if (!this.disposed)
        this.logThrowOnce(s, this.loggedHostFilesThrowMessages)
      return this.store.epoch === epoch && !this.disposed
    }
  }

  async seedFromBackend(path: string, epoch: number): Promise<boolean> {
    const s = this.state
    const i = await readUserSettingsFromBackend(
      this.storageV5,
      path,
      s.kind === 'seeded' ? s : undefined,
    )
    if (this.store.epoch !== epoch || this.disposed) return false
    if (i.kind === 'seeded') {
      this.store.seedParsedFile(path, 'userSettings', i.parsed, epoch)
      if (s.kind === 'seeded' && s.contentHash === i.contentHash) return true
    } else if (i.kind === 'absent') {
      logBrokenSettingsSymlink(path)
      this.store.seedParsedFile(
        path,
        'userSettings',
        emptyParsedSettings(),
        epoch,
      )
    }
    this.transition(i)
    return true
  }

  transition(t: PrimerState): void {
    const e = this.state
    if (
      e.kind === t.kind &&
      (t.kind !== 'failing' || (e.kind === 'failing' && e.code === t.code))
    ) {
      this.runsInState++
      return
    }
    if (e.kind === 'failing' && t.kind === 'seeded') {
      logForDebugging(
        `settingsPrime: backend read recovered after ${this.runsInState} failing run(s)`,
      )
    }
    this.runsInState = 1
    this.state = t
    switch (t.kind) {
      case 'seeded':
        logForDebugging(`settingsPrime: user settings seeded (${t.size} bytes)`)
        return
      case 'absent':
        logForDebugging('settingsPrime: user settings absent; served as none')
        return
      case 'oversize':
        logForDebugging(
          'settingsPrime: user settings not seeded (oversize); raw path serves',
        )
        return
      case 'failing':
        logForDebugging(
          `settingsPrime: backend read failed: ${t.code}${t.failureClass ? ` (${t.failureClass})` : ''}; raw path serves`,
          { level: 'warn' },
        )
        return
      case 'unprimed':
      case 'broken':
        return
    }
  }

  onThrow(t: unknown): void {
    this.consecutiveThrows++
    this.state = { kind: 'broken' }
    this.logThrowOnce(t)
    if (this.consecutiveThrows >= CONSECUTIVE_THROW_DISPOSE) {
      logForDebugging(
        `settingsPrime: disabled after ${CONSECUTIVE_THROW_DISPOSE} consecutive failures; raw path serves`,
        { level: 'warn' },
      )
      this.dispose()
    }
  }

  logThrowOnce(t: unknown, e: Set<string> = this.loggedThrowMessages): void {
    const s = errorMessage(t)
    if (e.has(s) || e.size >= LOGGED_THROW_MESSAGE_CAP) return
    e.add(s)
    logError(t instanceof Error ? t : new Error(s))
  }

  primes(storageV5: StorageV5): boolean {
    return this.storageV5 === storageV5
  }

  async whenIdle(): Promise<void> {
    while (this.inFlight !== null || this.followUpQueued) {
      await (this.inFlight ?? Promise.resolve())
    }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.inFlight = null
    this.followUpQueued = false
    if (this.store.primer === this) {
      this.store.primer = undefined
      this.store.managedFileReads.clear()
    }
  }
}

/**
 * Official b @179522769 — start-up seed try/catch wrapper.
 */
async function seedStartupLogged(
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run()
  } catch (s) {
    logForDebugging(
      `settingsPrime: start-up seed of the ${label} failed: ${errorMessage(s)}; the file reads serve`,
      { level: 'warn' },
    )
  }
}

/**
 * Official j @179523090 — seed user settings once at start-up (before SKn).
 */
async function seedUserSettingsFileAtStartup(
  storageV5: StorageV5,
  store: SettingsOwner,
): Promise<void> {
  try {
    const s = await userSettingsPrimePath()
    if (s === undefined) return
    if (store.parsedFiles.has(s)) {
      logForDebugging(
        'settingsPrime: user settings already read before start-up; seed skipped',
      )
      return
    }
    const i = store.epoch
    const r = await readUserSettingsFromBackend(storageV5, s, undefined)
    if (r.kind === 'absent') {
      logBrokenSettingsSymlink(s)
      if (store.seedParsedFile(s, 'userSettings', emptyParsedSettings(), i)) {
        logForDebugging('settingsPrime: user settings absent; seeded as none')
      }
      return
    }
    if (r.kind !== 'seeded') {
      logForDebugging(
        `settingsPrime: start-up seed skipped (${describePrimeReadKind(r)}); the file read serves`,
      )
      return
    }
    if (store.seedParsedFile(s, 'userSettings', r.parsed, i)) {
      logForDebugging(
        `settingsPrime: user settings seeded at start-up (${r.size} bytes)`,
      )
    }
  } catch (s) {
    logForDebugging(
      `settingsPrime: start-up seed failed: ${errorMessage(s)}; the file read serves`,
      { level: 'warn' },
    )
  }
}

/**
 * Official Npn @179522585 — leftover seedUserSettings.
 * Called from init when D() && backend (parallel with configs enable).
 * Gold: gold-248-SKn-chunk-fns.txt.
 */
export async function seedUserSettings(
  storageV5: StorageV5 | undefined,
  store: SettingsOwner,
): Promise<void> {
  if (!isHoverRestOn() || storageV5 === undefined) return
  const s = store.epoch
  await Promise.all([
    seedUserSettingsFileAtStartup(storageV5, store),
    ownershipProbeAheadLogged(storageV5, store),
    seedStartupLogged('managed-settings file tier', () =>
      seedManagedSettingsTier(storageV5, store, s),
    ),
  ])
  await seedStartupLogged('project/local layers', () =>
    seedProjectLocalLayers(storageV5, store, store.epoch),
  )
}

/**
 * Official `$pn` @179527115 — leftover settingsPrime.
 * Gate: D() && storageV5 defined; second prime ignored if other backend.
 * `_Ke` → primeRemoteSettingsBackendView before construct.
 * Official export alias: primeSettings.
 */
export async function settingsPrime(
  storageV5: StorageV5 | undefined,
  store: SettingsOwner,
): Promise<void> {
  if (!isHoverRestOn() || storageV5 === undefined) return
  if (store.primer !== undefined) {
    if (!store.primer.primes(storageV5)) {
      logForDebugging(
        'settingsPrime: store already primed through another backend; second prime ignored',
      )
    }
    return
  }
  void primeStorageBackendView(storageV5).catch(err => {
    logError(err instanceof Error ? err : new Error(errorMessage(err)))
  })
  store.primer = new SettingsPrimer(storageV5, store)
  await store.primer.whenIdle()
}

/** Official export alias `$pn as primeSettings`. */
export const primeSettings = settingsPrime
