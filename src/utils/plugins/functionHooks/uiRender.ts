/**
 * Function hooks submodule: uiRender
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { getRenderVersion } from '../../render/invalidateAllRenders.js'
import {
  formatDrawnPlainLinks,
  rewriteDrawnLinksToPlainText,
} from '../pluginLinkHref.js'
import { invalidatePluginToolList } from '../pluginToolList.js'
import {
  bindUiSelectionSource,
  getKeptUiSelection,
  getUiSelectionRowHolding,
  selectionAnswer,
  toUiSelection,
} from '../uiSelectionRowHolding.js'
import { Ns, getClipboardPath } from '@anthropic/ink'
import {
  FAULT_RENDER_FV,
  OSC52_WRITE_BOUND,
  UI_INVALIDATE_EVENTS,
  UI_RENDER_ENGINE_FALLBACK,
  UI_RENDER_EVAL_CAP,
  UI_SURFACES,
  firstRecord,
  formatPluginStatusText,
  hostCheck,
  hostTextCheck,
  isEventRecord,
  osc52Payload,
  paneIdCheck,
  paneTitleHoldsControl,
} from './constants.js'
import {
  bumpFaultRenderFv,
  clientFaultLue,
  clientFaultPace,
  clientFaultSiteKey,
  invalidatePluginRender,
  noteAbortedUiRender,
  noteSlowUiRender,
  recordDrawingReaders,
  uiRenderPluginNames,
} from './faultRender.js'
import { computeDrawingFingerprint } from './heldPressStore.js'
import { runFunctionHookChain } from './hookChain.js'
import {
  dropPluginPane,
  getPanesState,
  hasAskedPane,
  notifyPanesListeners,
  placementAtOpen,
  rememberAskedPane,
  seedAskedPanes,
} from './panes.js'
import {
  collectHeldPressButtons,
  releaseDrawingButtons,
  releasePresses,
  stampPluginOnDrawing,
} from './press.js'
import {
  RASTER_BLITS_PER_WINDOW,
  decodeRasterCells,
  imageSourceProblem,
  mountSiteKey,
} from './raster.js'
import {
  bumpRasterFrames,
  fhState,
  getResolvedAnswer,
  isInsideHookEval,
  runtimeBridge,
  uiRenderDrawingAls,
} from './state.js'
import type {
  ClientFaultSite,
  PluginPaneEntry,
  UiAskHostInput,
  UiRenderDrawing,
  UiRenderEvalRecord,
} from './types.js'
import { fillWithheldUiResolveTable, makeUiResolveTable } from './uiResolve.js'
import {
  anotherPluginOwns,
  blitUnmountedDeny,
  holdPluginSite,
  runUiFocus,
  runUiScroll,
  takeBlitSlot,
  walkUiMounts,
} from './uiSites.js'
import {
  acceptAskUserQuestionRewrite,
  clipRewrittenUiRenderProps,
  isEngineDrawing,
  logUiRenderRefused,
  stripUnknownBoxBorderStyles,
  uiRenderArgCheck,
  uiRenderDialogRowsCheck,
  uiRenderDrawingPlainCheck,
  uiRenderEnginePropsCheck,
  uiRenderHoverCheck,
  uiRenderModPropsCheck,
  uiRenderTreeCheck,
} from './uiValidation.js'

export async function runUiAsk(
  args: unknown[],
  plugin?: string,
): Promise<unknown> {
  // densable vCe(js): object whose tool is AskUserQuestion.
  const input = firstRecord(args)
  if (!input || input.tool !== 'AskUserQuestion') {
    hostCheck('ui.ask', "takes the AskUserQuestion tool's input", plugin)
  }
  const questions = Array.isArray(input.questions)
    ? (input.questions as UiAskHostInput['questions'])
    : []
  const askHostHandler = fhState().uiAskHostHandler
  if (askHostHandler) {
    return askHostHandler({
      tool: 'AskUserQuestion',
      questions,
    })
  }
  const askHandler = fhState().uiAskHandler
  if (askHandler) {
    const first = questions[0]
    const question = first?.question ?? ''
    const options = (first?.options ?? []).map(option => option.label)
    const answer = await askHandler(question, options)
    return { result: { answers: { [question]: answer } } }
  }
  const answers: Record<string, string> = {}
  for (const question of questions) {
    answers[question.question] = question.options[0]?.label ?? ''
  }
  return { result: { answers } }
}

/** densable `sBo` — per-MD eval cache; drop on abort if still this record. */
/** densable `sBo` `n` — last stamped HD Map identity. */
/** densable `sBo` `r` — last stamped Fv engineVersion. */
/** densable `sBo` `s` / `reused()`. */

/** densable `d8n` — `props.onScreen` `{first,last,of}` or null. */
function uiRenderOnScreen(input: Record<string, unknown>): unknown {
  const props = isEventRecord(input.props) ? input.props : undefined
  if (props === undefined || !Object.hasOwn(props, 'onScreen')) return undefined
  const n = props.onScreen
  if (n === null) return null
  if (!isEventRecord(n)) return undefined
  const first = n.first
  const last = n.last
  const of = n.of
  if (
    typeof first === 'number' &&
    typeof last === 'number' &&
    typeof of === 'number'
  ) {
    return { first, last, of }
  }
  return undefined
}

/** densable `egn` / `u8n` propsKey (viewport + props). */
function uiRenderPropsKey(input: Record<string, unknown>): string {
  const viewport = isEventRecord(input.viewport) ? input.viewport : undefined
  const columns = viewport?.columns ?? ''
  const isFullscreen = viewport?.isFullscreen ?? ''
  const props = isEventRecord(input.props) ? input.props : {}
  return [
    columns,
    isFullscreen,
    JSON.stringify(props),
    JSON.stringify(uiRenderOnScreen(input) ?? null),
  ].join('\0')
}

/** densable `l8n` — settled + propsKey + HD identity + Lue version. */
function uiRenderEvalFits(
  rec: UiRenderEvalRecord,
  propsKey: string,
  version: string,
): boolean {
  const { faultRenderVersions } = fhState()
  return (
    rec.settled !== undefined &&
    rec.propsKey === propsKey &&
    rec.versions === faultRenderVersions &&
    rec.version === version
  )
}

/** densable `sBo` `countReuse`. */
function countReuse(): void {
  fhState().uiRenderEvalReuseCount += 1
}

function rememberUiRenderEval(md: string, rec: UiRenderEvalRecord): void {
  if (
    rec.versions !== fhState().uiRenderEvalHd ||
    rec.engineVersion !== fhState().uiRenderEvalEngineVersion
  ) {
    fhState().uiRenderEvalCache.clear()
    fhState().uiRenderEvalHd = rec.versions
    fhState().uiRenderEvalEngineVersion = rec.engineVersion
  }
  fhState().uiRenderEvalCache.delete(md)
  fhState().uiRenderEvalCache.set(md, rec)
  for (const key of fhState().uiRenderEvalCache.keys()) {
    if (fhState().uiRenderEvalCache.size <= UI_RENDER_EVAL_CAP) break
    fhState().uiRenderEvalCache.delete(key)
  }
}

function rememberUiRenderDrawing(
  plugin: string,
  component: string,
  requestId: string,
  tree: unknown,
): void {
  const outgoing = fhState().pluginDrawings.filter(
    drawing =>
      drawing.component === component && drawing.requestId === requestId,
  )
  for (const drawing of outgoing) {
    releaseDrawingButtons(drawing.tree, drawing.plugin, component, requestId)
  }
  fhState().pluginDrawings.splice(
    0,
    fhState().pluginDrawings.length,
    ...fhState().pluginDrawings.filter(
      drawing =>
        !(drawing.component === component && drawing.requestId === requestId),
    ),
  )
  const site = { component, requestId, surface: 'terminal' }
  if (
    isEngineDrawing(tree) ||
    tree === undefined ||
    tree === null ||
    typeof tree === 'string'
  ) {
    // densable bo(e): release held presses when site reverts to engine/empty.
    for (const name of fhState().heldPressStore.holdersOf(site)) {
      const { released } = fhState().heldPressStore.holdDrawing(name, site, [])
      if (released.length > 0) {
        releasePresses(name, released, { component, requestId })
      }
    }
    bumpRasterFrames()
    return
  }
  fhState().pluginDrawings.push({
    plugin,
    requestId,
    component,
    tree,
  })
  const grouped = collectHeldPressButtons(tree)
  const plugins = new Set([
    ...fhState().heldPressStore.holdersOf(site),
    ...grouped.keys(),
  ])
  const drawnFingerprint = computeDrawingFingerprint(tree)
  for (const name of plugins) {
    const { released } = fhState().heldPressStore.holdDrawing(
      name,
      { ...site, drawn: drawnFingerprint },
      grouped.get(name) ?? [],
    )
    if (released.length > 0) {
      releasePresses(name, released, { component, requestId })
    }
  }
  walkUiMounts(tree, plugin, requestId)
  bumpRasterFrames()
}

/**
 * densable `ar` / `Hoe().ui.render` / `OPe`: run `ui.render` hooks, stamp
 * Raster/Image (`Te`), keep the tree for the matching `nWt(xI(component))`
 * site. Engine fallback is `{type:"engine",ref:0}` (`sMe` / `Fhe`).
 */
function cloneUiRenderBaselineValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(cloneUiRenderBaselineValue(item, seen))
    return out
  }
  if (!isEventRecord(value)) return value
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, entry] of Object.entries(value)) {
    out[key] = cloneUiRenderBaselineValue(entry, seen)
  }
  return out
}

export async function evaluateUiRender(
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const reason = uiRenderArgCheck(input)
  if (reason !== undefined) throw new Error(reason)
  const component = String(input.component)
  const requestId = typeof input.requestId === 'string' ? input.requestId : ''
  const surface = typeof input.surface === 'string' ? input.surface : 'terminal'
  const originalEngineProps = isEventRecord(input.props)
    ? (cloneUiRenderBaselineValue(input.props) as Record<string, unknown>)
    : {}
  // densable `gSt()`: already inside a hook-chain eval → skip sBo, dispatch FBr.
  const skipCache = isInsideHookEval()
  const drawingSite: ClientFaultSite = { surface, component, requestId }
  const drawing: UiRenderDrawing = {
    instanceKey: clientFaultSiteKey(drawingSite),
    instance: drawingSite,
    versionsRead: new Map(),
    isEnded: false,
  }
  const md = clientFaultSiteKey(drawingSite)
  const propsKey = uiRenderPropsKey(input)
  const version = clientFaultLue(drawingSite)
  const previous =
    skipCache || requestId === ''
      ? undefined
      : fhState().uiRenderEvalCache.get(md)
  if (
    !skipCache &&
    previous !== undefined &&
    uiRenderEvalFits(previous, propsKey, version)
  ) {
    countReuse()
    logForDebugging(
      `ui.render (${component} ${requestId}): ${surface} reuses its settled evaluation (one dispatch per draw)`,
    )
    return previous.settled
  }
  // densable `Wkt` false → `Fhe`/`sMe`. Empty classic chain's tail is that.
  // densable `jBr` `D=Date.now()` around `FBr`; `U2` after settle when live;
  // `W2` on abort if `!Q.settled`.
  const startedAt = Date.now()
  const liveNames =
    clientFaultPace(drawingSite) === 'live'
      ? uiRenderPluginNames(drawingSite)
      : []
  let settled = false
  const evalRecord: UiRenderEvalRecord | undefined =
    skipCache || requestId === ''
      ? undefined
      : {
          propsKey,
          version,
          settled: undefined,
          versions: fhState().faultRenderVersions,
          engineVersion:
            fhState().faultRenderVersions.get(FAULT_RENDER_FV) ??
            getRenderVersion(FAULT_RENDER_FV) ??
            0,
        }
  if (evalRecord !== undefined) rememberUiRenderEval(md, evalRecord)
  const onAbort = (): void => {
    if (!settled) {
      if (
        evalRecord !== undefined &&
        fhState().uiRenderEvalCache.get(md) === evalRecord
      ) {
        fhState().uiRenderEvalCache.delete(md)
      }
      noteAbortedUiRender(liveNames, Date.now() - startedAt)
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  let drawn: unknown
  try {
    drawn = await uiRenderDrawingAls.run(drawing, () =>
      runFunctionHookChain(
        'ui.render',
        input,
        async () => UI_RENDER_ENGINE_FALLBACK,
      ),
    )
  } finally {
    drawing.isEnded = true
  }
  settled = true
  signal?.removeEventListener('abort', onAbort)
  // densable FBr: `if(e.requestId!==""&&!n.aborted)jC(g)` after the chain.
  if (requestId !== '' && !signal?.aborted) recordDrawingReaders(drawing)
  const plugin = fhState().lastUiRenderPlugin
  const tree = stampPluginOnDrawing(drawn, plugin)
  const treeReason = uiRenderTreeCheck(tree)
  if (treeReason !== undefined) {
    logUiRenderRefused(component, treeReason)
    throw new Error(treeReason)
  }
  const drawingReason = uiRenderDrawingPlainCheck(tree, plugin)
  if (drawingReason !== undefined) {
    logUiRenderRefused(component, drawingReason)
    throw new Error(drawingReason)
  }
  const hoverReason = uiRenderHoverCheck(tree)
  if (hoverReason !== undefined) {
    logUiRenderRefused(component, hoverReason)
    throw new Error(hoverReason)
  }
  const modPropsReason = uiRenderModPropsCheck(tree)
  if (modPropsReason !== undefined) {
    logUiRenderRefused(component, modPropsReason)
    throw new Error(modPropsReason)
  }
  const rowsReason = uiRenderDialogRowsCheck(tree, component, surface)
  if (rowsReason !== undefined) {
    logUiRenderRefused(component, rowsReason)
    throw new Error(rowsReason)
  }
  if (
    isEventRecord(tree) &&
    tree.type === 'engine' &&
    tree !== UI_RENDER_ENGINE_FALLBACK
  ) {
    if (!isEventRecord(tree.props)) {
      const missingPropsReason = 'no { props } (an object)'
      logUiRenderRefused(component, missingPropsReason)
      throw new Error(missingPropsReason)
    }
    const propsReason = uiRenderEnginePropsCheck(tree.props, {
      component,
      props: originalEngineProps,
    })
    if (propsReason !== undefined) {
      logUiRenderRefused(component, propsReason)
      throw new Error(propsReason)
    }
  }
  const clippedTree =
    isEventRecord(tree) &&
    tree.type === 'engine' &&
    tree !== UI_RENDER_ENGINE_FALLBACK
      ? clipRewrittenUiRenderProps(tree, input, component)
      : tree
  const accepted = stripUnknownBoxBorderStyles(
    acceptAskUserQuestionRewrite(clippedTree, input, component),
  )
  // densable `i8n` / `eBo` — Vmn-failing Links become Text; pane keeps drawing.
  drawn = rewriteDrawnLinksToPlainText(accepted, surface, problems => {
    logForDebugging(formatDrawnPlainLinks(component, problems), {
      level: 'warn',
    })
  })
  rememberUiRenderDrawing(plugin, component, requestId, drawn)
  if (evalRecord !== undefined && !signal?.aborted) {
    evalRecord.settled = drawn
  }
  // densable `!V` U2 — previous cache occupied this MD (stale replace).
  if (liveNames.length > 0 && !signal?.aborted && previous !== undefined) {
    noteSlowUiRender(liveNames, Date.now() - startedAt)
  }
  return drawn
}

export function runInterfaceCall(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown> {
  if (
    typeof input.name !== 'string' ||
    typeof input.method !== 'string' ||
    !Array.isArray(input.args)
  ) {
    hostCheck('interface.call', 'takes { owner, name, method, args }', plugin)
  }
  if (input.args.length > 1) {
    hostCheck('interface.call', "takes one input, its event's e", plugin)
  }
  const owner = typeof input.owner === 'string' ? input.owner : (plugin ?? '')
  return runtimeBridge.callPluginInterface(
    owner,
    { name: String(input.name), method: String(input.method) },
    input.args,
  )
}

export async function runUiHost(
  op: string,
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown> {
  if (op === 'ui.invalidate') {
    const event = input.event
    if (
      typeof event !== 'string' ||
      !(UI_INVALIDATE_EVENTS as readonly string[]).includes(event)
    ) {
      hostCheck(
        op,
        'takes "ui.render", "prompt.section", "prompt.context", "prompt.attachment", "tool.describe", "tool.list", "command.describe" or "config.describe"',
        plugin,
      )
    }
    switch (event) {
      case 'ui.render':
        // densable `budgets.renders.invalidate(r.plugin)` (`jis`).
        if (typeof plugin === 'string' && plugin !== '') {
          invalidatePluginRender(plugin)
        } else {
          bumpFaultRenderFv()
          bumpRasterFrames()
        }
        break
      case 'prompt.section':
      case 'prompt.context':
      case 'prompt.attachment':
      case 'tool.describe':
      case 'tool.list':
        fhState().pendingUiInvalidations.add(event)
        invalidatePluginToolList()
        break
      case 'command.describe':
      case 'config.describe':
        fhState().pendingUiInvalidations.add(event)
        break
    }
    return undefined
  }
  if (op === 'ui.open') {
    const idReason = paneIdCheck(input.id)
    if (idReason !== undefined) hostCheck(op, idReason, plugin)
    if (input.title !== undefined) {
      const titleCheck = hostTextCheck(input.title)
      if (titleCheck !== undefined) hostCheck(op, titleCheck, plugin)
      if (
        typeof input.title === 'string' &&
        paneTitleHoldsControl(input.title)
      ) {
        hostCheck(op, 'title holds a control character', plugin)
      }
    }
    for (const key of ['focus', 'closeOnEscape', 'holdToasts'] as const) {
      if (input[key] !== undefined && input[key] !== true) {
        hostCheck(op, `${key} is true or left out`, plugin)
      }
    }
    for (const key of ['rows', 'columns'] as const) {
      const value = input[key]
      if (
        value !== undefined &&
        !(typeof value === 'number' && Number.isInteger(value) && value > 0)
      ) {
        hostCheck(
          op,
          `${key} is a positive whole number or left out (got ${String(value)})`,
          plugin,
        )
      }
    }
    // densable eNo + ee — seed asked, placementAtOpen column gate, unplaced waiters.
    seedAskedPanes()
    const id = String(input.id)
    const owner = plugin ?? ''
    const title = typeof input.title === 'string' ? input.title : id
    const askedRef = { plugin: owner, id }
    // densable dZ force: person-origin / ui.press|input|select. Local hostOp
    // has no hookOrigin bag — treat explicit force:true as person open.
    const force = input.force === true
    // densable eNo: already in open → skip ee (`x=ie?{isPlaced:!0}:ee`).
    const alreadyOpen = fhState().paneOpenIds.has(id)
    const placement = alreadyOpen
      ? ({ isPlaced: true } as const)
      : placementAtOpen(getPanesState(), askedRef, force)
    const next: PluginPaneEntry = {
      id,
      plugin: owner,
      title,
      ...(input.closeOnEscape === true && { closeOnEscape: true }),
      ...(input.holdToasts === true && { holdToasts: true }),
      ...(typeof input.rows === 'number' && { rows: input.rows }),
      ...(typeof input.columns === 'number' && { columns: input.columns }),
    }
    if (!hasAskedPane(getPanesState(), askedRef) && force) {
      rememberAskedPane(askedRef)
    }
    if (placement.isPlaced) {
      // densable `b(e,r,n)`: already-open keeps shownId; new open uses
      // focusedId ?? id. focusedId is never written here — only focus:true
      // queues focusRequest for AbovePrompt a4n settle.
      const held = fhState().pluginPanes.find(pane => pane.id === id)
      if (held) {
        const at = fhState().pluginPanes.indexOf(held)
        fhState().pluginPanes[at] = { ...next, plugin: held.plugin }
      } else {
        fhState().pluginPanes.push(next)
      }
      holdPluginSite(next.plugin, id, 'Pane')
      fhState().paneOpenIds.add(id)
      if (!alreadyOpen) {
        fhState().shownPaneId = fhState().focusedPaneId ?? id
      }
      if (input.focus === true) fhState().paneFocusRequest = id
      for (let i = fhState().unplacedPanes.length - 1; i >= 0; i--) {
        if (fhState().unplacedPanes[i]?.id === id)
          fhState().unplacedPanes.splice(i, 1)
      }
      notifyPanesListeners()
      bumpRasterFrames()
      return { isPlaced: true }
    }
    // Below openFloor — park in unplaced; placeWaiting when columns widen.
    // already-open never reaches here (gold short-circuit).
    const atUnplaced = fhState().unplacedPanes.findIndex(pane => pane.id === id)
    if (atUnplaced >= 0) fhState().unplacedPanes[atUnplaced] = next
    else fhState().unplacedPanes.push(next)
    notifyPanesListeners()
    bumpRasterFrames()
    return { isPlaced: false, reason: placement.reason }
  }
  if (op === 'ui.close') {
    const origin = input.origin
    const originOk = isEventRecord(origin) && origin.kind === 'plugin'
    if (paneIdCheck(input.id) !== undefined) {
      hostCheck(op, paneIdCheck(input.id) ?? '', plugin)
    }
    if (!originOk) hostCheck(op, "origin is the engine's to set", plugin)
    // densable JFt — single drop path (NFr + Ide Map + shown/focused).
    dropPluginPane(String(input.id))
    return undefined
  }
  if (op === 'ui.panes') {
    // densable `rNo` / `fue` — open ∪ unplaced; isPlaced = open membership.
    // Never export minify `rNo`/`fue`.
    const owner = plugin ?? ''
    return [...fhState().pluginPanes, ...fhState().unplacedPanes]
      .filter(pane => pane.plugin === owner)
      .map(pane => ({
        id: pane.id,
        title: pane.title,
        isShown: fhState().shownPaneId === pane.id,
        isFocused: fhState().focusedPaneId === pane.id,
        isPlaced: fhState().paneOpenIds.has(pane.id),
      }))
  }
  if (op === 'ui.scroll') {
    const to = input.to
    const inn = input.in
    const block = input.block
    const startEnd = to === 'start' || to === 'end'
    const byRequest =
      isEventRecord(to) &&
      typeof to.requestId === 'string' &&
      to.requestId !== '' &&
      !Object.hasOwn(to, 'key')
    const byKey =
      isEventRecord(to) &&
      typeof to.key === 'string' &&
      to.key !== '' &&
      !Object.hasOwn(to, 'requestId')
    if (!(startEnd || byRequest || byKey)) {
      hostCheck(
        op,
        'takes { to } ({ requestId }, { key }, "start" or "end")',
        plugin,
      )
    }
    if (inn !== undefined && (typeof inn !== 'string' || inn === '')) {
      hostCheck(
        op,
        'in is the requestId of one of its sites (a string)',
        plugin,
      )
    }
    if (startEnd && inn === undefined) {
      hostCheck(
        op,
        `to: "${String(to)}" takes { in } (which of its sites)`,
        plugin,
      )
    }
    if (
      block !== undefined &&
      block !== 'start' &&
      block !== 'center' &&
      block !== 'end' &&
      block !== 'nearest'
    ) {
      hostCheck(op, 'block is "start", "center", "end" or "nearest"', plugin)
    }
    return runUiScroll(input, plugin)
  }
  if (op === 'ui.focus') {
    const requestId = input.requestId
    const key = input.key
    if (
      typeof requestId !== 'string' ||
      requestId === '' ||
      typeof key !== 'string' ||
      key === ''
    ) {
      hostCheck(
        op,
        'takes { requestId, key } (which of its sites, and the element it drew there, by key)',
        plugin,
      )
    }
    return runUiFocus({ ...input, plugin: plugin ?? input.plugin }, plugin)
  }
  if (op === 'ui.selection') {
    // densable N$t / Tae: every client that named ui_read_selection is asked.
    const { listSurfaceViewportClients } = await import(
      '../surfaceViewportClients.js'
    )
    const clients = listSurfaceViewportClients().filter(
      c =>
        Array.isArray(c.answers) &&
        (c.answers as unknown[]).includes('ui_read_selection'),
    )
    if (clients.length > 0) {
      // densable N$t: Promise.any — the first non-empty selection wins.
      const { getCurrentStructuredIO } = await import('src/cli/structuredIO.js')
      const io = getCurrentStructuredIO()
      if (io) {
        const first = await Promise.any(
          clients.map(async c => {
            const answer = await io.requestUiReadSelection(
              c.surface,
              c.clientId,
            )
            if (!answer || answer.text === '') throw new Error('empty')
            return answer
          }),
        ).catch(() => undefined)
        return first ? toUiSelection(first) : undefined
      }
    }
    return toUiSelection(runUiSelection())
  }
  if (op === 'ui.copy') {
    if (typeof input.text !== 'string') {
      hostCheck(op, 'takes { text, surface? } (a string text)', plugin)
    }
    const stamped = stampUiCopy(input)
    const surface = stamped.surface
    if (
      surface !== undefined &&
      (typeof surface !== 'string' || !Object.hasOwn(UI_SURFACES, surface))
    ) {
      hostCheck(
        op,
        'surface is not the name of a surface (terminal, desktop, mobile, vscode)',
        plugin,
      )
    }
    const name = plugin && plugin !== '' ? plugin : 'unattributed'
    if (typeof surface === 'string' && !drawingSurfaces().includes(surface)) {
      logForDebugging(
        `$.ui.copy (${name}): no surface draws (${surface}); nothing copied`,
      )
      return { isCopied: false, reason: 'no-surface' }
    }
    if (typeof surface === 'string' && surface !== 'terminal') {
      // densable vko: the client that named ui_copy on this surface answers.
      const client = attachedClientAnswering('ui_copy', surface)
      const { getCurrentStructuredIO } = await import('src/cli/structuredIO.js')
      const copied =
        client !== undefined &&
        (await getCurrentStructuredIO()?.requestUiCopy(
          client.surface,
          client.clientId,
          name,
          String(input.text),
        )) === true
      logForDebugging(
        `$.ui.copy (${name}): ${String(input.text).length} chars to ${surface}: ${copied ? 'copied' : 'no client there took it; nothing copied'}`,
      )
      return copied
        ? { isCopied: true }
        : { isCopied: false, reason: 'no-clipboard' }
    }
    return runUiCopy(stamped, plugin)
  }
  if (op === 'ui.blit') {
    const requestOk =
      typeof input.requestId === 'string' &&
      input.requestId !== '' &&
      typeof input.key === 'string' &&
      input.key !== ''
    const cells = typeof input.cells === 'string'
    const source = isEventRecord(input.source)
    if (
      !(
        requestOk &&
        cells !== source &&
        (input.cells === undefined || cells) &&
        (input.source === undefined || source)
      )
    ) {
      hostCheck(
        op,
        "takes { requestId, key, cells } (strings; the site, the Raster's key, its encoded cells) or { requestId, key, source } (the Image's key, its next ImageSource)",
        plugin,
      )
    }
    if (
      (input.columns !== undefined && typeof input.columns !== 'number') ||
      (input.rows !== undefined && typeof input.rows !== 'number')
    ) {
      hostCheck(op, 'columns and rows are numbers when given', plugin)
    }
    const owner = plugin ?? ''
    const requestId = String(input.requestId)
    const key = String(input.key)
    const kind = input.source !== undefined ? 'Image' : 'Raster'
    const siteKey = mountSiteKey(requestId, key, owner)
    if (kind === 'Raster') {
      const site = fhState().mountedRasters.get(siteKey)
      const rasters = [...(site?.rasters ?? [])]
      const first = rasters[0]
      if (site === undefined || first === undefined) {
        return blitUnmountedDeny(
          'Raster',
          requestId,
          key,
          anotherPluginOwns('Raster', requestId, key, owner),
        )
      }
      const columns =
        typeof input.columns === 'number' ? input.columns : first.columns
      const rows = typeof input.rows === 'number' ? input.rows : first.rows
      const matching = rasters.filter(
        mount => mount.columns === columns && mount.rows === rows,
      )
      if (matching.length === 0) {
        return {
          deny: `the mounted Raster is ${first.columns}x${first.rows}, not ${columns}x${rows}; a resize is a redraw (ui.invalidate)`,
        }
      }
      if (!takeBlitSlot(site)) {
        return {
          deny: `more than ${RASTER_BLITS_PER_WINDOW} blits a second; the surface paints at its frame rate, so one blit a frame is all that shows`,
        }
      }
      const decoded = decodeRasterCells(input.cells, columns, rows)
      if ('problem' in decoded) return { deny: decoded.problem }
      for (const mount of matching) mount.paint(decoded.words)
      bumpRasterFrames()
      return {}
    }
    const site = fhState().mountedImages.get(siteKey)
    const images = [...(site?.images ?? [])]
    const first = images[0]
    if (site === undefined || first === undefined) {
      return blitUnmountedDeny(
        'Image',
        requestId,
        key,
        anotherPluginOwns('Image', requestId, key, owner),
      )
    }
    const columns =
      typeof input.columns === 'number' ? input.columns : first.columns
    const rows = typeof input.rows === 'number' ? input.rows : first.rows
    const matching = images.filter(
      mount => mount.columns === columns && mount.rows === rows,
    )
    if (matching.length === 0) {
      return {
        deny: `the mounted Image is ${first.columns}x${first.rows}, not ${columns}x${rows}; a resize is a redraw (ui.invalidate)`,
      }
    }
    if (!takeBlitSlot(site)) {
      return {
        deny: `more than ${RASTER_BLITS_PER_WINDOW} blits a second; the surface transmits at its frame rate, so one blit a frame is all that shows`,
      }
    }
    const sourceProblem = imageSourceProblem(input.source)
    if (sourceProblem !== undefined) return { deny: sourceProblem }
    const swaps = matching.map(mount => mount.swap(input.source))
    const firstSwap = swaps[0]
    if (firstSwap !== undefined && swaps.every(msg => msg !== undefined)) {
      return { deny: firstSwap }
    }
    bumpRasterFrames()
    return {}
  }
  if (op === 'ui.resolve') {
    const reason = uiRenderArgCheck(input)
    if (reason !== undefined) hostCheck(op, reason, plugin)
    const owner = plugin ?? ''
    const requestId =
      typeof input.requestId === 'string' && input.requestId !== ''
        ? input.requestId
        : undefined
    walkUiMounts(input, owner, requestId)
    walkUiMounts(input.children, owner, requestId)
    walkUiMounts(input.element, owner, requestId)
    bumpRasterFrames()
    const surface = String(input.surface)
    const component = String(input.component)
    // densable `$xr.read`: worker `resolveTables` answer wins when present.
    if (owner !== '') {
      const stored = getResolvedAnswer(owner, surface, component)
      if (stored !== undefined) return stored
    }
    // densable `$t` / yOt `ui.resolve` (not classic.ui.resolve); tail is `ivo`.
    return runFunctionHookChain('ui.resolve', input, async () =>
      makeUiResolveTable(surface, owner),
    ).then(table => fillWithheldUiResolveTable(table, surface, plugin))
  }
  return undefined
}

/**
 * densable 2.1.289 `ui.selection` terminal core (`Ga` / `xrs`).
 * Gold: `iqn(text, rowHolding(selection))` → `{ text }` or `{ text, requestId }`.
 */
function runUiSelection(): { text: string; instance_id?: string } | undefined {
  const ink = Ns().get(process.stdout)
  if (!ink || typeof ink.getSelectedText !== 'function') return undefined
  bindUiSelectionSource(ink)
  const text =
    typeof ink.hasTextSelection === 'function' && !ink.hasTextSelection()
      ? ''
      : ink.getSelectedText()
  if (typeof text !== 'string' || text === '') {
    return ink.isAltScreenActive ? getKeptUiSelection() : undefined
  }
  const holding = getUiSelectionRowHolding()
  const requestId =
    holding !== undefined && ink.selection !== undefined
      ? holding(ink.selection)
      : undefined
  return selectionAnswer(text, requestId)
}

/**
 * densable `Y7` — attached surfaces. CLI REPL is terminal when Ink is on stdout.
 * Desktop/vscode surfaces stay Drop.
 */
function attachedCopySurfaces(): string[] {
  return fhState().promptBoxBound ? ['terminal'] : []
}

/** densable `Y7` — terminal only while a composer is bound. */
function drawingSurfaces(): string[] {
  const { listDrawingSurfaces } =
    require('../surfaceViewportClients.js') as typeof import('../surfaceViewportClients.js')
  return [...attachedCopySurfaces(), ...listDrawingSurfaces()]
}

/** densable `sU(answer)` — first attached client that named this answer. */
export function attachedClientAnswering(
  answer: string,
  surface?: string,
): { surface: string; clientId: string } | undefined {
  const { listSurfaceViewportClients } =
    require('../surfaceViewportClients.js') as typeof import('../surfaceViewportClients.js')
  const found = listSurfaceViewportClients().find(
    c =>
      (surface === undefined || c.surface === surface) &&
      Array.isArray(c.answers) &&
      (c.answers as unknown[]).includes(answer),
  )
  return found
    ? { surface: found.surface, clientId: found.clientId }
    : undefined
}

/** densable `Jko` stamp: fill surface from Y7()[0] when omitted. */
function stampUiCopy(input: Record<string, unknown>): Record<string, unknown> {
  const surface = input.surface ?? attachedCopySurfaces()[0]
  return surface === undefined ? input : { ...input, surface }
}

/** densable `_Xn` — terminal OSC-52 (and native path is a success even if OSC is empty). */
function runUiCopy(
  input: Record<string, unknown>,
  plugin?: string,
): { isCopied: boolean; reason?: string } {
  const name = plugin && plugin !== '' ? plugin : 'unattributed'
  const surface = input.surface
  if (surface === undefined) {
    logForDebugging(
      `$.ui.copy (${name}): no surface draws (none attached); nothing copied`,
    )
    return { isCopied: false, reason: 'no-surface' }
  }
  if (surface !== 'terminal') {
    const chars = String(input.text).length
    logForDebugging(
      `$.ui.copy (${name}): ${chars} chars to ${String(surface)}: no client there took it; nothing copied`,
    )
    return { isCopied: false, reason: 'no-clipboard' }
  }
  const text = String(input.text)
  const payload = osc52Payload(text)
  const within = payload !== '' && payload.length <= OSC52_WRITE_BOUND
  if (within) process.stdout.write(payload)
  // densable Qko: path is Fue() (native / tmux-buffer / osc52). Copied when
  // OSC 52 was written, or the path is not osc52.
  const path = getClipboardPath()
  const copied = within || path !== 'osc52'
  logForDebugging(
    `$.ui.copy (${name}): ${text.length} chars, path ${path}, OSC 52 ${within ? 'written' : 'over the write bound'}; ${copied ? 'copied' : 'nothing copied'}`,
  )
  return copied
    ? { isCopied: true }
    : { isCopied: false, reason: 'no-clipboard' }
}

/** densable `oRt` + REPL `status(v, M)` — add/remove pinned status notification. */
export function runUiStatus(plugin: string, text: string | undefined): void {
  const label = text ?? '(cleared)'
  if (!fhState().uiStatusHandler && !fhState().functionHooksAppStateWriter) {
    logForDebugging(
      `$.ui.status (${plugin}): no session bound; dropped: ${label}`,
    )
    return
  }
  logForDebugging(`$.ui.status (${plugin}): ${label}`)
  const statusHandler = fhState().uiStatusHandler
  if (statusHandler) {
    statusHandler({ plugin, text })
    return
  }
  const key = `plugin-status-${plugin}`
  fhState().functionHooksAppStateWriter?.(prev => {
    const isCurrent = prev.notifications.current?.key === key
    const inQueue = prev.notifications.queue.some(n => n.key === key)
    const inPinned = prev.notifications.pinned.some(n => n.key === key)
    if (text === undefined && !isCurrent && !inQueue && !inPinned) {
      return prev
    }
    const filteredPinned = prev.notifications.pinned.filter(n => n.key !== key)
    const nextPinned =
      text !== undefined
        ? [
            ...filteredPinned,
            {
              key,
              kind: 'event',
              text: formatPluginStatusText(plugin, text),
              priority: 'low' as const,
              pinned: true,
            },
          ]
        : filteredPinned
    return {
      ...prev,
      notifications: {
        current: isCurrent ? null : prev.notifications.current,
        queue: inQueue
          ? prev.notifications.queue.filter(n => n.key !== key)
          : prev.notifications.queue,
        pinned: nextPinned,
      },
    }
  })
}
