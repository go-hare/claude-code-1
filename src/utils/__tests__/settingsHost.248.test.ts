/**
 * densable 2.1.248 leftover official Fe on SettingsSource, Oe on ExtensionsConfig.
 * Not class Fe / class Oe. Leftover wrappers go through host.
 *
 * Gold (SEA official-248/package/claude.exe, 226708128):
 * - Official Fe @178537943 sha=0ab3d41a6899e314
 * - Official tn @178538797 sha=4c7707fa4d321be9
 * - Official Oe @178538900
 * - xL @178566482 / XEn @178566546
 * - G$ @178571899 / y7e @178572004
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getAdditionalDirectoriesForClaudeMd,
  getAllowedChannels,
  getAllowedSettingSources,
  getChromeFlagOverride,
  getFlagSettingsInline,
  getFlagSettingsPath,
  getHasDevChannels,
  getInlinePluginUrls,
  getInlinePlugins,
  getInlinePluginsNoMcp,
  getParentManagedSettings,
  getSyncedPluginDirs,
  getUseCoworkPlugins,
  setAdditionalDirectoriesForClaudeMd,
  setAllowedChannels,
  setAllowedSettingSources,
  setChromeFlagOverride,
  setFlagSettingsInline,
  setFlagSettingsPath,
  setHasDevChannels,
  setInlinePluginUrls,
  setInlinePlugins,
  setInlinePluginsNoMcp,
  setParentManagedSettings,
  setSyncedPluginDirs,
  setUseCoworkPlugins,
} from '../../bootstrap/state.js'
import {
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from '../sessionHost.js'
import {
  getSettingsOwner,
  resetSettingsCache,
  setCachedParsedFile,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import { SettingsPrimer, settingsPrime } from '../settings/settingsPrimer.js'
import { getManagedFilePath } from '../settings/managedPath.js'
import {
  isHoverRestOn,
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

beforeEach(() => {
  resetSessionHostForTests()
  resetHoverRestPinForTests()
})

afterEach(() => {
  resetSessionHostForTests()
  resetHoverRestPinForTests()
})

describe('densable 2.1.248 leftover Fe/Oe on k.host', () => {
  test('class bodies have official Fe/Oe slots and reset', () => {
    const host = src('../sessionHost.ts')
    expect(host).toContain('Official Fe @178537943')
    expect(host).toContain('Official Oe @178538900')
    expect(host).toContain('Official tn @178538797')
    expect(host).toContain('flagSettingsPath()')
    expect(host).toContain('replaceFlagSettingsPath')
    expect(host).toContain('flagSettingsExpectedContent()')
    expect(host).toContain('flagSettingsFilePinnedContent()')
    expect(host).toContain('parentManagedSettingsInvalid()')
    expect(host).toContain('allowedSettingSources()')
    expect(host).toContain('replaceUseCoworkPlugins')
    expect(host).toContain('syncedPluginDirs()')
    expect(host).toContain('syncedPluginDirsRegistered()')
    expect(host).toContain('clearSyncedPluginDirs()')
    expect(host).toContain('sessionSkillAllowlist()')
    expect(host).toContain('teammateAgentId()')
    expect(host).toContain('settingsSource: new SettingsSource()')
    expect(host).toContain('extensionsConfig: new ExtensionsConfig()')
    expect(host).not.toContain('class Fe')
    expect(host).not.toContain('class Oe')
    expect(host).not.toContain('class Ie')
    expect(host).not.toContain('class Yt')
    expect(host).not.toContain('class jt')
  })

  test('leftover Fe wrappers go through n().host.settingsSource', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function xL(){return n().host.settingsSource.flagSettingsPath()}',
    )
    expect(state).toContain(
      'function XEn(e){n().host.settingsSource.replaceFlagSettingsPath(e)}',
    )
    expect(state).toContain(
      'function x2(){return n().host.settingsSource.flagSettingsInline()}',
    )
    expect(state).toContain(
      'function AEe(e){n().host.settingsSource.replaceFlagSettingsInline(e)}',
    )
    expect(state).toContain(
      'function ZEn(){return n().host.settingsSource.parentManagedSettings()}',
    )
    expect(state).toContain(
      'function ekn(e){n().host.settingsSource.replaceParentManagedSettings(e)}',
    )
    expect(state).toContain(
      'function kde(){return n().host.settingsSource.allowedSettingSources()}',
    )
    expect(state).toContain(
      'function mkn(e){n().host.settingsSource.replaceAllowedSettingSources(e)}',
    )
    expect(state).toContain(
      'function G$(e){let t=n();t.host.settingsSource.replaceUseCoworkPlugins(e),mGt.of(t.host).invalidateAll()}',
    )
    expect(state).toContain(
      'function y7e(){return n().host.settingsSource.useCoworkPlugins()}',
    )
    expect(state).toContain('resetSettingsCache()')
    expect(state).toContain('mGt.of(host).invalidateAll()')
    // flag-settings expected/pinned content wrappers landed (hostWrapperGaps.248)
    expect(state).toContain('export function getFlagSettingsExpectedContent')
    expect(state).toContain('export function getFlagSettingsFilePinnedContent')
    expect(state).not.toContain(
      'export function getParentManagedSettingsInvalid',
    )

    const srcHost = getBootstrapSessionHost().settingsSource
    expect(getFlagSettingsPath()).toBeUndefined()
    setFlagSettingsPath('/tmp/flags.json')
    expect(getFlagSettingsPath()).toBe('/tmp/flags.json')
    expect(srcHost.flagSettingsPath()).toBe('/tmp/flags.json')

    setFlagSettingsInline({ model: 'opus' })
    expect(getFlagSettingsInline()).toEqual({ model: 'opus' })
    expect(srcHost.flagSettingsInline()).toEqual({ model: 'opus' })

    setParentManagedSettings({ env: { FOO: '1' } })
    expect(getParentManagedSettings()).toEqual({ env: { FOO: '1' } })
    expect(srcHost.parentManagedSettings()).toEqual({ env: { FOO: '1' } })

    expect(getAllowedSettingSources()).toEqual([
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ])
    setAllowedSettingSources(['policySettings'])
    expect(getAllowedSettingSources()).toEqual(['policySettings'])
    expect(srcHost.allowedSettingSources()).toEqual(['policySettings'])

    expect(getUseCoworkPlugins()).toBe(false)
    setUseCoworkPlugins(true)
    expect(getUseCoworkPlugins()).toBe(true)
    expect(srcHost.useCoworkPlugins()).toBe(true)
  })

  test('leftover Oe wrappers go through n().host.extensionsConfig', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function m7e(e){n().host.extensionsConfig.replaceInlinePlugins(e)}',
    )
    expect(state).toContain(
      'function C4(){return n().host.extensionsConfig.inlinePlugins()}',
    )
    expect(state).toContain(
      'function h7e(e){n().host.extensionsConfig.replaceInlinePluginsNoMcp(e)}',
    )
    expect(state).toContain(
      'function R4(){return n().host.extensionsConfig.inlinePluginsNoMcp()}',
    )
    expect(state).toContain(
      'function hkn(e){n().host.extensionsConfig.replaceInlinePluginUrls(e)}',
    )
    expect(state).toContain(
      'function Vne(){return n().host.extensionsConfig.inlinePluginUrls()}',
    )
    expect(state).toContain(
      'function Tde(e){n().host.extensionsConfig.replaceSyncedPluginDirs(e)}',
    )
    expect(state).toContain(
      'function xEe(){return n().host.extensionsConfig.syncedPluginDirs()}',
    )
    expect(state).toContain(
      'function Skn(e){n().host.extensionsConfig.replaceChromeFlagOverride(e)}',
    )
    expect(state).toContain(
      'function Ade(){return n().host.extensionsConfig.chromeFlagOverride()}',
    )
    expect(state).toContain(
      'function _m(){return n().host.extensionsConfig.additionalDirectoriesForClaudeMd()}',
    )
    expect(state).toContain(
      'function D4(e){n().host.extensionsConfig.replaceAdditionalDirectoriesForClaudeMd(e)}',
    )
    expect(state).toContain(
      'function Bp(){return n().host.extensionsConfig.allowedChannels()}',
    )
    expect(state).toContain(
      'function p7(e){n().host.extensionsConfig.replaceAllowedChannels(e)}',
    )
    expect(state).toContain(
      'function R7e(){return n().host.extensionsConfig.hasDevChannels()}',
    )
    expect(state).toContain(
      'function o3t(e){n().host.extensionsConfig.replaceHasDevChannels(e)}',
    )
    expect(state).not.toContain('export function getSessionSkillAllowlist')
    expect(state).not.toContain('export function setSessionSkillAllowlist')
    expect(state).not.toContain('export function getTeammateAgentId')
    expect(state).not.toContain('export function setTeammateAgentId')

    const ext = getBootstrapSessionHost().extensionsConfig
    setInlinePlugins(['/tmp/a'])
    expect(getInlinePlugins()).toEqual(['/tmp/a'])
    expect(ext.inlinePlugins()).toEqual(['/tmp/a'])

    setInlinePluginsNoMcp(['/tmp/b'])
    expect(getInlinePluginsNoMcp()).toEqual(['/tmp/b'])
    expect(ext.inlinePluginsNoMcp()).toEqual(['/tmp/b'])

    setInlinePluginUrls(['https://example.test/p.zip'])
    expect(getInlinePluginUrls()).toEqual(['https://example.test/p.zip'])
    expect(ext.inlinePluginUrls()).toEqual(['https://example.test/p.zip'])

    expect(getSyncedPluginDirs()).toEqual([])
    expect(ext.syncedPluginDirsRegistered()).toBe(false)
    setSyncedPluginDirs(['/tmp/sync'])
    expect(getSyncedPluginDirs()).toEqual(['/tmp/sync'])
    expect(ext.syncedPluginDirs()).toEqual(['/tmp/sync'])
    expect(ext.syncedPluginDirsRegistered()).toBe(true)

    setChromeFlagOverride(true)
    expect(getChromeFlagOverride()).toBe(true)
    expect(ext.chromeFlagOverride()).toBe(true)

    setAdditionalDirectoriesForClaudeMd(['/tmp/md'])
    expect(getAdditionalDirectoriesForClaudeMd()).toEqual(['/tmp/md'])
    expect(ext.additionalDirectoriesForClaudeMd()).toEqual(['/tmp/md'])

    const channel = {
      kind: 'server' as const,
      name: 'dev',
    }
    setAllowedChannels([channel])
    expect(getAllowedChannels()).toEqual([channel])
    expect(ext.allowedChannels()).toEqual([channel])

    setHasDevChannels(true)
    expect(getHasDevChannels()).toBe(true)
    expect(ext.hasDevChannels()).toBe(true)
  })

  test('Fe.reset and Oe.reset restore official defaults', () => {
    const host = getBootstrapSessionHost()
    host.settingsSource.replaceFlagSettingsPath('/x')
    host.settingsSource.replaceFlagSettingsExpectedContent('exp')
    host.settingsSource.replaceFlagSettingsFilePinnedContent('pin')
    host.settingsSource.replaceFlagSettingsInline({ a: 1 })
    host.settingsSource.replaceParentManagedSettings({ b: 2 })
    host.settingsSource.replaceParentManagedSettingsInvalid(true)
    host.settingsSource.replaceAllowedSettingSources(['userSettings'])
    host.settingsSource.replaceUseCoworkPlugins(true)
    host.settingsSource.reset()
    expect(host.settingsSource.flagSettingsPath()).toBeUndefined()
    expect(host.settingsSource.flagSettingsExpectedContent()).toBeUndefined()
    expect(host.settingsSource.flagSettingsFilePinnedContent()).toBeUndefined()
    expect(host.settingsSource.flagSettingsInline()).toBeNull()
    expect(host.settingsSource.parentManagedSettings()).toBeNull()
    expect(host.settingsSource.parentManagedSettingsInvalid()).toBe(false)
    expect(host.settingsSource.allowedSettingSources()).toEqual([
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ])
    expect(host.settingsSource.useCoworkPlugins()).toBe(false)

    host.extensionsConfig.replaceInlinePlugins(['a'])
    host.extensionsConfig.replaceInlinePluginsNoMcp(['b'])
    host.extensionsConfig.replaceInlinePluginUrls(['c'])
    host.extensionsConfig.replaceSyncedPluginDirs(['d'])
    host.extensionsConfig.replaceAdditionalDirectoriesForClaudeMd(['e'])
    host.extensionsConfig.replaceAllowedChannels([{ kind: 'server' }])
    host.extensionsConfig.replaceHasDevChannels(true)
    host.extensionsConfig.replaceSessionSkillAllowlist(['skill'])
    host.extensionsConfig.replaceChromeFlagOverride(false)
    host.extensionsConfig.replaceTeammateAgentId('agent-1')
    host.extensionsConfig.reset()
    expect(host.extensionsConfig.inlinePlugins()).toEqual([])
    expect(host.extensionsConfig.inlinePluginsNoMcp()).toEqual([])
    expect(host.extensionsConfig.inlinePluginUrls()).toEqual([])
    expect(host.extensionsConfig.syncedPluginDirs()).toEqual([])
    expect(host.extensionsConfig.syncedPluginDirsRegistered()).toBe(false)
    expect(host.extensionsConfig.additionalDirectoriesForClaudeMd()).toEqual([])
    expect(host.extensionsConfig.allowedChannels()).toEqual([])
    expect(host.extensionsConfig.hasDevChannels()).toBe(false)
    expect(host.extensionsConfig.sessionSkillAllowlist()).toBeUndefined()
    expect(host.extensionsConfig.chromeFlagOverride()).toBeUndefined()
    expect(host.extensionsConfig.teammateAgentId()).toBeUndefined()
  })

  test('SettingsOwner (fGt) invalidateAll clears bag; retain branch gated', () => {
    const cache = src('../settings/settingsCache.ts')
    expect(cache).toContain('Official fGt @178505059')
    expect(cache).toContain('Official D() @178167129')
    expect(cache).toContain('isHoverRestOn')
    expect(cache).toContain('primedFiles = new Set')
    expect(cache).toContain('folderListings = new Map')
    expect(cache).toContain('retainedListings = new Map')
    expect(cache).toContain('invalidated = createSignal()')
    expect(cache).toContain('changed = createSignal()')
    expect(cache).toContain('settingsPrimerGate(): boolean')
    expect(cache).toContain("e?.userLayer === 'retain'")
    expect(cache).toContain('this.invalidated.emit()')
    expect(cache).toContain(
      'resetSettingsCache(e?: { userLayer?: string }): void',
    )
    expect(cache).toContain('owner().invalidateAll(e)')
    expect(cache).toContain('seedParsedFile')
    expect(cache).toContain('retainLayer')
    expect(cache).toContain('retainFolderListing')
    expect(cache).toContain('primedFolderListing')
    expect(cache).toContain('folderListingForPolicyWalk')
    expect(cache).toContain('noteWalkListing')
    expect(cache).toContain('SKn @179523748')
    expect(cache).toContain('sha=435524f56ab1199e')
    expect(cache).toContain('gold-248-SKn-primer.txt')
    expect(cache).toContain('assign @179527321')
    expect(cache).toContain('primer: SettingsPrimer | undefined')
    expect(cache).not.toContain('class fGt')
    expect(cache).not.toContain('class Ft{')
    expect(cache).not.toContain('class SKn')
    expect(cache).not.toContain('export class Primer')
    expect(cache).not.toContain('async function $pn')

    const owner = getSettingsOwner()
    setSessionSettingsCache({
      settings: {},
      errors: [],
    })
    setCachedParsedFile('/tmp/a.json', { settings: {}, errors: [] })
    owner.primedFiles.add('/tmp/a.json')
    owner.folderListings.set('/tmp', ['a.json'])
    owner.retained.set('/tmp/a.json', {
      parsed: { settings: {}, errors: [] },
    })
    owner.retainedListings.set('/tmp', { names: ['a.json'] })
    const epoch0 = owner.epoch
    let invalidated = 0
    const unsub = owner.onInvalidate(() => {
      invalidated++
    })
    resetSettingsCache()
    expect(owner.epoch).toBe(epoch0 + 1)
    expect(owner.mergedSettings).toBeNull()
    expect(owner.parsedFiles.size).toBe(0)
    expect(owner.primedFiles.size).toBe(0)
    expect(owner.folderListings.size).toBe(0)
    expect(owner.retained.size).toBe(0)
    expect(owner.retainedListings.size).toBe(0)
    expect(invalidated).toBe(1)
    // D() off by default — retain branch unreachable
    expect(isHoverRestOn()).toBe(false)
    owner.retained.set('/tmp/a.json', {
      parsed: { settings: { x: 1 }, errors: [] },
    })
    owner.invalidateAll({ userLayer: 'retain' })
    expect(owner.retained.size).toBe(0)
    expect(owner.parsedFiles.size).toBe(0)
    unsub()
  })

  test('SettingsOwner retain restores when D on and primer set', async () => {
    pinHoverRest(true)
    expect(isHoverRestOn()).toBe(true)
    const owner = getSettingsOwner()
    const parsed = { settings: { model: 'opus' }, errors: [] }
    owner.retainLayer('/tmp/a.json', parsed)
    owner.retainFolderListing('/tmp', ['a.json'])
    const storageV5 = {
      read: async () => ({
        ok: true as const,
        value: {
          items: [{ found: false, totalBytes: 0, value: new Uint8Array() }],
        },
      }),
      subscribe: async () => ({
        ok: true as const,
        value: { unsubscribe: () => {}, observationLagMs: 0 },
      }),
      hostFiles: {
        serves: () => false,
        serving: () => 'absent' as const,
        stat: async () => ({ ok: true as const, value: { kind: 'absent' } }),
        readBytes: async () => ({
          ok: true as const,
          value: { found: false, value: new Uint8Array(), bytes: 0 },
        }),
        listFolder: async () => ({
          ok: true as const,
          value: { found: false as const },
        }),
      },
    }
    owner.primer = new SettingsPrimer(storageV5 as never, owner)
    await owner.primer.whenIdle()
    owner.invalidateAll({ userLayer: 'retain' })
    expect(owner.retained.size).toBe(1)
    expect(owner.retainedListings.size).toBe(1)
    expect(owner.parsedFiles.get('/tmp/a.json')).toEqual(parsed)
    expect(owner.primedFiles.has('/tmp/a.json')).toBe(true)
    expect(owner.folderListings.get('/tmp')).toEqual(['a.json'])
    owner.primer.dispose()
  })

  test('settingsPrime/Npn/nHe call sites land; deeplink L0n invent-ban', () => {
    const callSites = src(
      '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-settings-call-sites.txt',
    )
    expect(callSites).toContain('$pn(i,ra())')
    expect(callSites).toContain('seedUserSettings')
    expect(callSites).toContain('updateHooksConfigSnapshotUnderPrime')
    expect(callSites).toContain('invent-ban')
    expect(callSites).toContain('--deep-link-cwd-b64')
    expect(callSites).toContain('ExitWorktreeTool.ts')

    const map = src(
      '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-SKn-leftover-map.txt',
    )
    expect(map).toContain('seedUserSettings')
    expect(map).toContain('entrypoints/init.ts')
    expect(map).toContain('invent-ban')
    expect(map).toContain('ExitWorktreeTool.ts')

    const initSrc = src('../../entrypoints/init.ts')
    expect(initSrc).toContain('seedUserSettings')
    expect(initSrc).toContain('settingsPrime')
    expect(initSrc).toContain('primeRemoteSettingsBackendView')
    expect(initSrc).toContain('getPinnedStorageV5()')
    expect(initSrc).toContain('getSettingsOwner()')
    expect(initSrc).toContain('init_remote_settings_primed')
    expect(initSrc).toContain(
      'await settingsPrime(getPinnedStorageV5(), getSettingsOwner())',
    )

    const primerSrc = src('../settings/settingsPrimer.ts')
    expect(primerSrc).toContain('export async function seedUserSettings')
    expect(primerSrc).toContain('Official Npn @179522585')
    expect(primerSrc).toContain('export const primeSettings = settingsPrime')
    expect(primerSrc).toContain('user settings seeded at start-up')

    const setupSrc = src('../../setup.ts')
    expect(setupSrc).toContain(
      'updateHooksConfigSnapshotUnderPrime(getPinnedStorageV5())',
    )
    expect(setupSrc).not.toContain('captureHooksConfigSnapshot()')

    const exitWt = src(
      '../../../packages/builtin-tools/src/tools/ExitWorktreeTool/ExitWorktreeTool.ts',
    )
    expect(exitWt).toContain('updateHooksConfigSnapshotUnderPrime')
    expect(exitWt).toContain('getPinnedStorageV5()')
    expect(exitWt).not.toContain('updateHooksConfigSnapshot()')
  })

  test('SettingsPrimer lands; Vjt/T/O/k_/k/_Ke/Gqe/kC/Zve all LAND', async () => {
    const gold = src(
      '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-SKn-primer.txt',
    )
    expect(gold).toContain('@179523748')
    expect(gold).toContain('sha=435524f56ab1199e')
    expect(gold).toContain('len=3367')
    expect(gold).toContain('@179527321')
    expect(gold).toContain('e.primer=new SKn(t,e)')
    expect(gold).toContain('async function $pn')
    expect(gold).toContain('whenIdle')
    expect(gold).toContain('primes')
    expect(gold).toContain('dispose')

    const map = src(
      '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-SKn-leftover-map.txt',
    )
    expect(map).toContain('SettingsPrimer')
    expect(map).toContain('settingsPrime')
    expect(map).toContain('ownershipProbeAhead')
    expect(map).toContain('seedAttestedSystemTier')
    expect(map).not.toContain('UNKNOWN @179529582')
    expect(map).not.toContain('UNKNOWN @179534300')
    expect(map).toContain('readUserSettingsFromBackend')
    expect(map).toContain('seedProjectLocalLayers')
    expect(map).toContain('seedManagedSettingsTier')
    expect(map).toContain('reloadMergedSettingsAfterPrime')
    expect(map).toContain('userSettingsPrimePath')
    expect(map).toContain('primeRemoteSettingsBackendView')
    expect(map).toContain('loadSettingsUnderPrime')
    expect(map).toContain('seedUserSettings')
    expect(map).not.toContain('UNKNOWN @179162866')
    expect(map).not.toContain('UNKNOWN @179527369')
    expect(map).not.toContain('UNKNOWN @179527519')
    expect(map).not.toContain('UNKNOWN @179502007')
    expect(map).not.toContain('UNKNOWN @179529407')
    expect(map).not.toContain('UNKNOWN @179531012')
    expect(map).not.toContain('UNKNOWN @179508981')

    const seedGold = src(
      '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-Vjt-T-O-seed.txt',
    )
    expect(seedGold).toContain('@179502007')
    expect(seedGold).toContain('@179529407')
    expect(seedGold).toContain('@179531012')
    expect(seedGold).toContain('@179508981')
    expect(seedGold).toContain('@179522501')
    expect(seedGold).toContain('Se.userSettings')
    expect(seedGold).toContain('A_=2097152')

    const wKnGold = src(
      '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-wKn-v-seed.txt',
    )
    expect(wKnGold).toContain('@179534300')
    expect(wKnGold).toContain('@179529582')
    expect(wKnGold).toContain('@179506113')
    expect(wKnGold).toContain('function W(')
    expect(wKnGold).toContain('function S(')

    const primerSrc = src('../settings/settingsPrimer.ts')
    expect(primerSrc).toContain('export class SettingsPrimer')
    expect(primerSrc).toContain('export async function settingsPrime')
    expect(primerSrc).toContain('Official SKn @179523748')
    expect(primerSrc).toContain('readUserSettingsFromBackend')
    expect(primerSrc).toContain('seedProjectLocalLayers')
    expect(primerSrc).toContain('seedManagedSettingsTier')
    expect(primerSrc).toContain('reloadMergedSettingsAfterPrime')
    expect(primerSrc).toContain('userSettingsPrimePath')
    expect(primerSrc).toContain('ownershipProbeAhead')
    expect(primerSrc).toContain('seedAttestedSystemTier')
    expect(primerSrc).toContain('parseSettingsFileContent')
    expect(primerSrc).toContain('primeRemoteSettingsBackendView')
    expect(primerSrc).toContain('export async function loadSettingsUnderPrime')
    expect(primerSrc).toContain('export async function seedUserSettings')
    expect(primerSrc).toContain('legacyLocalSettingsPath')
    expect(primerSrc).toContain('legacyLocalSettingsPathFromHost')
    expect(primerSrc).toContain('Official Zve @179445024')
    expect(primerSrc).toContain('Official kC @179506276')
    expect(primerSrc).toContain('legacy local settings')
    expect(primerSrc).not.toContain('export class SKn')
    expect(primerSrc).not.toContain('async function $pn')
    expect(primerSrc).not.toMatch(/\bclass SKn\{/)
    expect(primerSrc).not.toContain('// UNKNOWN @179502007')
    expect(primerSrc).not.toContain('// UNKNOWN @179529407')
    expect(primerSrc).not.toContain('// UNKNOWN @179531012')
    expect(primerSrc).not.toContain('// UNKNOWN @179508981')
    expect(primerSrc).not.toContain('// UNKNOWN @179534300')
    expect(primerSrc).not.toContain('// UNKNOWN @179529582')
    expect(primerSrc).not.toContain('// UNKNOWN @179162866')

    const utSrc = src('../settings/remoteSettingsBackendView.ts')
    expect(utSrc).toContain('export class RemoteSettingsBackendView')
    expect(utSrc).toContain(
      'export async function primeRemoteSettingsBackendView',
    )
    expect(utSrc).toContain(
      'export async function runRemoteSettingsBackendPrime',
    )
    expect(utSrc).toContain('Official Yv(){return}')
    expect(utSrc).toContain('Official Ut @179163791')

    const cache = src('../settings/settingsCache.ts')
    expect(cache).toContain('primer: SettingsPrimer | undefined')
    expect(cache).not.toContain('primer: unknown')
    expect(cache).not.toContain('export class Primer')
    expect(cache).not.toContain('export class SKn')
    expect(cache).not.toMatch(/\bclass SKn\{/)

    const settingsSrc = src('../settings/settings.ts')
    expect(settingsSrc).toContain('export function parseSettingsFileContent')

    pinHoverRest(true)
    expect(isHoverRestOn()).toBe(true)
    const owner = getSettingsOwner()
    expect(owner.primer).toBeUndefined()

    const storageV5 = {
      read: async () => ({
        ok: true as const,
        value: {
          items: [{ found: false, totalBytes: 0, value: new Uint8Array() }],
        },
      }),
      subscribe: async () => ({
        ok: true as const,
        value: { unsubscribe: () => {}, observationLagMs: 0 },
      }),
      hostFiles: {
        serves: () => false,
        serving: () => 'absent' as const,
        stat: async () => ({ ok: true as const, value: { kind: 'absent' } }),
        readBytes: async () => ({
          ok: true as const,
          value: { found: false, value: new Uint8Array(), bytes: 0 },
        }),
        listFolder: async () => ({
          ok: true as const,
          value: { found: false as const },
        }),
      },
    }
    await settingsPrime(storageV5 as never, owner)
    expect(owner.primer).toBeInstanceOf(SettingsPrimer)
    expect(owner.primer!.primes(storageV5 as never)).toBe(true)
    await owner.primer!.whenIdle()
    owner.primer!.dispose()
    expect(owner.primer).toBeUndefined()
    expect(owner.managedFileReads.size).toBe(0)

    // D off → settingsPrime no-ops
    resetHoverRestPinForTests()
    pinHoverRest(false)
    await settingsPrime(storageV5 as never, owner)
    expect(owner.primer).toBeUndefined()
  })

  test('loadSettingsUnderPrime serializes backendReadResetTail and retain path', async () => {
    const { loadSettingsUnderPrime } = await import(
      '../settings/settingsPrimer.js'
    )
    pinHoverRest(true)
    const owner = getSettingsOwner()
    const storageV5 = {
      read: async () => ({
        ok: true as const,
        value: {
          items: [{ found: false, totalBytes: 0, value: new Uint8Array() }],
        },
      }),
      subscribe: async () => ({
        ok: true as const,
        value: { unsubscribe: () => {}, observationLagMs: 0 },
      }),
      hostFiles: {
        serves: () => false,
        serving: () => 'absent' as const,
        stat: async () => ({ ok: true as const, value: { kind: 'absent' } }),
        readBytes: async () => ({
          ok: true as const,
          value: { found: false, value: new Uint8Array(), bytes: 0 },
        }),
        listFolder: async () => ({
          ok: true as const,
          value: { found: false as const },
        }),
      },
    }
    await settingsPrime(storageV5 as never, owner)
    expect(owner.primer).toBeInstanceOf(SettingsPrimer)

    let releaseFirst!: () => void
    owner.backendReadResetTail = new Promise(r => {
      releaseFirst = r
    })
    let secondStarted = false
    const first = loadSettingsUnderPrime(storageV5 as never).then(d => {
      secondStarted = true
      return d
    })
    // Second call must wait on backendReadResetTail serialization
    const secondPromise = loadSettingsUnderPrime(storageV5 as never)
    expect(secondStarted).toBe(false)
    releaseFirst()
    const dispose1 = await first
    const dispose2 = await secondPromise
    expect(secondStarted).toBe(true)
    dispose1?.()
    dispose2?.()
    owner.primer!.dispose()
  })

  test('settingsPrime calls primeRemoteSettingsBackendView (_Ke path)', async () => {
    const primerSrc = src('../settings/settingsPrimer.ts')
    expect(primerSrc).toContain('primeRemoteSettingsBackendView')
    expect(primerSrc).toContain('void primeStorageBackendView(storageV5)')
    const utSrc = src('../settings/remoteSettingsBackendView.ts')
    expect(utSrc).toContain('Official _Ke @179162866')
    expect(utSrc).toContain('new RemoteSettingsBackendView')
  })

  test('SettingsOwner retain skips restore when D on but primer unset', () => {
    pinHoverRest(true)
    const owner = getSettingsOwner()
    owner.primer = undefined
    owner.retainLayer('/tmp/a.json', { settings: { x: 1 }, errors: [] })
    owner.retainFolderListing('/tmp', ['a.json'])
    owner.invalidateAll({ userLayer: 'retain' })
    expect(owner.retained.size).toBe(0)
    expect(owner.retainedListings.size).toBe(0)
    expect(owner.parsedFiles.size).toBe(0)
  })

  test('SettingsOwner seed/walk/verdict methods match official fGt roster', async () => {
    pinHoverRest(true)
    const owner = getSettingsOwner()
    const storageV5 = {
      read: async () => ({
        ok: true as const,
        value: {
          items: [{ found: false, totalBytes: 0, value: new Uint8Array() }],
        },
      }),
      subscribe: async () => ({
        ok: true as const,
        value: { unsubscribe: () => {}, observationLagMs: 0 },
      }),
      hostFiles: {
        serves: () => false,
        serving: () => 'absent' as const,
        stat: async () => ({ ok: true as const, value: { kind: 'absent' } }),
        readBytes: async () => ({
          ok: true as const,
          value: { found: false, value: new Uint8Array(), bytes: 0 },
        }),
        listFolder: async () => ({
          ok: true as const,
          value: { found: false as const },
        }),
      },
    }
    owner.primer = new SettingsPrimer(storageV5 as never, owner)
    await owner.primer.whenIdle()
    const epoch = owner.epoch
    const parsed = { settings: { a: 1 }, errors: [] }
    expect(owner.seedParsedFile('/p.json', 'userSettings', parsed, epoch)).toBe(
      true,
    )
    expect(owner.parsedFiles.get('/p.json')).toEqual(parsed)
    expect(owner.primedFiles.has('/p.json')).toBe(true)
    expect(
      owner.walkReadDiffers('/p.json', { settings: { a: 2 }, errors: [] }),
    ).toBe(false)
    owner.primedFiles.delete('/p.json')
    expect(owner.walkRead('/p.json')).toBe(true)
    expect(
      owner.walkReadDiffers('/p.json', { settings: { a: 2 }, errors: [] }),
    ).toBe(true)
    expect(owner.primedFolderListing('/dir')).toBeUndefined()
    expect(owner.seedFolderListing('/dir', ['x.json'], epoch)).toBe(true)
    expect(owner.primedFolderListing('/dir')).toEqual(['x.json'])
    expect(owner.folderListingForPolicyWalk('/dir')).toEqual(['x.json'])
    expect(owner.policyWalkCount).toBe(1)
    owner.noteWalkListing('/dir', ['x.json', 'y.json'])
    // listings differ + policyWalks(1) > o(0) → raced
    expect(owner.folderInstallVerdict('/dir', ['x.json'], 0)).toBe('raced')
    expect(owner.folderInstallVerdict('/dir', ['x.json'], 1)).toBe('deferred')
    expect(owner.policyInstallVerdict('/p.json', parsed, 0)).toBe('install')
    const drop = owner.retainLayer('/p.json', parsed)
    drop()
    expect(owner.retained.has('/p.json')).toBe(false)
    owner.dropRetainedLayer('/other')
    owner.clearFolderListing('/dir', epoch)
    // walkedFolders still has /dir → clearFolderListing no-ops listing delete
    expect(owner.folderListings.has('/dir')).toBe(true)
    owner.primer.dispose()
  })

  test('ownershipProbeAhead primes uids when D on and hostFiles serves workspace', async () => {
    pinHoverRest(true)
    const owner = getSettingsOwner()
    const root = process.cwd()
    const stats = new Map<string, { kind: string; uid?: number }>([
      [root, { kind: 'directory', uid: 42 }],
      [join(root, '.git'), { kind: 'directory', uid: 42 }],
      [join(root, '.claude'), { kind: 'directory', uid: 42 }],
    ])
    const storageV5 = {
      read: async () => ({
        ok: true as const,
        value: {
          items: [{ found: false, totalBytes: 0, value: new Uint8Array() }],
        },
      }),
      hostFiles: {
        serves: (space: string) => space === 'workspace',
        serving: () => 'host' as const,
        stat: async (key: { space: string; path: string }) => {
          const hit = stats.get(key.path) ?? { kind: 'absent' as const }
          return { ok: true as const, value: hit }
        },
        readBytes: async () => ({
          ok: true as const,
          value: { found: false, value: new Uint8Array(), bytes: 0 },
        }),
        listFolder: async () => ({
          ok: true as const,
          value: { found: false as const },
        }),
      },
    }
    const hadUid =
      typeof process.getuid === 'function' ||
      typeof process.geteuid === 'function'
    owner.primer = new SettingsPrimer(storageV5 as never, owner)
    await owner.primer.whenIdle()
    if (hadUid) {
      expect(typeof owner.localStoreProbes.hasCanonicalRootOwnerUids).toBe(
        'function',
      )
    }
    owner.primer.dispose()
  })

  test('seedAttestedSystemTier seeds empty policy tier when system serving absent', async () => {
    pinHoverRest(true)
    const owner = getSettingsOwner()
    const managedRoot = getManagedFilePath()
    const basePath = join(managedRoot, 'managed-settings.json')
    const dropInDir = join(managedRoot, 'managed-settings.d')
    const storageV5 = {
      read: async () => ({
        ok: true as const,
        value: {
          items: [{ found: false, totalBytes: 0, value: new Uint8Array() }],
        },
      }),
      hostFiles: {
        serves: () => true,
        serving: (space: string) =>
          space === 'system' ? ('absent' as const) : ('host' as const),
        stat: async () => ({ ok: true as const, value: { kind: 'absent' } }),
        readBytes: async () => ({
          ok: true as const,
          value: { found: false, value: new Uint8Array(), bytes: 0 },
        }),
        listFolder: async () => ({
          ok: true as const,
          value: { found: false as const },
        }),
      },
    }
    owner.primer = new SettingsPrimer(storageV5 as never, owner)
    await owner.primer.whenIdle()
    expect(owner.systemSpaceServingLogged).toBe(true)
    expect(owner.systemAttestationContradicted).toBe(false)
    expect(owner.folderListings.get(dropInDir)).toEqual([])
    expect(owner.parsedFiles.get(basePath)).toEqual({
      settings: null,
      errors: [],
    })
    expect(owner.primedFiles.has(basePath)).toBe(true)
    owner.primer.dispose()
  })
})
