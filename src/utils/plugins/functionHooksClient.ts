/**
 * densable 2.1.282 Client host: `Oe` / `yQn` / `to` / `so`.
 *
 * `environmentFor` loads scanned surface modules. `acquire` holds an instance
 * keyed `plugin surface requestId key`. Failed snapshots use gold strings.
 * A drawn tree is the surface export's return (object from `h`, or a string
 * JSON tree). No invented iframe.
 */
import { existsSync, lstatSync, realpathSync, readFileSync } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { SourceTextModule, createContext, runInContext, type Context } from 'vm'
import {
  SURFACE_LIMITS,
  installSurfaceRuntime,
  type SurfaceRuntime,
} from './functionHooksSurfaceRuntime.js'

const LOADING = Object.freeze({ status: 'loading' as const })
const UNPROMPTED_RENDER_CAP = 3
const POST_CHARS = 4096
const CLOCK_MIN_MS = 16
/** densable `zWe` — surface module top-level settle. */
const SURFACE_READY_MS = 10_000
/** densable `fe` — `le()` cap before ellipsis. */
const CLIENT_FAIL_CHARS = 500
/** densable `ez.placeholder` U+10EEEE. */
const CLIENT_FAIL_PLACEHOLDER = 0x10eeee

/**
 * densable `a4` classes: tab/LF/CR, `\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f`,
 * lone surrogate, U+10EEEE. Char-code loop — biome bans those classes in a regex.
 */
function isClientFailControl(cp: number): boolean {
  if (cp === 9 || cp === 10 || cp === 13) return true
  if (cp <= 0x08) return true
  if (cp === 0x0b || cp === 0x0c) return true
  if (cp >= 0x0e && cp <= 0x1f) return true
  if (cp >= 0x7f && cp <= 0x9f) return true
  if (cp >= 0xd800 && cp <= 0xdfff) return true
  return cp === CLIENT_FAIL_PLACEHOLDER
}

/** densable `re(t,n)` — UTF-16 slice, drop a trailing high surrogate. */
function truncateUtf16(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(max - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

export type ClientSnapshot =
  | { status: 'loading' }
  | { status: 'drawn'; tree: unknown }
  | { status: 'failed'; text: string }

export type ClientInstance = {
  id: string
  plugin: string
  module: string
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ClientSnapshot
  setProps: (props: unknown) => void
  resize: (columns: number, rows: number) => void
  pointer: (event: Record<string, unknown>) => void
  key: (event: Record<string, unknown>) => void
  acceptsPointer: () => boolean
  acceptsKeys: () => boolean
  runHeld: (handle: number, event: unknown) => void
  dropHeld: (handles: number[]) => void
  release: () => void
}

export type SurfaceModuleScan = {
  module: string
  modulePath: string
  component: string
  source: string
}

type SurfaceHandle = {
  render: () => unknown
  setProps: (props: unknown) => void
  resize: (columns: number, rows: number) => void
  pointer: (event: unknown) => void
  key: (event: unknown) => void
  hasPointerListener: () => boolean
  hasKeyListener: () => boolean
  runHeld: (handle: number, event: unknown) => void
  dropHeld: (handles: number[]) => void
  unmount: () => void
}

type SurfaceHostFns = {
  schedule: () => void
  post: (data: unknown) => void
  startTimer: (ms: number, tick: () => void) => () => void
}

type SurfaceEnvironment = {
  mount: (input: {
    module: string
    props: unknown
    host: SurfaceHostFns
  }) => SurfaceHandle
}

type MountedSurface = {
  module: string
  host: SurfaceHostFns
  timers: Map<number, () => void>
}

type ClientRecord = {
  id: string
  plugin: string
  module: string
  element: string
  requestId: string
  surfaceName: string
  props: unknown
  columns: number
  rows: number
  surface: SurfaceHandle | undefined
  snapshot: ClientSnapshot
  listeners: Set<() => void>
  holders: number
  isDestroyed: boolean
  isDirty: boolean
  isRendering: boolean
  unpromptedRenders: number
  renderTimer: ReturnType<typeof setImmediate> | undefined
  mountGeneration: number
  destroyTimer: ReturnType<typeof setTimeout> | undefined
}

const instances = new Map<string, ClientRecord>()
const environments = new Map<string, { loading: Promise<SurfaceEnvironment> }>()
const pluginSurfaces = new Map<
  string,
  { root: string; modules: SurfaceModuleScan[] }
>()

export function setPluginSurfaceModules(
  plugin: string,
  root: string | undefined,
  modules: readonly SurfaceModuleScan[],
): void {
  pluginSurfaces.set(plugin, { root: root ?? '', modules: [...modules] })
  environments.delete(plugin)
}

export function forgetPluginSurfaceModules(plugin?: string): void {
  if (plugin === undefined) {
    pluginSurfaces.clear()
    environments.clear()
    return
  }
  pluginSurfaces.delete(plugin)
  environments.delete(plugin)
}

/** densable `Z` — plugin, surface, requestId, key. */
export function clientInstanceKey(input: {
  plugin: string
  surface: string
  requestId: string
  key: string
}): string {
  return [input.plugin, input.surface, input.requestId, input.key].join(' ')
}

function notify(record: ClientRecord): void {
  for (const listener of record.listeners) listener()
}

function setSnapshot(record: ClientRecord, snapshot: ClientSnapshot): void {
  record.snapshot = snapshot
  notify(record)
}

/** densable `le(r)` — `r.replace(a4," ")` then cap `fe` + U+2026. */
export function sanitizeClientFailMessage(message: string): string {
  let cleaned = ''
  for (const ch of String(message)) {
    const cp = ch.codePointAt(0) ?? 0
    cleaned += isClientFailControl(cp) ? ' ' : ch
  }
  return cleaned.length > CLIENT_FAIL_CHARS
    ? `${truncateUtf16(cleaned, CLIENT_FAIL_CHARS)}…`
    : cleaned
}

/** densable `de(plugin, module, message)` — strip existing plugin prefix, keep `Client ${module}: `. */
function clientDetail(plugin: string, module: string, message: string): string {
  const sanitized = sanitizeClientFailMessage(message)
  const prefix = `${plugin}: `
  const stripped = sanitized.startsWith(prefix)
    ? sanitized.slice(prefix.length)
    : sanitized
  const client = `Client ${module}: `
  return stripped.startsWith(client) ? stripped : `${client}${stripped}`
}

function failRecord(record: ClientRecord, detail: string): void {
  unmountSurface(record)
  setSnapshot(record, {
    status: 'failed',
    text: `${record.plugin}: ${clientDetail(record.plugin, record.module, detail)}`,
  })
}

function unmountSurface(record: ClientRecord): void {
  record.mountGeneration += 1
  record.isDirty = false
  if (record.renderTimer !== undefined) {
    clearImmediate(record.renderTimer)
    record.renderTimer = undefined
  }
  try {
    record.surface?.unmount()
  } catch {
    /* gold T() swallows into fail */
  }
  record.surface = undefined
}

function resetUnprompted(plugin: string): void {
  for (const record of instances.values()) {
    if (record.plugin === plugin) record.unpromptedRenders = 0
  }
}

function paint(record: ClientRecord): void {
  const surface = record.surface
  if (!surface || record.isDestroyed) return
  record.isDirty = false
  record.isRendering = true
  try {
    const tree = stampHeldPress(record.plugin, surface.render())
    setSnapshot(record, { status: 'drawn', tree })
  } catch (err) {
    failRecord(record, errorMessage(err))
  } finally {
    record.isRendering = false
  }
}

function schedule(record: ClientRecord): void {
  if (record.isDirty || record.isDestroyed || !record.surface) return
  if (record.unpromptedRenders >= UNPROMPTED_RENDER_CAP) {
    const err = `set its state again after each of ${record.unpromptedRenders} renders, nothing heard between; set state on a pointer or key event, a tick, a press or new props, and let a render settle`
    if (record.isRendering) throw new Error(err)
    failRecord(record, err)
    return
  }
  record.isDirty = true
  record.renderTimer = setImmediate(() => {
    record.renderTimer = undefined
    if (record.isDirty) {
      record.unpromptedRenders += 1
      paint(record)
    }
  })
}

/** densable `xe`/`ge` — stamp `{plugin,handle}` press from trampoline `held`. */
function stampHeldPress(plugin: string, tree: unknown): unknown {
  const walk = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return node
    if (Array.isArray(node)) return node.map(walk)
    const rec = node as Record<string, unknown>
    const out: Record<string, unknown> = { type: rec.type }
    if (rec.props !== undefined) out.props = rec.props
    if (rec.hover !== undefined) out.hover = rec.hover
    if (typeof rec.held === 'number') {
      out.press = { plugin, handle: rec.held }
    } else if (Array.isArray(rec.children)) {
      out.children = rec.children.map(walk)
    }
    return out
  }
  return walk(tree)
}

function drawingH(
  type: unknown,
  props: Record<string, unknown> | null | undefined,
  ...rest: unknown[]
): unknown {
  const children: unknown[] = []
  const flatten = (value: unknown): void => {
    if (value === undefined || value === null || value === false) return
    if (Array.isArray(value)) {
      for (const item of value) flatten(item)
      return
    }
    children.push(value)
  }
  flatten(rest)
  if (typeof type === 'function') {
    return (type as (p: Record<string, unknown>) => unknown)({
      ...(props ?? {}),
      children,
    })
  }
  if (typeof type !== 'string') return null
  const handlerKey =
    type === 'Button'
      ? 'onPress'
      : type === 'Input' || type === 'Select'
        ? 'onEvent'
        : undefined
  const cleaned: Record<string, unknown> = {}
  let handler: unknown
  for (const [name, value] of Object.entries(props ?? {})) {
    if (name === 'children' || value === null || value === undefined) continue
    if (handlerKey !== undefined && name === handlerKey) {
      handler = value
      continue
    }
    cleaned[name] = value
  }
  return {
    type,
    ...(Object.keys(cleaned).length > 0 && { props: cleaned }),
    ...(children.length > 0 && { children }),
    ...(handler !== undefined && { [handlerKey!]: handler }),
  }
}

/**
 * densable `ho` — try/catch around a boolean probe. Gold `Ta` uses this so a
 * bun-shared `Error` constructor cannot recurse `instanceof` into the patch.
 */
function probe(run: () => boolean): boolean {
  try {
    return run()
  } catch {
    return false
  }
}

/** densable `Qsn` — host `instanceof Error` wrapped in `ho`. */
function hostIsError(value: unknown): value is Error {
  return probe(() => value instanceof Error)
}

function errorMessage(err: unknown): string {
  return hostIsError(err) ? err.message : String(err)
}

/** densable `pe` — Script / module.evaluate budget (`ICe(pe, budgetMs)`). */
const SURFACE_EVALUATE_MS = 1000

/** densable `hvo` / `eMe` — isolate context, no wasm/eval strings, drop escape globals. */
function createSurfaceVmContext(): Context {
  /** densable `wa=()=>Object.create(null)` — isolate fills Error/Object, not host copies. */
  const sandbox = Object.create(null) as Record<string, unknown>
  sandbox.h = drawingH
  sandbox.Fragment = (props: { children?: unknown }) => props.children
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })
  try {
    runInContext(
      `(() => {
        Object.defineProperty(Error, 'prepareStackTrace', {
          value: (err, sites) => String(err.stack ?? err),
          writable: false,
          configurable: false,
        });
        for (const g of [
          'ShadowRealm', 'WebAssembly', 'FinalizationRegistry', 'WeakRef',
          'Atomics', 'SharedArrayBuffer', 'queueMicrotask', '$vm', 'gc',
          'edenGC', 'fullGC', 'print', 'readFile', 'Loader',
        ]) {
          try { delete globalThis[g] } catch {}
        }
      })()`,
      context,
    )
  } catch {
    /* bun may refuse some deletes */
  }
  try {
    /**
     * densable `Ta` — patch isolate `Error[Symbol.hasInstance]`. Gold Node
     * contextify gives a distinct constructor; bun may alias host `Error`,
     * and patching that poisons host `instanceof Error`.
     */
    const isolateError = runInContext('Error', context) as typeof Error
    if (isolateError === Error) {
      return context
    }
    hardenIsolateIntrinsics(context)
    const ordinary = Function.prototype[Symbol.hasInstance]
    const patch = runInContext(
      `(isError => {
        const ordinary = Function.prototype[Symbol.hasInstance]
        Object.defineProperty(Error, Symbol.hasInstance, {
          value: function hasInstance(value) {
            return this === Error ? isError(value) : ordinary.call(this, value)
          },
        })
      })`,
      context,
    ) as (isError: (value: unknown) => boolean) => void
    patch(
      (value: unknown) =>
        hostIsError(value) || probe(() => ordinary.call(isolateError, value)),
    )
  } catch {
    /* bun may refuse Error[Symbol.hasInstance] */
  }
  return context
}

/**
 * densable `eMe` remainder — enableOverride + freeze isolate intrinsics.
 * Only when isolate `Error` is not the host constructor (bun aliases).
 */
function hardenIsolateIntrinsics(context: Context): void {
  try {
    runInContext(
      `(() => {
        function enableOverride(proto, key) {
          const d = Object.getOwnPropertyDescriptor(proto, key);
          if (!d || 'get' in d) return;
          const v = d.value;
          Object.defineProperty(proto, key, {
            get() { return v },
            set(nv) {
              if (this === proto) return;
              Object.defineProperty(this, key, {
                value: nv, writable: true, enumerable: true, configurable: true,
              });
            },
            enumerable: d.enumerable, configurable: true,
          });
        }
        const errorCtors = [
          Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError,
          URIError, AggregateError, globalThis.SuppressedError,
        ].filter(Boolean);
        const errorProtos = errorCtors.map(C => C.prototype);
        for (const [proto, keys] of [
          [Object.prototype, Object.getOwnPropertyNames(Object.prototype)],
          [Function.prototype, ['toString', 'constructor', 'name', 'length']],
          [Array.prototype, ['toString', 'constructor']],
          [Date.prototype, ['toString', 'toLocaleString', 'valueOf', 'constructor']],
          ...errorProtos.map(p => [p, ['name', 'message', 'toString', 'constructor']]),
        ]) for (const k of keys) enableOverride(proto, k);
        for (const C of [
          Promise, Object, Array, Function, globalThis.Iterator,
          Map, Set, WeakMap, WeakSet,
          String, Number, Boolean, Symbol, BigInt,
          Date, RegExp, ArrayBuffer, DataView,
          ...errorCtors,
          typeof URL !== 'undefined' ? URL : undefined,
        ].filter(Boolean)) {
          Object.freeze(C);
          Object.freeze(C.prototype);
        }
        for (const C of [
          Object.getPrototypeOf(Int8Array),
          Int8Array, Uint8Array, Uint8ClampedArray,
          Int16Array, Uint16Array, Int32Array, Uint32Array,
          globalThis.Float16Array, Float32Array, Float64Array,
          BigInt64Array, BigUint64Array,
        ].filter(Boolean)) {
          Object.freeze(C);
          Object.freeze(C.prototype);
        }
        for (const f of [async () => {}, function* () {}, async function* () {}]) {
          Object.freeze(f.constructor);
          Object.freeze(f.constructor.prototype);
        }
        for (const C of [
          globalThis.DisposableStack, globalThis.AsyncDisposableStack,
          globalThis.Intl,
        ].filter(Boolean)) {
          Object.freeze(C);
          if (C.prototype) Object.freeze(C.prototype);
        }
        for (const ns of [JSON, Math, Reflect, Proxy]) Object.freeze(ns);
        Object.defineProperty(globalThis, 'then', {
          value: undefined, writable: false, configurable: false,
        });
        if (typeof Intl !== 'undefined') {
          for (const k of Object.getOwnPropertyNames(Intl)) {
            const C = Intl[k];
            if (typeof C === 'function') {
              Object.freeze(C);
              if (C.prototype) Object.freeze(C.prototype);
            }
          }
        }
      })()`,
      context,
    )
  } catch {
    /* bun may refuse freeze */
  }
}

/**
 * densable `tMe` — clone host values into the isolate (drop functions,
 * skip `__proto__`, cap errors stay walker-created).
 */
function cloneIntoIsolate(context: Context, value: unknown): unknown {
  const clone = runInContext(
    `(() => {
      const _WeakMap = WeakMap, _WeakSet = WeakSet, _isArray = Array.isArray,
            _keys = Object.keys, _defineProperty = Object.defineProperty,
            _Error = Error, _isSafeInteger = Number.isSafeInteger
      const _capSet = new _WeakSet()
      function capErr(msg) {
        const e = new _Error(msg)
        _capSet.add(e)
        return e
      }
      function isCap(e) {
        try { return _capSet.has(e) } catch { return false }
      }
      return (hostVal) => {
        const seen = new _WeakMap()
        function c(v) {
          if (typeof v === 'function') return undefined
          if (v === null || typeof v !== 'object') return v
          const hit = seen.get(v); if (hit !== undefined) return hit
          if (_isArray(v)) {
            let len
            try { len = v.length } catch {
              throw new _Error('unable to read array length across the workflow VM boundary')
            }
            if (typeof len !== 'number' || !_isSafeInteger(len)) {
              throw capErr('array length is not a safe integer across the workflow VM boundary')
            }
            const out = []; seen.set(v, out)
            for (let i = 0; i < len; i++) {
              try { out[i] = c(v[i]) } catch (e) { if (isCap(e)) throw e; out[i] = undefined }
            }
            return out
          }
          const out = {}; seen.set(v, out)
          let ks; try { ks = _keys(v) } catch { return out }
          for (const k of ks) {
            if (k === '__proto__') continue
            try {
              const vk = v[k]
              if (typeof vk === 'function') continue
              _defineProperty(out, k, { value: c(vk), writable: true, enumerable: true, configurable: true })
            } catch (e) { if (isCap(e)) throw e }
          }
          return out
        }
        return c(hostVal)
      }
    })()`,
    context,
  ) as (hostVal: unknown) => unknown
  return clone(value)
}

async function withReadyMs<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function realpathOrSelf(file: string): string {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

function insidePluginRoot(root: string, file: string): boolean {
  const fromRoot = relative(realpathOrSelf(root), realpathOrSelf(file))
  return (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== '..' &&
      !isAbsolute(fromRoot))
  )
}

/** densable `Rqe`. */
const SURFACE_KIT = 'claude-code'

/**
 * densable `J2n` / `Lr` — isolate `import "claude-code"` kit. Gold loads
 * `state-library.js` from the SEA; the public table is atom/derive/memberOf/read/update.
 */
/**
 * densable isolate `J2n` public table (`atom`/`derive`/`memberOf`/`read`/`update`)
 * plus host `ko` freeze of atom initial. SEA `state-library.js` txt is bunfs-only.
 */
const SURFACE_KIT_SOURCE = `const atomTag = Symbol.for('claude-code.state.atom')
const derivedTag = Symbol.for('claude-code.state.derived')
function ko(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const item of Object.values(value)) ko(item)
  return Object.freeze(value)
}
export function atom(init) {
  let value = ko(typeof init === 'function' ? init() : init)
  const listeners = new Set()
  const held = {
    [atomTag]: true,
    get() { return value },
    set(nextValue) {
      value = ko(nextValue)
      for (const listener of listeners) listener()
    },
    sub(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return Object.freeze(held)
}
export function derive(fn) {
  return Object.freeze({
    [derivedTag]: true,
    get: fn,
    set() {},
    sub() { return () => {} },
  })
}
export function memberOf(held, key) {
  return Object.freeze({
    get() { return held.get()?.[key] },
    set(nextValue) {
      const cur = held.get()
      if (cur && typeof cur === 'object') held.set({ ...cur, [key]: nextValue })
    },
    sub(listener) { return held.sub(listener) },
  })
}
export function read(held) { return held.get() }
export function update(held, fn) {
  held.set(fn(held.get()))
  return held.get()
}
`

/** densable `KGn` / `UKe` — code-like extensions a surface import may end in. */
const SURFACE_CODE_EXT = [
  '.ts',
  '.tsx',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]

/** densable `tPr` — relative specifier, or the `claude-code` kit. */
function isRelativeSurfaceImport(spec: string): boolean {
  return (
    spec === '.' ||
    spec === '..' ||
    spec.startsWith('./') ||
    spec.startsWith('../')
  )
}

function isSurfaceKit(spec: string): boolean {
  return spec === SURFACE_KIT
}

/** densable `Cvo`. */
function surfaceImportDenied(
  pluginName: string,
  specifier: string,
  from: string,
): Error {
  return new Error(
    `${pluginName}: cannot import "${specifier}" (from ${from}): a hooks module imports its own files by relative path and "claude-code", nothing else`,
  )
}

/** densable `zo` — spelled path plus sibling extensions and `index.*`. */
function surfaceFileCandidates(file: string): string[] {
  const out = [file]
  if (file.endsWith('.js')) {
    const stem = file.slice(0, -3)
    out.push(`${stem}.ts`, `${stem}.tsx`)
  }
  if (file.endsWith('.jsx')) out.push(`${file.slice(0, -4)}.tsx`)
  if (file.endsWith('.mjs')) out.push(`${file.slice(0, -4)}.mts`)
  if (file.endsWith('.cjs')) out.push(`${file.slice(0, -4)}.cts`)
  for (const ext of SURFACE_CODE_EXT) {
    out.push(`${file}${ext}`)
    out.push(join(file, `index${ext}`))
  }
  return out
}

/** densable `Fat` — realpath must stay inside the plugin folder and be a file. */
function surfaceRealFile(
  pluginName: string,
  spelled: string,
  file: string,
  root: string,
): string {
  const real = realpathOrSelf(file)
  if (!insidePluginRoot(root, real)) {
    throw new Error(
      `${pluginName}: ${file}: ${real} resolves outside the plugin's folder`,
    )
  }
  try {
    if (!lstatSync(real).isFile()) {
      throw new Error(`${pluginName}: ${spelled}: not a regular file`)
    }
  } catch (err) {
    if (hostIsError(err) && err.message.includes('not a regular file'))
      throw err
    throw new Error(`${pluginName}: ${spelled}: not a regular file`)
  }
  return real
}

/**
 * densable `Avo` — try every `zo` candidate; Fat errors in Xo
 * (`no such file` / `not a regular file` / `resolves outside`) continue.
 */
function pickSurfaceFile(
  pluginName: string,
  specifier: string,
  from: string,
  resolved: string,
  root: string,
  modulePath: string,
): string {
  const prefix = `${pluginName}: cannot import "${specifier}" (from ${from}):`
  const errors: string[] = []
  for (const candidate of surfaceFileCandidates(resolved)) {
    if (candidate !== modulePath && !existsSync(candidate)) continue
    try {
      if (!insidePluginRoot(root, candidate)) {
        throw new Error(`${prefix} it is outside the plugin's folder (${root})`)
      }
      if (candidate === modulePath) return candidate
      return surfaceRealFile(pluginName, specifier, candidate, root)
    } catch (err) {
      const msg = errorMessage(err)
      if (
        msg.includes('no such file') ||
        msg.includes('not a regular file') ||
        msg.includes('resolves outside') ||
        msg.includes('outside the plugin')
      ) {
        errors.push(msg)
        continue
      }
      throw err
    }
  }
  throw new Error(
    errors.length === 0
      ? `${prefix} no such file under ${root}`
      : `${prefix} no such file under ${root}`,
  )
}

async function loadSurfaceFile(
  pluginName: string,
  root: string,
  modulePath: string,
  source: string,
  context: Context,
): Promise<Record<string, unknown>> {
  const modules = new Map<string, SourceTextModule>()
  const sources = new Map<string, string>([[modulePath, source]])
  const kit = new SourceTextModule(SURFACE_KIT_SOURCE, {
    identifier: SURFACE_KIT,
    context,
  })
  modules.set(SURFACE_KIT, kit)
  const link = async (specifier: string, referrer: { identifier: string }) => {
    const from = referrer.identifier
    if (isSurfaceKit(specifier)) return kit
    if (!isRelativeSurfaceImport(specifier)) {
      throw surfaceImportDenied(pluginName, specifier, from)
    }
    const resolved = resolve(from, '..', specifier)
    const file = pickSurfaceFile(
      pluginName,
      specifier,
      from,
      resolved,
      root,
      modulePath,
    )
    return moduleFor(file)
  }
  const moduleFor = (file: string): SourceTextModule => {
    const cached = modules.get(file)
    if (cached) return cached
    const raw =
      sources.get(file) ??
      (file === modulePath ? source : readFileSync(file, 'utf8'))
    sources.set(file, raw)
    /** densable `MNo(lin(h,v), h, a)` — transpile then rewrite Client() literals. */
    const text = rewriteClientModuleLiterals(
      transpileSurfaceSource(file, raw),
      file,
      root,
    )
    const created = new SourceTextModule(text, {
      identifier: file,
      context,
      initializeImportMeta(meta) {
        meta.url = pathToFileURL(file).href
      },
      async importModuleDynamically(specifier, referrer) {
        const linked = await link(specifier, referrer)
        if (linked.status === 'unlinked') await linked.link(link)
        if (linked.status === 'linked') {
          await linked.evaluate({ timeout: SURFACE_EVALUATE_MS })
        }
        return linked
      },
    })
    modules.set(file, created)
    return created
  }
  const main = moduleFor(modulePath)
  await main.link(link)
  await withReadyMs(
    Promise.resolve(main.evaluate({ timeout: SURFACE_EVALUATE_MS })),
    SURFACE_READY_MS,
    `its top level did not settle in ${SURFACE_READY_MS}ms`,
  )
  return main.namespace as Record<string, unknown>
}

function pickComponent(
  exports: Record<string, unknown>,
  named: string,
): unknown {
  if (Object.hasOwn(exports, named)) return exports[named]
  if (Object.hasOwn(exports, 'default')) return exports.default
  const caps = Object.keys(exports).filter(key => /^[A-Z]/.test(key))
  if (caps.length === 1) return exports[caps[0]!]
  return undefined
}

async function buildEnvironment(
  pluginName: string,
): Promise<SurfaceEnvironment> {
  const held = pluginSurfaces.get(pluginName)
  if (!held) {
    throw new Error(`${pluginName}: Client: the plugin is not loaded`)
  }
  const scanned = held.modules
  if (scanned.length === 0) {
    throw new Error(
      `${pluginName}: Client: the plugin loaded no surface module (its hooks module builds no Client from a literal path), so nothing can draw its Clients`,
    )
  }
  const root = held.root
  const context = createSurfaceVmContext()
  let nextId = 0
  let nextTimer = 0
  const mounts = new Map<number, MountedSurface>()
  let surfaceRuntime!: SurfaceRuntime
  surfaceRuntime = installSurfaceRuntime(
    context,
    {
      schedule: id => {
        mounts.get(id)?.host.schedule()
      },
      post: (id, text) => {
        const mount = mounts.get(id)
        if (!mount) return
        if (text.length > POST_CHARS) {
          throw new Error(
            `${pluginName}: Client ${mount.module}: post: the data serializes to ${text.length} characters, over the ${POST_CHARS} limit; not sent`,
          )
        }
        try {
          mount.host.post(JSON.parse(text) as unknown)
        } catch {
          mount.host.post(text)
        }
      },
      startTimer: (id, intervalMs) => {
        const mount = mounts.get(id)
        const timer = ++nextTimer
        if (!mount) return timer
        const cancel = mount.host.startTimer(
          Math.max(intervalMs, CLOCK_MIN_MS),
          () => {
            if (mounts.get(id)?.timers.has(timer) !== true) return
            surfaceRuntime.stage(id, 'tick', timer)
            surfaceRuntime.run()
          },
        )
        mount.timers.set(timer, cancel)
        return timer
      },
      stopTimer: (id, timer) => {
        const mount = mounts.get(id)
        mount?.timers.get(timer)?.()
        mount?.timers.delete(timer)
      },
    },
    SURFACE_LIMITS,
    `${pluginName} surface`,
  )
  const loaded = new Map<
    string,
    { component: string; exports: Record<string, unknown> } | { error: Error }
  >()
  for (const item of scanned) {
    try {
      const exports = await loadSurfaceFile(
        pluginName,
        root,
        item.modulePath,
        item.source,
        context,
      )
      loaded.set(item.module, { component: item.component, exports })
    } catch (err) {
      loaded.set(item.module, {
        error: new Error(
          `${pluginName}: Client ${item.module}: the surface module did not load: ${errorMessage(err)}`,
        ),
      })
    }
  }
  return {
    mount(input) {
      const heldModule = loaded.get(input.module)
      if (!heldModule) {
        const names = [...loaded.keys()].join(', ') || 'none'
        throw new Error(
          `${pluginName}: Client ${input.module}: the plugin loaded no surface module at that path (it loaded ${names})`,
        )
      }
      if ('error' in heldModule) throw heldModule.error
      const fn = pickComponent(heldModule.exports, heldModule.component)
      if (typeof fn !== 'function') {
        throw new Error(
          `${pluginName}: Client ${input.module}: its export ${heldModule.component} is not a function (props, surface) => tree`,
        )
      }
      const id = ++nextId
      const hostTimers = new Map<number, () => void>()
      mounts.set(id, {
        module: input.module,
        host: input.host,
        timers: hostTimers,
      })
      surfaceRuntime.mount(
        id,
        fn as (props: unknown, surface: unknown) => unknown,
        cloneIntoIsolate(context, input.props),
      )
      const runStaged = (kind: string, payload?: unknown): unknown => {
        surfaceRuntime.stage(
          id,
          kind,
          payload === undefined
            ? undefined
            : cloneIntoIsolate(context, payload),
        )
        return surfaceRuntime.run()
      }
      return {
        render() {
          const json = runStaged('render')
          if (typeof json !== 'string') {
            throw new Error('the module returned no tree')
          }
          return JSON.parse(json) as unknown
        },
        setProps(next) {
          surfaceRuntime.setProps(id, cloneIntoIsolate(context, next))
        },
        resize(columns, rows) {
          surfaceRuntime.resize(id, columns, rows)
        },
        pointer(event) {
          runStaged('pointer', event)
        },
        key(event) {
          runStaged('key', event)
        },
        hasPointerListener: () => surfaceRuntime.hasListener(id, 'pointer'),
        hasKeyListener: () => surfaceRuntime.hasListener(id, 'key'),
        runHeld(handle, event) {
          runStaged('held', { handle, event })
        },
        dropHeld(handles) {
          surfaceRuntime.dropHeld(
            id,
            cloneIntoIsolate(context, handles) as number[],
          )
        },
        unmount() {
          const mount = mounts.get(id)
          if (mount) {
            for (const cancel of mount.timers.values()) cancel()
            mount.timers.clear()
            mounts.delete(id)
          }
          surfaceRuntime.unmount(id)
        },
      }
    },
  }
}

function environmentFor(plugin: string): Promise<SurfaceEnvironment> {
  const held = environments.get(plugin)
  if (held) return held.loading
  const loading = buildEnvironment(plugin)
  environments.set(plugin, { loading })
  return loading
}

function attach(record: ClientRecord): ClientInstance {
  return {
    id: record.id,
    plugin: record.plugin,
    module: record.module,
    subscribe(listener) {
      record.listeners.add(listener)
      return () => {
        record.listeners.delete(listener)
      }
    },
    getSnapshot: () => record.snapshot,
    setProps(next) {
      record.props = next
      resetUnprompted(record.plugin)
      try {
        record.surface?.setProps(next)
      } catch (err) {
        failRecord(record, errorMessage(err))
        return
      }
      paint(record)
    },
    resize(columns, rows) {
      if (columns === record.columns && rows === record.rows) return
      record.columns = columns
      record.rows = rows
      resetUnprompted(record.plugin)
      try {
        record.surface?.resize(columns, rows)
      } catch {
        /* gold T */
      }
      paint(record)
    },
    pointer(event) {
      resetUnprompted(record.plugin)
      try {
        record.surface?.pointer(event)
      } catch (err) {
        failRecord(record, errorMessage(err))
      }
    },
    key(event) {
      resetUnprompted(record.plugin)
      try {
        record.surface?.key(event)
      } catch (err) {
        failRecord(record, errorMessage(err))
      }
    },
    acceptsPointer: () => record.surface?.hasPointerListener() === true,
    acceptsKeys: () => record.surface?.hasKeyListener() === true,
    runHeld(handle, event) {
      resetUnprompted(record.plugin)
      try {
        record.surface?.runHeld(handle, event)
      } catch (err) {
        failRecord(record, errorMessage(err))
      }
    },
    dropHeld(handles) {
      try {
        record.surface?.dropHeld(handles)
      } catch {
        /* gold T */
      }
    },
    release() {
      record.holders = Math.max(0, record.holders - 1)
      if (record.holders === 0 && !record.isDestroyed) {
        clearTimeout(record.destroyTimer)
        record.destroyTimer = setTimeout(() => {
          if (record.holders === 0) destroy(record)
        }, 0)
      }
    },
  }
}

function destroy(record: ClientRecord): void {
  if (record.isDestroyed) return
  record.isDestroyed = true
  clearTimeout(record.destroyTimer)
  unmountSurface(record)
  if (instances.get(record.id) === record) instances.delete(record.id)
}

function mountWhenReady(record: ClientRecord): void {
  record.mountGeneration += 1
  const generation = record.mountGeneration
  environmentFor(record.plugin).then(
    env => {
      if (generation !== record.mountGeneration || record.isDestroyed) return
      if (record.surface) return
      try {
        record.surface = env.mount({
          module: record.module,
          props: record.props,
          host: {
            schedule: () => schedule(record),
            post: () => undefined,
            startTimer: (ms, tick) => {
              const id = setInterval(tick, Math.max(ms, CLOCK_MIN_MS))
              return () => clearInterval(id)
            },
          },
        })
        record.surface.resize(record.columns, record.rows)
        paint(record)
      } catch (err) {
        failRecord(record, errorMessage(err))
      }
    },
    err => {
      if (generation !== record.mountGeneration || record.isDestroyed) return
      failRecord(record, errorMessage(err))
    },
  )
}

function createRecord(input: {
  plugin: string
  surface: string
  requestId: string
  key: string
  module: string
  props: unknown
}): ClientRecord {
  const id = clientInstanceKey(input)
  return {
    id,
    plugin: input.plugin,
    module: input.module,
    element: input.key,
    requestId: input.requestId,
    surfaceName: input.surface,
    props: input.props,
    columns: 0,
    rows: 0,
    surface: undefined,
    snapshot: LOADING,
    listeners: new Set(),
    holders: 1,
    isDestroyed: false,
    isDirty: false,
    isRendering: false,
    unpromptedRenders: 0,
    renderTimer: undefined,
    mountGeneration: 0,
    destroyTimer: undefined,
  }
}

const DETACHED: ClientInstance = {
  id: '',
  plugin: '',
  module: '',
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  setProps: () => undefined,
  resize: () => undefined,
  pointer: () => undefined,
  key: () => undefined,
  acceptsPointer: () => false,
  acceptsKeys: () => false,
  runHeld: () => undefined,
  dropHeld: () => undefined,
  release: () => undefined,
}

export const DETACHED_CLIENT = DETACHED

/** densable `rKr.acquire`. */
export function acquirePluginClient(input: {
  plugin: string
  component?: string
  requestId?: string
  surface?: string
  key: string
  module: string
  props?: unknown
}): ClientInstance {
  const surface = input.surface ?? 'terminal'
  const requestId = input.requestId ?? 'detached'
  const id = clientInstanceKey({
    plugin: input.plugin,
    surface,
    requestId,
    key: input.key,
  })
  const held = instances.get(id)
  if (held !== undefined && !held.isDestroyed && held.module === input.module) {
    clearTimeout(held.destroyTimer)
    held.destroyTimer = undefined
    held.holders += 1
    held.props = input.props
    try {
      held.surface?.setProps(input.props)
    } catch {
      /* */
    }
    return attach(held)
  }
  if (held) destroy(held)
  const created = createRecord({
    plugin: input.plugin,
    surface,
    requestId,
    key: input.key,
    module: input.module,
    props: input.props,
  })
  instances.set(id, created)
  mountWhenReady(created)
  return attach(created)
}

export function disposePluginClients(): void {
  for (const record of [...instances.values()]) destroy(record)
  instances.clear()
  environments.clear()
  pluginSurfaces.clear()
}

const CLIENT_RELATIVE = /^\.\.?(?:\/|$)/

/** densable `Lo` — classic jsx pragma for `lin` / Bun.Transpiler. */
const SURFACE_JSX_PRAGMA = `/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
`

/** densable `ao` — loader from `KGn` / `UKe`. */
function surfaceLoaderOf(file: string): string {
  const ext = SURFACE_CODE_EXT.find(item => file.endsWith(item))
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts'
  if (ext === '.tsx') return 'tsx'
  if (ext === '.jsx') return 'jsx'
  return 'js'
}

/**
 * densable `lin` — JS files pass through; TS/JSX go through Bun.Transpiler
 * with the classic `h`/`Fragment` pragma.
 */
function transpileSurfaceSource(file: string, source: string): string {
  const loader = surfaceLoaderOf(file)
  if (loader === 'js') return source
  const prefix = loader === 'ts' ? '' : SURFACE_JSX_PRAGMA
  const transpiler = new Bun.Transpiler({ loader, macro: false })
  return transpiler.transformSync(`${prefix}${source}`)
}

type AcornNode = {
  type: string
  start?: number
  end?: number
  name?: string
  value?: unknown
  callee?: AcornNode
  arguments?: AcornNode[]
  properties?: AcornNode[]
  key?: AcornNode
  computed?: boolean
  kind?: string
  expressions?: unknown[]
  quasis?: Array<{ value?: { cooked?: string | null } }>
}

function acornParse(source: string): AcornNode | undefined {
  try {
    const { parse } = require('acorn') as {
      parse: (
        code: string,
        opts: {
          ecmaVersion: 'latest'
          sourceType: 'module'
          locations?: boolean
        },
      ) => AcornNode
    }
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return undefined
  }
}

function literalString(node: AcornNode | undefined): string | undefined {
  if (node === undefined) return undefined
  if (node.type === 'Literal' && typeof node.value === 'string')
    return node.value
  if (
    node.type === 'TemplateLiteral' &&
    (node.expressions?.length ?? 0) === 0
  ) {
    const cooked = node.quasis?.[0]?.value?.cooked
    return cooked === undefined || cooked === null ? undefined : cooked
  }
  return undefined
}

function isClientCallee(node: AcornNode | undefined): boolean {
  if (node === undefined) return false
  if (node.type === 'Identifier' && node.name === 'Client') return true
  if (node.type === 'Literal' && node.value === 'Client') return true
  if (node.type === 'MemberExpression' && node.computed !== true) {
    const rec = node as AcornNode & { property?: AcornNode }
    return rec.property?.type === 'Identifier' && rec.property.name === 'Client'
  }
  return false
}

function clientModuleArg(call: AcornNode): AcornNode | undefined {
  const args = call.arguments ?? []
  const callee = call.callee
  if (callee !== undefined && isClientCallee(callee)) return args[0]
  if (
    callee?.type === 'Identifier' &&
    callee.name === 'h' &&
    args[0] !== undefined &&
    isClientCallee(args[0])
  ) {
    return args[1]
  }
  return undefined
}

function moduleProperty(obj: AcornNode): AcornNode | undefined {
  let held: AcornNode | undefined
  for (const prop of obj.properties ?? []) {
    if (prop.type === 'SpreadElement') continue
    const key = prop.key
    const isModule =
      prop.computed !== true &&
      ((key?.type === 'Identifier' && key.name === 'module') ||
        (key?.type === 'Literal' && key.value === 'module'))
    if (isModule) held = prop
  }
  return held
}

/**
 * densable `xo` — Client module path relative to the plugin root, posix.
 */
function clientModuleFromSpelled(
  spelled: string,
  file: string,
  root: string,
): string | undefined {
  if (!isRelativeSurfaceImport(spelled)) return undefined
  if (!SURFACE_CODE_EXT.some(ext => spelled.endsWith(ext))) return undefined
  const resolved = resolve(file, '..', spelled)
  const fromRoot = relative(root, resolved)
  if (
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    return undefined
  }
  return fromRoot.split(sep).join('/')
}

/**
 * densable MNo skips comment AST. Regex fallback: scan to `index` so
 * `//` inside a string/URL (`https://`) is not a line comment.
 */
function sourceIndexInComment(source: string, index: number): boolean {
  let i = 0
  let quote: '"' | "'" | '`' | null = null
  let block = false
  while (i < index) {
    const ch = source[i]!
    const next = source[i + 1]
    if (block) {
      if (ch === '*' && next === '/') {
        block = false
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (quote !== null) {
      if (ch === '\\' && quote !== '`') {
        i += 2
        continue
      }
      if (quote === '`' && ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      block = true
      i += 2
      continue
    }
    if (ch === '/' && next === '/') {
      i += 2
      while (i < index && source[i] !== '\n' && source[i] !== '\r') i += 1
      if (i >= index) return true
      continue
    }
    i += 1
  }
  return block
}

/**
 * densable `MNo` — rewrite `Client({ module: "./board.tsx" })` literals to
 * the posix path from the plugin root. Walks last-to-first so slices stay
 * valid. Acorn is optional (this repo has no `acorn` package); the regex
 * matches gold `co`/`fr` Client() + `h(Client, …)` spelled strings.
 */
export function rewriteClientModuleLiterals(
  source: string,
  file: string,
  root: string,
): string {
  if (!source.includes('Client')) return source
  const hits: Array<{ start: number; end: number; next: string }> = []
  const tree = acornParse(source)
  if (tree !== undefined) {
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return
      const rec = node as AcornNode
      if (rec.type === 'CallExpression') {
        const arg = clientModuleArg(rec)
        if (arg?.type === 'ObjectExpression') {
          const prop = moduleProperty(arg)
          const value = prop?.value as AcornNode | undefined
          const spelled = literalString(value)
          const start = value?.start
          const end = value?.end
          if (
            spelled !== undefined &&
            start !== undefined &&
            end !== undefined
          ) {
            const next = clientModuleFromSpelled(spelled, file, root)
            if (next !== undefined) {
              hits.push({ start, end, next: JSON.stringify(next) })
            }
          }
        }
      }
      for (const child of Object.values(rec)) {
        if (Array.isArray(child)) {
          for (const item of child) walk(item)
        } else {
          walk(child)
        }
      }
    }
    walk(tree)
  }
  if (hits.length === 0) {
    /**
     * densable `co`/`lr`/`fr` without acorn: only `Client({ module })` or
     * `h(Client, { module })`. `notClient({ module })` and a comment that
     * merely contains "Client" must not rewrite.
     */
    const re =
      /(?:^|[^\w$])(?:Client\s*\(|h\s*\(\s*Client\s*,)\s*\{[^}]*?\bmodule\s*:\s*(['"`])(\.\.?\/[^'"`]+)\1/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      const spelled = match[2]!
      const quote = match[1]!
      const start = match.index + match[0].lastIndexOf(quote + spelled + quote)
      const end = start + spelled.length + 2
      if (sourceIndexInComment(source, start)) continue
      const next = clientModuleFromSpelled(spelled, file, root)
      if (next !== undefined)
        hits.push({ start, end, next: JSON.stringify(next) })
    }
  }
  hits.sort((a, b) => b.start - a.start)
  let out = source
  for (const hit of hits) {
    out = `${out.slice(0, hit.start)}${hit.next}${out.slice(hit.end)}`
  }
  return out
}

function isRelativeClientPath(value: string): boolean {
  return CLIENT_RELATIVE.test(value) && !value.includes('\0')
}

/**
 * densable `xo` / scan.clients: relative Client module paths from the
 * hooks file (`Client("./board")` or `module: "./board"`).
 */
export function scanClientModulePaths(source: string): string[] {
  const found = new Set<string>()
  try {
    const { parse } = require('acorn') as {
      parse: (
        code: string,
        opts: { ecmaVersion: 'latest'; sourceType: 'module' },
      ) => unknown
    }
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return
      const rec = node as Record<string, unknown>
      if (rec.type === 'CallExpression') {
        const callee = rec.callee as Record<string, unknown> | undefined
        const args = rec.arguments as unknown[] | undefined
        const name =
          callee?.type === 'Identifier' && typeof callee.name === 'string'
            ? callee.name
            : undefined
        const first = args?.[0] as Record<string, unknown> | undefined
        if (
          name === 'Client' &&
          first?.type === 'Literal' &&
          typeof first.value === 'string' &&
          isRelativeClientPath(first.value)
        ) {
          found.add(first.value)
        }
      }
      if (
        rec.type === 'Property' &&
        ((rec.key as { name?: string; value?: unknown } | undefined)?.name ===
          'module' ||
          (rec.key as { value?: unknown } | undefined)?.value === 'module')
      ) {
        const value = rec.value as Record<string, unknown> | undefined
        if (
          value?.type === 'Literal' &&
          typeof value.value === 'string' &&
          isRelativeClientPath(value.value)
        ) {
          found.add(value.value)
        }
      }
      for (const child of Object.values(rec)) {
        if (Array.isArray(child)) {
          for (const item of child) walk(item)
        } else {
          walk(child)
        }
      }
    }
    walk(tree)
  } catch {
    const re = /(?:Client\(\s*|module\s*:\s*)(['"`])(\.\.?\/[^'"`]+)\1/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) found.add(match[2]!)
  }
  return [...found]
}

function componentOfSurfaceSource(source: string): string {
  if (/export\s+default\b/.test(source)) return 'default'
  const named = source.match(/export\s+function\s+([A-Z][A-Za-z0-9_]*)/)
  if (named?.[1]) return named[1]
  const constCap = source.match(/export\s+(?:const|let)\s+([A-Z][A-Za-z0-9_]*)/)
  if (constCap?.[1]) return constCap[1]
  return 'default'
}

export function loadScannedSurfaceModules(
  pluginRoot: string,
  spelled: readonly string[],
): SurfaceModuleScan[] {
  const next: SurfaceModuleScan[] = []
  for (const module of spelled) {
    if (!isRelativeClientPath(module)) continue
    const modulePath = resolve(pluginRoot, module)
    if (!existsSync(modulePath)) continue
    if (!insidePluginRoot(pluginRoot, modulePath)) continue
    const source = readFileSync(modulePath, 'utf8')
    next.push({
      module,
      modulePath,
      component: componentOfSurfaceSource(source),
      source,
    })
  }
  return next
}
