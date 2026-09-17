/**
 * densable 2.1.246 #16 — storageV5 factory / pin.
 * Official: createLocalFsBackend hb @207543077,
 * tryCreateLocalV5Backend qF, tryCreateV5Backend qb,
 * pinStorageV5FromEnv UF, pinStorageV5 v.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { realpath } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import {
  resetGlobalClaudeFileForTests,
  seedGlobalClaudeFile,
} from '../../env.js'
import { createLocalFsBackend } from '../createLocalFsBackend.js'
import {
  acquireStorageWatchBus,
  announceStorageChange,
  releaseStorageWatchBus,
  StorageWatchBus,
} from '../storageWatchBus.js'
import {
  loadDigestIndex,
  publishFileSerialized,
  readValueWholeSe,
  resolveDigestStreamLayout,
  syncDigestStream,
} from '../digestLog.js'
import {
  CREDENTIALS_STORE_HANDLE,
  credentialsStoreFor,
  pinStorageV5,
  pinStorageV5FromEnv,
  recordHoverRestDecision,
  resetHoverRestPinForTests,
  resetPinnedCredentialsForTests,
  resetPinnedStorageV5ForTests,
  tryCreateLocalV5Backend,
  tryCreateV5Backend,
} from '../index.js'
import {
  getReadSymlinkClass,
  getSymlinkPolicy,
  isStreamNamespaceKey,
  resolveWriteOpts,
  validateStorageKey,
  validateStorageScope,
} from '../writeValidate.js'

const temps: string[] = []

afterEach(() => {
  resetHoverRestPinForTests()
  resetPinnedStorageV5ForTests()
  resetPinnedCredentialsForTests()
  resetGlobalClaudeFileForTests()
  delete process.env.CLAUDE_CODE_HOVER_REST
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storageV5 factory / pin (2.1.246)', () => {
  test('source-locks official factory and pin names', () => {
    const src = [
      readFileSync(join(import.meta.dir, '../index.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../createLocalFsBackend.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../digestLog.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../storageLock.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../writeValidate.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../storageLease.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../storageSubscribe.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../storageWatchBus.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../listRecursiveXa.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../storageHbMutate.ts'), 'utf8'),
      readFileSync(join(import.meta.dir, '../createLocalHostFiles.ts'), 'utf8'),
    ].join('\n')
    expect(src).toContain('export function createLocalFsBackend')
    expect(src).toContain('export function tryCreateLocalV5Backend')
    expect(src).toContain('export function tryCreateV5Backend')
    expect(src).toContain('export function pinStorageV5FromEnv')
    expect(src).toContain('export function pinStorageV5')
    expect(src).toContain('export function recordHoverRestDecision')
    expect(src).toContain('if (!isHoverRestOn()) return')
    expect(src).toContain('async readRecords(key, opts)')
    expect(src).toContain('async listEntries(scope, opts)')
    expect(src).toContain('async listRecursive(scope, opts)')
    expect(src).toContain('densable leftover `Xa` @207425816')
    expect(src).toContain('densable leftover `_y` @207436901')
    expect(src).toContain('densable leftover `Ql` @207423247')
    expect(src).toContain('leftover `qF` @207548851')
    expect(src).toContain("logEvent('tengu_feature_ok'")
    expect(src).toContain("logEvent('tengu_feature_sad'")
    expect(src).toContain("'fell_back'")
    expect(src).toContain(
      "namespace === 'history' || namespace === 'transcript'",
    )
    expect(src).toContain('listScopeEntries(')
    expect(src).toContain('usesLineDelimitedRecordReader(rec)')
    expect(src).toContain('export function resolveDigestStreamLayout')
    expect(src).toContain('export async function syncDigestStream')
    expect(src).toContain('export async function loadDigestIndex')
    expect(src).toContain('export async function readDigestRecords')
    expect(src).toContain('export async function storageAppendRecords')
    expect(src).toContain('export async function publishValidatedStorageFile')
    expect(src).toContain('export async function withStorageLock')
    expect(src).toContain('export async function withValuePublishLock')
    expect(src).toContain('export function isColocatedValueLockKey')
    expect(src).toContain('export function resolveValuePublishLockPath')
    expect(src).toContain('publishing without it, as a plain write does')
    expect(src).toContain('lockUnconditionalPublishes')
    expect(src).toContain("telemetryCode: 'LockSuspect'")
    expect(src).toContain("result.error.code === 'NotFound'")
    expect(src).toContain('isMkdirParentDiscipline(dt.discipline)')
    expect(src).toContain('densable leftover `Be`/`ne` @207293555')
    expect(src).toContain('export async function acquireLockfile')
    expect(src).toContain('densable leftover `ut`/`Ve` @205799448')
    expect(src).toContain('export async function runSerializedByPath')
    expect(src).toContain('densable leftover `mt`/`he` @207295041')
    expect(src).toContain('export async function enterPathQueue')
    expect(src).toContain('densable leftover `Ke` @207295455')
    expect(src).toContain('export function computeLockRetryPolicy')
    expect(src).toContain('densable leftover `Wr` @207295080')
    expect(src).toContain('export function validateWriteRequest')
    expect(src).toContain('export async function appendRecordsByNamespace')
    expect(src).toContain('export async function historyAppendWithFileLock')
    expect(src).toContain('export async function sessionLogAppendExclusive')
    expect(src).toContain('export async function logAppendPackedViaAppendFile')
    expect(src).toContain('stale: 1e4')
    expect(src).toContain('10485760')
    expect(src).toContain('storage-v2')
    expect(src).toContain('index.jsonl')
    expect(src).toContain('stream.lock')
    expect(src).toContain('apply.marker')
    expect(src).toContain('async append(key, records, opts)')
    expect(src).toContain('async touch(key)')
    expect(src).toContain('async digest(key, opts)')
    expect(src).toContain('async ensureScope(scope, opts)')
    expect(src).toContain('async tombstone(key, recordIds)')
    expect(src).toContain('async statStream(key)')
    expect(src).toContain('export async function publishFileWithPrecondition')
    expect(src).toContain('export async function purgeTombstonedDigestLog')
    expect(src).toContain('export async function compactTombstonedDigestLog')
    expect(src).toContain('`Ur`=`R6c`=`Wn`')
    expect(src).toContain('export function leasesDir')
    expect(src).toContain('export function leasePath')
    expect(src).toContain('vd @207312251')
    expect(src).toContain('rs @207258557')
    expect(src).toContain("join(roots.configHome, PE, 'leases')")
    expect(src).toContain('`Ol`=`S6c`=`$n`')
    expect(src).toContain('Ma=Yn@207288501')
    expect(src).toContain('function withDigestKeyExpect')
    expect(src).toContain('function storageWatchKeyId')
    expect(src).toContain('export async function subscribeStorage')
    expect(src).toContain('densable leftover `Fb` @207546305')
    expect(src).toContain('densable leftover class `Lt` @207367705')
    expect(src).toContain('densable leftover `Ou` @207359054')
    expect(src).toContain('densable leftover `Ob` @207547246')
    expect(src).toContain('densable leftover `Ii` @207349789')
    expect(src).toContain('densable leftover `xi` @207336252')
    expect(src).toContain('densable leftover `du` @207336147')
    expect(src).toContain('densable leftover `uu` @207336359')
    expect(src).toContain('densable leftover `lu` @207336451')
    expect(src).toContain('densable leftover `wp` @207336677')
    expect(src).toContain('densable leftover `fu`/`Lp` @207341329')
    expect(src).toContain('densable leftover `gu`/`Op` @207342738')
    expect(src).toContain('densable leftover `ry` @207406953')
    expect(src).toContain('densable leftover `Pl`=`jn`=`Q6c` @207285604')
    expect(src).toContain('densable leftover `se`=`Gn`=`N6c` @207283900')
    expect(src).toContain('densable leftover `Me` @207282930')
    expect(src).toContain('densable leftover `we`=`ga`=`f8c` @207228251')
    expect(src).toContain('densable leftover `Se`=`ma`=`h8c` @207228950')
    expect(src).toContain('densable leftover `ue`=`e8c` @207228190')
    expect(src).toContain('densable leftover `ve` @207229681')
    expect(src).toContain('`oe`=`qfd`=`ye`=`"OtherNames"`')
    expect(src).toContain('/proc/self/fd')
    expect(src).toContain('densable leftover `rn` @207237689')
    expect(src).toContain('densable leftover `I`=`Iad`=`p` @206341557')
    expect(src).toContain('`Xe`=`Had`=`T`=`"team"`')
    expect(src).toContain('densable leftover `M`=`"timeline.jsonl"` @207274040')
    expect(src).toContain('leftover `xn` @207277702')
    expect(src).toContain('densable leftover `Se` @207245150')
    expect(src).toContain('keys.jobTimeline(jobId)')
    expect(src).toContain('densable leftover `mn` @207239882')
    expect(src).toContain('densable leftover `It` @207277935')
    expect(src).toContain('leftover `mn` then `Tn` then `an`')
    expect(src).toContain('must be one of the pluginRegistry files')
    expect(src).toContain('densable leftover `fe`=`qad`=`zn` @205859549')
    expect(src).toContain('densable leftover `Kl` @207405200')
    expect(src).toContain('densable leftover `Jg` @207406085')
    expect(src).toContain('densable leftover `ey` @207406787')
    expect(src).toContain('densable leftover `Qg` @207406592')
    expect(src).toContain('densable leftover `Zg` @207406327')
    expect(src).toContain('densable leftover `$i`=`Xa`=`r9c` @207253787')
    expect(src).toContain('densable leftover `J`=`Lr`=`w8c` @207234064')
    expect(src).toContain('`le`=`tfd`=`be`=`"LeafMoved"`')
    expect(src).toContain('HardeningUnavailable')
    expect(src).toContain('densable leftover `Ty` @207435065')
    expect(src).toContain('densable leftover `Li`=`Sr`=`P6c` @207285604')
    expect(src).toContain('densable leftover `gn` @207340570')
    expect(src).toContain('densable leftover `cu` @207340220')
    expect(src).toContain('densable leftover `Ft` @207355400')
    expect(src).toContain('densable leftover `da` @207354200')
    expect(src).toContain('densable leftover `hu` @207354250')
    expect(src).toContain('densable leftover `kr`=`K6c`=`Kn`=`E` @207293000')
    expect(src).toContain('268_435_456')
    expect(src).toContain('2_147_479_552')
    expect(src).toContain('SCREENED_SESSION_LOG_CAP = 32')
    expect(src).toContain("key.namespace !== 'sessionLog'")
    expect(src).toContain('densable leftover `Gr` @207360246')
    expect(src).toContain('4_194_304')
    expect(src).toContain('densable leftover `opensGap`')
    expect(src).toContain('densable leftover `deliverBehindGap`')
    expect(src).toContain('byteEnd: scanned.liveBytes')
    expect(src).toContain('export function acquireStorageWatchBus')
    expect(src).toContain('densable leftover `Mu` @207361294')
    expect(src).toContain('densable leftover `Au.openedAtMs` @207361047')
    expect(src).toContain('densable leftover `Au.emit` @207361178')
    expect(src).toContain('leftover `Ot` @207296119')
    expect(src).toContain('o7c as K')
    expect(src).toContain('p7c as Q')
    expect(src).toContain('export async function withStorageWatchExpect')
    expect(src).toContain('export function announceStorageChange')
    expect(src).toContain('densable leftover `Cu.expectEcho` @207363204')
    expect(src).toContain('densable leftover `rg` @207366436')
    expect(src).toContain('densable leftover `ng` @207366455')
    expect(src).toContain('it did not report our own writes')
    expect(src).toContain('densable leftover `Nr`/`qe` @207238282')
    expect(src).toContain('!isStreamNamespaceKey(change.key)')
    expect(src).toContain("getReadSymlinkClass(change.key) === 'refuse'")
    expect(src).toContain('announceEgAppend')
    expect(src).toContain('announceRgAppend')
    expect(src).toContain('leftover `oy` @207414037')
    expect(src).toContain('leftover `$l` @207417461 — `Q` then `ly`')
    expect(src).toContain('export function validateStorageScope')
    expect(src).toContain('export function getStreamSubscribeMode')
    expect(src).toContain('installed_plugins.json')
    expect(src).toContain('asset-cache')
    expect(src).toContain('.claude-plugin')
    expect(src).toContain("['changelog/changelog.md', 'changelog.md']")
    expect(src).toContain('org-memory-discovery.json')
    expect(src).toContain("'backups'")
    expect(src).toContain('basename(roots.globalConfigFile)')
    expect(src).toContain('async applyTombstones(key)')
    expect(src).toContain('export function resolveWriteOpts')
    expect(src).toContain('export function getDefaultPublishDiscipline')
    expect(src).toContain('densable leftover `Fc` @207445806')
    expect(src).toContain('densable leftover `ds` @207446172')
    expect(src).toContain('densable leftover `gk` @207453997')
    expect(src).toContain('densable leftover `yk` @207454870')
    expect(src).toContain('densable leftover `pf` @207462778')
    expect(src).toContain('densable leftover `yf` @207464676')
    expect(src).toContain('densable leftover `kf` @207465286')
    expect(src).toContain('densable leftover `Ds` @207517338')
    expect(src).toContain('densable leftover `km` @207521788')
    expect(src).toContain('densable leftover `Jf` @207502320')
    expect(src).toContain('densable leftover `Zf` @207504036')
    expect(src).toContain('densable leftover `Tf` @207491081')
    expect(src).toContain('densable leftover `Qk` @207481800')
    expect(src).toContain('densable leftover `zk` @207463653')
    expect(src).toContain('densable leftover `$k` @207466621')
    expect(src).toContain('densable leftover `sm` @207519888')
    expect(src).toContain('densable leftover `Dv` @207520102')
    expect(src).toContain('densable leftover `Wv` @207542795')
    expect(src).toContain("transcript: 'everyForm'")
    expect(src).toContain("history: 'wholeStreamAtomic'")
    expect(src).toContain('async resolveKey(key, opts)')
    expect(src).toContain('async resolveKeys(keys, opts)')
    expect(src).toContain('async copy(from, to, opts)')
    expect(src).toContain('async move(from, to, opts)')
    expect(src).toContain('async moveScope(from, to, opts)')
    expect(src).toContain('async replaceRecords(key, entries, opts)')
    expect(src).toContain('async writeFromFile(key, path, opts)')
    expect(src).toContain('async writeFromStream(key, body, opts)')
    expect(src).toContain('must return { write } or { skip: true }')
    expect(src).toContain('densable leftover `Pf` @207480971')
    expect(src).toContain('densable leftover `Lf` @207480654')
    expect(src).toContain('densable leftover `Of` @207481306')
    expect(src).toContain('densable leftover `xf` @207481748')
    expect(src).toContain("const STAGING_SUFFIX_DF = '.tmp~'")
    expect(src).toContain('export function stagingScopeBesidePf')
    expect(src).toContain('export function stagingScopeWithinLf')
    expect(src).toContain('densable leftover `$c` @207455722')
    expect(src).toContain('["home","workspace","system","userNamed"]')
    expect(src).toContain('export function createLocalHostFiles')
    expect(src).toContain('export function snapshotHostStoreRootsAb')
    expect(src).toContain('stagingScopeBeside(scope)')
    expect(src).toContain('stagingScopeWithin(scope)')
    expect(src).toContain('hostFiles: createLocalHostFiles')
    expect(src).toContain('densable leftover `tc` @207427137')
    expect(src).toContain('densable leftover `yc` @207443798')
    expect(src).toContain('densable leftover `$l` @207417461')
    expect(src).toContain('DELETE_SCOPE_FENCED_SY')
    expect(src).toContain(
      "namespace === 'bridgeSpawn' && scope.dir === undefined",
    )
    expect(src).toContain('a session memory log is not copied or moved')
    expect(src).toContain('update takes a value key, not a stream')
    expect(src).toContain('update supplies its own exclusivity')
    expect(src).toContain(
      "a marketplace's tree is not resolved through resolveKey yet",
    )
    const za = readFileSync(
      join(import.meta.dir, '../listEntriesZa.ts'),
      'utf8',
    )
    expect(za).toContain('export function resolveScopeListDirectories')
    expect(za).toContain('export function mapNamespaceListEntry')
    expect(za).toContain('export async function listScopeEntries')
    expect(src).toContain(
      'v5 storage backend construction failed; this process falls back to legacy storage',
    )
  })

  test('tryCreateV5Backend is official qb — empty after Po()', () => {
    expect(tryCreateV5Backend()).toBeUndefined()
    recordHoverRestDecision(true)
    expect(tryCreateV5Backend()).toBeUndefined()
  })

  test('tryCreateLocalV5Backend is gated on Po()', () => {
    expect(tryCreateLocalV5Backend()).toBeUndefined()
    recordHoverRestDecision(true)
    const backend = tryCreateLocalV5Backend()
    expect(backend).toBeDefined()
    expect(typeof backend?.scopeKind).toBe('function')
    expect(typeof backend?.statMeta).toBe('function')
    expect(typeof backend?.readText).toBe('function')
  })

  test('qF Im is seedGlobalClaudeFile seeded/unchanged/conflict', () => {
    const qf = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')
    expect(qf).toContain('seedGlobalClaudeFile(options.globalConfigFile)')
    expect(qf).toContain('global config file already resolved to')
    expect(seedGlobalClaudeFile('/tmp/a.json')).toBe('seeded')
    expect(seedGlobalClaudeFile('/tmp/a.json')).toBe('unchanged')
    expect(seedGlobalClaudeFile('/tmp/b.json')).toBe('conflict')
  })

  test('createLocalFsBackend statMeta/readText jobsRoot pins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-'))
    temps.push(dir)
    const pins = JSON.stringify(['abcd1234', 'deadbeef'])
    mkdirSync(join(dir, 'jobs'), { recursive: true })
    writeFileSync(join(dir, 'jobs', 'pins.json'), pins)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = { namespace: 'jobsRoot', file: 'pins' }
    const meta = await backend.statMeta(key)
    expect(meta.ok).toBe(true)
    if (meta.ok) {
      expect(meta.value.size).toBe(pins.length)
      expect(typeof meta.value.mtimeMs).toBe('number')
    }
    const read = await backend.readText([
      { key, offset: 0, length: pins.length + 1 },
    ])
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.value.items[0]?.found).toBe(true)
      expect(read.value.items[0]?.value).toBe(pins)
    }
  })

  test('createLocalFsBackend scopeKind pluginCache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-pc-'))
    temps.push(dir)
    const cache = join(dir, 'plugins', 'cache', 'mkt', 'plug', '1.0.0')
    mkdirSync(cache, { recursive: true })
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const present = await backend.scopeKind({
      namespace: 'pluginCache',
      marketplace: 'mkt',
      plugin: 'plug',
      version: '1.0.0',
    })
    expect(present).toEqual({
      ok: true,
      value: { kind: 'directory' },
    })
    const missing = await backend.scopeKind({
      namespace: 'pluginCache',
      marketplace: 'mkt',
      plugin: 'plug',
      version: '9.9.9',
    })
    expect(missing).toEqual({
      ok: true,
      value: { kind: 'absent' },
    })
  })

  test('pinStorageV5FromEnv no-ops without CLAUDE_CODE_HOVER_REST', () => {
    expect(pinStorageV5FromEnv()).toBeUndefined()
    expect(pinStorageV5()).toBeUndefined()
  })

  test('pinStorageV5FromEnv pins hover-rest; default factory is qb', () => {
    process.env.CLAUDE_CODE_HOVER_REST = '1'
    const snapshot = pinStorageV5FromEnv()
    expect(snapshot?.configHome).toBeDefined()
    expect(snapshot?.backend).toBeUndefined()
    expect(pinStorageV5(snapshot)).toBeUndefined()
  })

  test('cli pins after cli_entry; skips --preload / --bg-spare', () => {
    const cli = readFileSync(
      join(import.meta.dir, '../../../entrypoints/cli.tsx'),
      'utf8',
    )
    expect(cli).toContain("profileCheckpoint('cli_entry')")
    expect(cli).toContain('pinStorageV5FromEnv')
    expect(cli).toContain('pinStorageV5(hoverRestSnapshot)')
    expect(cli).toContain("args[0] !== '--preload'")
    expect(cli).toContain("args[0] !== '--bg-spare'")
    expect(cli).toContain('credentialsStoreFor(pinned)')
    expect(cli).toContain('primePolicyLimitsCache(pinned)')
    expect(cli).not.toContain('tryCreateLocalV5Backend()')
  })

  test('write/read/lease leftover VFS surface', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-w-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = { namespace: 'state', id: 'policy-limits' }
    const body = '{"restrictions":{"remote":{"allowed":false}}}'
    const written = await backend.write(key, body)
    expect(written.ok).toBe(true)
    const read = await backend.read([{ key, offset: 0, length: body.length }])
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.value.items[0]?.found).toBe(true)
      expect(
        Buffer.from(read.value.items[0]?.value ?? []).toString('utf8'),
      ).toBe(body)
    }
    const lease = await backend.acquireLease(key, 60_000, { holder: 't' })
    expect(lease.ok).toBe(true)
    const leaseDir = join(dir, 'storage-v2', 'leases')
    expect(existsSync(leaseDir)).toBe(true)
    const leaseFiles = readdirSync(leaseDir).filter(n => n.endsWith('.json'))
    expect(leaseFiles.length).toBe(1)
    expect(leaseFiles[0]).toMatch(/^[0-9a-f]{64}\.json$/)
    const again = await backend.acquireLease(key, 60_000, { holder: 't' })
    expect(again.ok).toBe(true)
    const other = await backend.acquireLease(key, 60_000, { holder: 'u' })
    expect(other.ok).toBe(false)
    if (!other.ok) expect(other.error.code).toBe('Held')
    const listed = await backend.listLeases(key)
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.length).toBe(1)
    if (lease.ok) await lease.value.release()
    const sub = await backend.subscribe({ target: 'key', key }, () => {})
    expect(sub.ok).toBe(true)
    if (sub.ok) {
      expect(sub.value.observationLagMs).toBeGreaterThan(0)
      sub.value.unsubscribe()
    }
    await backend.close()
  })

  test('subscribeStorage Fb zu/Hu leftover rejects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-sub-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      nativeWatch: false,
    })
    const key = { namespace: 'state', id: 'policy-limits' }
    const lag = await backend.subscribe({ target: 'key', key }, () => {}, {
      maxObservationLagMs: -1,
    })
    expect(lag.ok).toBe(false)
    if (!lag.ok) {
      expect(lag.error.code).toBe('InvalidArgument')
    }
    const market = await backend.subscribe(
      {
        target: 'scope',
        scope: { namespace: 'marketplaceCache', marketplace: 'mkt' },
      },
      () => {},
    )
    expect(market.ok).toBe(false)
    if (!market.ok) {
      expect(market.error.code).toBe('InvalidArgument')
    }
    const served = await backend.subscribe({ target: 'key', key }, () => {})
    expect(served.ok).toBe(true)
    if (served.ok) {
      expect(served.value.observationLagMs).toBe(2000)
      served.value.unsubscribe()
    }
    await backend.close()
  })

  test('createLocalFsBackend write job namespace + parent mustExist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-job-'))
    temps.push(dir)
    const jobDir = join(dir, 'jobs', 'abcd1234')
    mkdirSync(jobDir, { recursive: true })
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = {
      namespace: 'job',
      jobId: 'abcd1234',
      relPath: ['state.json'],
    }
    const body = '{"name":"phone"}'
    const written = await backend.write(key, body, { parent: 'mustExist' })
    expect(written.ok).toBe(true)
    const bare = await backend.read([key])
    expect(bare.ok).toBe(true)
    if (bare.ok) {
      expect(bare.value.items[0]?.found).toBe(true)
      expect(
        Buffer.from(bare.value.items[0]?.value ?? []).toString('utf8'),
      ).toBe(body)
    }
    await backend.close()
  })

  test('createLocalFsBackend readRecords/listEntries leftover al/za', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-rr-'))
    temps.push(dir)
    const project = join(dir, 'projects', 'proj')
    const sub = join(project, 'sid', 'subagents')
    mkdirSync(sub, { recursive: true })
    const body = '{"uuid":"a"}\n{"uuid":"b"}\n'
    writeFileSync(join(project, 'sid.jsonl'), body)
    writeFileSync(join(sub, 'agent-aid.jsonl'), '{"uuid":"c"}\n')
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = {
      namespace: 'transcript',
      projectKey: 'proj',
      sessionId: 'sid',
    }
    const missing = await backend.readRecords({
      ...key,
      sessionId: 'gone',
    })
    expect(missing).toEqual({ ok: false, error: { code: 'NotFound' } })
    const page = await backend.readRecords(key, { order: 'backward' })
    expect(page.ok).toBe(true)
    if (page.ok) {
      expect(
        page.value.items.map(i => Buffer.from(i.data).toString('utf8')),
      ).toEqual(['{"uuid":"b"}\n', '{"uuid":"a"}\n'])
      expect(page.value.items[0]?.seq).toBe('{"uuid":"a"}\n'.length)
      expect(page.value.items[1]?.seq).toBe(0)
    }
    const listed = await backend.listEntries(key)
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items).toEqual([
        {
          kind: 'key',
          key: {
            namespace: 'transcript',
            projectKey: 'proj',
            sessionId: 'sid',
            agentId: 'aid',
          },
          size: expect.any(Number),
          mtimeMs: expect.any(Number),
        },
      ])
    }
    const ids = await (
      await import('../../sessionPersistenceSync.js')
    ).listSubagentIdsForSession(backend, 'proj', 'sid')
    expect(ids).toEqual(['aid'])
    const jobDir = join(dir, 'jobs', 'abcd1234')
    mkdirSync(jobDir, { recursive: true })
    writeFileSync(join(jobDir, 'state.json'), '{}')
    const jobs = await backend.listEntries({
      namespace: 'job',
      jobId: 'abcd1234',
    })
    expect(jobs.ok).toBe(true)
    if (jobs.ok) {
      expect(
        jobs.value.items.some(
          i =>
            i.kind === 'key' &&
            i.key?.namespace === 'job' &&
            Array.isArray(i.key.relPath) &&
            i.key.relPath[0] === 'state.json',
        ),
      ).toBe(true)
    }
    const opaque = await backend.readRecords({
      namespace: 'job',
      jobId: 'abcd1234',
      relPath: ['state.json'],
    })
    expect(opaque).toEqual({ ok: false, error: { code: 'NotFound' } })
    await backend.close()
    // 动态 import sessionPersistenceSync 冷加载要 ~8s（模块图很大），超过默认 5s。
  }, 30000)

  test('createLocalFsBackend Xu/Eg write + La Re/sl/Ot read digest-log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-la-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = { namespace: 'state', id: 'digest-log' }
    const first = Buffer.from('{"n":1}')
    const second = Buffer.from('{"n":2}')
    const written = await backend.append(key, [
      { data: first },
      { data: second },
    ])
    expect(written.ok).toBe(true)
    if (written.ok) {
      expect(written.value.acks).toHaveLength(2)
      expect(written.value.acks[0]?.seq).toBe(0)
      expect(written.value.acks[1]?.seq).toBe(1)
    }
    const page = await backend.readRecords(key, { order: 'forward' })
    expect(page.ok).toBe(true)
    if (page.ok) {
      expect(
        page.value.items.map(i => Buffer.from(i.data).toString('utf8')),
      ).toEqual(['{"n":1}', '{"n":2}'])
      expect(page.value.items[0]?.seq).toBe(0)
      expect(page.value.items[0]?.endSeq).toBe(1)
      expect(typeof page.value.items[0]?.recordId).toBe('string')
      expect(page.value.items[0]?.tombstoned).toBe(false)
    }
    const host = {
      closed: false,
      roots: backend.roots,
      lockUnconditionalPublishes: false,
      indexCache: new Map(),
      verifiedCache: new Set<string>(),
      scanFilesCache: new Map(),
      scanCountCache: new Map(),
      screenedSessionLogs: new Map(),
    }
    const layout = resolveDigestStreamLayout(
      host,
      key,
      join(dir, 'state', 'digest-log.json'),
    )
    expect(layout?.index.endsWith('index.jsonl')).toBe(true)
    expect(layout?.marker.endsWith('apply.marker')).toBe(true)
    expect(await syncDigestStream(host, layout!)).toEqual({
      ok: true,
      value: undefined,
    })
    const loaded = await loadDigestIndex(host, layout!)
    expect(loaded.ok).toBe(true)
    if (loaded.ok && loaded.value !== 'missing') {
      expect(loaded.value.entries).toHaveLength(2)
    }
    const streams = join(dir, 'storage-v2', 'streams')
    expect(existsSync(streams)).toBe(true)
    const hashed = readdirSync(streams)
    expect(hashed).toHaveLength(1)
    expect(existsSync(join(streams, hashed[0]!, 'index.jsonl'))).toBe(true)
    const log = readFileSync(join(dir, 'state', 'digest-log.json'))
    expect(log.equals(Buffer.concat([first, second]))).toBe(true)
    const framed = await backend.append({ namespace: 'history' }, [
      { data: '{"h":1}\n' },
    ])
    expect(framed.ok).toBe(true)
    const hist = await backend.readRecords(
      { namespace: 'history' },
      { order: 'forward' },
    )
    expect(hist.ok).toBe(true)
    if (hist.ok) {
      expect(
        Buffer.from(hist.value.items[0]?.data ?? []).toString('utf8'),
      ).toBe('{"h":1}\n')
    }
    const transcriptWrite = await backend.write(
      {
        namespace: 'transcript',
        projectKey: 'proj',
        sessionId: 'sid',
      },
      '{"x":1}\n',
    )
    expect(transcriptWrite).toEqual({
      ok: false,
      error: { code: 'InvalidArgument' },
    })
    const sessionLog = await backend.append(
      {
        namespace: 'sessionLog',
        projectKey: 'proj',
        year: '2026',
        month: '09',
        day: '14',
        logName: 'note',
      },
      [{ data: 'hello\n' }],
    )
    expect(sessionLog.ok).toBe(true)
    expect(
      existsSync(
        join(
          dir,
          'projects',
          'proj',
          'memory',
          'logs',
          '2026',
          '09',
          '14',
          'note.md',
        ),
      ),
    ).toBe(true)
    expect(
      readFileSync(
        join(
          dir,
          'projects',
          'proj',
          'memory',
          'logs',
          '2026',
          '09',
          '14',
          'note.md',
        ),
        'utf8',
      ),
    ).toBe('hello\n')
    const debugLog = await backend.append(
      {
        namespace: 'log',
        sessionId: 'sid',
        channel: 'debug',
      },
      [{ data: 'dbg\n' }],
    )
    expect(debugLog.ok).toBe(true)
    expect(existsSync(join(dir, 'debug', 'sid.txt'))).toBe(true)
    const { getDebugLogRotationConfig, DEBUG_LOG_MAX_BYTES } = await import(
      '../writeValidate.js'
    )
    expect(DEBUG_LOG_MAX_BYTES).toBe(10485760)
    expect(
      getDebugLogRotationConfig(
        { configHome: dir },
        { namespace: 'log', channel: 'debug', sessionId: 'sid' },
        join(dir, 'debug', 'sid.txt'),
      ),
    ).toEqual({
      maxBytes: 10485760,
      rotatedPath: join(dir, 'debug', 'sid.1.txt'),
    })
    await backend.close()
  })

  test('withStorageLock reentrant ifReentrant returns ok', async () => {
    const { withStorageLock } = await import('../storageLock.js')
    const dir = mkdtempSync(join(tmpdir(), 'sv5-lock-'))
    temps.push(dir)
    const index = join(dir, 'index.jsonl')
    writeFileSync(index, '')
    const nested = await withStorageLock(
      index,
      async () =>
        withStorageLock(
          index,
          async () => ({ ok: true as const, value: 'inner' }),
          {
            ifReentrant: () => ({ ok: true, value: 'reentrant' }),
            ifContended: () => ({
              ok: false,
              error: { code: 'Unavailable' },
            }),
          },
        ),
      {
        ifReentrant: () => ({ ok: true, value: 'outer' }),
        ifContended: () => ({ ok: false, error: { code: 'Unavailable' } }),
      },
    )
    expect(nested).toEqual({ ok: true, value: 'reentrant' })
  })

  test('createLocalFsBackend leftover hb extras + ja publish', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-hb-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const settings = { namespace: 'settings', layer: 'user' }
    const settingsBody = '{"theme":"dark"}'
    const registry = await backend.write(
      { namespace: 'pluginRegistry', file: 'installed' },
      '{}',
    )
    expect(registry.ok).toBe(true)
    expect(existsSync(join(dir, 'plugins', 'installed_plugins.json'))).toBe(
      true,
    )
    const changelog = await backend.write(
      { namespace: 'cache', store: 'changelog', id: 'changelog.md' },
      'notes',
    )
    expect(changelog.ok).toBe(true)
    expect(existsSync(join(dir, 'cache', 'changelog.md'))).toBe(true)
    const cacheOther = await backend.write(
      { namespace: 'cache', store: 'foo', id: 'bar' },
      'x',
    )
    expect(cacheOther.ok).toBe(true)
    expect(existsSync(join(dir, 'cache', 'foo', 'bar'))).toBe(true)
    const kindCopy = await backend.write(
      { namespace: 'globalConfig', kind: 'backup', stamp: '1' },
      '{}',
    )
    expect(kindCopy.ok).toBe(true)
    expect(existsSync(join(dir, 'backups', '.claude.json.backup.1'))).toBe(true)
    const settingsWrite = await backend.write(settings, settingsBody)
    expect(settingsWrite.ok).toBe(true)
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(settingsBody)

    const state = { namespace: 'state', id: 'digest-log' }
    const first = await backend.append(state, [
      { data: Buffer.from('{"n":1}') },
    ])
    expect(first.ok).toBe(true)
    const stream = await backend.statStream(state)
    expect(stream.ok).toBe(true)
    if (stream.ok) {
      expect(stream.value.recordCount).toBe(1)
      expect(stream.value.headSeq).toBe(0)
    }
    const value = await backend.readValue({
      namespace: 'state',
      id: 'policy-limits',
    })
    expect(value).toBeUndefined()
    const policy = await backend.write(
      { namespace: 'state', id: 'policy-limits' },
      '{"ok":true}',
    )
    expect(policy.ok).toBe(true)
    expect(existsSync(join(dir, 'policy-limits.json'))).toBe(true)
    const readValue = await backend.readValue({
      namespace: 'state',
      id: 'policy-limits',
    })
    expect(readValue?.size).toBe('{"ok":true}'.length)

    const touch = await backend.touch({
      namespace: 'state',
      id: 'policy-limits',
    })
    expect(touch.ok).toBe(true)
    const digest = await backend.digest({
      namespace: 'state',
      id: 'policy-limits',
    })
    expect(digest.ok).toBe(true)
    if (digest.ok) {
      expect(digest.value.totalBytes).toBe('{"ok":true}'.length)
      expect(digest.value.digest).toHaveLength(64)
    }
    const mode = await backend.setMode(
      { namespace: 'state', id: 'policy-limits' },
      0o644,
    )
    expect(mode.ok).toBe(true)

    const inPlace = await backend.write(
      { namespace: 'state', id: 'policy-limits' },
      '{"ok":false}',
      { publishDiscipline: 'inPlace' },
    )
    expect(inPlace.ok).toBe(true)
    expect(readFileSync(join(dir, 'policy-limits.json'), 'utf8')).toBe(
      '{"ok":false}',
    )

    const absent = await backend.write(
      { namespace: 'state', id: 'fresh-state' },
      '{"n":1}',
      { precondition: { type: 'ifAbsent' } },
    )
    expect(absent.ok).toBe(true)
    expect(existsSync(join(dir, 'state', 'fresh-state.json'))).toBe(true)
    const again = await backend.write(
      { namespace: 'state', id: 'fresh-state' },
      '{"n":2}',
      { precondition: { type: 'ifAbsent' } },
    )
    expect(again).toEqual({ ok: false, error: { code: 'Failed' } })

    const scope = await backend.ensureScope({
      namespace: 'userConfigDir',
      dir: 'commands',
    })
    expect(scope.ok).toBe(true)
    if (scope.ok) expect(scope.value.created).toBe(true)
    expect(existsSync(join(dir, 'commands'))).toBe(true)
    const againScope = await backend.ensureScope({
      namespace: 'userConfigDir',
      dir: 'commands',
    })
    expect(againScope).toEqual({ ok: true, value: { created: false } })
    const market = await backend.ensureScope({
      namespace: 'marketplaceCache',
      marketplace: 'mkt',
    })
    expect(market.ok).toBe(true)
    if (market.ok) expect(market.value.created).toBe(true)

    const tomb = await backend.tombstone(state, ['missing-id'])
    expect(tomb.ok).toBe(true)
    if (tomb.ok) {
      expect(tomb.value.matched).toEqual([false])
      expect(tomb.value.newly).toEqual([])
    }
    const purged = await backend.applyTombstones(state)
    expect(purged).toEqual({ ok: true, value: { purged: 0 } })
    const keys = await backend.scopeKeys({
      namespace: 'state',
      id: 'policy-limits',
    })
    expect(keys.ok).toBe(true)
    const framed = await backend.streamEntries({ namespace: 'history' })
    expect(framed).toBe('missing')
    await backend.close()
  })

  test('history streamEntries is leftover Ou framed observe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-ou-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      nativeWatch: false,
    })
    const key = { namespace: 'history' }
    expect(await backend.streamEntries(key)).toBe('missing')

    const first = '{"q":"a"}\n'
    const second = '{"q":"b"}\n'
    writeFileSync(join(dir, 'history.jsonl'), first + second + '{"partial"')
    const framed = await backend.streamEntries(key)
    expect(framed).toMatchObject({
      byteEnd: first.length + second.length,
    })
    expect(framed).not.toEqual({ unobservable: { code: 'Failed' } })
    const rec = framed as {
      generation: string
      entries: Array<{ seq: number; recordId: string }>
      byteEnd: number
      stamp: { generation: string; size: number; mtimeMs: number }
    }
    expect(rec.generation.startsWith('scan:')).toBe(true)
    expect(rec.entries).toHaveLength(2)
    expect(rec.entries[0]).toMatchObject({ seq: 0, recordId: '0' })
    expect(rec.entries[1]).toMatchObject({
      seq: first.length,
      recordId: String(first.length),
    })
    expect(rec.stamp.generation).toBe(rec.generation)
    expect(rec.stamp.size).toBe(first.length + second.length + 10)
    expect(await backend.streamEntries(key, rec.stamp)).toBe('unchanged')

    const counted = await backend.statStream(key)
    expect(counted.ok).toBe(true)
    if (counted.ok) {
      expect(counted.value.recordCount).toBe(2)
      expect(counted.value.headSeq).toBe(first.length)
      expect(counted.value.size).toBe(first.length + second.length)
      expect(counted.value.tornTailBytes).toBe(10)
      expect(counted.value.version?.startsWith('scan:')).toBe(true)
    }
    const again = await backend.statStream(key)
    expect(again).toEqual(counted)

    const valued = await backend.readValue(key)
    expect(valued?.size).toBe(first.length + second.length)
    expect(Buffer.from(valued?.bytes ?? []).toString('utf8')).toBe(
      first + second,
    )
    expect(valued?.version.startsWith('scan:')).toBe(true)

    const ranged = await backend.read([
      { key, offset: 0, length: first.length },
    ])
    expect(ranged.ok).toBe(true)
    if (ranged.ok) {
      expect(ranged.value.items[0]?.found).toBe(true)
      expect(ranged.value.items[0]?.totalBytes).toBe(
        first.length + second.length,
      )
      expect(
        Buffer.from(ranged.value.items[0]?.value ?? []).toString('utf8'),
      ).toBe(first)
      expect(ranged.value.items[0]?.version?.startsWith('scan:')).toBe(true)
    }
    const tailed = await backend.read([{ key, tail: second.length }])
    expect(tailed.ok).toBe(true)
    if (tailed.ok) {
      expect(
        Buffer.from(tailed.value.items[0]?.value ?? []).toString('utf8'),
      ).toBe(second)
      expect(tailed.value.items[0]?.totalBytes).toBe(
        first.length + second.length,
      )
    }

    const sub = await backend.subscribe({ target: 'key', key }, () => {})
    expect(sub.ok).toBe(true)
    if (sub.ok) {
      expect(sub.value.observationLagMs).toBe(2000)
      sub.value.unsubscribe()
    }
    await backend.close()
  })

  test('sessionLog Ft screens hops via leftover $r', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-ft-'))
    temps.push(dir)
    mkdirSync(join(dir, 'projects', 'proj', 'memory'), { recursive: true })
    writeFileSync(join(dir, 'projects', 'proj', 'memory', 'logs'), 'not-a-dir')
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = {
      namespace: 'sessionLog',
      projectKey: 'proj',
      year: '2026',
      month: '09',
      day: '16',
      logName: 'note',
    }
    expect(await backend.readValue(key)).toBeUndefined()
    const ranged = await backend.read([{ key, offset: 0, length: 4 }])
    expect(ranged).toEqual({ ok: false, error: { code: 'Failed' } })
    await backend.close()
  })

  test('job leftover Se/xn refuse timeline.jsonl first-seg', () => {
    expect(
      validateStorageKey({
        namespace: 'job',
        jobId: 'abcd1234',
        relPath: ['timeline.jsonl'],
      }),
    ).toEqual({ code: 'InvalidArgument', argument: 'key.relPath' })
    expect(
      validateStorageKey({
        namespace: 'job',
        jobId: 'abcd1234',
        relPath: ['Timeline.jsonl'],
      }),
    ).toEqual({ code: 'InvalidArgument', argument: 'key.relPath' })
    expect(
      validateStorageScope({
        namespace: 'job',
        jobId: 'abcd1234',
        relPath: ['timeline.jsonl'],
      }),
    ).toEqual({ code: 'InvalidArgument', argument: 'scope.relPath' })
    expect(
      validateStorageKey({
        namespace: 'job',
        jobId: 'abcd1234',
        relPath: ['state.json'],
      }),
    ).toBeUndefined()
  })

  test('listRecursive leftover Xa/_y walks memory files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-xa-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      nativeWatch: false,
    })
    const missingVersion = await backend.listRecursive({
      namespace: 'pluginCache',
      marketplace: 'm',
      plugin: 'p',
    })
    expect(missingVersion).toEqual({
      ok: false,
      error: { code: 'InvalidArgument' },
    })
    const wrote = await backend.write(
      {
        namespace: 'memory',
        projectKey: 'proj',
        relPath: ['nested', 'hello.md'],
      },
      'hi',
    )
    expect(wrote.ok).toBe(true)
    const listed = await backend.listRecursive({
      namespace: 'memory',
      projectKey: 'proj',
    })
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items.some(item => item.kind === 'key')).toBe(true)
    }
    await backend.close()
  })

  test('mn/It extras: settings layer, pluginRegistry, scope stream-keys', () => {
    expect(
      validateStorageKey({ namespace: 'settings', layer: 'team' }),
    ).toEqual({ code: 'InvalidArgument', argument: 'key.layer' })
    expect(
      validateStorageKey({ namespace: 'pluginRegistry', file: 'nope' }),
    ).toEqual({ code: 'InvalidArgument', argument: 'key.file' })
    expect(
      validateStorageKey({
        namespace: 'pluginRegistry',
        file: 'installed',
      }),
    ).toBeUndefined()
    expect(
      validateStorageKey({
        namespace: 'sessionLog',
        projectKey: 'proj',
        year: '2026',
        month: '09',
        day: '16',
        logName: 'CON',
      }),
    ).toEqual({ code: 'InvalidArgument', argument: 'key.logName' })
    expect(
      validateStorageScope({
        namespace: 'transcript',
        projectKey: 'p',
        sessionId: 's',
        agentId: 'agent',
      }),
    ).toEqual({ code: 'InvalidArgument', argument: 'scope.agentId' })
    expect(
      validateStorageScope({
        namespace: 'sessionLog',
        year: '2026',
      }),
    ).toEqual({ code: 'InvalidArgument', argument: 'scope.projectKey' })
  })

  test('rn I/Xe refuse memory first-seg team alias, not ..', () => {
    const team = { namespace: 'memory', relPath: ['team'] }
    const dotted = { namespace: 'memory', relPath: ['Team.'] }
    const colon = { namespace: 'memory', relPath: ['team:note'] }
    const parent = { namespace: 'memory', relPath: ['..'] }
    const note = { namespace: 'memory', relPath: ['state.json'] }
    expect(getReadSymlinkClass(team)).toBe('refuse')
    expect(getSymlinkPolicy(team)).toBe('refuse')
    expect(getReadSymlinkClass(dotted)).toBe('refuse')
    expect(getReadSymlinkClass(colon)).toBe('refuse')
    expect(getReadSymlinkClass(parent)).toBe('follow')
    expect(getReadSymlinkClass(note)).toBe('follow')
    expect(getSymlinkPolicy(note)).toBe('follow')
  })

  test('Me we/ga refuses a hardened hard-linked value as OtherNames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-we-'))
    temps.push(dir)
    const path = join(dir, 'solo.json')
    writeFileSync(path, '{"ok":true}')
    const hardened = join(await realpath(dirname(path)), basename(path))
    const solo = await readValueWholeSe(path, 'refuse', hardened)
    expect(solo.ok).toBe(true)
    try {
      linkSync(path, join(dir, 'alias.json'))
    } catch {
      return
    }
    const linked = await readValueWholeSe(path, 'refuse', hardened)
    expect(linked.ok).toBe(false)
    if (!linked.ok) {
      expect(linked.error.kind).toBe('fs')
      expect((linked.error as { error?: { code?: string } }).error?.code).toBe(
        'OtherNames',
      )
    }
  })

  test('Kl Jg/ey/Qg reject hardened stream and follow-on-refuse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-kl-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const history = { namespace: 'history' }
    const state = { namespace: 'state', id: 'policy-limits' }
    expect(await backend.read([history], { hardened: true })).toEqual({
      ok: false,
      error: { code: 'InvalidArgument' },
    })
    expect(await backend.read([state], { symlinks: 'follow' })).toEqual({
      ok: false,
      error: { code: 'InvalidArgument' },
    })
    await backend.write(state, '{"ok":true}')
    const whole = await backend.read([state])
    expect(whole.ok).toBe(true)
    if (whole.ok) {
      expect(whole.value.items[0]?.found).toBe(true)
      expect(whole.value.items[0]?.version).toHaveLength(16)
    }
    await backend.close()
  })

  test('credentialsStoreFor gates on Po() and a handle', () => {
    expect(credentialsStoreFor({})).toBeUndefined()
    recordHoverRestDecision(true)
    expect(credentialsStoreFor(undefined)).toBeUndefined()
    const store = credentialsStoreFor({})
    expect(store?.[CREDENTIALS_STORE_HANDLE]).toBe('CredentialsStoreHandle')
  })

  test('oy Kt NotFound mkdir-retry + lockUnconditionalPublishes write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-oy-kt-'))
    temps.push(dir)
    // densable oy: colocated lock + missing parent → NotFound → ie(en) → retry En.
    const nested = join(dir, 'deep', 'nest', 'mail.json')
    const key = { namespace: 'mailbox', id: 'm1' }
    const host = {
      closed: false,
      roots: {
        configHome: dir,
        globalConfigFile: join(dir, '.claude.json'),
      },
      lockUnconditionalPublishes: true,
      indexCache: new Map(),
      verifiedCache: new Set<string>(),
      scanFilesCache: new Map(),
      scanCountCache: new Map(),
      screenedSessionLogs: new Map(),
    }
    const dt = resolveWriteOpts(key)
    expect(dt.makeParent).toBe(true)
    expect(existsSync(join(dir, 'deep'))).toBe(false)
    const published = await publishFileSerialized(
      nested,
      key,
      '{"ok":1}',
      dt,
      host,
    )
    expect(published.ok).toBe(true)
    expect(existsSync(nested)).toBe(true)
    expect(readFileSync(nested, 'utf8')).toBe('{"ok":1}')

    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      lockUnconditionalPublishes: true,
    })
    const written = await backend.write(
      { namespace: 'state', id: 'kt-publish' },
      '{"kt":true}',
    )
    expect(written.ok).toBe(true)
    expect(existsSync(join(dir, 'state', 'kt-publish.json'))).toBe(true)
    await backend.close()
  })

  test('Fc/ds resolveKey: inPlace memory, refuse stream and marketplace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-fc-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = {
      namespace: 'memory',
      projectKey: 'p',
      relPath: ['note.md'],
    }
    const within = { namespace: 'memory', projectKey: 'p' }
    await backend.write(key, 'hi')
    const hit = await backend.resolveKey(key, {
      within,
      anchor: 'literal',
    })
    expect(hit).toEqual({ ok: true, value: { kind: 'inPlace' } })
    expect(
      await backend.resolveKey(
        { namespace: 'history' },
        { within, anchor: 'literal' },
      ),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'key' },
    })
    expect(
      await backend.resolveKey(key, {
        within: { namespace: 'marketplaceCache', marketplace: 'm' },
        anchor: 'literal',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'opts.within' },
    })
    expect(
      await backend.resolveKeys('nope', { within, anchor: 'literal' }),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'keys' },
    })
    await backend.close()
  })

  test('pf/yf copy and move values; Tf refuses sessionLog and class mix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-pf-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const from = { namespace: 'state', id: 'copy-a' }
    const to = { namespace: 'state', id: 'copy-b' }
    await backend.write(from, '{"a":1}')
    const copied = await backend.copy(from, to)
    expect(copied.ok).toBe(true)
    const read = await backend.read([to])
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(Buffer.from(read.value.items[0]!.value!).toString()).toBe(
        '{"a":1}',
      )
    }
    const movedTo = { namespace: 'state', id: 'copy-c' }
    const moved = await backend.move(to, movedTo)
    expect(moved.ok).toBe(true)
    expect(
      await backend.copy(
        {
          namespace: 'sessionLog',
          projectKey: 'p',
          year: '2026',
          month: '09',
          day: '16',
          logName: 'daily',
        },
        { namespace: 'history' },
      ),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'from' },
    })
    expect(await backend.copy(from, { namespace: 'history' })).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'to' },
    })
    await backend.close()
  })

  test('kf moveScope: Gk one-tree only; $k refuses self', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-kf-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const mem = { namespace: 'memory', projectKey: 'p' }
    expect(await backend.moveScope(mem, { ...mem, projectKey: 'q' })).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'from' },
    })
    expect(
      await backend.moveScope(
        {
          namespace: 'transcript',
          projectKey: 'p',
          sessionId: 's1',
        },
        {
          namespace: 'transcript',
          projectKey: 'p',
          sessionId: 's1',
        },
      ),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'to' },
    })
    await backend.close()
  })

  test('Ds update sm/Dv write and skip; refuse stream and precondition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-ds-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const key = { namespace: 'state', id: 'upd' }
    expect(
      await backend.update({ namespace: 'history' }, () => ({ skip: true })),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'key' },
    })
    expect(
      await backend.update(key, () => ({ skip: true }), {
        precondition: { type: 'none' },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'opts.precondition' },
    })
    const created = await backend.update(key, () => ({ write: '{"n":1}' }))
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.written).toBe(true)
      expect(created.value.found).toBe(false)
    }
    const skipped = await backend.update(key, () => ({ skip: true }))
    expect(skipped).toEqual({
      ok: true,
      value: { written: false, found: true },
    })
    const text = await backend.updateText(key, current => ({
      write: `${current?.value ?? ''}!`,
    }))
    expect(text.ok).toBe(true)
    await backend.close()
  })

  test('km replaceRecords history; refuse log namespace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-km-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    expect(
      await backend.replaceRecords(
        { namespace: 'log', sessionId: 's', channel: 'debug' },
        [{ data: 'x\n' }],
      ),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'stream.namespace' },
    })
    const replaced = await backend.replaceRecords({ namespace: 'history' }, [
      { data: '{"q":1}\n' },
    ])
    expect(replaced.ok).toBe(true)
    expect(readFileSync(join(dir, 'history.jsonl'), 'utf8')).toBe('{"q":1}\n')
    await backend.close()
  })

  test('Jf/Zf ingest value; refuse stream and follow keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-jf-'))
    temps.push(dir)
    const src = join(dir, 'src.json')
    writeFileSync(src, '{"ingested":true}')
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    expect(await backend.writeFromFile({ namespace: 'history' }, src)).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'key' },
    })
    expect(
      await backend.writeFromFile(
        { namespace: 'settings', layer: 'user' },
        src,
      ),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'key' },
    })
    const key = { namespace: 'state', id: 'ingested' }
    const fromFile = await backend.writeFromFile(key, src)
    expect(fromFile.ok).toBe(true)
    expect(readFileSync(join(dir, 'state', 'ingested.json'), 'utf8')).toBe(
      '{"ingested":true}',
    )
    async function* chunks() {
      yield new Uint8Array([123, 125])
    }
    const fromStream = await backend.writeFromStream(
      { namespace: 'state', id: 'streamed' },
      chunks(),
      { maxBytes: 16 },
    )
    expect(fromStream.ok).toBe(true)
    expect(readFileSync(join(dir, 'state', 'streamed.json'), 'utf8')).toBe('{}')
    expect(
      await backend.writeFromStream(key, chunks(), undefined as never),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'opts' },
    })
    await backend.close()
  })

  test('Pf/Lf stage pluginCache.version only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-pf-lf-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const parent = {
      namespace: 'pluginCache',
      marketplace: 'mkt',
      plugin: 'plug',
    }
    const within = backend.stagingScopeWithin(parent)
    expect(within.namespace).toBe('pluginCache')
    expect(within.marketplace).toBe('mkt')
    expect(within.plugin).toBe('plug')
    expect(String(within.version)).toMatch(/^install\.tmp~[0-9a-f]{8}$/)
    const beside = backend.stagingScopeBeside({
      ...parent,
      version: '1.0.0',
    })
    expect(String(beside.version)).toMatch(/^1\.0\.0\.tmp~[0-9a-f]{8}$/)
    expect(() =>
      backend.stagingScopeWithin({
        namespace: 'memory',
        projectKey: 'p',
      }),
    ).toThrow(/only a whole plugin version can be staged/)
    expect(() =>
      backend.stagingScopeBeside({
        namespace: 'pluginCache',
        marketplace: 'mkt',
        plugin: 'plug',
        version: '1.0.0',
        relPath: ['x'],
      }),
    ).toThrow(/only a whole plugin version can be staged/)
    await backend.close()
  })

  test('$c hostFiles serve map, write/read, refuse space', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-host-'))
    temps.push(dir)
    const workspace = mkdtempSync(join(tmpdir(), 'sv5-ws-'))
    temps.push(workspace)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      hostFilesServe: { system: false, home: 'absent' },
    })
    expect(backend.hostFiles.serves('workspace')).toBe(true)
    expect(backend.hostFiles.serves('system')).toBe(false)
    expect(backend.hostFiles.serving('home')).toBe('absent')
    const file = join(workspace, 'note.txt')
    const path = { space: 'workspace' as const, path: file }
    const written = await backend.hostFiles.write(path, 'hello')
    expect(written).toEqual({ ok: true, value: { bytes: 5 } })
    expect(await backend.hostFiles.readText(path)).toEqual({
      ok: true,
      value: { found: true, value: 'hello', bytes: 5 },
    })
    expect(
      await backend.hostFiles.readText({
        space: 'system',
        path: join(workspace, 'nope.txt'),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'Failed',
        failureClass: 'environment',
        telemetryCode: 'Unsupported',
      },
    })
    expect(
      await backend.hostFiles.readText({
        space: 'home',
        path: join(workspace, 'gone.txt'),
      }),
    ).toEqual({ ok: true, value: { found: false } })
    expect(
      await backend.hostFiles.write(
        { space: 'workspace', path: join(dir, '.claude.json') },
        'x',
      ),
    ).toEqual({
      ok: false,
      error: {
        code: 'InvalidArgument',
        argument: 'path',
        reason:
          "a path under the config home is the store's own state: address it by its key, not as a host file",
      },
    })
    await backend.close()
  })

  test('tc olderThanMs sweeps bridge-spawn folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-tc-'))
    temps.push(dir)
    const spawn = mkdtempSync(join(tmpdir(), 'sv5-spawn-'))
    temps.push(spawn)
    const oldDir = join(spawn, 'old-job')
    const newDir = join(spawn, 'new-job')
    mkdirSync(oldDir)
    mkdirSync(newDir)
    const oldTime = new Date(Date.now() - 60_000)
    utimesSync(oldDir, oldTime, oldTime)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      bridgeSpawnRoot: spawn,
      clock: () => Date.now(),
    })
    expect(
      await backend.deleteScope(
        { namespace: 'memory', projectKey: 'p' },
        { olderThanMs: 1000 },
      ),
    ).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'opts.olderThanMs' },
    })
    const swept = await backend.deleteScope(
      { namespace: 'bridgeSpawn' },
      { olderThanMs: 10_000 },
    )
    expect(swept.ok).toBe(true)
    if (swept.ok) {
      expect(swept.value.deleted).toBe(1)
      expect(swept.value.skipped).toBe(1)
    }
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(newDir)).toBe(true)
    expect(await backend.deleteScope({ namespace: 'session' })).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'scope' },
    })
    await backend.close()
  })

  test('Au emit fans out; openedAtMs tracks expect', () => {
    const bus = new StorageWatchBus()
    const seen: Array<[unknown, string]> = []
    const stopListen = bus.addListener((change, sourceInstanceId) => {
      seen.push([change, sourceInstanceId])
    })
    const stopExpect = bus.expect('k1')
    expect(bus.isWritingLocally('k1')).toBe(true)
    expect(typeof bus.openedAtMs('k1')).toBe('number')
    bus.emit({ kind: 'created' }, 'inst')
    expect(seen).toEqual([[{ kind: 'created' }, 'inst']])
    stopExpect()
    expect(bus.openedAtMs('k1')).toBeUndefined()
    stopListen()
  })

  test('zl/Xu/$l announce via leftover Ot=K', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-k-'))
    temps.push(dir)
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const bus = acquireStorageWatchBus(dir)
    const seen: Array<Record<string, unknown>> = []
    const stop = bus.addListener(change => {
      seen.push(change as Record<string, unknown>)
    })
    const valueKey = { namespace: 'state', id: 'policy-limits' }
    const streamKey = { namespace: 'state', id: 'digest-log' }
    const written = await backend.write(valueKey, '{"ok":true}')
    expect(written.ok).toBe(true)
    expect(
      seen.some(
        c =>
          c.kind === 'updated' &&
          typeof c.key === 'object' &&
          c.key !== null &&
          (c.key as { id?: string }).id === 'policy-limits',
      ),
    ).toBe(true)
    const appended = await backend.append(streamKey, [
      { data: Buffer.from('{"n":1}') },
    ])
    expect(appended.ok).toBe(true)
    expect(
      seen.some(
        c =>
          c.kind === 'created' &&
          typeof c.key === 'object' &&
          c.key !== null &&
          (c.key as { id?: string }).id === 'digest-log',
      ),
    ).toBe(true)
    const removed = await backend.delete(valueKey)
    expect(removed).toEqual({ ok: true, value: { existed: true } })
    expect(
      seen.some(
        c =>
          c.kind === 'deleted' &&
          typeof c.key === 'object' &&
          c.key !== null &&
          (c.key as { id?: string }).id === 'policy-limits',
      ),
    ).toBe(true)
    const missing = await backend.delete(valueKey)
    expect(missing).toEqual({ ok: true, value: { existed: false } })
    stop()
    await backend.close()
    await releaseStorageWatchBus(dir)
  })

  test('Ot expectEcho: qe/Xe skip; ng miss then demote', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv5-echo-'))
    temps.push(dir)
    const bus = new StorageWatchBus()
    await bus.watchers.watch(dir, false, () => {})
    const rec = bus.watchers.watches.get(`flat:${resolve(dir)}`)
    expect(rec).toBeDefined()
    if (rec === undefined) return
    expect(isStreamNamespaceKey({ namespace: 'transcript' })).toBe(true)
    expect(isStreamNamespaceKey({ namespace: 'state' })).toBe(false)
    if (rec.arm.kind !== 'live') {
      await bus.watchers.closeAll()
      return
    }

    const host = {
      bus,
      instanceId: 'i',
      roots: { configHome: dir },
      timing: { echoDeadlineMs: 0 },
      resolvePath: () => join(dir, 'x.json'),
      keyId: (key: Record<string, unknown>) => String(key.id ?? 'k'),
    }

    announceStorageChange(host, {
      kind: 'updated',
      key: { namespace: 'transcript', projectKey: 'p', sessionId: 's' },
    })
    announceStorageChange(host, {
      kind: 'updated',
      key: { namespace: 'settings', layer: 'user' },
    })
    announceStorageChange(host, {
      kind: 'appended',
      key: { namespace: 'state', id: 'policy-limits' },
    })
    await new Promise<void>(ok => setTimeout(() => setImmediate(ok), 0))
    expect(rec.echoMisses).toBe(0)

    const stop1 = bus.expect('policy-limits')
    announceStorageChange(host, {
      kind: 'updated',
      key: { namespace: 'state', id: 'policy-limits' },
    })
    stop1()
    await new Promise<void>(ok => setTimeout(() => setImmediate(ok), 0))
    expect(rec.echoMisses).toBe(1)

    const stop2 = bus.expect('policy-limits')
    announceStorageChange(host, {
      kind: 'deleted',
      key: { namespace: 'state', id: 'policy-limits' },
    })
    stop2()
    await new Promise<void>(ok => setTimeout(() => setImmediate(ok), 0))
    expect(rec.echoMisses).toBe(2)
    expect(rec.demotedForLife).toBe(true)

    rec.lastCallbackAtMs = performance.now() + 10_000
    rec.echoMisses = 1
    rec.demotedForLife = false
    rec.lastEchoMissAtMs = Number.NEGATIVE_INFINITY
    const stop3 = bus.expect('policy-limits')
    announceStorageChange(host, {
      kind: 'created',
      key: { namespace: 'state', id: 'policy-limits' },
    })
    stop3()
    await new Promise<void>(ok => setTimeout(() => setImmediate(ok), 0))
    expect(rec.echoMisses).toBe(0)
    await bus.watchers.closeAll()
  })
})
