/**
 * Official mGt = new K(() => new fGt) @178509673.
 * Leftover SettingsOwner is fGt; WeakOwnerCache is K.
 * ra() / Yl / G$ invalidate via of(k.host).invalidateAll().
 */
import { basename, dirname } from 'path'
import isEqual from 'lodash-es/isEqual.js'
import type { SettingSource } from './constants.js'
import type { SettingsJson } from './types.js'
import type { SettingsWithErrors, ValidationError } from './validation.js'
import { getBootstrapSessionHost } from '../sessionRoot.js'
import { createSignal } from '../signal.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
import type { SettingsPrimer } from './settingsPrimer.js'

class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

type ParsedSettings = {
  settings: SettingsJson | null
  errors: ValidationError[]
}

type RetainedParsed = { parsed: ParsedSettings }
type RetainedListing = { names: string[] }

/**
 * Official Ft — local store probe bag owned by fGt.
 * Leftover name LocalStoreProbes (never mint Ft as a class identifier).
 */
class LocalStoreProbes {
  ownerUidsByRoot = new Map<string, unknown>()
  realHomeDir: string | undefined
  canonicalRootOwnerUids(e: string, t: (root: string) => unknown): unknown {
    const o = this.ownerUidsByRoot.get(e)
    if (o !== undefined) return o
    const r = t(e)
    this.ownerUidsByRoot.set(e, r)
    return r
  }
  hasCanonicalRootOwnerUids(e: string): boolean {
    return this.ownerUidsByRoot.has(e)
  }
  primeCanonicalRootOwnerUids(e: string, t: unknown): boolean {
    if (this.ownerUidsByRoot.has(e)) return false
    this.ownerUidsByRoot.set(e, t)
    return true
  }
  clearCanonicalRootOwnerUids(): void {
    this.ownerUidsByRoot.clear()
  }
  normalizedRealHomeDir(e: () => string): string {
    return (this.realHomeDir ??= e())
  }
  clearNormalizedRealHomeDir(): void {
    this.realHomeDir = undefined
  }
}

/**
 * Official D() @178167129 (chunk-4qdmbxwt) — `return e===!0` / rtr pin.
 * Leftover name isHoverRestOn (hoverRestPin.ts); fGt imports the same D.
 * Primer: leftover SettingsPrimer ≈ official SKn @179523748 sha=435524f56ab1199e,
 * assign `e.primer=new SKn(t,e)` @179527321 via `$pn` → `settingsPrime`.
 * Gold: gold-248-SKn-primer.txt / gold-248-SKn-leftover-map.txt
 */
function settingsPrimerGate(): boolean {
  return isHoverRestOn()
}

/**
 * Official fGt @178505059 sha=4bef1721daf3cebc (invalidateAll @178505706).
 * Leftover SettingsOwner — full method roster 1:1; D wired; primer =
 * SettingsPrimer | undefined (settingsPrimer.ts).
 */
export class SettingsOwner {
  mergedSettings: SettingsWithErrors | null = null
  perSource = new Map<SettingSource, SettingsJson | null>()
  parsedFiles = new Map<string, ParsedSettings>()
  folderListings = new Map<string, string[]>()
  managedFileReads = new Map<string, unknown>()
  primedFiles = new Set<string>()
  policyWalks = 0
  walkedFolders = new Map<string, string[] | null>()
  policy: Record<string, unknown> = {}
  lastPolicyEnvComposition: unknown = null
  isLoadingFromDisk = false
  autoModeUntrustedSourceWarned = false
  /** Official $e() */
  changed = createSignal()
  internalWrites = new Map<string, unknown>()
  enabledSources: SettingSource[] | undefined
  pluginBase: Record<string, unknown> | undefined
  epoch = 0
  systemSpaceServingLogged = false
  systemAttestationContradicted = false
  backendReadResetTail: Promise<void> = Promise.resolve()
  /** Official $e() */
  invalidated = createSignal()
  pluginBaseLoaded = false
  /**
   * Official primer — SKn instance (@179523748 sha=435524f56ab1199e /
   * assign @179527321 via $pn → settingsPrime). Leftover SettingsPrimer.
   * Gold: gold-248-SKn-primer.txt / gold-248-SKn-leftover-map.txt
   */
  primer: SettingsPrimer | undefined
  localStoreProbes = new LocalStoreProbes()
  retained = new Map<string, RetainedParsed>()
  retainedListings = new Map<string, RetainedListing>()

  setPluginBase(e: Record<string, unknown> | undefined): void {
    this.pluginBase = e
    this.pluginBaseLoaded = true
  }
  clearPluginBase(): void {
    this.pluginBase = undefined
  }
  /**
   * Official fGt.invalidateAll(e) @178505706.
   * Retain branch: userLayer==="retain" && D() && primer!==void 0.
   */
  invalidateAll(e?: { userLayer?: string }): void {
    this.epoch++
    this.mergedSettings = null
    this.perSource.clear()
    this.parsedFiles.clear()
    this.primedFiles.clear()
    this.policyWalks = 0
    this.walkedFolders.clear()
    this.folderListings.clear()
    this.policy = {}
    if (
      e?.userLayer === 'retain' &&
      settingsPrimerGate() &&
      this.primer !== undefined
    ) {
      for (const [t, o] of this.retained) {
        this.parsedFiles.set(t, o.parsed)
        this.primedFiles.add(t)
      }
      for (const [t, o] of this.retainedListings) {
        this.folderListings.set(t, o.names)
      }
    } else {
      this.retained.clear()
      this.retainedListings.clear()
    }
    this.invalidated.emit()
  }
  invalidatePolicyLayer(): void {
    this.mergedSettings = null
    this.perSource.delete('policySettings')
    this.policy = {}
  }
  onInvalidate(e: () => void): () => void {
    return this.invalidated.subscribe(e)
  }
  seedParsedFile(
    e: string,
    t: SettingSource,
    o: ParsedSettings,
    r: number,
  ): boolean {
    if (r !== this.epoch) return false
    const i = this.parsedFiles.get(e)
    const s = i === undefined || !isEqual(i, o)
    this.parsedFiles.set(e, o)
    if (s || this.primedFiles.has(e)) this.primedFiles.add(e)
    const a = this.retained.get(e)
    if (a !== undefined) a.parsed = o
    if (s) this.dropDerivedCaches(t)
    return true
  }
  walkReadDiffers(e: string, t: ParsedSettings): boolean {
    const o = this.parsedFiles.get(e)
    return o !== undefined && !this.primedFiles.has(e) && !isEqual(o, t)
  }
  unseedParsedFile(e: string, t: SettingSource, o: number): void {
    if (o !== this.epoch) return
    this.retained.delete(e)
    if (
      !this.primedFiles.has(e) ||
      (t === 'policySettings' && this.policyWalks > 0)
    )
      return
    this.primedFiles.delete(e)
    this.parsedFiles.delete(e)
    this.dropDerivedCaches(t)
  }
  dropDerivedCaches(e: SettingSource): void {
    this.perSource.delete(e)
    this.mergedSettings = null
    if (e === 'policySettings') this.policy = {}
  }
  primedFolderListing(e: string): string[] | undefined {
    return settingsPrimerGate() ? this.folderListings.get(e) : undefined
  }
  folderListingForPolicyWalk(e: string): string[] | undefined {
    if (!settingsPrimerGate()) return
    this.policyWalks++
    const t = this.folderListings.get(e)
    if (!this.walkedFolders.has(e) || t !== undefined)
      this.walkedFolders.set(e, t ?? null)
    return t
  }
  noteWalkListing(e: string, t: string[] | null): void {
    if (!settingsPrimerGate()) return
    this.walkedFolders.set(e, t)
  }
  get policyWalkCount(): number {
    return this.policyWalks
  }
  policyInstallVerdict(
    e: string,
    t: ParsedSettings,
    o: number,
  ): 'install' | 'raced' | 'deferred' {
    const r = this.parsedFiles.get(e)
    if (r === undefined || isEqual(r, t)) return 'install'
    if (!this.primedFiles.has(e)) return 'raced'
    if (this.policyWalks === 0) return 'install'
    return this.policyWalks > o ? 'raced' : 'deferred'
  }
  folderInstallVerdict(
    e: string,
    t: string[],
    o: number,
  ): 'install' | 'raced' | 'deferred' {
    if (!this.walkedFolders.has(e))
      return this.hasParsedDropInOutside(e, t) ? 'raced' : 'install'
    const r = this.walkedFolders.get(e)
    if (r !== null && r !== undefined && isEqual(r, t)) return 'install'
    return this.policyWalks > o ? 'raced' : 'deferred'
  }
  seedFolderListing(e: string, t: string[], o: number): boolean {
    if (o !== this.epoch) return false
    const r = this.folderListings.get(e)
    this.folderListings.set(e, t)
    const i = this.retainedListings.get(e)
    if (i !== undefined) i.names = t
    if (r !== undefined && !isEqual(r, t))
      this.dropDerivedCaches('policySettings')
    return true
  }
  walkReadManagedFileIn(e: string, t: string): boolean {
    for (const [o, r] of this.parsedFiles) {
      if (
        !o.includes('\0') &&
        !this.primedFiles.has(o) &&
        (r.settings !== null || r.errors.length > 0) &&
        (o === e || dirname(o) === t)
      )
        return true
    }
    return false
  }
  walkRead(e: string): boolean {
    return this.parsedFiles.has(e) && !this.primedFiles.has(e)
  }
  hasParsedDropInOutside(e: string, t: string[]): boolean {
    for (const o of this.parsedFiles.keys()) {
      if (
        !o.includes('\0') &&
        !this.primedFiles.has(o) &&
        dirname(o) === e &&
        !t.includes(basename(o))
      )
        return true
    }
    return false
  }
  clearFolderListing(e: string, t: number): void {
    if (t !== this.epoch) return
    this.retainedListings.delete(e)
    if (!this.folderListings.has(e) || this.walkedFolders.has(e)) return
    this.folderListings.delete(e)
    this.dropDerivedCaches('policySettings')
  }
  retainLayer(e: string, t: ParsedSettings): () => void {
    const o: RetainedParsed = { parsed: t }
    this.retained.set(e, o)
    return () => {
      if (this.retained.get(e) === o) this.retained.delete(e)
    }
  }
  dropRetainedLayer(e: string): void {
    this.retained.delete(e)
  }
  retainFolderListing(e: string, t: string[]): () => void {
    const o: RetainedListing = { names: t }
    this.retainedListings.set(e, o)
    return () => {
      if (this.retainedListings.get(e) === o) this.retainedListings.delete(e)
    }
  }
}

/** Official mGt */
const settingsOwners = new WeakOwnerCache(() => new SettingsOwner())

function owner(): SettingsOwner {
  return settingsOwners.of(getBootstrapSessionHost())
}

/** Official ra() — mGt.of(z().host) */
export function getSettingsOwner(): SettingsOwner {
  return owner()
}

export function getSessionSettingsCache(): SettingsWithErrors | null {
  return owner().mergedSettings
}

export function setSessionSettingsCache(value: SettingsWithErrors): void {
  owner().mergedSettings = value
}

export function getCachedSettingsForSource(
  source: SettingSource,
): SettingsJson | null | undefined {
  const bag = owner().perSource
  return bag.has(source) ? bag.get(source) : undefined
}

export function setCachedSettingsForSource(
  source: SettingSource,
  value: SettingsJson | null,
): void {
  owner().perSource.set(source, value)
}

export function getCachedParsedFile(path: string): ParsedSettings | undefined {
  return owner().parsedFiles.get(path)
}

export function setCachedParsedFile(path: string, value: ParsedSettings): void {
  owner().parsedFiles.set(path, value)
}

/**
 * Official Yl(e) — fGt.invalidateAll via mGt.of(host).
 * Optional retain opts for Gqe/z re-seed path. Leftover callers keep this name.
 */
export function resetSettingsCache(e?: { userLayer?: string }): void {
  owner().invalidateAll(e)
}

export function getPluginSettingsBase(): Record<string, unknown> | undefined {
  return owner().pluginBase
}

export function setPluginSettingsBase(
  settings: Record<string, unknown> | undefined,
): void {
  owner().setPluginBase(settings)
}

export function clearPluginSettingsBase(): void {
  owner().clearPluginBase()
}
