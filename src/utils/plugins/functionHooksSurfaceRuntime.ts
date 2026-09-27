/**
 * densable 2.1.282 Client trampoline (`jOn` / `__surface__.run`).
 *
 * Gold: `vm.runInContext(jOn, context)(host, limits)` then
 * `new Script("__surface__.run()").runInContext(context)`.
 */
import { runInContext, Script, type Context } from 'vm'

export const SURFACE_LIMITS = {
  nodes: 20_000,
  depth: 32,
  chars: 100_000,
  values: 20_000,
  dataDepth: 32,
} as const

export type SurfaceHost = {
  schedule: (id: number) => void
  post: (id: number, text: string) => void
  startTimer: (id: number, intervalMs: number) => number
  stopTimer: (id: number, timer: number) => void
}

type InnerRuntime = {
  mount: (
    id: number,
    fn: (props: unknown, surface: unknown) => unknown,
    props: unknown,
  ) => void
  setProps: (id: number, props: unknown) => void
  resize: (id: number, columns: number, rows: number) => void
  stage: (id: number, kind: string, payload?: unknown) => void
  dropHeld: (id: number, handles: number[]) => void
  hasListener: (id: number, kind: 'pointer' | 'key') => boolean
  unmount: (id: number) => void
}

export type SurfaceRuntime = InnerRuntime & {
  run: () => unknown
}

/**
 * densable `jOn` — String.raw factory evaluated in the surface vm context.
 * `h` is read from that context (`const _h = h`).
 */
export const SURFACE_TRAMPOLINE_SOURCE = `((host, limits) => {
  const { freeze, defineProperty, defineProperties, keys: _keys } = Object
  const _isArray = Array.isArray
  const _Map = Map
  const _stringify = JSON.stringify
  const _Error = Error
  const _TypeError = TypeError
  const _isFinite = Number.isFinite
  const _h = h
  const instances = new _Map()
  let pending = null

  // surface.elements (types/ ClientElements), the one table every
  // instance's surface hands out: the terminal's names less Client (nothing
  // nests in a Client), Raster and Image, each a constructor over this
  // environment's h, so <Box> from it and h('Box', ...) are one tree. What
  // $.ui.resolve(e) is to a hooks module, with no $ and no hook between. A
  // Markdown draws here without onLinkPress: a surface module answers its
  // own pointer (surface.onPointer), and exportTree refuses one that has it.
  const ELEMENT_NAMES =
    ['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown']
  const elements = { __proto__: null }
  for (const name of ELEMENT_NAMES) {
    elements[name] = freeze(props => {
      const { children, ...rest } = props ?? {}
      const childList = children === undefined
        ? []
        : _isArray(children) ? children : [children]
      return _h(name, rest, ...childList)
    })
  }
  freeze(elements)

  // The trampoline. Client code that calls it finds nothing staged.
  defineProperty(globalThis, '__surface__', {
    value: freeze({
      __proto__: null,
      run: () => {
        const staged = pending
        pending = null
        return staged === null ? undefined : staged()
      },
    }),
    enumerable: false,
    writable: false,
    configurable: false,
  })

  const fail = (message, Ctor = _Error) => { throw new Ctor(message) }
  const instanceOf = id => instances.get(id) ?? fail('no client instance ' + id)
  const listener = (fn, what) =>
    typeof fn === 'function' ? fn : fail(what + ' takes a function', _TypeError)

  function surfaceOf(id, instance) {
    const surface = { __proto__: null }
    defineProperties(surface, {
      elements: { value: elements, enumerable: true },
      state: { get: () => instance.state, enumerable: true },
      columns: { get: () => instance.columns, enumerable: true },
      rows: { get: () => instance.rows, enumerable: true },
      setState: {
        value: next => {
          instance.state = next
          if (!instance.scheduled) {
            host.schedule(id)
            instance.scheduled = true
          }
        },
        enumerable: true,
      },
      every: {
        value: (ms, fn) => {
          listener(fn, 'every')
          const interval =
            typeof ms === 'number' && _isFinite(ms) && ms > 0 ? ms : 0
          const timer = host.startTimer(id, interval)
          instance.timers.set(timer, fn)
          return () => {
            if (instance.timers.delete(timer)) host.stopTimer(id, timer)
          }
        },
        enumerable: true,
      },
      onPointer: {
        value: fn => {
          instance.pointer = listener(fn, 'onPointer')
          return () => { if (instance.pointer === fn) instance.pointer = null }
        },
        enumerable: true,
      },
      onKey: {
        value: fn => {
          instance.key = listener(fn, 'onKey')
          return () => { if (instance.key === fn) instance.key = null }
        },
        enumerable: true,
      },
      post: {
        value: data => {
          let text
          try { text = _stringify(data) } catch (error) {
            fail('post takes plain data (' + error.message + ')', _TypeError)
          }
          if (typeof text !== 'string') {
            fail('post takes plain data, not ' + typeof data, _TypeError)
          }
          host.post(id, text)
        },
        enumerable: true,
      },
    })
    return freeze(surface)
  }

  const PRESSABLE = {
    __proto__: null, Button: 'onPress', Input: 'onEvent', Select: 'onEvent',
  }

  // The module's tree read HERE, never by the host: every node, every
  // props value and every hover rebuilt into fresh plain structures of ours
  // (getters run here, under the call budget; a toJSON is never consulted,
  // functions and undefined drop), each element closure held under a number
  // of the instance's in its place, then one JSON text of those fresh
  // structures alone. The host parses that text; nothing of the module's
  // crosses.
  function exportTree(instance, tree) {
    const budget = { nodes: 0, values: 0 }
    const tooMany = () =>
      fail('props of more than ' + limits.values + ' values')
    // Mirrors the host's plainDataProblem, one props payload at a time (the
    // count restarts per element; the tree's own bound is limits.nodes):
    // every value counts, an array by its length up front, a hole refused,
    // so an oversize or sparse array fails by name at once.
    const propsOf = value => {
      budget.values = 0
      return plain(value, 0)
    }
    const plain = (value, depth) => {
      if (++budget.values > limits.values) tooMany()
      if (value === null) return null
      const kind = typeof value
      if (kind === 'string' || kind === 'boolean') return value
      if (kind === 'number') return _isFinite(value) ? value : null
      if (kind !== 'object') return undefined
      if (depth > limits.dataDepth) {
        fail('props nesting deeper than ' + limits.dataDepth)
      }
      if (_isArray(value)) {
        if (value.length > limits.values - budget.values) tooMany()
        const out = []
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) fail('props with a hole in an array')
          const item = plain(value[i], depth + 1)
          out.push(item === undefined ? null : item)
        }
        return out
      }
      const out = {}
      for (const key of _keys(value)) {
        const item = plain(value[key], depth + 1)
        if (item !== undefined) {
          defineProperty(out, key, {
            value: item, enumerable: true, writable: true, configurable: true,
          })
        }
      }
      return out
    }
    const walk = (node, depth) => {
      if (typeof node === 'string') return node
      if (typeof node !== 'object' || node === null || _isArray(node)) {
        fail('a child that is neither a string nor an element')
      }
      if (++budget.nodes > limits.nodes) {
        fail('a tree of more than ' + limits.nodes + ' nodes')
      }
      if (depth > limits.depth) fail('a tree deeper than ' + limits.depth)
      const tag = node.type
      if (typeof tag !== 'string') fail('an element without a type')
      if (tag === 'Client') {
        fail('a Client inside the tree; a surface module draws elements, ' +
          'not nested Clients')
      }
      if (tag === 'Raster') {
        fail('a Raster inside the tree; a hooks module draws a Raster and ' +
          'repaints it with $.ui.blit, a surface module draws elements')
      }
      if (tag === 'Image') {
        fail('an Image inside the tree; a hooks module draws an Image, a ' +
          'surface module draws elements')
      }
      if (tag === 'engine') {
        fail('an engine node inside the tree; nothing of the engine draws ' +
          'inside a Client')
      }
      if (tag === 'Markdown' && node.press !== undefined) {
        fail('a Markdown with onLinkPress inside the tree; a surface ' +
          'module answers its own pointer with surface.onPointer')
      }
      const out = { type: tag }
      if (node.props !== undefined) out.props = propsOf(node.props)
      if (node.hover !== undefined) out.hover = propsOf(node.hover)
      const closureKey = PRESSABLE[tag]
      if (closureKey !== undefined) {
        const closure = node[closureKey]
        if (typeof closure !== 'function') {
          fail('a ' + tag + ' without its handler (build it with ' +
            'surface.elements.' + tag + ')')
        }
        const handle = ++instance.heldCounter
        instance.held.set(handle, closure)
        out.held = handle
        return out
      }
      const children = node.children
      if (children !== undefined) {
        if (!_isArray(children)) fail('children that are not an array')
        const copied = []
        for (let i = 0; i < children.length; i++) {
          copied.push(walk(children[i], depth + 1))
        }
        out.children = copied
      }
      return out
    }
    const text = _stringify(walk(tree, 0))
    if (text.length > limits.chars) {
      fail('a tree serializing to more than ' + limits.chars + ' characters')
    }
    return text
  }

  // Every user function is called bare (no receiver): its \`this\` is
  // undefined, never the instance record. Only render answers anything: the
  // tree's JSON text; a listener's return value stays here.
  function act(instance, kind, payload) {
    switch (kind) {
      case 'render': {
        instance.scheduled = false
        const render = instance.fn
        return exportTree(instance, render(instance.props, instance.surface))
      }
      case 'pointer': {
        const listener = instance.pointer
        if (listener !== null) listener(payload)
        return undefined
      }
      case 'key': {
        const listener = instance.key
        if (listener !== null) listener(payload)
        return undefined
      }
      case 'tick': {
        const fn = instance.timers.get(payload)
        if (fn !== undefined) fn()
        return undefined
      }
      case 'held': {
        const fn = instance.held.get(payload.handle)
        if (fn !== undefined) fn(payload.event)
        return undefined
      }
      default:
        return fail('unknown surface call ' + kind)
    }
  }

  return freeze({
    __proto__: null,
    mount: (id, fn, props) => {
      if (typeof fn !== 'function') {
        fail('the surface module export is not a function', _TypeError)
      }
      const instance = {
        fn, props, state: undefined, columns: 0, rows: 0, scheduled: false,
        pointer: null, key: null, timers: new _Map(), surface: null,
        held: new _Map(), heldCounter: 0,
      }
      instance.surface = surfaceOf(id, instance)
      instances.set(id, instance)
    },
    setProps: (id, props) => { instanceOf(id).props = props },
    resize: (id, columns, rows) => {
      const instance = instanceOf(id)
      instance.columns = columns
      instance.rows = rows
    },
    stage: (id, kind, payload) => {
      const instance = instanceOf(id)
      pending = () => act(instance, kind, payload)
    },
    // The closures exportTree held for elements a redraw retired.
    dropHeld: (id, handles) => {
      const instance = instances.get(id)
      if (instance === undefined) return
      for (let i = 0; i < handles.length; i++) instance.held.delete(handles[i])
    },
    hasListener: (id, kind) => {
      const instance = instances.get(id)
      if (instance === undefined) return false
      const listener = kind === 'pointer' ? instance.pointer : instance.key
      return listener !== null
    },
    unmount: id => {
      const instance = instances.get(id)
      if (instance === undefined) return
      instances.delete(id)
      instance.timers.clear()
      instance.held.clear()
      instance.pointer = null
      instance.key = null
    },
  })
})`

/** densable `Ee`. */
const SURFACE_RUN = '__surface__.run()'

export function installSurfaceRuntime(
  context: Context,
  host: SurfaceHost,
  limits = SURFACE_LIMITS,
  scriptName = 'surface',
): SurfaceRuntime {
  const factory = runInContext(SURFACE_TRAMPOLINE_SOURCE, context) as (
    boundHost: SurfaceHost,
    boundLimits: typeof SURFACE_LIMITS,
  ) => InnerRuntime
  const inner = factory(host, limits)
  const script = new Script(SURFACE_RUN, { filename: scriptName })
  /** densable `pe` default Script budget. */
  const SURFACE_RUN_MS = 1000
  return {
    mount: inner.mount,
    setProps: inner.setProps,
    resize: inner.resize,
    stage: inner.stage,
    dropHeld: inner.dropHeld,
    hasListener: inner.hasListener,
    unmount: inner.unmount,
    run: () => script.runInContext(context, { timeout: SURFACE_RUN_MS }),
  }
}
