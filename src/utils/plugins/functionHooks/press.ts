/**
 * Function hooks submodule: press
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { cloneIn, isEventRecord } from './constants.js'
import { createPressAnswering, pressAnswering } from './heldPressStore.js'
import { fhState, pressSlot, waitForWorkerReplacement } from './state.js'

/** densable `Te` / Image restamp — stamp the returning plugin onto Raster/Image/Client/press. */
export function stampPluginOnDrawing(node: unknown, plugin: string): unknown {
  if (plugin === '') return node
  if (Array.isArray(node)) {
    return node.map(child => stampPluginOnDrawing(child, plugin))
  }
  if (!isEventRecord(node)) return node
  const children =
    node.children !== undefined
      ? stampPluginOnDrawing(node.children, plugin)
      : undefined
  if (node.type === 'Raster' && !isEventRecord(node.raster)) {
    return {
      ...node,
      raster: { plugin },
      ...(children !== undefined && { children }),
    }
  }
  if (node.type === 'Image' && !isEventRecord(node.image)) {
    return {
      ...node,
      image: { plugin },
      ...(children !== undefined && { children }),
    }
  }
  if (
    node.type === 'Client' &&
    (!isEventRecord(node.client) || node.client.plugin === '')
  ) {
    return {
      ...node,
      client: { plugin },
      ...(children !== undefined && { children }),
    }
  }
  if (isEventRecord(node.press) && node.press.plugin === '') {
    const handle = node.press.handle
    const emptySlot = pressSlot('', handle)
    const held = fhState().pressHandlers.get(emptySlot)
    if (held !== undefined) {
      fhState().pressHandlers.delete(emptySlot)
      fhState().pressHandlers.set(pressSlot(plugin, handle), held)
    }
    return {
      ...node,
      press: { plugin, handle },
      ...(children !== undefined && { children }),
    }
  }
  if (children !== undefined) return { ...node, children }
  return node
}

/**
 * densable worker `press`: look up the held handler or refuse.
 * Enter answering ALS (`ze`/`v.run`), invoke with `cloneIn` (identity),
 * then clear `isLive` in `finally`.
 */
export async function invokePress(
  environmentId: string,
  handle: unknown,
  event: unknown,
): Promise<unknown> {
  const held = fhState().pressHandlers.get(pressSlot(environmentId, handle))
  if (held === undefined) {
    if (
      fhState().workerOwnsDispatch &&
      fhState().workerReplacementPromise !== undefined
    ) {
      await waitForWorkerReplacement('ui.press')
    }
    const pressWorker = fhState().functionHooksWorker
    if (fhState().workerOwnsDispatch && pressWorker) {
      const mod = fhState().loadedModules.find(
        item => item.name === environmentId && item.status !== 'unloaded',
      )
      if (mod && mod.native !== true) {
        return pressWorker.press(environmentId, handle, event)
      }
    }
    throw new Error(
      `ui.press/ui.input/ui.select: no handler is held under handle ${handle}`,
    )
  }
  const answering = createPressAnswering(event)
  return pressAnswering.run(answering, () =>
    Promise.resolve(held(cloneIn(event))).finally(() => {
      answering.isLive = false
    }),
  )
}

export function holdPress(
  environmentId: string,
  handle: unknown,
  fn: (event: unknown) => unknown,
): void {
  fhState().pressHandlers.set(pressSlot(environmentId, handle), fn)
}

/** densable worker `releasePresses` / `Lmn`. */
export function releasePresses(
  environmentId: string,
  handles: unknown[],
  site?: { component: string; requestId: string },
): void {
  const hookHandles = handles.filter(
    handle => !(typeof handle === 'number' && handle < 0),
  )
  if (hookHandles.length === 0) return
  const mod = fhState().loadedModules.find(
    item => item.name === environmentId && item.status !== 'unloaded',
  )
  if (!mod) {
    const component = site?.component ?? 'Pane'
    const requestId = site?.requestId ?? ''
    logForDebugging(
      `ui.render (${component} ${requestId}): ${environmentId} drew Buttons but is not loaded; nothing to release`,
    )
    return
  }
  for (const handle of hookHandles) {
    fhState().pressHandlers.delete(pressSlot(environmentId, handle))
  }
  const releaseWorker = fhState().functionHooksWorker
  if (mod.native !== true && fhState().workerOwnsDispatch && releaseWorker) {
    releaseWorker.releasePresses(environmentId, hookHandles)
  }
}

/** densable `ae` @182867306 — extract `{ value: string }[]` (or `string[]`) from `<Select options>`. */
function extractHeldSelectOptionValues(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  if (raw.every(item => typeof item === 'string')) {
    return raw
  }
  const values = raw.map(item =>
    typeof item === 'object' && item !== null && 'value' in item
      ? (item as { value?: unknown }).value
      : undefined,
  )
  return values.every((v): v is string => typeof v === 'string')
    ? values
    : undefined
}

export function collectHeldPressButtons(tree: unknown): Map<
  string,
  Array<{
    tag: string
    handle: unknown
    element: string
    pressableLinks?: string[]
    options?: string[]
  }>
> {
  const byPlugin = new Map<
    string,
    Array<{
      tag: string
      handle: unknown
      element: string
      pressableLinks?: string[]
      options?: string[]
    }>
  >()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (!isEventRecord(node)) return
    const props = isEventRecord(node.props) ? node.props : undefined
    if (
      node.type === 'Button' ||
      node.type === 'Select' ||
      node.type === 'Input' ||
      node.type === 'Markdown'
    ) {
      const press = isEventRecord(node.press) ? node.press : undefined
      const plugin = typeof press?.plugin === 'string' ? press.plugin : ''
      const element =
        typeof props?.key === 'string'
          ? props.key
          : typeof press?.element === 'string'
            ? press.element
            : typeof node.key === 'string'
              ? node.key
              : undefined
      if (
        plugin !== '' &&
        press?.handle !== undefined &&
        typeof element === 'string'
      ) {
        const held = byPlugin.get(plugin) ?? []
        const rawLinks = props?.pressableLinks ?? node.pressableLinks
        const links =
          Array.isArray(rawLinks) &&
          rawLinks.every((link): link is string => typeof link === 'string')
            ? rawLinks
            : undefined
        const options =
          node.type === 'Select'
            ? extractHeldSelectOptionValues(props?.options ?? node.options)
            : undefined
        held.push({
          tag: String(node.type),
          handle: press.handle,
          element,
          ...(links !== undefined ? { pressableLinks: links } : {}),
          ...(options !== undefined ? { options } : {}),
        })
        byPlugin.set(plugin, held)
      }
      return
    }
    if (node.children !== undefined) walk(node.children)
    if (props?.children !== undefined) walk(props.children)
  }
  walk(tree)
  return byPlugin
}

function collectButtonHandles(tree: unknown): Map<string, unknown[]> {
  const byPlugin = new Map<string, unknown[]>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (!isEventRecord(node)) return
    if (
      node.type === 'Button' ||
      node.type === 'Select' ||
      node.type === 'Input' ||
      node.type === 'Markdown'
    ) {
      const press = isEventRecord(node.press) ? node.press : undefined
      const plugin = typeof press?.plugin === 'string' ? press.plugin : ''
      if (plugin !== '' && press?.handle !== undefined) {
        const held = byPlugin.get(plugin) ?? []
        held.push(press.handle)
        byPlugin.set(plugin, held)
      }
    }
    if (node.children !== undefined) walk(node.children)
    const props = isEventRecord(node.props) ? node.props : undefined
    if (props?.children !== undefined) walk(props.children)
  }
  walk(tree)
  return byPlugin
}

export function releaseDrawingButtons(
  tree: unknown,
  plugin: string,
  component: string,
  requestId: string,
): void {
  const grouped = collectButtonHandles(tree)
  if (grouped.size === 0 && plugin !== '') {
    return
  }
  for (const [name, handles] of grouped) {
    releasePresses(name, handles, { component, requestId })
  }
}
