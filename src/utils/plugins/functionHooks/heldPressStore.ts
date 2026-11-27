/**
 * Function hooks submodule: heldPressStore
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { AsyncLocalStorage } from 'async_hooks'
import type {
  HeldPressRecord,
  HeldPressSite,
  PressAnswering,
  PressEventKind,
} from './types.js'

/** densable `Mme` — press answering window / host press timeout. */
export const PRESS_ANSWER_MS = 10_000

/**
 * densable `ae`: classify the press payload for answering ALS.
 * `kind` → ui.input, `value` → ui.select, else ui.press.
 */
function classifyPressEvent(event: unknown): PressEventKind {
  if (event !== null && typeof event === 'object') {
    if ('kind' in event) return 'ui.input'
    if ('value' in event) return 'ui.select'
  }
  return 'ui.press'
}

/** densable `ze` — live answering store for one press. */
export function createPressAnswering(event: unknown): PressAnswering {
  return {
    event: classifyPressEvent(event),
    isLive: true,
    answersUntil: Date.now() + PRESS_ANSWER_MS,
  }
}

/** densable `answering` ALS (`Xe.answering`). */
export const pressAnswering = new AsyncLocalStorage<PressAnswering>()

/**
 * densable `fe` — live press event kind while a press handler may answer.
 * Returns undefined when no live answering store / past answersUntil.
 */
export function getLivePressEvent(): PressEventKind | undefined {
  const store = pressAnswering.getStore()
  return store !== undefined && store.isLive && Date.now() < store.answersUntil
    ? store.event
    : undefined
}

/** densable `OP` — hosted DualInk press id bound. */
const HELD_PRESS_ID_BOUND = 1_073_741_824

/**
 * densable `IP` / `T3` — DualInk held-press metadata. Lookup is by hosted id
 * (gold `e.get(h)`) or original handle. DualInk press does not invent baseButton.
 */
export function computeDrawingFingerprint(tree: unknown): string {
  try {
    return JSON.stringify(tree, (key, val) => {
      if (key === 'handle' || key === 'press') return undefined
      return val
    })
  } catch {
    return ''
  }
}

function inheritUnchangedHandles(opts: {
  previous: Map<unknown, number>
  handles: unknown[]
  hostedOfHandle: (
    plugin: string,
    except: string,
    handle: unknown,
  ) => number | undefined
  plugin: string
  except: string
}): Map<unknown, number> {
  const { previous, handles, hostedOfHandle, plugin, except } = opts
  const nextSet = new Set(handles)
  const inherited = new Map(previous)
  let idx = 0
  for (const [prevHandle, hostedId] of previous) {
    const nextHandle = handles[idx++]
    if (
      nextHandle !== undefined &&
      !previous.has(nextHandle) &&
      !nextSet.has(prevHandle) &&
      hostedOfHandle(plugin, except, prevHandle) === undefined &&
      hostedOfHandle(plugin, except, nextHandle) === undefined
    ) {
      inherited.set(nextHandle, hostedId)
    }
  }
  return inherited
}

export function createHeldPressStore(): {
  heldPress: (
    plugin: string,
    handle: unknown,
    element?: string,
  ) => HeldPressRecord | undefined
  holdDrawing: (
    plugin: string,
    site: HeldPressSite & { drawn?: string },
    buttons: Array<{
      tag: string
      handle: unknown
      element: string
      pressableLinks?: string[]
      options?: string[]
    }>,
  ) => { hosted: Map<unknown, number>; released: unknown[] }
  holdersOf: (site: HeldPressSite) => string[]
  forgetPresses: (plugin: string) => void
  heldByKeyOf: (key: {
    tag: string
    plugin: string
    element: string
    surface: string
    component: string
    requestId?: string
  }) => HeldPressRecord | undefined
  hostedButtonsOf: (
    plugin: string,
    element: string,
  ) => Array<{ hosted: number; button: HeldPressRecord }>
  heldPressCount: () => number
} {
  const byHosted = new Map<number, HeldPressRecord>()
  const byDrawing = new Map<string, Map<unknown, number>>()
  const byDrawn = new Map<string, string | undefined>()
  let next = Math.floor(Math.random() * HELD_PRESS_ID_BOUND)
  const drawingKey = (plugin: string, site: HeldPressSite): string =>
    `${plugin}\0${site.component}\0${site.requestId}\0${site.surface}`
  const hostedOfHandle = (
    plugin: string,
    except: string,
    handle: unknown,
  ): number | undefined => {
    for (const [key, map] of byDrawing) {
      if (key === except || !key.startsWith(`${plugin}\0`)) continue
      const hosted = map.get(handle)
      if (hosted !== undefined) return hosted
    }
    return undefined
  }
  return {
    heldPress(plugin, handle, element) {
      if (typeof handle === 'number') {
        const hosted = byHosted.get(handle)
        if (
          hosted?.plugin === plugin &&
          (element === undefined ||
            element === '' ||
            hosted.element === element)
        ) {
          return hosted
        }
      }
      for (const rec of byHosted.values()) {
        if (
          rec.plugin === plugin &&
          rec.handle === handle &&
          (element === undefined || element === '' || rec.element === element)
        ) {
          return rec
        }
      }
      return undefined
    },
    holdDrawing(plugin, siteWithDrawn, buttons) {
      const { drawn, ...site } = siteWithDrawn
      const key = drawingKey(plugin, site)
      const previous = byDrawing.get(key) ?? new Map<unknown, number>()
      const hosted = new Map<unknown, number>()
      const prevMap =
        drawn !== undefined &&
        drawn === byDrawn.get(key) &&
        buttons.length === previous.size
          ? inheritUnchangedHandles({
              previous,
              handles: buttons.map(b => b.handle),
              hostedOfHandle,
              plugin,
              except: key,
            })
          : previous
      for (const button of buttons) {
        const id =
          prevMap.get(button.handle) ??
          hostedOfHandle(plugin, key, button.handle) ??
          ++next
        hosted.set(button.handle, id)
        byHosted.set(id, { ...button, plugin, ...site })
      }
      const released: unknown[] = []
      const hostedValues = new Set(hosted.values())
      for (const [handle, id] of previous) {
        if (
          !hosted.has(handle) &&
          hostedOfHandle(plugin, key, handle) === undefined
        ) {
          if (!hostedValues.has(id)) byHosted.delete(id)
          released.push(handle)
        }
      }
      if (hosted.size === 0) {
        byDrawing.delete(key)
        byDrawn.delete(key)
      } else {
        byDrawing.set(key, hosted)
        byDrawn.set(key, drawn)
      }
      return { hosted, released }
    },
    holdersOf(site) {
      const suffix = `\0${site.component}\0${site.requestId}\0${site.surface}`
      const names: string[] = []
      for (const key of byDrawing.keys()) {
        if (key.endsWith(suffix)) {
          names.push(key.slice(0, key.indexOf('\0')))
        }
      }
      return names
    },
    forgetPresses(plugin) {
      for (const [id, rec] of byHosted) {
        if (rec.plugin === plugin) byHosted.delete(id)
      }
      for (const key of [...byDrawing.keys()]) {
        if (key.startsWith(`${plugin}\0`)) byDrawing.delete(key)
      }
    },
    heldByKeyOf(key) {
      const matches = [...byHosted.values()].filter(
        rec =>
          rec.tag === key.tag &&
          rec.plugin === key.plugin &&
          rec.element === key.element &&
          rec.surface === key.surface &&
          rec.component === key.component &&
          (key.requestId === undefined || rec.requestId === key.requestId),
      )
      return matches.length === 1 ? matches[0] : undefined
    },
    hostedButtonsOf(plugin, element) {
      return [...byHosted]
        .filter(([, rec]) => rec.plugin === plugin && rec.element === element)
        .map(([hosted, button]) => ({ hosted, button }))
    },
    heldPressCount: () => byHosted.size,
  }
}
