/**
 * Function hooks submodule: faultRender
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { invalidateRender } from '../../render/invalidateAllRenders.js'
import { getActiveSessionFromAls, runWithSession } from '../../sessionHost.js'
import type {
  ClientFaultReport,
  ClientMessageEnqueue,
  ClientMessagePost,
} from '../functionHooksClient.js'
import {
  CLIENT_MESSAGE_COALESCE_MS,
  DRAWING_READERS_CAP,
  FAULT_RENDER_ABORT_MS,
  FAULT_RENDER_FOLD_MS,
  FAULT_RENDER_FV,
  FAULT_RENDER_LIVE,
  FAULT_RENDER_LIVE_MS,
  FAULT_RENDER_STATE_SUFFIX,
  FAULT_RUNS_CAP,
  PLUGIN_RENDER_COOLDOWN_MS,
  describeThrown,
  emptyClientFaultFold,
  functionHookPatternMatches,
  isBuiltinTierMod,
} from './constants.js'
import { runFunctionHookChain } from './hookChain.js'
import { bumpRasterFrames, fhState, pluginSessionState } from './state.js'
import type {
  ClientFaultFoldPace,
  ClientFaultSite,
  UiRenderDrawing,
} from './types.js'
import { matcherAllows } from './uiValidation.js'

/**
 * densable 2.1.289 `dO` / `iO` (terminal): run the owning plugin's `ui.fault`
 * hooks alone. Matcher throw → taken as heard (include hook). Fire-and-forget.
 * Gold always qT(only+core) and logs settle even with no plugin hook.
 */
/**
 * densable `dO` — qT(only+core), settle unique English, return `g??{}`.
 * Chain throw propagates; gold `ko` / local reporter catch it.
 */
export async function dispatchClientFault(
  report: ClientFaultReport,
): Promise<unknown> {
  const event: Record<string, unknown> = {
    surface: report.surface,
    component: report.component,
    requestId: report.requestId,
    element: report.element,
    module: report.module,
    phase: report.phase,
    reason: report.reason,
  }
  try {
    logForDebugging(`${report.plugin}: Client rejection`)
  } catch (err) {
    logForDebugging(
      `${report.plugin}: the fault could not be said: ${describeThrown(err)}`,
      { level: 'error' },
    )
  }
  const started = performance.now()
  try {
    const answered = await runFunctionHookChain(
      'ui.fault',
      event,
      async () => ({}),
      report.plugin,
    )
    logForDebugging(
      `ui.fault ${report.plugin}/${report.element} (${report.module}) in ${report.component} from ${report.surface}, ${report.phase}: dispatched, settled in ${(performance.now() - started).toFixed(1)}ms`,
    )
    return answered ?? {}
  } finally {
    finishClientFault(report)
  }
}

/** densable `Zm`. */
function notePluginRenderCooldown(
  names: readonly string[],
  now = Date.now(),
): void {
  for (const name of names) {
    fhState().pluginRenderCooldownUntil.set(
      name,
      now + PLUGIN_RENDER_COOLDOWN_MS,
    )
  }
}

/** densable `jP`. */
function pluginOnCooldown(name: string, now: number): boolean {
  const until = fhState().pluginRenderCooldownUntil.get(name)
  return until !== undefined && now < until
}

/** densable `U2` — slow live render (> eh) cools HD plugin bumps. */
export function noteSlowUiRender(
  names: readonly string[],
  durationMs: number,
  now = Date.now(),
): void {
  if (durationMs > FAULT_RENDER_LIVE_MS) notePluginRenderCooldown(names, now)
}

/** densable `W2` — aborted render (> WP) cools HD plugin bumps. */
export function noteAbortedUiRender(
  names: readonly string[],
  durationMs: number,
  now = Date.now(),
): void {
  if (durationMs > FAULT_RENDER_ABORT_MS) notePluginRenderCooldown(names, now)
}

/** densable `jis()` live/steady pair; steady `onBump` is live.bump. */

/** densable `Amt` — flush one fold: Qc `\0state` then one staleListener bump. */
function flushClientFaultFolds(pace: ClientFaultFoldPace, now: number): void {
  const session = pluginSessionState()
  const fold = session.folds[pace]
  if (fold.pending !== undefined) clearTimeout(fold.pending)
  fold.pending = undefined
  fold.lastAt = now
  const readers = new Map(
    [...fold.stale].flatMap(instanceKey => {
      const rec = session.readers.get(instanceKey)
      return rec === undefined ? [] : [[instanceKey, rec] as const]
    }),
  )
  fold.stale.clear()
  if (readers.size === 0) return
  for (const instanceKey of readers.keys()) qcFaultSite(instanceKey)
  invalidateRender('ui.render')
  bumpRasterFrames()
}

/** densable `Zc` — enqueue instanceKeys into live/steady folds; debounce Amt. */
function noteClientFaultStale(instanceKeys: readonly string[]): void {
  const session = pluginSessionState()
  const paces = new Set<ClientFaultFoldPace>()
  for (const instanceKey of instanceKeys) {
    const rec = session.readers.get(instanceKey)
    if (rec === undefined) continue
    const pace = clientFaultPace(rec.instance)
    session.folds[pace].stale.add(instanceKey)
    paces.add(pace)
  }
  for (const pace of paces) {
    const fold = session.folds[pace]
    if (fold.pending !== undefined) continue
    const now = Date.now()
    const delay = FAULT_RENDER_FOLD_MS[pace] - Math.max(0, now - fold.lastAt)
    if (delay <= 0) flushClientFaultFolds(pace, now)
    else {
      const captured = getActiveSessionFromAls()
      const timer = setTimeout(() => {
        if (captured !== undefined && getActiveSessionFromAls() !== captured) {
          runWithSession(captured, () =>
            flushClientFaultFolds(pace, Date.now()),
          )
          return
        }
        flushClientFaultFolds(pace, Date.now())
      }, delay)
      timer.unref?.()
      fold.pending = timer
    }
  }
}

/** densable `$C` — readersOf lookup then `Zc` (`noteClientFaultStale`). */
export function notifyDrawingReadersOfKeys(keys: readonly string[]): void {
  const session = pluginSessionState()
  for (const key of keys) {
    const of = session.readersOf.get(key)
    if (of !== undefined && of.size > 0) noteClientFaultStale([...of])
  }
}

function dropDrawingReader(instanceKey: string): void {
  const session = pluginSessionState()
  const rec = session.readers.get(instanceKey)
  if (rec === undefined) return
  for (const key of rec.reads) {
    const of = session.readersOf.get(key)
    of?.delete(instanceKey)
    if (of?.size === 0) session.readersOf.delete(key)
  }
  session.readers.delete(instanceKey)
}

/** densable `jC` after ui.render when requestId !== ''. */
export function recordDrawingReaders(drawing: UiRenderDrawing): void {
  const session = pluginSessionState()
  dropDrawingReader(drawing.instanceKey)
  if (drawing.versionsRead.size === 0) return
  const plugins = uiRenderPluginNames(drawing.instance)
  session.readers.set(drawing.instanceKey, {
    instance: drawing.instance,
    plugins,
    reads: new Set(drawing.versionsRead.keys()),
  })
  let stale = false
  for (const [key, version] of drawing.versionsRead) {
    const of = session.readersOf.get(key) ?? new Set<string>()
    of.add(drawing.instanceKey)
    session.readersOf.set(key, of)
    if ((fhState().pluginState.get(key)?.version ?? 0) !== version) stale = true
  }
  for (const key of [...session.readers.keys()]) {
    if (session.readers.size <= DRAWING_READERS_CAP) break
    if (!session.mounted.has(key)) dropDrawingReader(key)
  }
  if (stale) noteClientFaultStale([drawing.instanceKey])
}

/** densable `bh(Fv)` / `E1t()` — bump HD `ui.render`; React observes via invalidateRender. */
export function bumpFaultRenderFv(): void {
  fhState().faultRenderVersions.set(
    FAULT_RENDER_FV,
    (fhState().faultRenderVersions.get(FAULT_RENDER_FV) ?? 0) + 1,
  )
  invalidateRender('ui.render')
}

export function clientFaultSiteKey(site: ClientFaultSite): string {
  return `${site.surface}\0${site.component}\0${site.requestId}`
}

function clientFaultStateKey(md: string): string {
  return `${md}${FAULT_RENDER_STATE_SUFFIX}`
}

/** densable `Qc([MD], pluginState)` — write `\0state`; `Lue` ignores it. */
function qcFaultSite(md: string): void {
  const session = pluginSessionState()
  session.bumps += 1
  fhState().faultRenderVersions.set(clientFaultStateKey(md), session.bumps)
}

function uiRenderMatcherMatches(
  matcher: unknown,
  site: ClientFaultSite,
  isBuiltin = false,
): boolean {
  if (Array.isArray(matcher)) {
    return matcher.some(item => uiRenderMatcherMatches(item, site, isBuiltin))
  }
  return matcherAllows(
    matcher,
    {
      surface: site.surface,
      component: site.component,
      requestId: site.requestId,
    },
    'ui.render',
    isBuiltin,
  )
}

/** densable `Amn`/`uUe` — ui.render hook plugins matching the site. */
export function uiRenderPluginNames(site: ClientFaultSite): string[] {
  return fhState()
    .loadedModules.filter(mod => mod.status !== 'unloaded')
    .filter(mod => {
      const builtin = isBuiltinTierMod(mod)
      return (mod.hooks ?? []).some(
        hook =>
          functionHookPatternMatches(hook.pattern, 'ui.render') &&
          uiRenderMatcherMatches(hook.matcher, site, builtin),
      )
    })
    .map(mod => mod.name)
}

/**
 * densable `I2` — plugin is live-visible: expanded AbovePrompt, shown
 * Pane, or PromptHint (`dUe`/`uUe`).
 */
function pluginVisibleLive(name: string): boolean {
  const above =
    fhState().pluginBandExpanded &&
    uiRenderPluginNames({
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: '',
    }).includes(name)
  const shownId = fhState().shownPaneId
  const pane =
    shownId !== null &&
    uiRenderPluginNames({
      surface: 'terminal',
      component: 'Pane',
      requestId: shownId,
    }).includes(name)
  const hint = uiRenderPluginNames({
    surface: 'terminal',
    component: 'PromptHint',
    requestId: '',
  }).includes(name)
  return above || pane || hint
}

/**
 * densable `jis.invalidate`: steady.call first; live.call only when
 * steady did not bump now (`!s.call`) AND `!jP` AND `I2`.
 */
export function invalidatePluginRender(plugin: string): void {
  if (
    !fhState().hdPluginSteadyBump.call(plugin) &&
    !pluginOnCooldown(plugin, Date.now()) &&
    pluginVisibleLive(plugin)
  ) {
    fhState().hdPluginLiveBump.call(plugin)
  }
}

/** densable `cS` — live vs steady HD key pace. */
export function clientFaultPace(site: ClientFaultSite): 'live' | 'steady' {
  if (site.surface !== 'terminal') return 'steady'
  const above = site.component === 'AbovePrompt' && fhState().pluginBandExpanded
  const hint = site.component === 'PromptHint'
  const pane =
    site.component === 'Pane' && fhState().shownPaneId === site.requestId
  return above || hint || pane ? 'live' : 'steady'
}

/**
 * densable `Lue` = `EUe(HD, site)` = `DY(Rh(HD, uUe(site), cS(site)), HD, MD)`.
 * `Rh` with names: `Fv` then `\0${plugin}\0${wh(plugin,pace)}`.
 * `DY`: if `${MD}\0state` exists, append `\0\0${s}`.
 */
export function clientFaultLue(site: ClientFaultSite): string {
  const hd = fhState().faultRenderVersions
  const names = uiRenderPluginNames(site)
  const pace = clientFaultPace(site)
  let stamp = String(hd.get(FAULT_RENDER_FV) ?? 0)
  for (const name of names) {
    const key = pace === 'live' ? `${name}${FAULT_RENDER_LIVE}` : name
    stamp += `\0${name}\0${hd.get(key) ?? 0}`
  }
  const state = hd.get(clientFaultStateKey(clientFaultSiteKey(site)))
  return state === undefined ? stamp : `${stamp}\0\0${state}`
}

function clientFaultSiteMounted(site: ClientFaultSite): boolean {
  return (pluginSessionState().mounted.get(clientFaultSiteKey(site)) ?? 0) > 0
}

/** densable `FUo` increment. */
export function holdClientFaultMount(md: string): void {
  const mounted = pluginSessionState().mounted
  mounted.set(md, (mounted.get(md) ?? 0) + 1)
}

/** densable `FUo` release: last drop + !readers → `kS`. */
export function releaseClientFaultMount(md: string): void {
  const session = pluginSessionState()
  const next = (session.mounted.get(md) ?? 1) - 1
  if (next > 0) {
    session.mounted.set(md, next)
    return
  }
  session.mounted.delete(md)
  if (!session.readers.has(md)) {
    fhState().faultRenderVersions.delete(clientFaultStateKey(md))
  }
}

/** densable `xS` — `Qc` then staleListeners (`bumpRasterFrames`). */
function invalidateClientFaultSite(site: ClientFaultSite): void {
  qcFaultSite(clientFaultSiteKey(site))
  invalidateRender('ui.render')
  bumpRasterFrames()
}

/** densable `BC` — `kS` iff `!(mounted || readers)`. */
function dropClientFaultRenderKey(site: ClientFaultSite): void {
  const md = clientFaultSiteKey(site)
  const session = pluginSessionState()
  if ((session.mounted.get(md) ?? 0) > 0 || session.readers.has(md)) return
  fhState().faultRenderVersions.delete(clientFaultStateKey(md))
}

export function resetClientFaultRuns(): void {
  const session = pluginSessionState()
  for (const pace of ['live', 'steady'] as const) {
    const fold = session.folds[pace]
    if (fold.pending !== undefined) clearTimeout(fold.pending)
    session.folds[pace] = emptyClientFaultFold()
  }
  fhState().hdPluginLiveBump.reset()
  fhState().hdPluginSteadyBump.reset()
  session.faultRuns.clear()
  session.mounted.clear()
  session.readers.clear()
  session.readersOf.clear()
  session.bumps = 0
  session.versionFloor = 0
  fhState().faultRenderVersions.clear()
  fhState().pluginRenderCooldownUntil.clear()
  fhState().uiRenderEvalCache.clear()
  fhState().uiRenderEvalHd = undefined
  fhState().uiRenderEvalEngineVersion = 0
  fhState().uiRenderEvalReuseCount = 0
}

function ownerHeardUiFault(report: ClientFaultReport): boolean {
  const needle = 'ui.fault'
  return fhState().loadedModules.some(mod => {
    if (mod.name !== report.plugin) return false
    if (mod.status === 'unloaded') return false
    const builtin = isBuiltinTierMod(mod)
    return (mod.hooks ?? []).some(hook => {
      if (!functionHookPatternMatches(hook.pattern, needle)) return false
      try {
        return matcherAllows(
          hook.matcher,
          {
            surface: report.surface,
            component: report.component,
            requestId: report.requestId,
            element: report.element,
            module: report.module,
            phase: report.phase,
            reason: report.reason,
          },
          needle,
          builtin,
        )
      } catch {
        return true
      }
    })
  })
}

function recordClientFaultRun(site: ClientFaultSite, bornAt: string): void {
  const runs = pluginSessionState().faultRuns
  const key = clientFaultSiteKey(site)
  const held = runs.get(key)
  const now = clientFaultLue(site)
  const keep = held?.versions.has(now) === true
  try {
    invalidateClientFaultSite(site)
  } finally {
    const after = clientFaultLue(site)
    const versions = new Set(keep && held !== undefined ? held.versions : [])
    versions.add(after)
    runs.delete(key)
    runs.set(key, {
      site,
      versions,
      bornAt: held?.bornAt ?? bornAt,
    })
    if (runs.size > FAULT_RUNS_CAP) {
      const oldest = runs.keys().next().value
      if (oldest !== undefined) {
        const evicted = runs.get(oldest)
        runs.delete(oldest)
        if (evicted !== undefined) dropClientFaultRenderKey(evicted.site)
      }
    }
  }
}

function finishClientFault(report: ClientFaultReport): void {
  if (report.requestId === '') return
  if (!ownerHeardUiFault(report)) return
  const site: ClientFaultSite = {
    surface: report.surface,
    component: report.component,
    requestId: report.requestId,
  }
  const key = clientFaultSiteKey(site)
  const held = pluginSessionState().faultRuns.get(key)
  const now = clientFaultLue(site)
  const bornAt = held?.bornAt ?? now
  // densable sO: skip when both bornAt and current Lue are already recorded.
  if (held?.versions.has(bornAt) === true && held.versions.has(now)) return
  recordClientFaultRun(site, bornAt)
}

function drainClientMessages(): void {
  fhState().clientMessageDrain = undefined
  const batch = [...fhState().clientMessagePosts.values()]
  fhState().clientMessagePosts.clear()
  for (const item of batch) {
    fhState().clientMessagesDispatched += 1
    void dispatchClientMessage(item.post).then(item.reply, err => {
      logForDebugging(
        `ui.message ${item.post.plugin}/${item.post.element}: the chain threw (${describeThrown(err)}); no reply`,
        { level: 'warn' },
      )
    })
  }
}

export function enqueueClientMessage(
  post: ClientMessageEnqueue,
  reply: (value: unknown) => void,
): void {
  const state = fhState()
  const captured = getActiveSessionFromAls()
  state.clientMessagePosts.set(post.id, { post, reply })
  state.clientMessageDrain ??= setTimeout(() => {
    if (captured !== undefined && getActiveSessionFromAls() !== captured) {
      runWithSession(captured, drainClientMessages)
      return
    }
    drainClientMessages()
  }, CLIENT_MESSAGE_COALESCE_MS)
}

export function cancelClientMessage(id: string): void {
  fhState().clientMessagePosts.delete(id)
  if (
    fhState().clientMessagePosts.size === 0 &&
    fhState().clientMessageDrain !== undefined
  ) {
    clearTimeout(fhState().clientMessageDrain)
    fhState().clientMessageDrain = undefined
  }
}

export function resetClientMessageQueue(): void {
  fhState().clientMessagePosts.clear()
  if (fhState().clientMessageDrain !== undefined) {
    clearTimeout(fhState().clientMessageDrain)
    fhState().clientMessageDrain = undefined
  }
  fhState().clientMessagesDispatched = 0
}

/**
 * densable `N1t` / `tgn` — owning plugin `ui.message` alone, then core {}.
 * Chain throw is Wbr's warn (`the chain threw`); N1t itself rejects.
 */
export async function dispatchClientMessage(
  post: ClientMessagePost,
): Promise<unknown> {
  const started = performance.now()
  const message: Record<string, unknown> = {
    surface: post.surface,
    component: post.component,
    requestId: post.requestId,
    element: post.element,
    module: post.module,
    data: post.data,
  }
  const answered = await runFunctionHookChain(
    'ui.message',
    message,
    async () => ({}),
    post.plugin,
  )
  logForDebugging(
    `ui.message ${post.plugin}/${post.element} (${post.module}) in ${post.component} from ${post.surface}: dispatched, settled in ${(performance.now() - started).toFixed(1)}ms`,
  )
  return answered ?? {}
}
