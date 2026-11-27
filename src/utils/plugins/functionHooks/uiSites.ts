/**
 * Function hooks submodule: uiSites
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { getPluginSurfaceModules } from '../functionHooksClient.js'
import { SURFACE_LIMITS } from '../functionHooksSurfaceRuntime.js'
import { KITTY_PLACEHOLDER_MAX } from '../kittyGraphics.js'
import {
  scrollTranscriptByRequestId,
  type TranscriptRevealBlock,
} from '../transcriptReveal.js'
import { createHash } from 'crypto'
import {
  ABOVE_PROMPT_REQUEST_ID,
  FOCUS_SITE_WAIT_MS,
  functionHookPatternMatches,
  isBuiltinTierMod,
  isEventRecord,
} from './constants.js'
import {
  clientFaultSiteKey,
  dispatchClientMessage,
  holdClientFaultMount,
  releaseClientFaultMount,
} from './faultRender.js'
import { getLivePressEvent } from './heldPressStore.js'
import { runFunctionHookChain } from './hookChain.js'
import { getPanesState, notifyPanesListeners, subscribePanes } from './panes.js'
import {
  RASTER_BLITS_PER_WINDOW,
  RASTER_BLIT_WINDOW_MS,
  RASTER_MAX_COLUMNS,
  RASTER_MAX_ROWS,
  mountSiteKey,
  rasterWordsToAnsi,
} from './raster.js'
import {
  bumpRasterFrames,
  fhState,
  hasMatchingFunctionHook,
  ideGet,
  ideSiteKey,
} from './state.js'
import type {
  ImageSite,
  MountedImage,
  MountedRaster,
  PersonUiScrollInput,
  PluginFocusDispatchInput,
  PluginFocusHookCtx,
  PluginFocusHostBind,
  PluginFocusSite,
  PluginFocusSiteSnapshot,
  PluginScrollOrigin,
  PluginScrollSiteDims,
  PluginScrollSiteSnapshot,
  PluginSite,
  RasterSite,
  RemoteClientMessageInput,
  RemoteClientPressInput,
  RemoteUiFocusInput,
  RemoteUiScrollInput,
  ScrollSiteLayoutNode,
} from './types.js'
import { matcherAllows } from './uiValidation.js'

function focusSiteMapKey(
  component: PluginSite['component'],
  requestId: string,
): string {
  return `${component}:${requestId}`
}

function holdPluginFocusSite(
  plugin: string,
  requestId: string,
  component: PluginSite['component'],
  keys: Set<string>,
): PluginFocusSite {
  const mapKey = focusSiteMapKey(component, requestId)
  const held = fhState().pluginFocusSites.get(mapKey)
  if (held) {
    held.plugin = plugin
    held.owner = plugin
    held.keys = keys
    return held
  }
  const next: PluginFocusSite = {
    plugin,
    owner: plugin,
    requestId,
    component,
    keys,
  }
  fhState().pluginFocusSites.set(mapKey, next)
  fhState().focusSiteDraws.emit()
  return next
}

function dropPluginFocusSite(plugin: string, requestId: string): void {
  let dropped = false
  for (const [mapKey, site] of fhState().pluginFocusSites) {
    if (site.plugin === plugin && site.requestId === requestId) {
      fhState().pluginFocusSites.delete(mapKey)
      dropped = true
    }
  }
  if (dropped) fhState().focusSiteDraws.emit()
}

function focusSiteIsHeldNow(site: PluginFocusSite): boolean {
  if (site.host) return site.host.isHeldNow()
  if (site.component === 'AbovePrompt') return fhState().focusedPaneId === null
  if (fhState().focusedPaneId !== null)
    return fhState().focusedPaneId === site.requestId
  if (fhState().shownPaneId !== null)
    return fhState().shownPaneId === site.requestId
  return true
}

function focusSiteHolderNow(site: PluginFocusSite): string | undefined {
  if (site.host) return site.host.holderNow()
  if (!focusSiteIsHeldNow(site)) return undefined
  return site.holder ?? site.owner
}

/**
 * densable XHo `g9e().set` — Pane/AbovePrompt keyboard host binds live
 * isHeldNow / holderNow / hasElement / commit. Returns unbind.
 */
export function bindPluginFocusHost(bind: PluginFocusHostBind): () => void {
  const mapKey = focusSiteMapKey(bind.component, bind.requestId)
  const owner = bind.owner ?? ''
  const held = fhState().pluginFocusSites.get(mapKey)
  const keys = held?.keys ?? new Set<string>()
  const site: PluginFocusSite = {
    plugin: owner,
    owner,
    requestId: bind.requestId,
    component: bind.component,
    keys,
    holder: held?.holder,
    host: bind,
  }
  fhState().pluginFocusSites.set(mapKey, site)
  fhState().focusSiteDraws.emit()
  return () => {
    // densable XHo cleanup: `g9e().delete(Ge)` — drop the live host entry.
    if (fhState().pluginFocusSites.get(mapKey)?.host === bind) {
      fhState().pluginFocusSites.delete(mapKey)
      fhState().focusSiteDraws.emit()
    }
  }
}

/** densable `ZLt` / `focusSiteDraws` — waiters abort when sites change. */
export function subscribePluginFocusSiteDraws(
  listener: () => void,
): () => void {
  return fhState().focusSiteDraws.subscribe(listener)
}

/** densable `yat` — foreign plugin origin vs site owner. */
function isForeignPluginFocusSite(
  site: PluginFocusSite,
  origin: { kind: string; name?: string } | undefined,
  caller: string,
): boolean {
  return (
    origin?.kind === 'plugin' &&
    site.owner !== undefined &&
    site.owner !== '' &&
    origin.name !== undefined &&
    site.owner !== origin.name &&
    caller !== origin.name
  )
}

/** densable focus `x$` — holderNow defined and ≠ origin plugin. */
function isForeignFocusHolder(
  site: PluginFocusSite,
  origin: { kind: string; name?: string } | undefined,
): boolean {
  if (origin?.kind !== 'plugin' || origin.name === undefined) return false
  const holder = focusSiteHolderNow(site)
  return holder !== undefined && holder !== origin.name
}

export function getPluginFocusSite(
  plugin: string,
  requestId: string,
): PluginFocusSiteSnapshot | undefined {
  for (const site of fhState().pluginFocusSites.values()) {
    if (site.plugin === plugin && site.requestId === requestId) {
      return {
        plugin: site.plugin,
        owner: site.owner,
        requestId: site.requestId,
        component: site.component,
        keyCount: site.keys.size,
        holder: site.holder,
        isHeldNow: focusSiteIsHeldNow(site),
      }
    }
  }
  return undefined
}

/** densable compositor `PLo` shared across mounted-frame snapshots. */

export function getMountedRasterFrames(): Array<{
  plugin: string
  requestId: string
  key: string
  columns: number
  rows: number
  ansi: string
}> {
  const frames: Array<{
    plugin: string
    requestId: string
    key: string
    columns: number
    rows: number
    ansi: string
  }> = []
  const seen = new Set<MountedRaster>()
  for (const site of fhState().mountedRasters.values()) {
    for (const mount of site.rasters) {
      if (seen.has(mount)) continue
      seen.add(mount)
      frames.push({
        plugin: mount.plugin,
        requestId: mount.requestId,
        key: mount.key,
        columns: mount.columns,
        rows: mount.rows,
        ansi: mount.lastAnsi ?? '',
      })
    }
  }
  return frames
}

/** Image mounts with a last swap — REPL shows a dim placeholder (no kitty). */
export function getMountedImageFrames(): Array<{
  plugin: string
  requestId: string
  key: string
  columns: number
  rows: number
  lastSource?: unknown
}> {
  const frames: Array<{
    plugin: string
    requestId: string
    key: string
    columns: number
    rows: number
    lastSource?: unknown
  }> = []
  const seen = new Set<MountedImage>()
  for (const site of fhState().mountedImages.values()) {
    for (const mount of site.images) {
      if (seen.has(mount)) continue
      seen.add(mount)
      frames.push({
        plugin: mount.plugin,
        requestId: mount.requestId,
        key: mount.key,
        columns: mount.columns,
        rows: mount.rows,
        lastSource: mount.lastSource,
      })
    }
  }
  return frames
}

/** densable `Wve` — add a mount; return unmount. */
function holdMounted<T>(opts: {
  sites: Map<string, T>
  siteKey: string
  mount: unknown
  mountsOf: (site: T) => Set<unknown>
  freshSite: () => T
}): () => void {
  const site = opts.sites.get(opts.siteKey) ?? opts.freshSite()
  opts.mountsOf(site).add(opts.mount)
  opts.sites.set(opts.siteKey, site)
  return () => {
    const held = opts.mountsOf(site)
    held.delete(opts.mount)
    if (held.size === 0 && opts.sites.get(opts.siteKey) === site) {
      opts.sites.delete(opts.siteKey)
    }
  }
}

export function mountRaster(mount: MountedRaster): () => void {
  return holdMounted({
    sites: fhState().mountedRasters,
    siteKey: mountSiteKey(mount.requestId, mount.key, mount.plugin),
    mount,
    mountsOf: site => site.rasters,
    freshSite: () => ({ rasters: new Set(), windowStart: 0, blits: 0 }),
  })
}

function mountImage(mount: MountedImage): () => void {
  return holdMounted({
    sites: fhState().mountedImages,
    siteKey: mountSiteKey(mount.requestId, mount.key, mount.plugin),
    mount,
    mountsOf: site => site.images,
    freshSite: () => ({ images: new Set(), windowStart: 0, blits: 0 }),
  })
}

function existingRasterMount(
  plugin: string,
  requestId: string,
  key: string,
): MountedRaster | undefined {
  const site = fhState().mountedRasters.get(
    mountSiteKey(requestId, key, plugin),
  )
  if (!site) return undefined
  return [...site.rasters].find(
    item =>
      item.plugin === plugin &&
      item.key === key &&
      item.requestId === requestId,
  )
}

function existingImageMount(
  plugin: string,
  requestId: string,
  key: string,
): MountedImage | undefined {
  const site = fhState().mountedImages.get(mountSiteKey(requestId, key, plugin))
  if (!site) return undefined
  return [...site.images].find(
    item =>
      item.plugin === plugin &&
      item.key === key &&
      item.requestId === requestId,
  )
}

/**
 * densable `ILo` from Raster `wo`: replace the mount's paint with the
 * widget's `R.paint` (Joo + go on that ink-raw-ansi node). Tests keep the
 * fallback paint from ui.resolve until a widget attaches.
 */
export function attachRasterWidgetPaint(
  plugin: string,
  requestId: string,
  key: string,
  paint: (words: Uint32Array) => void,
): () => void {
  const site = fhState().mountedRasters.get(
    mountSiteKey(requestId, key, plugin),
  )
  const mount = site
    ? [...site.rasters].find(
        item =>
          item.plugin === plugin &&
          item.key === key &&
          item.requestId === requestId,
      )
    : undefined
  if (mount === undefined) {
    const created: MountedRaster = {
      plugin,
      requestId,
      key,
      columns: 1,
      rows: 1,
      paint,
    }
    const unmount = mountRaster(created)
    noteDrawnElement(plugin, requestId, key)
    bumpRasterFrames()
    return () => {
      unmount()
      bumpRasterFrames()
    }
  }
  const previous = mount.paint
  mount.paint = words => {
    mount.lastWords = words
    paint(words)
  }
  bumpRasterFrames()
  return () => {
    mount.paint = previous
    bumpRasterFrames()
  }
}

export function attachImageWidgetSwap(
  plugin: string,
  requestId: string,
  key: string,
  swap: (source: unknown) => string | undefined,
): () => void {
  const site = fhState().mountedImages.get(mountSiteKey(requestId, key, plugin))
  const mount = site
    ? [...site.images].find(
        item =>
          item.plugin === plugin &&
          item.key === key &&
          item.requestId === requestId,
      )
    : undefined
  if (mount === undefined) {
    const created: MountedImage = {
      plugin,
      requestId,
      key,
      columns: 1,
      rows: 1,
      swap,
    }
    const unmount = mountImage(created)
    noteDrawnElement(plugin, requestId, key)
    bumpRasterFrames()
    return () => {
      unmount()
      bumpRasterFrames()
    }
  }
  const previous = mount.swap
  mount.swap = source => {
    mount.lastSource = source
    return swap(source)
  }
  bumpRasterFrames()
  return () => {
    mount.swap = previous
    bumpRasterFrames()
  }
}

/** densable `_mt` / `fmt` — another plugin owns this key. */
export function anotherPluginOwns(
  kind: 'Raster' | 'Image',
  requestId: string,
  key: string,
  plugin: string,
): boolean {
  const sites =
    kind === 'Raster' ? fhState().mountedRasters : fhState().mountedImages
  for (const site of sites.values()) {
    const mounts =
      kind === 'Raster'
        ? (site as RasterSite).rasters
        : (site as ImageSite).images
    for (const mount of mounts) {
      if (
        mount.requestId === requestId &&
        mount.key === key &&
        mount.plugin !== plugin
      ) {
        return true
      }
    }
  }
  return false
}

/** densable `$ve`. */
export function blitUnmountedDeny(
  kind: 'Raster' | 'Image',
  requestId: string,
  key: string,
  otherPlugin: boolean,
): { deny: string } {
  if (otherPlugin) {
    return {
      deny: `the ${kind} under key "${key}" in ${requestId} is another plugin's, not its to ${kind === 'Raster' ? 'paint' : 'swap'}`,
    }
  }
  return {
    deny: `no ${kind} of its own is mounted under key "${key}" in ${requestId}`,
  }
}

/** densable `Nve` — at most $W blits per second. */
export function takeBlitSlot(site: {
  windowStart: number
  blits: number
}): boolean {
  const now = Date.now()
  if (now - site.windowStart >= RASTER_BLIT_WINDOW_MS) {
    site.windowStart = now
    site.blits = 0
  }
  const ok = site.blits < RASTER_BLITS_PER_WINDOW
  site.blits += ok ? 1 : 0
  return ok
}

export function walkUiMounts(
  node: unknown,
  plugin: string,
  requestId: string | undefined,
): void {
  if (Array.isArray(node)) {
    for (const child of node) walkUiMounts(child, plugin, requestId)
    return
  }
  if (!isEventRecord(node)) return
  const props = isEventRecord(node.props) ? node.props : node
  const type = typeof node.type === 'string' ? node.type : undefined
  const key =
    (typeof props.key === 'string' && props.key) ||
    (typeof node.key === 'string' && node.key) ||
    undefined
  const rasterStamp = isEventRecord(node.raster) ? node.raster : undefined
  const imageStamp = isEventRecord(node.image) ? node.image : undefined
  const owner =
    type === 'Raster' && typeof rasterStamp?.plugin === 'string'
      ? rasterStamp.plugin
      : type === 'Image' && typeof imageStamp?.plugin === 'string'
        ? imageStamp.plugin
        : plugin
  const req =
    (typeof props.requestId === 'string' && props.requestId) ||
    (typeof node.requestId === 'string' && node.requestId) ||
    requestId
  const columns =
    typeof props.columns === 'number'
      ? props.columns
      : typeof node.columns === 'number'
        ? node.columns
        : 1
  const rows =
    typeof props.rows === 'number'
      ? props.rows
      : typeof node.rows === 'number'
        ? node.rows
        : 1
  if (type === 'Raster' && key && req) {
    const cols = Math.min(Math.max(1, columns), RASTER_MAX_COLUMNS)
    const rws = Math.min(Math.max(1, rows), RASTER_MAX_ROWS)
    const existing = existingRasterMount(owner, req, key)
    if (existing) {
      existing.columns = cols
      existing.rows = rws
    } else {
      const raster: MountedRaster = {
        plugin: owner,
        requestId: req,
        key,
        columns: cols,
        rows: rws,
        paint(words) {
          raster.lastWords = words
          raster.lastAnsi = rasterWordsToAnsi(
            words,
            raster.columns,
            raster.rows,
            fhState().sharedRasterPalette,
          )
        },
      }
      mountRaster(raster)
    }
    holdPluginSite(owner, req, scrollSiteComponent(req)).keys.add(key)
  }
  if (type === 'Image' && key && req) {
    const cols = Math.min(
      Math.max(1, columns),
      KITTY_PLACEHOLDER_MAX,
      RASTER_MAX_COLUMNS,
    )
    const rws = Math.min(
      Math.max(1, rows),
      KITTY_PLACEHOLDER_MAX,
      RASTER_MAX_ROWS,
    )
    const existing = existingImageMount(owner, req, key)
    if (existing) {
      existing.columns = cols
      existing.rows = rws
    } else {
      const image: MountedImage = {
        plugin: owner,
        requestId: req,
        key,
        columns: cols,
        rows: rws,
        swap(next) {
          // Gold `io({hasRoot, ...})` may deny when a kitty sink is busy/refuses.
          // Widget attach wraps this swap; a second walk must not add another
          // stub that would make blit treat kitty refuse as success.
          image.lastSource = next
          return undefined
        },
      }
      mountImage(image)
    }
    holdPluginSite(owner, req, scrollSiteComponent(req)).keys.add(key)
  }
  if (node.children !== undefined) walkUiMounts(node.children, owner, req)
  if (props !== node && props.children !== undefined) {
    walkUiMounts(props.children, owner, req)
  }
}

function sitesOf(plugin: string, inn?: string): PluginSite[] {
  return fhState().pluginSites.filter(
    site =>
      site.plugin === plugin && (inn === undefined || site.requestId === inn),
  )
}

export function holdPluginSite(
  plugin: string,
  requestId: string,
  component: PluginSite['component'] = 'Pane',
): PluginSite {
  const held = ideGet(component, requestId)
  if (held) {
    held.plugin = plugin
    held.owner = plugin
    holdPluginFocusSite(plugin, requestId, component, held.keys)
    return held
  }
  const next: PluginSite = {
    plugin,
    owner: plugin,
    requestId,
    component,
    keys: new Set(),
    offset: 0,
    maxOffset: 0,
    bodyRows: 0,
    contentRows: 0,
    followEnd: false,
  }
  fhState().pluginSites.push(next)
  fhState().ideSites.set(ideSiteKey(component, requestId), next)
  holdClientFaultMount(
    clientFaultSiteKey({
      surface: 'terminal',
      component,
      requestId,
    }),
  )
  holdPluginFocusSite(plugin, requestId, component, next.keys)
  return next
}

function applyPluginScrollSiteDims(
  site: PluginSite,
  dims?: PluginScrollSiteDims,
): void {
  if (dims === undefined) return
  if (dims.maxOffset !== undefined) site.maxOffset = dims.maxOffset
  if (dims.bodyRows !== undefined) site.bodyRows = dims.bodyRows
  if (dims.contentRows !== undefined) site.contentRows = dims.contentRows
  if (dims.followEnd !== undefined) site.followEnd = dims.followEnd
  if (dims.offset !== undefined) site.offset = dims.offset
  // densable followEnd latch — pin to end after wat success / dim growth.
  if (site.followEnd) {
    const pinned = Math.max(0, site.maxOffset)
    if (site.offset !== pinned) {
      site.offset = pinned
      bumpRasterFrames()
    } else {
      site.offset = pinned
    }
  }
}

function snapshotPluginScrollSite(site: PluginSite): PluginScrollSiteSnapshot {
  return {
    plugin: site.plugin,
    owner: site.owner,
    requestId: site.requestId,
    component: site.component,
    offset: site.offset,
    maxOffset: site.maxOffset,
    bodyRows: site.bodyRows,
    contentRows: site.contentRows,
    keyCount: site.keys.size,
    followEnd: site.followEnd,
  }
}

/**
 * densable `ZV(node, root)` — sum yoga computedTop from node up to root.
 * Walk off the tree → -1 (cEe then returns undefined).
 */
export function layoutOffsetTop(
  node: ScrollSiteLayoutNode,
  root: ScrollSiteLayoutNode,
): number {
  let top = 0
  let cur: ScrollSiteLayoutNode | undefined = node
  while (cur !== undefined && cur !== root) {
    top += cur.yogaNode?.getComputedTop() ?? 0
    cur = cur.parentNode
  }
  return cur === root ? top : -1
}

/**
 * densable `cEe(root, key, plugin)` — DFS walk of Ink tree for elementKey.
 * Skip the root itself; plugin match is optional when elementPlugin is absent.
 */
export function layoutKeyRows(
  root: ScrollSiteLayoutNode,
  key: string,
  plugin: string,
): { top: number; bottom: number } | undefined {
  const stack: ScrollSiteLayoutNode[] = [root]
  for (let node = stack.pop(); node; node = stack.pop()) {
    const attrs = node.attributes
    const elementKey =
      typeof attrs?.elementKey === 'string' ? attrs.elementKey : undefined
    const elementPlugin =
      typeof attrs?.elementPlugin === 'string' ? attrs.elementPlugin : undefined
    if (
      node !== root &&
      elementKey === key &&
      (elementPlugin === undefined || elementPlugin === plugin)
    ) {
      const top = layoutOffsetTop(node, root)
      const height = node.yogaNode?.getComputedHeight() ?? 0
      return top < 0 ? undefined : { top, bottom: top + height }
    }
    const kids = node.childNodes ?? []
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const child = kids[i]
      if (
        child &&
        typeof child === 'object' &&
        (child as ScrollSiteLayoutNode).nodeName !== '#text'
      ) {
        stack.push(child as ScrollSiteLayoutNode)
      }
    }
  }
  return undefined
}

/**
 * densable `OMr` — nearest block: keep in view if already visible, else
 * clamp start so the window covers as much of [top,bottom) as possible.
 */
export function nearestScrollOffset(input: {
  offset: number
  bodyRows: number
  top: number
  bottom: number
}): number {
  const { offset, bodyRows, top, bottom } = input
  const fit =
    bottom > offset + bodyRows
      ? Math.max(0, Math.min(top, bottom - bodyRows))
      : offset
  return top < offset ? top : fit
}

/**
 * densable `kat` — map key rows + bodyRows + block to a target offset.
 * Taller-than-viewport keys (`bottom-top > bodyRows`) always start at `top`.
 */
export function alignScrollToKeyRows(
  input: {
    offset: number
    bodyRows: number
    top: number
    bottom: number
  },
  block: TranscriptRevealBlock,
): number {
  const { bodyRows, top, bottom } = input
  if (bottom - top > bodyRows) return top
  switch (block) {
    case 'start':
      return top
    case 'end':
      return bottom - bodyRows
    case 'center':
      return top - Math.floor((bodyRows - (bottom - top)) / 2)
    case 'nearest':
      return nearestScrollOffset(input)
  }
}

/**
 * densable Ide `keyRows(plugin, key)` — yoga walk when contentRoot is bound;
 * else membership-only `{top:0,bottom:0}` (tests / pre-layout).
 */
export function scrollSiteKeyRows(
  site: PluginScrollSiteSnapshot | PluginSite,
  plugin: string,
  key: string,
): { top: number; bottom: number } | undefined {
  const held = 'keys' in site ? site : ideGet(site.component, site.requestId)
  if (!held || held.plugin !== plugin) return undefined
  // densable yEe keyRows = cEe(content, key, plugin) — yoga first, no keys.has.
  if (held.contentRoot !== undefined) {
    return layoutKeyRows(held.contentRoot, key, plugin)
  }
  if (!held.keys.has(key)) return undefined
  return { top: 0, bottom: 0 }
}

/** densable Ide site binds the Ink content root used by `keyRows`. */
export function bindPluginScrollSiteLayout(
  plugin: string,
  requestId: string,
  root: ScrollSiteLayoutNode | null,
  component?: PluginSite['component'],
): void {
  const held = ideGet(scrollSiteComponent(requestId, component), requestId)
  if (held === undefined || held.plugin !== plugin) return
  if (root === null) {
    held.contentRoot = undefined
    return
  }
  held.contentRoot = root
}

/**
 * densable Ide site `followEnd()` — latch + snap offset to maxOffset.
 * Bump raster so Pane/AbovePrompt hosts that paint site offset re-render.
 */
export function followPluginScrollSiteEnd(
  plugin: string,
  requestId: string,
  component?: PluginSite['component'],
): boolean {
  const held = ideGet(scrollSiteComponent(requestId, component), requestId)
  if (held === undefined || held.plugin !== plugin) return false
  held.followEnd = true
  held.offset = Math.max(0, held.maxOffset)
  bumpRasterFrames()
  return true
}

/**
 * densable `Jq` — held focused Ink node edge in content coords.
 * Stale index / missing content / walk-off → -1.
 */
export function heldFocusEdge(
  input: {
    held: { node: ScrollSiteLayoutNode; index: number } | null
    index: number | null
    content: ScrollSiteLayoutNode | null
  },
  edge: 'top' | 'bottom',
): number {
  const { held, index, content } = input
  if (
    held === null ||
    index === null ||
    held.index !== index ||
    content === null
  ) {
    return -1
  }
  const top = layoutOffsetTop(held.node, content)
  const height = held.node.yogaNode?.getComputedHeight() ?? 0
  return top < 0 ? -1 : top + (edge === 'bottom' ? height : 0)
}

function scrollSiteComponent(
  requestId: string,
  component?: PluginSite['component'],
): PluginSite['component'] {
  if (component !== undefined) return component
  return requestId === ABOVE_PROMPT_REQUEST_ID ? 'AbovePrompt' : 'Pane'
}

/**
 * densable Ide().set — register/hold a scroll site in `pluginSites`
 * keyed `component:requestId` (gold `Fj`). Person-origin commit/dispatch is
 * `commitPluginScrollSite` / `dispatchPersonUiScroll`.
 */
export function registerPluginScrollSite(
  plugin: string,
  requestId: string,
  component: PluginSite['component'],
  dims?: PluginScrollSiteDims,
): PluginScrollSiteSnapshot {
  const site = holdPluginSite(plugin, requestId, component)
  applyPluginScrollSiteDims(site, dims)
  return snapshotPluginScrollSite(site)
}

/** densable Ide().set field sync — update dims on an existing held site. */
export function updatePluginScrollSite(
  plugin: string,
  requestId: string,
  dims: PluginScrollSiteDims,
  component?: PluginSite['component'],
): PluginScrollSiteSnapshot | undefined {
  const held = ideGet(scrollSiteComponent(requestId, component), requestId)
  if (held === undefined || held.plugin !== plugin) return undefined
  applyPluginScrollSiteDims(held, dims)
  return snapshotPluginScrollSite(held)
}

/** densable Ide().delete lite — drop a held scroll site. */
export function unregisterPluginScrollSite(
  plugin: string,
  requestId: string,
  component?: PluginSite['component'],
): void {
  for (let i = fhState().pluginSites.length - 1; i >= 0; i--) {
    const site = fhState().pluginSites[i]
    if (
      site?.plugin === plugin &&
      site.requestId === requestId &&
      (component === undefined || site.component === component)
    ) {
      fhState().ideSites.delete(ideSiteKey(site.component, site.requestId))
      releaseClientFaultMount(
        clientFaultSiteKey({
          surface: 'terminal',
          component: site.component,
          requestId: site.requestId,
        }),
      )
      fhState().pluginSites.splice(i, 1)
    }
  }
  if (component === undefined) dropPluginFocusSite(plugin, requestId)
}

export function getPluginScrollSite(
  plugin: string,
  requestId: string,
  component?: PluginSite['component'],
): PluginScrollSiteSnapshot | undefined {
  const held = ideGet(scrollSiteComponent(requestId, component), requestId)
  if (held === undefined || held.plugin !== plugin) return undefined
  return snapshotPluginScrollSite(held)
}

/**
 * densable `Hde` — thin promise error swallow + debug log.
 * Semantic export only (never `Hde`).
 */
export function logUiScrollSettled<T>(
  label: string,
  promise: Promise<T>,
): Promise<T | undefined> {
  return promise.catch((err: unknown) => {
    const why = err instanceof Error ? err.message : String(err)
    logForDebugging(`${label}: ${why}`, { level: 'error' })
    return undefined
  })
}

/**
 * densable `Sat(site, origin)` — foreign plugin origin cannot move this site.
 * `Sat=(e,n)=>n.kind==="plugin"&&e.owner!==void 0&&e.owner!==n.name`
 */
export function isForeignPluginScrollOrigin(
  siteOwner: string | undefined,
  origin: PluginScrollOrigin | undefined,
): boolean {
  return (
    origin?.kind === 'plugin' &&
    siteOwner !== undefined &&
    siteOwner !== '' &&
    siteOwner !== origin.name
  )
}

/**
 * densable Ide site `commit` / `vq` — clamp offset; Sat ownership deny.
 * Returns `{ deny: 'no such site' }` / `{ deny: "not this plugin's site" }`.
 */
export function commitPluginScrollSite(
  plugin: string,
  requestId: string,
  offset: number,
  origin?: PluginScrollOrigin,
  component?: PluginSite['component'],
): { deny?: string } {
  const held = ideGet(scrollSiteComponent(requestId, component), requestId)
  if (held === undefined || held.plugin !== plugin) {
    return { deny: 'no such site' }
  }
  if (isForeignPluginScrollOrigin(held.owner ?? held.plugin, origin)) {
    return { deny: "not this plugin's site" }
  }
  const max = Math.max(0, held.maxOffset)
  const next = Math.max(0, Math.min(max, Math.floor(offset)))
  held.offset = next
  // densable Ide commit (Vt): always We(!1). Only wat / followEnd() arms.
  held.followEnd = false
  return {}
}

/**
 * densable yEe person-origin path — `Hde(label, QLt({input}))`.
 * Gold: handlers empty → `vq` commit; else `iZ` = function-hook chain with
 * bottom = commit. Local: `runFunctionHookChain('ui.scroll', …, vqTail)`.
 */
export function dispatchPersonUiScroll(
  input: PersonUiScrollInput,
): Promise<{ deny?: string } | undefined> {
  const label = `ui.scroll ${input.component} ${input.requestId}`
  const scrollInput = {
    component: input.component,
    requestId: input.requestId,
    offset: input.offset,
    by: input.by,
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    origin: { kind: 'person' as const },
    ...(input.pointer !== undefined && { pointer: input.pointer }),
  }
  const vqCommit = (): { deny?: string } => {
    // densable QLt person path — Ide Fj(component, requestId), not caller plugin.
    const held = ideGet(input.component, input.requestId)
    if (held === undefined) return { deny: 'no such site' }
    const committed = commitPluginScrollSite(
      held.plugin,
      input.requestId,
      input.offset,
      { kind: 'person' },
      input.component,
    )
    if (committed.deny !== undefined) return committed
    updatePluginScrollSite(
      held.plugin,
      input.requestId,
      {
        bodyRows: input.bodyRows,
        contentRows: input.contentRows,
      },
      input.component,
    )
    // densable yEe local Me re-renders immediately; Pane host reads
    // getShownPluginPane().offset from pluginSites — bump like scrollPluginPane.
    bumpRasterFrames()
    return {}
  }
  return logUiScrollSettled(
    label,
    runFunctionHookChain('ui.scroll', scrollInput, async () => {
      const result = vqCommit()
      logForDebugging(
        `ui.scroll ${input.component} ${input.requestId} (person) by ${input.by} to ${input.offset}: ${
          result.deny === undefined ? 'moved' : `denied (${result.deny})`
        }`,
      )
      return result
    }).then(value => {
      if (
        value !== null &&
        typeof value === 'object' &&
        'deny' in value &&
        typeof (value as { deny?: unknown }).deny === 'string'
      ) {
        return value as { deny: string }
      }
      return (value as { deny?: string } | undefined) ?? {}
    }),
  )
}

/**
 * densable `JC` / `ok` — CLI `ui_scroll` person-origin QLt.
 */
export async function runRemoteUiScroll(input: RemoteUiScrollInput): Promise<{
  result: { deny?: string }
  offset: number
  isFollowingEnd: boolean
}> {
  const held = ideGet(input.component, input.requestId)
  if (held === undefined) {
    return {
      result: { deny: 'no such site' },
      offset: input.offset,
      isFollowingEnd: false,
    }
  }
  const max = Math.max(0, held.contentRows - held.bodyRows, held.maxOffset)
  const before = held.followEnd ? max : Math.min(held.offset, max)
  const next = Math.min(Math.max(0, before + input.by), max)
  const result =
    (await dispatchPersonUiScroll({
      component: input.component,
      requestId: input.requestId,
      offset: next,
      by: input.by,
      bodyRows: input.bodyRows,
      contentRows: input.contentRows,
      plugin: held.plugin,
      ...(input.pointer !== undefined && { pointer: input.pointer }),
    })) ?? {}
  const after = ideGet(input.component, input.requestId)
  return {
    result,
    offset: result.deny !== undefined ? before : (after?.offset ?? next),
    isFollowingEnd: after?.followEnd === true,
  }
}

/**
 * densable `vC` — CLI `ui_focus`. Absent element reports hold only.
 */
export async function runRemoteUiFocus(input: RemoteUiFocusInput): Promise<{
  result: { deny?: string }
  element: { plugin: string; key: string } | null
}> {
  void input.clientId
  void input.isHeld
  const site = lookupFocusSite(input.component, input.requestId)
  if (input.element === undefined) {
    return {
      result: {},
      element:
        site?.holder !== undefined ? { plugin: site.holder, key: '' } : null,
    }
  }
  if (site === undefined) {
    return {
      result: { deny: 'no such site' },
      element: input.element,
    }
  }
  const origin =
    input.by === 'auto' && input.element !== null
      ? { kind: 'plugin' as const, name: input.element.plugin }
      : { kind: 'person' as const }
  const result = await Promise.resolve(
    dispatchUiFocus({
      component: input.component,
      requestId: input.requestId,
      origin,
      ...(input.element !== null && {
        plugin: input.element.plugin,
        element: input.element.key,
      }),
    }),
  )
  const after = lookupFocusSite(input.component, input.requestId)
  return {
    result,
    element:
      input.element !== null
        ? input.element
        : after?.holder !== undefined
          ? { plugin: after.holder, key: '' }
          : null,
  }
}

/**
 * densable `FS.moduleFor` / `EO` analog — scanned modules as the CLI payload.
 * Full import-map compile stays in the surface runtime; do not invent minify EO.
 */
export function clientModuleFor(plugin: string):
  | {
      plugin: string
      hash: string
      modules: Array<{ module: string; entry: string; component: string }>
      runtime: string
      limits: typeof SURFACE_LIMITS
      files: Array<{ key: string; source: string }>
    }
  | undefined {
  const mod = fhState().loadedModules.find(
    item => item.name === plugin && item.status !== 'unloaded',
  )
  const scanned =
    mod?.surfaceModules ?? getPluginSurfaceModules(plugin)?.modules
  if (mod === undefined || scanned === undefined || scanned.length === 0) {
    return undefined
  }
  const files = scanned.map(row => ({
    key: `surface:///${row.module.replaceAll('\\', '/')}`,
    source: row.source,
  }))
  const digest = createHash('sha256')
  digest.update(JSON.stringify(SURFACE_LIMITS))
  for (const file of files) {
    digest.update(file.key)
    digest.update('\0')
    digest.update(file.source)
  }
  return {
    plugin,
    hash: digest.digest('hex'),
    modules: scanned.map(row => ({
      module: row.module.replaceAll('\\', '/'),
      entry: `surface:///${row.module.replaceAll('\\', '/')}`,
      component: row.component,
    })),
    runtime: 'claude:surface-runtime',
    limits: SURFACE_LIMITS,
    files,
  }
}

/**
 * densable `I3` — CLI `ui_client_press`. Missing plugin → undefined.
 */
export async function runRemoteClientPress(
  input: RemoteClientPressInput,
): Promise<{ reached?: unknown } | undefined> {
  const loaded = fhState().loadedModules.some(
    item => item.name === input.plugin && item.status !== 'unloaded',
  )
  if (!loaded) {
    logForDebugging(
      `ui.${input.event.type}: no desktop Client ${input.plugin}/${input.key} (${input.module}) is drawn in ${input.component} ${input.requestId}; nothing ran`,
    )
    return undefined
  }
  let reached: unknown
  const base = {
    plugin: input.plugin,
    component: input.component,
    requestId: input.requestId,
    key: input.key,
    module: input.module,
    element: input.element,
    surface: 'desktop',
  }
  if (input.event.type === 'press') {
    await runFunctionHookChain('ui.press', base, async event => {
      reached = event
      return { element: (event as { element?: unknown }).element }
    })
  } else if (input.event.type === 'input') {
    await runFunctionHookChain(
      'ui.input',
      { ...base, kind: input.event.kind, value: input.event.value },
      async event => {
        reached = event
        return {
          element: (event as { element?: unknown }).element,
          value: (event as { value?: unknown }).value,
        }
      },
    )
  } else {
    await runFunctionHookChain(
      'ui.select',
      { ...base, value: input.event.value },
      async event => {
        reached = event
        return {
          element: (event as { element?: unknown }).element,
          value: (event as { value?: unknown }).value,
        }
      },
    )
  }
  return reached !== undefined ? { reached } : {}
}

/**
 * densable `O3` / `N1t` — CLI `ui_message`. Missing plugin → undefined.
 */
export async function runRemoteClientMessage(
  input: RemoteClientMessageInput,
): Promise<{ props?: unknown } | undefined> {
  const loaded = fhState().loadedModules.some(
    item => item.name === input.plugin && item.status !== 'unloaded',
  )
  if (!loaded) return undefined
  const answered = await dispatchClientMessage({
    plugin: input.plugin,
    surface: 'desktop',
    component: input.component,
    requestId: input.requestId,
    element: input.key,
    module: input.module,
    data: input.data,
  })
  if (
    answered !== null &&
    typeof answered === 'object' &&
    !Array.isArray(answered) &&
    'props' in answered
  ) {
    return { props: (answered as { props: unknown }).props }
  }
  return {}
}

/**
 * Record a drawn element key so ui.focus can hit it (gold focusSiteDraws).
 * Defaults Pane; AbovePrompt requestId (or explicit component) keeps Ide component.
 * Gold `g9e` focusSites Map (separate from scrollSites). XHo host overrides
 * hasElement/commit when bound; keys are the CLI fallback membership.
 */
export function noteDrawnElement(
  plugin: string,
  requestId: string,
  key: string,
  component?: PluginSite['component'],
): void {
  holdPluginSite(
    plugin,
    requestId,
    scrollSiteComponent(requestId, component),
  ).keys.add(key)
  fhState().focusSiteDraws.emit()
}

function asScrollResult(value: unknown): { deny?: string } {
  if (
    value !== null &&
    typeof value === 'object' &&
    'deny' in value &&
    typeof (value as { deny?: unknown }).deny === 'string'
  ) {
    return { deny: (value as { deny: string }).deny }
  }
  return (value as { deny?: string } | undefined) ?? {}
}

/**
 * densable `h` / `QLt` — clamp offset, plugin-origin hook chain then vq commit.
 */
function dispatchPluginScrollOffset(
  site: PluginSite,
  next: number,
  owner: string,
): { deny?: string } | Promise<{ deny?: string }> {
  const clamped = Math.max(0, Math.min(site.maxOffset, next))
  const by = clamped - site.offset
  const origin = { kind: 'plugin' as const, name: owner }
  const vqCommit = (): { deny?: string } => {
    const committed = commitPluginScrollSite(
      owner,
      site.requestId,
      clamped,
      origin,
      site.component,
    )
    if (committed.deny !== undefined) return committed
    updatePluginScrollSite(
      owner,
      site.requestId,
      {
        bodyRows: site.bodyRows,
        contentRows: site.contentRows,
      },
      site.component,
    )
    // densable yEe Vt/Ie updates Me for plugin origin too; Pane needs bump.
    bumpRasterFrames()
    return {}
  }
  if (!hasMatchingFunctionHook('ui.scroll')) {
    const result = vqCommit()
    logForDebugging(
      `ui.scroll ${site.component} ${site.requestId} (plugin) by ${by} to ${clamped}: ${
        result.deny === undefined ? 'moved' : `denied (${result.deny})`
      }`,
    )
    return result
  }
  return runFunctionHookChain(
    'ui.scroll',
    {
      component: site.component,
      requestId: site.requestId,
      offset: clamped,
      by,
      bodyRows: site.bodyRows,
      contentRows: site.contentRows,
      origin,
    },
    async () => vqCommit(),
  ).then(asScrollResult)
}

function armFollowEndAfterWat(
  site: PluginSite,
  owner: string,
  result: { deny?: string } | Promise<{ deny?: string }>,
): { deny?: string } | Promise<{ deny?: string }> {
  const arm = (): void => {
    const live = ideGet(site.component, site.requestId)
    if (
      live !== undefined &&
      live.plugin === owner &&
      live.offset === Math.min(live.maxOffset, live.maxOffset)
    ) {
      followPluginScrollSiteEnd(owner, live.requestId, live.component)
    }
  }
  if (result instanceof Promise) {
    return result.then(row => {
      if (row.deny === undefined) arm()
      return row
    })
  }
  if (result.deny === undefined) arm()
  return result
}

export function runUiScroll(
  input: Record<string, unknown>,
  plugin?: string,
): { deny?: string } | Promise<{ deny?: string }> {
  const owner = plugin ?? ''
  const to = input.to
  const inn = typeof input.in === 'string' ? input.in : undefined
  const owned = sitesOf(owner, inn)
  if (inn !== undefined && owned.length === 0) {
    return { deny: "not this plugin's site" }
  }
  if (to === 'start' || to === 'end') {
    const [site] = owned
    if (!site) return { deny: "not this plugin's site" }
    if (to === 'start') return dispatchPluginScrollOffset(site, 0, owner)
    // densable wat — QLt to maxOffset then followEnd() when still at end.
    return armFollowEndAfterWat(
      site,
      owner,
      dispatchPluginScrollOffset(site, site.maxOffset, owner),
    )
  }
  if (isEventRecord(to) && typeof to.key === 'string') {
    // densable bat + kat + QLt — keyRows yoga walk, then commit offset.
    const key = to.key
    const hit = owned
      .map(site => {
        const rows = scrollSiteKeyRows(site, owner, key)
        return rows === undefined ? undefined : { site, rows }
      })
      .find(row => row !== undefined)
    if (!hit) return { deny: 'no element of its own is drawn under that key' }
    const rawBlock = input.block
    const block: TranscriptRevealBlock =
      rawBlock === 'start' ||
      rawBlock === 'center' ||
      rawBlock === 'end' ||
      rawBlock === 'nearest'
        ? rawBlock
        : 'nearest'
    const target = alignScrollToKeyRows(
      {
        offset: hit.site.offset,
        bodyRows: hit.site.bodyRows,
        ...hit.rows,
      },
      block,
    )
    return dispatchPluginScrollOffset(hit.site, target, owner)
  }
  if (isEventRecord(to) && typeof to.requestId === 'string') {
    // densable s0n: own plugin site → cannot scroll "around" it; else vat.
    if (sitesOf(owner, to.requestId).length > 0) {
      return { deny: 'nothing around that site scrolls' }
    }
    const rawBlock = input.block
    const block: TranscriptRevealBlock =
      rawBlock === 'start' ||
      rawBlock === 'center' ||
      rawBlock === 'end' ||
      rawBlock === 'nearest'
        ? rawBlock
        : 'nearest'
    // densable vat — person gate (dZ) + transcript.reveal alphabet.
    // Gold stamps origin/rootEvent via hostOps; local press ALS supplies
    // rootEvent via getLivePressEvent() when $.ui.scroll runs inside
    // ui.press|input|select answering.
    const livePress = getLivePressEvent()
    const rootEvent =
      typeof input.rootEvent === 'string' ? input.rootEvent : livePress
    const isPersonInput = input.isPersonInput === true
    const origin =
      input.origin !== undefined
        ? input.origin
        : [{ kind: 'plugin', name: owner }]
    return scrollTranscriptByRequestId(to.requestId, block, {
      plugin: owner,
      origin,
      isPersonInput,
      rootEvent,
    })
  }
  return { deny: "not this plugin's site" }
}

function lookupFocusSite(
  component: PluginSite['component'],
  requestId: string,
): PluginFocusSite | undefined {
  return fhState().pluginFocusSites.get(focusSiteMapKey(component, requestId))
}

function siteHasElement(
  site: PluginFocusSite,
  plugin: string,
  element: string,
): boolean {
  if (site.host) return site.host.hasElement(plugin, element)
  return site.keys.has(element)
}

/** densable `dUe` — plugins whose `ui.render` matcher matches `{component}`. */
function pluginsWithUiRenderComponent(component: string): string[] {
  return fhState()
    .loadedModules.filter(mod => {
      const builtin = isBuiltinTierMod(mod)
      return (mod.hooks ?? []).some(
        hook =>
          (functionHookPatternMatches(hook.pattern, 'ui.render') ||
            functionHookPatternMatches(hook.pattern, 'classic.ui.render')) &&
          matcherAllows(hook.matcher, { component }, 'ui.render', builtin),
      )
    })
    .map(mod => mod.name)
}

/**
 * densable `Rae` — map requestId + plugin to Pane/AbovePrompt site identity.
 * Pane if that plugin has the id open; AbovePrompt if requestId is vG and
 * dUe("AbovePrompt") includes the plugin. Else undefined (do not invent g9e).
 */
function resolveFocusSiteTarget(
  requestId: string,
  plugin: string,
): { component: PluginSite['component']; requestId: string } | undefined {
  const paneOpen = getPanesState().open.some(
    pane => pane.plugin === plugin && pane.id === requestId,
  )
  const above =
    requestId === ABOVE_PROMPT_REQUEST_ID &&
    pluginsWithUiRenderComponent('AbovePrompt').includes(plugin)
  const component: PluginSite['component'] | undefined = paneOpen
    ? 'Pane'
    : above
      ? 'AbovePrompt'
      : undefined
  if (component === undefined) return undefined
  return { component, requestId }
}

/**
 * densable `V$t` — lSo waiter ready predicate.
 * Identity missing / nested ui.render|ui.focus / unshown pane with no
 * placements → ready (do not wait). Else wait until held+hasElement.
 */
function isFocusSiteReady(
  input: { requestId: string; key: string },
  ctx: PluginFocusHookCtx,
): boolean {
  const target = resolveFocusSiteTarget(input.requestId, ctx.plugin)
  const site = target
    ? lookupFocusSite(target.component, target.requestId)
    : undefined
  const panes = getPanesState()
  const aboveExists =
    lookupFocusSite('AbovePrompt', ABOVE_PROMPT_REQUEST_ID) !== undefined
  const pendingFocus = panes.focusRequest === input.requestId && aboveExists
  const isPane = target?.component === 'Pane'
  if (
    target === undefined ||
    ctx.rootEvent === 'ui.render' ||
    ctx.rootEvent === 'ui.focus' ||
    (isPane
      ? panes.placements === 0 ||
        (panes.shownId !== input.requestId && !pendingFocus)
      : site === undefined)
  ) {
    return true
  }
  if (site === undefined || pendingFocus) return false
  const origin = { kind: 'plugin' as const, name: ctx.plugin }
  return (
    !focusSiteIsHeldNow(site) ||
    isForeignFocusHolder(site, origin) ||
    siteHasElement(site, ctx.plugin, input.key)
  )
}

/**
 * densable `Y$t`/`X$t` — wait until `ready` or timeout, woken by focusSiteDraws + panes.
 */
async function waitForFocusSiteDraw(
  ready: () => boolean,
  signal?: AbortSignal,
  budgetMs = FOCUS_SITE_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!ready() && signal?.aborted !== true) {
    const left = deadline - Date.now()
    if (left <= 0) return
    await new Promise<void>(resolve => {
      const ac = new AbortController()
      const finish = (): void => {
        ac.abort()
        resolve()
      }
      const unsubDraw = subscribePluginFocusSiteDraws(finish)
      const unsubPanes = subscribePanes(finish)
      const timer = setTimeout(finish, left)
      const onAbort = (): void => finish()
      signal?.addEventListener('abort', onAbort, { once: true })
      ac.signal.addEventListener(
        'abort',
        () => {
          unsubDraw()
          unsubPanes()
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        },
        { once: true },
      )
    })
  }
}

function asFocusResult(value: unknown): { deny?: string } {
  if (
    value !== null &&
    typeof value === 'object' &&
    'deny' in value &&
    typeof (value as { deny?: unknown }).deny === 'string'
  ) {
    return { deny: (value as { deny: string }).deny }
  }
  return (value as { deny?: string } | undefined) ?? {}
}

function fallbackFocusCommit(
  site: PluginFocusSite,
  input: PluginFocusDispatchInput,
): string | undefined {
  const element = input.element
  if (element === undefined || element === '') return 'no element named'
  if (!site.keys.has(element)) {
    return `no element of ${input.plugin ?? ''} is drawn under that key`
  }
  fhState().focusedPaneId = site.requestId
  if (site.component === 'Pane') fhState().shownPaneId = site.requestId
  site.holder = input.plugin ?? site.holder
  fhState().paneFocusRequest = null
  notifyPanesListeners()
  bumpRasterFrames()
  return undefined
}

/**
 * densable `Tq` — g9e lookup, yat, isHeldNow, x$, commit.
 */
function commitUiFocus(input: PluginFocusDispatchInput): { deny?: string } {
  const site = lookupFocusSite(input.component, input.requestId)
  if (!site) return { deny: 'no such site' }
  if (isForeignPluginFocusSite(site, input.origin, input.plugin ?? '')) {
    return { deny: "not this plugin's site" }
  }
  if (!focusSiteIsHeldNow(site)) {
    return { deny: 'that site does not hold the keyboard' }
  }
  if (isForeignFocusHolder(site, input.origin)) {
    return { deny: "another plugin's element holds the keyboard" }
  }
  const deny = site.host
    ? site.host.commit({
        plugin: input.plugin ?? '',
        element: input.element,
        origin: input.origin,
      })
    : fallbackFocusCommit(site, input)
  if (deny !== undefined) return { deny }
  if (site.host && input.plugin !== undefined && input.plugin !== '') {
    site.holder = input.plugin
  }
  return {}
}

/**
 * densable `idn` — ui.focus hook chain then Tq. Empty handlers → sync Tq
 * (XHo `ve` treats non-Promise as already settled). Abort on the hook path
 * → `{ deny: "the move was abandoned" }`.
 */
export function dispatchUiFocus(
  input: PluginFocusDispatchInput,
  options?: { signal?: AbortSignal },
): Promise<{ deny?: string }> | { deny?: string } {
  const signal = options?.signal
  const hasHooks = hasMatchingFunctionHook('ui.focus')
  const apply = (event: PluginFocusDispatchInput): { deny?: string } => {
    if (signal?.aborted === true && hasHooks) {
      return { deny: 'the move was abandoned' }
    }
    return commitUiFocus(event)
  }
  if (!hasHooks) return apply(input)
  return runFunctionHookChain(
    'ui.focus',
    {
      component: input.component,
      requestId: input.requestId,
      ...(input.plugin !== undefined && { plugin: input.plugin }),
      ...(input.element !== undefined && { element: input.element }),
      origin: input.origin,
    },
    async event =>
      apply({
        component:
          event.component === 'AbovePrompt' || event.component === 'Pane'
            ? event.component
            : input.component,
        requestId:
          typeof event.requestId === 'string'
            ? event.requestId
            : input.requestId,
        plugin: typeof event.plugin === 'string' ? event.plugin : input.plugin,
        element:
          typeof event.element === 'string' ? event.element : input.element,
        origin: input.origin,
      }),
  ).then(asFocusResult)
}

/**
 * densable `lSo` — plugin `ui.focus` `{requestId,key}`: wait V$t, then
 * Rae/mO gates, then idn/Tq. Missing identity → `"not this plugin's site"`.
 * Missing key after wait → `"no element of its own is drawn under that key"`.
 */
export async function runUiFocus(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<{ deny?: string }> {
  const caller =
    (typeof input.plugin === 'string' && input.plugin !== ''
      ? input.plugin
      : plugin) ?? ''
  const requestId = String(input.requestId ?? '')
  const key = String(input.key ?? '')
  const signal = input.signal instanceof AbortSignal ? input.signal : undefined
  const ctx: PluginFocusHookCtx = {
    plugin: caller,
    origin: input.origin,
    signal,
    ...(typeof input.rootEvent === 'string' && { rootEvent: input.rootEvent }),
  }
  await waitForFocusSiteDraw(
    () => isFocusSiteReady({ requestId, key }, ctx),
    signal,
  )
  const target = resolveFocusSiteTarget(requestId, caller)
  const site = target
    ? lookupFocusSite(target.component, target.requestId)
    : undefined
  const origin = { kind: 'plugin' as const, name: caller }
  if (!site) return { deny: "not this plugin's site" }
  if (!focusSiteIsHeldNow(site)) {
    return { deny: 'that site does not hold the keyboard' }
  }
  if (isForeignFocusHolder(site, origin)) {
    return { deny: "another plugin's element holds the keyboard" }
  }
  if (!siteHasElement(site, caller, key)) {
    return { deny: 'no element of its own is drawn under that key' }
  }
  return dispatchUiFocus(
    {
      component: site.component,
      requestId: site.requestId,
      plugin: caller,
      element: key,
      origin,
    },
    { signal },
  )
}
