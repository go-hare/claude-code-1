/**
 * Function hooks submodule: settingsAndEnv
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { isDeepStrictEqual } from 'util'
import {
  SESSION_AUTHORIZE_ENDPOINT,
  SESSION_AUTHORIZE_PER_PLUGIN_CAP,
  SETTINGS_READ_SOURCES,
  STORE_JSON_LIMIT,
  STORE_KEY_LIMIT,
  createInitialHookedMergeState,
  describeThrown,
  functionHookPatternMatches,
  hostCheck,
  isEventRecord,
  settingsSourceCheck,
  unwrapOpHookResult,
} from './constants.js'
import { runFunctionHookChain } from './hookChain.js'
import {
  buildOpHookOrigin,
  fhState,
  hasMatchingFunctionHookForOp,
  pluginStoreSlot,
  readPluginStoreFile,
  resolveHookCallOrigin,
  writePluginStoreFile,
} from './state.js'
import type {
  HookedMergeAnswers,
  HookedMergeEntry,
  HookedMergeState,
  PersonalPluginEnvWrite,
  SessionAuthHandleEntry,
} from './types.js'

export function clearSessionAuthHandles(): void {
  fhState().sessionAuthEntries.clear()
  fhState().sessionAuthHandlesByPlugin.clear()
}

export function forgetPluginSessionAuthHandles(plugin: string): void {
  const handles = fhState().sessionAuthHandlesByPlugin.get(plugin)
  if (!handles) return
  for (const handle of handles) fhState().sessionAuthEntries.delete(handle)
  fhState().sessionAuthHandlesByPlugin.delete(plugin)
}

function mintSessionAuthHandle(
  plugin: string,
  headers: Record<string, string>,
  host: string,
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto') as typeof import('crypto')
  const handle = `auth_${randomUUID().replace(/-/g, '')}`
  fhState().sessionAuthEntries.set(handle, { plugin, headers, host })
  const list = [
    ...(fhState().sessionAuthHandlesByPlugin.get(plugin) ?? []),
    handle,
  ]
  while (list.length > SESSION_AUTHORIZE_PER_PLUGIN_CAP) {
    const oldest = list.shift()
    if (oldest !== undefined) fhState().sessionAuthEntries.delete(oldest)
  }
  fhState().sessionAuthHandlesByPlugin.set(plugin, list)
  return handle
}

export function resolveSessionAuthHandle(
  plugin: string,
  handle: string,
): SessionAuthHandleEntry | undefined {
  const entry = fhState().sessionAuthEntries.get(handle)
  return entry?.plugin === plugin ? entry : undefined
}

export async function runSessionAuthorize(
  plugin?: string,
): Promise<{ handle: string; kind: 'bearer' | 'api-key' } | null> {
  const owner = plugin ?? ''
  if (
    process.env.CLAUDE_CODE_EVAL_CONFINED === '1' ||
    Boolean(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
  ) {
    return null
  }
  try {
    const { getAuthHeaders, withholdMisroutedCredential } = await import(
      '../../http.js'
    )
    let rawAuth: { headers: Record<string, string>; error?: string }
    try {
      rawAuth = getAuthHeaders()
    } catch {
      rawAuth = { headers: {}, error: 'no credential' }
    }
    if (
      rawAuth.error !== undefined &&
      Object.keys(rawAuth.headers).length === 0
    ) {
      if (process.env.ANTHROPIC_AUTH_TOKEN) {
        rawAuth = {
          headers: {
            Authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`,
          },
        }
      } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
        rawAuth = {
          headers: {
            Authorization: `Bearer ${process.env.CLAUDE_CODE_OAUTH_TOKEN}`,
          },
        }
      } else if (process.env.ANTHROPIC_API_KEY) {
        rawAuth = {
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
          },
        }
      }
    }
    const vetted = withholdMisroutedCredential(
      rawAuth,
      SESSION_AUTHORIZE_ENDPOINT,
    )
    if (vetted.error !== undefined) return null
    const kind: 'bearer' | 'api-key' | undefined =
      'Authorization' in vetted.headers
        ? 'bearer'
        : 'x-api-key' in vetted.headers
          ? 'api-key'
          : undefined
    if (kind === undefined) return null
    const host = new URL(SESSION_AUTHORIZE_ENDPOINT).host
    return {
      handle: mintSessionAuthHandle(owner, { ...vetted.headers }, host),
      kind,
    }
  } catch {
    return null
  }
}

function overlayForSource(source: string): Map<string, unknown> {
  const held = fhState().settingsOverlay.get(source)
  if (held) return held
  const next = new Map<string, unknown>()
  fhState().settingsOverlay.set(source, next)
  return next
}

export function mergeSettings(
  base: Record<string, unknown>,
  source?: string,
): Record<string, unknown> {
  const extra =
    source === undefined
      ? [...fhState().settingsOverlay.values()].reduce<Record<string, unknown>>(
          (acc, map) => Object.assign(acc, Object.fromEntries(map)),
          {},
        )
      : Object.fromEntries(overlayForSource(source))
  return { ...base, ...extra }
}

async function readSettingsHost(
  rec: Record<string, unknown> | undefined,
  op: string,
  plugin?: string,
): Promise<Record<string, unknown>> {
  const resolvedSource = settingsSourceCheck(rec?.source, op, plugin)
  try {
    const { getSettingsForSource, getInitialSettings } = await import(
      '../../settings/settings.js'
    )
    if (resolvedSource !== undefined) {
      return mergeSettings(
        (getSettingsForSource(resolvedSource) ?? {}) as Record<string, unknown>,
        resolvedSource,
      )
    }
    return mergeSettings(
      (getInitialSettings() ?? {}) as Record<string, unknown>,
    )
  } catch {
    return mergeSettings({}, resolvedSource)
  }
}

function normalizeEnvKeyForMatch(key: string): string {
  return process.platform === 'win32' ? key.toUpperCase() : key
}

function entriesMatchingEnvKey(
  key: string,
): Array<[string, PersonalPluginEnvWrite]> {
  const target = normalizeEnvKeyForMatch(key)
  return [...fhState().personalPluginEnvWrites.entries()].filter(
    ([, entry]) => normalizeEnvKeyForMatch(entry.name) === target,
  )
}

function isPersonalEnvWriteActive(entry: PersonalPluginEnvWrite): boolean {
  return process.env[entry.name] === entry.theirs
}

function activePersonalEnvWrites(): PersonalPluginEnvWrite[] {
  const entries = [...fhState().personalPluginEnvWrites.values()]
  return fhState().envIsolationOpen
    ? entries
    : entries.filter(isPersonalEnvWriteActive)
}

function setOrDeleteProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

export function beginPersonalEnvSetTrack(
  name: string,
  writer: string | undefined,
): () => void {
  if (!fhState().envIsolationOpen) {
    for (const [key, entry] of entriesMatchingEnvKey(name)) {
      if (!isPersonalEnvWriteActive(entry)) {
        fhState().personalPluginEnvWrites.delete(key)
      }
    }
  }
  const existing = fhState().personalPluginEnvWrites.get(name) ?? {
    name,
    before: process.env[name],
    theirs: undefined,
  }
  return () => {
    fhState().personalPluginEnvWrites.set(name, {
      ...existing,
      theirs: undefined,
      writer,
    })
    for (const [key, entry] of entriesMatchingEnvKey(name)) {
      fhState().personalPluginEnvWrites.set(key, {
        ...entry,
        theirs: process.env[entry.name],
        writer,
      })
    }
  }
}

export function clearPersonalEnvSetTrack(name: string): () => void {
  return () => {
    const current = process.env[name]
    for (const [key, entry] of entriesMatchingEnvKey(name)) {
      if (process.env[entry.name] === current) {
        fhState().personalPluginEnvWrites.delete(key)
      }
    }
  }
}

export function dropPersonalPluginEnvSetIfMatches(
  env: Record<string, string | undefined>,
): void {
  if (fhState().envIsolationOpen) return
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    for (const [key, entry] of entriesMatchingEnvKey(name)) {
      if (process.env[entry.name] === value) {
        fhState().personalPluginEnvWrites.delete(key)
      }
    }
  }
}

export function getPersonalPluginEnvSetKeys(): string[] {
  return activePersonalEnvWrites().map(entry => entry.name)
}

export function hasPersonalPluginEnvChangeForKeys(
  keys: readonly string[],
): boolean {
  const target = new Set(keys.map(normalizeEnvKeyForMatch))
  return activePersonalEnvWrites().some(
    entry =>
      (entry.theirs || undefined) !== (entry.before || undefined) &&
      target.has(normalizeEnvKeyForMatch(entry.name)),
  )
}

export function withPersonalPluginEnvIsolated<T>(
  fn: () => T,
  allowWriter?: (writer: string) => boolean,
): T {
  if (fhState().envIsolationOpen) return fn()
  const active = activePersonalEnvWrites()
  if (active.length === 0) return fn()
  const isolated = active.filter(
    entry =>
      entry.writer === undefined ||
      allowWriter === undefined ||
      !allowWriter(entry.writer),
  )
  for (let i = isolated.length - 1; i >= 0; i--) {
    const entry = isolated[i]!
    setOrDeleteProcessEnv(entry.name, entry.before)
  }
  fhState().envIsolationOpen = true
  try {
    return fn()
  } finally {
    for (const entry of isolated) {
      setOrDeleteProcessEnv(entry.name, entry.theirs)
    }
    fhState().envIsolationOpen = false
  }
}

export function clearPersonalPluginEnvSetKeysForReset(): void {
  fhState().personalPluginEnvWrites.clear()
  fhState().envIsolationOpen = false
}

export async function runSettingsRead(
  rec: Record<string, unknown> | undefined,
  op: string,
  plugin?: string,
): Promise<unknown> {
  settingsSourceCheck(rec?.source, op, plugin)
  const payload: Record<string, unknown> =
    rec?.source !== undefined ? { source: rec.source } : {}
  const hookOrigin = buildOpHookOrigin(plugin)
  if (!hasMatchingFunctionHookForOp('settings.read', payload, hookOrigin)) {
    return readSettingsHost(rec, op, plugin)
  }
  const out = await runFunctionHookChain(
    'settings.read',
    payload,
    async event => {
      settingsSourceCheck(event.source, op, plugin)
      return { value: await readSettingsHost(event, op, plugin) }
    },
    undefined,
    undefined,
    {
      origin: resolveHookCallOrigin(plugin),
      hookOrigin,
    },
  )
  return unwrapOpHookResult('settings.read', out, plugin)
}

export function getHookedMergeState(): HookedMergeState {
  return fhState().hookedMergeState
}

export function resetHookedMergeState(): void {
  fhState().hookedMergeState = createInitialHookedMergeState()
}

function mergeAnswersFingerprint(values: Map<string, unknown>): string {
  const keys = [...values.keys()].toSorted()
  return JSON.stringify([keys, keys.map(k => values.get(k))])
}

export function settingsReadPlugins(): string[] {
  const hookOrigin = buildOpHookOrigin(undefined)
  return fhState()
    .loadedModules.filter(
      mod =>
        mod.status !== 'unloaded' &&
        mod.patterns.some(pat =>
          functionHookPatternMatches(pat, 'settings.read'),
        ),
    )
    .filter(mod => {
      if (hookOrigin === undefined) return true
      return true
    })
    .map(mod => mod.name)
}

export async function engineMergeRead(): Promise<
  HookedMergeEntry[] | undefined
> {
  const hookOrigin = buildOpHookOrigin(undefined)
  const layers: Array<{ source: string; settings: Record<string, unknown> }> =
    []
  let base: Record<string, unknown> = fhState().hookedMergeState.computed ?? {}
  try {
    const { getSettingsForSource, getInitialSettings } = await import(
      '../../settings/settings.js'
    )
    for (const source of SETTINGS_READ_SOURCES) {
      const s = getSettingsForSource(source) as
        | Record<string, unknown>
        | undefined
      if (s && Object.keys(s).length > 0) {
        layers.push({ source, settings: { ...s } })
      }
    }
    if (fhState().hookedMergeState.computed === null) {
      base = (getInitialSettings() ?? {}) as Record<string, unknown>
    }
  } catch {
    // Keep empty layers / computed fallback in isolated test environments.
  }
  if (!hasMatchingFunctionHookForOp('settings.read', { layers }, hookOrigin)) {
    return undefined
  }

  let answered: Record<string, unknown>
  try {
    const out = await runFunctionHookChain(
      'settings.read',
      { layers },
      async () => ({ value: { ...base } }),
      undefined,
      undefined,
      {
        origin: resolveHookCallOrigin(undefined),
        hookOrigin,
      },
    )
    const unwrapped = unwrapOpHookResult('settings.read', out, undefined)
    answered = isEventRecord(unwrapped) ? unwrapped : base
  } catch (err) {
    logForDebugging(
      `settings.read: refused to the engine (${describeThrown(err)}); the settings' own values stand`,
    )
    answered = base
  }

  const allKeys = new Set([...Object.keys(answered), ...Object.keys(base)])
  const diffs: HookedMergeEntry[] = []
  for (const key of allKeys) {
    const nextVal = Object.hasOwn(answered, key) ? answered[key] : undefined
    const baseVal = Object.hasOwn(base, key) ? base[key] : undefined
    if (isDeepStrictEqual(nextVal, baseVal)) continue
    const lastLayer = layers.findLast(layer =>
      Object.hasOwn(layer.settings, key),
    )
    diffs.push({
      key,
      value: nextVal,
      ...(lastLayer !== undefined &&
        SETTINGS_READ_SOURCES.includes(
          lastLayer.source as (typeof SETTINGS_READ_SOURCES)[number],
        ) && {
          source: lastLayer.source as (typeof SETTINGS_READ_SOURCES)[number],
        }),
    })
  }
  return diffs
}

export async function raiseEngineSettingsMerge(
  reason: string,
  deps?: {
    engineMergeRead?: () => Promise<HookedMergeEntry[] | undefined>
    settingsReadPlugins?: () => string[]
    notifyChange?: (source: (typeof SETTINGS_READ_SOURCES)[number]) => void
  },
): Promise<void> {
  const state = fhState().hookedMergeState
  state.queuedFor = undefined
  try {
    const prevAnswers = state.answers
    if (fhState().loadedModules.length === 0 && prevAnswers === null) return

    const askedOf = JSON.stringify(
      fhState().loadedModules.map(mod => mod.environmentId ?? mod.name),
    )
    const askedAbout = state.computed
    if (
      askedOf === state.askedOf &&
      askedAbout === state.askedAbout &&
      state.unsettled.size === 0
    ) {
      logForDebugging(
        `settings.read: the engine's merge is not raised again (${reason}): neither the loaded plugins nor the settings changed.`,
      )
      return
    }

    const startMs = performance.now()
    const rawEntries = await (deps?.engineMergeRead ?? engineMergeRead)()
    if (rawEntries === undefined && state.visited.length === 0) {
      state.unsettled = new Set()
    }
    const entries = rawEntries ?? []
    logForDebugging(
      `settings.read: the engine's merge was raised (${reason}) in ${(performance.now() - startMs).toFixed(1)} ms; ${entries.length} keys answered otherwise than the files.`,
    )

    const prevValues = prevAnswers?.values ?? new Map<string, unknown>()
    const candidateMap = new Map<string, unknown>(
      entries
        .filter(entry => !state.unsettled.has(entry.key))
        .map(entry => [entry.key, entry.value]),
    )
    const candidateFp = mergeAnswersFingerprint(candidateMap)
    if (state.visited.includes(candidateFp)) {
      const allKeys = new Set([...candidateMap.keys(), ...prevValues.keys()])
      const oscillating = [...allKeys].filter(
        key =>
          candidateMap.has(key) !== prevValues.has(key) ||
          !isDeepStrictEqual(candidateMap.get(key), prevValues.get(key)),
      )
      if (oscillating.length > 0) {
        state.unsettled = new Set([...state.unsettled, ...oscillating])
        logForDebugging(
          `settings.read: the merge never settles for ${oscillating.join(', ')}; no hook's answer is taken for it.`,
          { level: 'warn' },
        )
      }
    }

    const settledEntries = entries.filter(
      entry => !state.unsettled.has(entry.key),
    )
    const pluginNames = (deps?.settingsReadPlugins ?? settingsReadPlugins)()
    const nextAnswers: HookedMergeAnswers | null =
      settledEntries.length + state.unsettled.size === 0
        ? null
        : {
            values: new Map(
              settledEntries.map(entry => [entry.key, entry.value]),
            ),
            errors: [...state.unsettled].map(key => ({
              path: key,
              severity: 'warning',
              statusOnly: true,
              message: `${key} never settles under a settings.read hook (one of: ${pluginNames.join(', ')}): taking its answer was followed by a reload of the plugins, and the plugins then loaded answered as before it. No hook's answer is taken for this key; the settings files' own value stands.`,
            })),
            source: SETTINGS_READ_SOURCES.findLast(src =>
              settledEntries.some(entry => entry.source === src),
            ),
          }

    if (isDeepStrictEqual(nextAnswers, prevAnswers)) {
      state.visited = []
      state.askedOf = askedOf
      state.askedAbout = askedAbout
      return
    }

    state.answers = nextAnswers
    state.isAnnouncing = true
    const regBefore = fhState().hookRegistrationEpoch
    try {
      const changedSource =
        SETTINGS_READ_SOURCES.findLast(
          src => src === nextAnswers?.source || src === prevAnswers?.source,
        ) ?? 'policySettings'
      deps?.notifyChange?.(changedSource)
    } finally {
      state.isAnnouncing = false
    }
    const didReload = fhState().hookRegistrationEpoch !== regBefore
    state.visited = didReload
      ? [...state.visited, mergeAnswersFingerprint(prevValues)]
      : []
  } catch (err) {
    logForDebugging(`settings.read: merge failed (${describeThrown(err)})`, {
      level: 'error',
    })
  }
}

export function scheduleEngineSettingsMerge(
  reason: string,
  deps?: Parameters<typeof raiseEngineSettingsMerge>[1],
): Promise<void> {
  const state = fhState().hookedMergeState
  if (state.queuedFor === undefined && !state.isAnnouncing) {
    state.queuedFor = reason
    state.pass = state.pass.then(() => raiseEngineSettingsMerge(reason, deps))
  }
  return state.pass
}

export function onSettingsChangedForMerge(
  deps?: Parameters<typeof raiseEngineSettingsMerge>[1],
): Promise<void> {
  if (!fhState().hookedMergeState.isAnnouncing) {
    fhState().hookedMergeState.unsettled = new Set()
  }
  return scheduleEngineSettingsMerge('the settings changed', deps)
}

export function runPluginStore(
  op: string,
  input: Record<string, unknown>,
  plugin?: string,
): unknown {
  const owner = plugin ?? ''
  const key = typeof input.key === 'string' ? input.key : ''
  if (op !== 'store.keys' && key === '') {
    hostCheck(op, 'takes a key', plugin)
  }
  if (op !== 'store.keys' && key.length > STORE_KEY_LIMIT) {
    throw new Error(
      `${owner}: $.store.${op === 'store.get' ? 'get' : op === 'store.set' ? 'set' : 'delete'}: the key is ${key.length} characters, over the ${STORE_KEY_LIMIT} limit`,
    )
  }
  const data = readPluginStoreFile(owner)
  if (op === 'store.get') {
    return Object.hasOwn(data, key) ? data[key] : undefined
  }
  if (op === 'store.set') {
    const next = { ...data, [key]: input.value }
    const raw = JSON.stringify(next)
    if (raw.length > STORE_JSON_LIMIT) {
      throw new Error(
        `${owner}: $.store.set: the store would be ${raw.length} characters, over the ${STORE_JSON_LIMIT} limit`,
      )
    }
    writePluginStoreFile(owner, next)
    fhState().pluginStore.set(pluginStoreSlot(owner, key), input.value)
    return undefined
  }
  if (op === 'store.delete') {
    if (!Object.hasOwn(data, key)) return undefined
    const next = { ...data }
    delete next[key]
    writePluginStoreFile(owner, next)
    fhState().pluginStore.delete(pluginStoreSlot(owner, key))
    return undefined
  }
  return Object.keys(data)
}
