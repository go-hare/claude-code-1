/**
 * Official Claude Code 2.1.331 REPL / Code Mode host-call DoS & input
 * validation guards.
 *
 * 1:1 alignment with extracted 2.1.331 modules:
 * - `chunk-gyvea1hp.js`: `Ae` (primitive-only wire args `xe`, per-turn call &
 *   char budget `#E`/`#w`/`#k`, `Ce = 65536`, `ct = 536870912`), `Je`
 *   (`createCodec`), `ae` (wire length & depth guard), `qe` / `be` (host op
 *   validation & `ye`), `me = 134217728`, `ze = 2000`, `$t = 3 * ze + 8`,
 *   `he = 1e6`.
 * - `kernel.prelude.js`: `module_protocol_codec` (`createCodec`, `tooLong`,
 *   `mostDepth`, `mostDigits`, `mostChars`).
 * - `chunk-ardxtvpf.js`: `hBe` (JSON bracket/brace depth scanner skipping
 *   string literals & escape runs).
 * - `chunk-e44nxx45.js`: `m8o = 268435456`, `MNt` (host op schemas), `ple` /
 *   `o$a` (`plainErrorLine` mapping for too-large / too-long-numbers /
 *   nested-too-deeply / unawaited Promise).
 * - `chunk-27n4hbw4.js`: `N_ = 4096`.
 * - Schema transform circular guard (`J.read` / `w.recall`):
 *   `"A circular value cannot pass through a transform"`.
 */

import { types as utilTypes } from 'node:util'
import {
  formatReplCallTooDeepError,
  formatReplCallTooManyBigIntDigitsError,
  REPL_CALL_NOT_MADE_PREFIX,
  REPL_CALL_TOO_DEEP_PLAIN_ERROR,
  REPL_CALL_TOO_LARGE_ERROR,
  REPL_CALL_TOO_LARGE_PLAIN_ERROR,
  REPL_CALL_TOO_LONG_NUMBERS_PLAIN_ERROR,
  REPL_CIRCULAR_TRANSFORM_ERROR,
  REPL_MOST_DEPTH,
  REPL_MOST_DIGITS,
  REPL_MOST_ITEMS,
  REPL_MOST_JSON_CHARS,
  REPL_MOST_TEXT_CHARS,
  REPL_PRIMITIVE_ONLY_ARGS_ERROR,
  REPL_TURN_BUDGET_EXCEEDED_ERROR,
  REPL_TURN_MAX_QUEUED_CALLS,
  REPL_TURN_MAX_QUEUED_CHARS,
  REPL_UNAWAITED_PROMISE_ERROR,
  REPL_UNAWAITED_PROMISE_PLAIN_ERROR,
  REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
  REPL_WIRE_MAX_DEPTH,
} from './constants.js'

export type ReplDosLimits = {
  /** Official `N_` (default 4096). */
  mostItems?: number
  /** Official `ze` / `R8r.mostDepth` (default 2000). */
  mostDepth?: number
  /** Official `he` (default 1_000_000). */
  mostDigits?: number
  /** Official `me` (default 134_217_728). */
  mostJsonChars?: number
  /** Official `m8o` (default 268_435_456). */
  mostTextChars?: number
  /** Official `$t = 3 * mostDepth + 8` (default 6008). */
  maxWireDepth?: number
  /** Official `Ce` (default 65_536). */
  maxTurnCalls?: number
  /** Official `ct` (default 536_870_912). */
  maxTurnChars?: number
}

export type ResolvedReplDosLimits = {
  mostItems: number
  mostDepth: number
  mostDigits: number
  mostJsonChars: number
  mostTextChars: number
  maxWireDepth: number
  maxTurnCalls: number
  maxTurnChars: number
}

export function resolveReplDosLimits(
  overrides?: ReplDosLimits,
): ResolvedReplDosLimits {
  const mostDepth = overrides?.mostDepth ?? REPL_MOST_DEPTH
  return {
    mostItems: overrides?.mostItems ?? REPL_MOST_ITEMS,
    mostDepth,
    mostDigits: overrides?.mostDigits ?? REPL_MOST_DIGITS,
    mostJsonChars: overrides?.mostJsonChars ?? REPL_MOST_JSON_CHARS,
    mostTextChars: overrides?.mostTextChars ?? REPL_MOST_TEXT_CHARS,
    maxWireDepth:
      overrides?.maxWireDepth ??
      (overrides?.mostDepth !== undefined
        ? 3 * mostDepth + 8
        : REPL_WIRE_MAX_DEPTH),
    maxTurnCalls: overrides?.maxTurnCalls ?? REPL_TURN_MAX_QUEUED_CALLS,
    maxTurnChars: overrides?.maxTurnChars ?? REPL_TURN_MAX_QUEUED_CHARS,
  }
}

// ============================================================================
// Plain Error Line Mapping (Official `ple`, `o$a`, `Sei` in 2.1.331)
// ============================================================================

export type ReplPlainErrorLine = {
  text: string
  replaces: string
}

const plainErrorTags = new WeakMap<object, string>()

const PLAIN_CALL_NOT_MADE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^its arguments are too large\. Pass less, or write the data to a file\.$/,
    REPL_CALL_TOO_LARGE_PLAIN_ERROR,
  ],
  [
    /^its BigInts have over \d+ digits together\. Pass them as text\.$/,
    REPL_CALL_TOO_LONG_NUMBERS_PLAIN_ERROR,
  ],
  [
    /^an argument nests more than \d+ levels deep\. Pass a flatter value\.$/,
    REPL_CALL_TOO_DEEP_PLAIN_ERROR,
  ],
]

/**
 * Official `ple(err, text)`: associate a user-facing plain error line with a
 * thrown error object.
 */
export function tagReplPlainError<T extends object>(err: T, text: string): T {
  plainErrorTags.set(err, text)
  return err
}

/**
 * Official `o$a(err, formattedError)`: map verbose model-facing REPL host-call
 * `TypeError`s (or explicitly tagged errors) to their concise user-facing line.
 */
export function mapReplPlainErrorLine(
  err: unknown,
  formattedError: string,
): string | undefined {
  if ((typeof err === 'object' && err !== null) || typeof err === 'function') {
    const tagged = plainErrorTags.get(err)
    if (tagged !== undefined) return tagged
  }
  if (formattedError.startsWith(REPL_CALL_NOT_MADE_PREFIX)) {
    const rest = formattedError.slice(REPL_CALL_NOT_MADE_PREFIX.length)
    for (const [pattern, plain] of PLAIN_CALL_NOT_MADE_PATTERNS) {
      if (pattern.test(rest)) return plain
    }
  }
  if (formattedError === `TypeError: ${REPL_UNAWAITED_PROMISE_ERROR}`) {
    return REPL_UNAWAITED_PROMISE_PLAIN_ERROR
  }
  return undefined
}

const SUMMARY_MAX_CHARS = 500
const TYPEERROR_EVAL_RE = /\.? \((?:evaluating|In|near) '/
const SIMPLE_IDENT_CHAIN_RE = /^[\w$]+(?:\??\.[\w$]+)*$/
const IS_NOT_KIND_RE = /^is not (?:a function|a constructor|an object)$/i
const TRAILING_IS_NOT_RE =
  / (is not (?:a function|a constructor|an object))\.?(?=\n|$)/i
const DESCRIBE_TOOL_MISSING_PREFIX = 'describeTool: no tool named'
const DESCRIBE_TOOL_MISSING_PLAIN = 'describeTool: no tool has that name.'

function firstDisplayLine(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const clipped =
    firstLine.length > SUMMARY_MAX_CHARS
      ? `${firstLine.slice(0, SUMMARY_MAX_CHARS)}\u2026`
      : firstLine
  return clipped.trim()
}

function summarizeTypeErrorSubject(subject: string, predicate: string): string {
  return SIMPLE_IDENT_CHAIN_RE.test(subject)
    ? `TypeError: ${subject} ${predicate}`
    : `TypeError: a value ${predicate}`
}

/**
 * Official `Sei` / `m(text)`: compute the normalized single-line summary that
 * `plainErrorLine.replaces` matches against.
 */
export function summarizeReplErrorLine(errorText: string): string {
  const isTypeError = errorText.startsWith('TypeError: ')
  const evalIdx = isTypeError ? errorText.search(TYPEERROR_EVAL_RE) : -1
  let candidate = errorText
  if (evalIdx !== -1) {
    const body = errorText.slice(11, evalIdx)
    const isNotIdx = body.lastIndexOf(' is not ')
    const predicate = body.slice(isNotIdx + 1)
    candidate =
      isNotIdx === -1 || !IS_NOT_KIND_RE.test(predicate)
        ? 'TypeError'
        : summarizeTypeErrorSubject(body.slice(0, isNotIdx), predicate)
  } else if (isTypeError) {
    const match = TRAILING_IS_NOT_RE.exec(errorText)
    const predicate = match?.[1]
    if (match !== null && predicate !== undefined) {
      candidate = summarizeTypeErrorSubject(
        errorText.slice(11, match.index),
        predicate,
      )
    }
  }
  const line = firstDisplayLine(candidate)
  const describeIdx = line.indexOf(DESCRIBE_TOOL_MISSING_PREFIX)
  return (
    (describeIdx === -1
      ? line
      : line.slice(0, describeIdx) + DESCRIBE_TOOL_MISSING_PLAIN) || 'Error'
  )
}

/**
 * Format a thrown value (host `Error` or cross-realm VM `Error`) to its
 * `Name: message` header matching official `H`.
 */
export function formatThrownErrorHeader(err: unknown): string {
  if (err instanceof Error) {
    const name = typeof err.name === 'string' && err.name ? err.name : 'Error'
    return err.message ? `${name}: ${err.message}` : name
  }
  if (typeof err === 'object' && err !== null) {
    const rec = err as { name?: unknown; message?: unknown }
    if (typeof rec.name === 'string' && typeof rec.message === 'string') {
      return rec.message ? `${rec.name}: ${rec.message}` : rec.name
    }
  }
  try {
    return String(err)
  } catch {
    return 'Error'
  }
}

// ============================================================================
// Wire JSON Nesting Depth Scanner (Official `hBe` + `C` in chunk-ardxtvpf.js)
// ============================================================================

const HAS_JSON_CONTAINER_RE = /[[{]/

function skipJsonStringEnd(text: string, openQuoteIndex: number): number {
  for (
    let pos = text.indexOf('"', openQuoteIndex + 1);
    pos !== -1;
    pos = text.indexOf('"', pos + 1)
  ) {
    let backslashes = 0
    while (text.charCodeAt(pos - 1 - backslashes) === 92) {
      backslashes++
    }
    if (backslashes % 2 === 0) {
      return pos
    }
  }
  return text.length - 1
}

/**
 * Official `hBe(text, maxDepth)`: returns true iff the JSON text does not nest
 * arrays/objects deeper than `maxDepth` levels, skipping string literals and
 * escape runs without parsing.
 */
export function isJsonNestingWithinLimit(
  text: string,
  maxDepth: number,
): boolean {
  if (!HAS_JSON_CONTAINER_RE.test(text)) return true
  let openCount = 0
  for (const ch of ['[', '{']) {
    let idx = text.indexOf(ch)
    while (idx !== -1 && openCount <= maxDepth) {
      openCount++
      idx = text.indexOf(ch, idx + 1)
    }
  }
  if (openCount <= maxDepth) return true
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 91 || code === 123) {
      if (++depth > maxDepth) return false
    } else if (code === 93 || code === 125) {
      depth--
    } else if (code === 34) {
      i = skipJsonStringEnd(text, i)
    }
  }
  return true
}

// ============================================================================
// Protocol Codec (Official `createCodec` / `Je` in kernel.prelude.js &
// chunk-gyvea1hp.js) — Guards 1, 2, and 3
// ============================================================================

export type ReplValueKind =
  | 'promise'
  | 'typed'
  | 'view'
  | 'buffer'
  | 'regexp'
  | 'date'
  | 'weakmap'
  | 'weakset'
  | 'map'
  | 'set'
  | 'error'

export type ReplCodecOptions = {
  mostItems?: number
  mostDepth?: number
  mostDigits?: number
  mostChars?: number
  kindOf?: (value: object) => ReplValueKind | undefined
  hides?: (value: object) => boolean
  jsonTextOf?: (
    value: object,
  ) => { text: string; printsAsJson: boolean } | undefined
  shownStack?: (stack: string) => string
  parseJsonText?: (text: string, printsAsJson: boolean) => unknown
  extraObjectPrototypes?: readonly object[]
  extraArrayPrototypes?: readonly object[]
}

export type ReplCodec = {
  isPlain: (
    root: unknown,
    shown?: (value: object) => string | undefined,
  ) => boolean
  isPlainKind: (value: object) => boolean
  namesOf: (value: object) => string[]
  treeOf: (
    root: unknown,
    shown?: (value: object) => string | undefined,
    whole?: boolean,
  ) => unknown
  readTree: (root: unknown) => unknown
  tooLong: TypeError
  encode: (
    value: unknown,
    shown?: (value: object) => string | undefined,
    whole?: boolean,
  ) => string
  decode: (text: string) => unknown
}

const CONVERSION_KEYS: ReadonlyArray<string | symbol> = [
  'valueOf',
  'toString',
  Symbol.toPrimitive,
  Symbol.toStringTag,
]

const ERROR_KEYS_NOT_COPIED: ReadonlySet<string> = new Set([
  'message',
  'name',
  'stack',
  'then',
  'toJSON',
  'toString',
  'valueOf',
])

const KIND_WORDS: Readonly<
  Record<Exclude<ReplValueKind, 'promise' | 'weakmap' | 'weakset'>, string>
> = {
  typed: 'a typed array',
  view: 'a DataView',
  buffer: 'an ArrayBuffer',
  regexp: 'a RegExp',
  date: 'a Date',
  map: 'a Map',
  set: 'a Set',
  error: 'an Error',
}

const PROMISE_WORDS =
  '[a promise that was not awaited: add await to get its value]'
const UNDEFINED_NODE = { $: 'u' } as const
const MOST_CHARS_OF_64_BITS = 21

const hostObjectProto = Object.prototype
const hostArrayProto = Array.prototype
const hostRegExpProto = RegExp.prototype

type GetterFn = () => unknown

function getterOf(prototype: object, key: string | symbol): GetterFn {
  const desc = Object.getOwnPropertyDescriptor(prototype, key)
  if (typeof desc?.get !== 'function') {
    throw new TypeError(`Missing getter for ${String(key)}`)
  }
  return desc.get as GetterFn
}

const typedArrayProto = Object.getPrototypeOf(Int8Array.prototype) as object
const typedNameGetter = getterOf(typedArrayProto, Symbol.toStringTag)
const typedLengthGetter = getterOf(typedArrayProto, 'length')
const regexpSourceGetter = getterOf(hostRegExpProto, 'source')
const mapSizeGetter = getterOf(Map.prototype, 'size')
const setSizeGetter = getterOf(Set.prototype, 'size')
const viewBufferGetter = getterOf(DataView.prototype, 'buffer')
const viewOffsetGetter = getterOf(DataView.prototype, 'byteOffset')
const viewLengthGetter = getterOf(DataView.prototype, 'byteLength')
const bufferLengthGetter = getterOf(ArrayBuffer.prototype, 'byteLength')
const mapForEachFn = Map.prototype.forEach
const setForEachFn = Set.prototype.forEach
const dateGetTimeFn = Date.prototype.getTime
const stringValueOfFn = String.prototype.valueOf
const numberValueOfFn = Number.prototype.valueOf
const boxedValueFns: ReadonlyArray<() => unknown> = [
  Number.prototype.valueOf,
  Boolean.prototype.valueOf,
  BigInt.prototype.valueOf,
]

type NumericTypedArrayInstance = ArrayBufferView & {
  [index: number]: number
  length: number
}
type BigIntTypedArrayInstance = ArrayBufferView & {
  [index: number]: bigint
  length: number
}
type TypedArrayCtor = new (
  length: number,
) => NumericTypedArrayInstance | BigIntTypedArrayInstance

const TYPED_ARRAY_CTORS = new Map<string, TypedArrayCtor>()
const globalRecord = globalThis as unknown as Record<string, unknown>
for (const name of [
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
]) {
  const ctor = globalRecord[name]
  if (typeof ctor === 'function') {
    TYPED_ARRAY_CTORS.set(name, ctor as TypedArrayCtor)
  }
}

type BuiltinErrorCtor =
  | ErrorConstructor
  | AggregateErrorConstructor
  | (new (
      error: unknown,
      suppressed: unknown,
      message?: string,
    ) => Error)

const ERROR_CTORS = new Map<string, BuiltinErrorCtor>()
const ERROR_PROTO_NAMES = new Map<object, string>()
for (const name of [
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'SuppressedError',
]) {
  const ctor = globalRecord[name]
  if (typeof ctor === 'function') {
    ERROR_CTORS.set(name, ctor as BuiltinErrorCtor)
    const proto = (ctor as { prototype?: unknown }).prototype
    if (typeof proto === 'object' && proto !== null) {
      ERROR_PROTO_NAMES.set(proto, name)
    }
  }
}

const REGEXP_FLAG_GETTERS: ReadonlyArray<readonly [string, GetterFn]> = (
  [
    ['d', 'hasIndices'],
    ['g', 'global'],
    ['i', 'ignoreCase'],
    ['m', 'multiline'],
    ['s', 'dotAll'],
    ['u', 'unicode'],
    ['v', 'unicodeSets'],
    ['y', 'sticky'],
  ] as const
)
  .filter(([, prop]) => prop in hostRegExpProto)
  .map(([flag, prop]) => [flag, getterOf(hostRegExpProto, prop)] as const)

const UTIL_TYPE_CHECKS: ReadonlyArray<
  readonly [ReplValueKind, (value: unknown) => boolean]
> = [
  ['promise', utilTypes.isPromise],
  ['typed', utilTypes.isTypedArray],
  ['view', utilTypes.isDataView],
  ['buffer', utilTypes.isArrayBuffer],
  ['regexp', utilTypes.isRegExp],
  ['date', utilTypes.isDate],
  ['weakmap', utilTypes.isWeakMap],
  ['weakset', utilTypes.isWeakSet],
  ['map', utilTypes.isMap],
  ['set', utilTypes.isSet],
  ['error', utilTypes.isNativeError],
]

function defineDataProp(
  target: object,
  key: string,
  value: unknown,
  enumerable = true,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable,
    configurable: true,
  })
}

function readOwnData(target: object, key: string | number): unknown {
  const desc = Object.getOwnPropertyDescriptor(target, key)
  return desc !== undefined && 'value' in desc ? desc.value : undefined
}

function hasInternalSlot(method: () => unknown, value: object): boolean {
  try {
    Reflect.apply(method, value, [])
    return true
  } catch {
    return false
  }
}

function hasOwnEnumerableNames(value: object): boolean {
  for (const key in value) {
    return Object.getOwnPropertyDescriptor(value, key) !== undefined
  }
  return false
}

function hasOwnConversionHook(value: object): boolean {
  for (let i = 0; i < CONVERSION_KEYS.length; i++) {
    if (
      Object.getOwnPropertyDescriptor(value, CONVERSION_KEYS[i]!) !== undefined
    ) {
      return true
    }
  }
  return false
}

function isBoxedPrimitive(value: object): boolean {
  if (hasOwnConversionHook(value) && hasInternalSlot(numberValueOfFn, value)) {
    return true
  }
  return Object.getOwnPropertyDescriptor(value, 'length') !== undefined
    ? hasInternalSlot(stringValueOfFn, value)
    : !hasOwnEnumerableNames(value) &&
        boxedValueFns.some(fn => hasInternalSlot(fn, value))
}

function isJsonNumber(value: number): boolean {
  return value - value === 0 && (value !== 0 || 1 / value > 0)
}

function encodeNumberNode(value: number): number | { $: 'n'; v: string } {
  return isJsonNumber(value)
    ? value
    : { $: 'n', v: value === 0 ? '-0' : String(value) }
}

function refuseCodec(message: string): never {
  throw new TypeError(message)
}

function requireArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : refuseCodec('not a list')
}

function requireCount(value: unknown): number {
  return typeof value === 'number' &&
    value >= 0 &&
    value % 1 === 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : refuseCodec('not a count')
}

function requireText(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string {
  return typeof value === 'string' && value.length <= maxLength
    ? value
    : refuseCodec('not text')
}

export function defaultKindOf(value: object): ReplValueKind | undefined {
  if (Object.getPrototypeOf(value) === hostObjectProto) {
    return undefined
  }
  for (const [kind, check] of UTIL_TYPE_CHECKS) {
    if (check(value)) return kind
  }
  return undefined
}

export function defaultHides(value: object): boolean {
  return value === globalThis || utilTypes.isProxy(value)
}

/**
 * Official `createCodec` / `Je` (`kernel.prelude.js` & `chunk-gyvea1hp.js`).
 * Enforces:
 * 1. Nesting depth limit (`mostDepth`, default 2000) when `whole === true`
 * 2. Cumulative BigInt digit limit (`mostDigits`, default 1_000_000) when `whole === true`
 * 3. Per-call argument size limit (`mostChars`, default 134_217_728)
 * 4. Item truncation cap (`mostItems`, default 4096)
 */
export function createReplCodec(options: ReplCodecOptions = {}): ReplCodec {
  const mostItems = options.mostItems ?? REPL_MOST_ITEMS
  const mostDepth = options.mostDepth ?? REPL_MOST_DEPTH
  const mostDigits = options.mostDigits ?? REPL_MOST_DIGITS
  const mostChars = options.mostChars ?? REPL_MOST_JSON_CHARS
  const kindOf = options.kindOf ?? defaultKindOf
  const hides = options.hides ?? defaultHides
  const jsonTextOf = options.jsonTextOf ?? (() => undefined)
  const shownStack = options.shownStack ?? ((stack: string) => stack)
  const parseJsonText =
    options.parseJsonText ?? ((text: string) => JSON.parse(text) as unknown)

  const acceptedObjProtos = new Set<object>([
    hostObjectProto,
    ...(options.extraObjectPrototypes ?? []),
  ])
  const acceptedArrProtos = new Set<object>([
    hostArrayProto,
    ...(options.extraArrayPrototypes ?? []),
  ])

  const tooLong = new TypeError(REPL_CALL_TOO_LARGE_ERROR)
  const atMost = (count: number): number =>
    count < mostItems ? count : mostItems

  const namesOf = (value: object): string[] => {
    const length = readOwnData(value, 'length')
    if (
      typeof length !== 'number' ||
      length <= mostItems ||
      !hasInternalSlot(stringValueOfFn, value)
    ) {
      return Object.keys(value)
    }
    const names: string[] = []
    for (let i = 0; i < mostItems; i++) {
      names[i] = String(i)
    }
    return names
  }

  const isPlainKind = (value: object): boolean =>
    kindOf(value) === undefined && !isBoxedPrimitive(value)

  const isPlain = (
    root: unknown,
    shown?: (value: object) => string | undefined,
  ): boolean => {
    const seen = new Set<object>()
    let charsLeft = mostChars

    const isPlainMember = (
      holder: object,
      key: string | number,
      depth: number,
    ): boolean => {
      const desc = Object.getOwnPropertyDescriptor(holder, key)
      return desc !== undefined && 'value' in desc && walk(desc.value, depth)
    }

    const walk = (value: unknown, depth: number): boolean => {
      if (typeof value === 'string') {
        charsLeft -= value.length
        return charsLeft >= 0
      }
      if (typeof value === 'boolean' || value === null) {
        return true
      }
      if (typeof value === 'number') {
        return isJsonNumber(value)
      }
      if (
        typeof value !== 'object' ||
        depth > mostDepth ||
        hides(value) ||
        seen.has(value) ||
        shown?.(value) !== undefined ||
        Object.getOwnPropertyDescriptor(value, 'toJSON') !== undefined
      ) {
        return false
      }
      seen.add(value)
      const proto = Object.getPrototypeOf(value) as object | null
      if (Array.isArray(value)) {
        const { length } = value
        if (
          proto === null ||
          !acceptedArrProtos.has(proto) ||
          length > mostItems
        ) {
          return false
        }
        for (let i = 0; i < length; i++) {
          if (!isPlainMember(value, i, depth + 1)) {
            return false
          }
        }
        return true
      }
      if (
        proto === null ||
        !acceptedObjProtos.has(proto) ||
        !isPlainKind(value)
      ) {
        return false
      }
      const keys = Object.keys(value)
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!
        charsLeft -= k.length
        if (charsLeft < 0 || !isPlainMember(value, k, depth + 1)) {
          return false
        }
      }
      return true
    }

    return walk(root, 0)
  }

  const treeOf = (
    root: unknown,
    shown?: (value: object) => string | undefined,
    whole?: boolean,
  ): unknown => {
    const seen = new Map<object, number>()
    const notCopied = new Set<string>()
    let charsLeft = mostChars
    let digitsLeft = mostDigits
    let refusal: Error | undefined

    const refuseAll = (error: Error): never => {
      refusal = error
      throw error
    }

    const counted = <T extends string | null | undefined>(text: T): T => {
      charsLeft -= typeof text === 'string' ? text.length : 0
      if (charsLeft < 0) refuseAll(tooLong)
      return text
    }

    const countItems = (count: number): void => {
      charsLeft -= 2 * atMost(count)
      counted(undefined)
    }

    const bytesOf = (
      buffer: ArrayBufferLike,
      offset: number,
      length: number,
    ): number[] => {
      countItems(length)
      const cap = atMost(length)
      const view = new Uint8Array(buffer, offset, cap)
      const bytes: number[] = []
      for (let i = 0; i < cap; i++) {
        bytes[i] = view[i]!
      }
      return bytes
    }

    const survives = (written: unknown, value: unknown): boolean =>
      written === UNDEFINED_NODE
        ? value === undefined
        : written === value ||
          typeof written !== 'string' ||
          !notCopied.has(written)

    const errorNode = (err: object, depth: number): Record<string, unknown> => {
      const readWord = (key: string): string | null => {
        const val = readOwnData(err, key)
        const kind = typeof val
        return kind === 'string' ||
          kind === 'number' ||
          kind === 'boolean' ||
          kind === 'bigint'
          ? counted(String(val))
          : null
      }
      const allKeys = Reflect.ownKeys(err)
      const members: Array<[string, unknown, boolean]> = []
      const cap = atMost(allKeys.length)
      for (let i = 0; i < cap; i++) {
        const key = allKeys[i]
        if (typeof key !== 'string' || ERROR_KEYS_NOT_COPIED.has(key)) {
          continue
        }
        const desc = Object.getOwnPropertyDescriptor(err, key)
        if (desc === undefined || !('value' in desc)) {
          continue
        }
        const written = write(desc.value, depth + 1)
        if (survives(written, desc.value)) {
          members.push([counted(key), written, desc.enumerable === true])
        }
      }
      const stack = readWord('stack')
      const proto = Object.getPrototypeOf(err) as object | null
      const ctorName =
        proto !== null ? (ERROR_PROTO_NAMES.get(proto) ?? null) : null
      return {
        $: 'e',
        c: ctorName,
        m: readWord('message') ?? '',
        n: readWord('name'),
        s: stack === null ? null : shownStack(stack),
        v: members,
      }
    }

    const slotNode = (
      value: object,
      kind: ReplValueKind,
      depth: number,
    ): Record<string, unknown> => {
      switch (kind) {
        case 'typed': {
          const length = Reflect.apply(typedLengthGetter, value, []) as number
          countItems(length)
          const items: Array<string | number | { $: 'n'; v: string }> = []
          const indexed = value as Record<number, number | bigint>
          const cap = atMost(length)
          for (let i = 0; i < cap; i++) {
            const item = indexed[i]!
            items[i] =
              typeof item === 'bigint' ? String(item) : encodeNumberNode(item)
          }
          return {
            $: 't',
            c: Reflect.apply(typedNameGetter, value, []) as string,
            v: items,
            n: length,
          }
        }
        case 'view': {
          const length = Reflect.apply(viewLengthGetter, value, []) as number
          const buffer = Reflect.apply(
            viewBufferGetter,
            value,
            [],
          ) as ArrayBufferLike
          const offset = Reflect.apply(viewOffsetGetter, value, []) as number
          return { $: 'dv', v: bytesOf(buffer, offset, length), n: length }
        }
        case 'buffer': {
          const length = Reflect.apply(bufferLengthGetter, value, []) as number
          return {
            $: 'ab',
            v: bytesOf(value as ArrayBufferLike, 0, length),
            n: length,
          }
        }
        case 'regexp': {
          let flags = ''
          for (const [flag, getter] of REGEXP_FLAG_GETTERS) {
            flags += Reflect.apply(getter, value, []) ? flag : ''
          }
          const last = readOwnData(value, 'lastIndex')
          return {
            $: 're',
            s: counted(Reflect.apply(regexpSourceGetter, value, []) as string),
            f: flags,
            l: typeof last === 'number' ? encodeNumberNode(last) : 0,
          }
        }
        case 'date':
          return {
            $: 'd',
            v: encodeNumberNode(
              Reflect.apply(dateGetTimeFn, value, []) as number,
            ),
          }
        case 'weakmap':
          return { $: 'wm' }
        case 'weakset':
          return { $: 'ws' }
        case 'map': {
          const pairs: Array<[unknown, unknown]> = []
          Reflect.apply(mapForEachFn, value, [
            (item: unknown, key: unknown) => {
              if (pairs.length < mostItems) {
                pairs.push([key, item])
              }
            },
          ])
          const written: Array<[unknown, unknown]> = []
          for (const [k, item] of pairs) {
            const keyNode = write(k, depth + 1)
            if (survives(keyNode, k)) {
              written.push([keyNode, write(item, depth + 1)])
            }
          }
          return {
            $: 'm',
            v: written,
            n: Reflect.apply(mapSizeGetter, value, []) as number,
          }
        }
        case 'set': {
          const members: unknown[] = []
          Reflect.apply(setForEachFn, value, [
            (member: unknown) => {
              if (members.length < mostItems) {
                members.push(member)
              }
            },
          ])
          const written: unknown[] = []
          for (const member of members) {
            const node = write(member, depth + 1)
            if (survives(node, member)) {
              written.push(node)
            }
          }
          return {
            $: 's',
            v: written,
            n: Reflect.apply(setSizeGetter, value, []) as number,
          }
        }
        case 'error':
          return errorNode(value, depth)
        case 'promise':
          return refuseCodec('a promise has no node')
      }
    }

    const bigIntNode = (digits: string): { $: 'b'; v: string } => {
      digitsLeft -= digits.length
      if (whole === true && digitsLeft < 0) {
        refuseAll(
          new TypeError(formatReplCallTooManyBigIntDigitsError(mostDigits)),
        )
      }
      return { $: 'b', v: digits }
    }

    const write = (value: unknown, depth: number): unknown => {
      switch (typeof value) {
        case 'string':
          return counted(value)
        case 'boolean':
          return value
        case 'number':
          return encodeNumberNode(value)
        case 'undefined':
        case 'function':
          return UNDEFINED_NODE
        case 'bigint':
          return bigIntNode(counted(String(value)))
        case 'symbol':
          return { $: 'y', v: counted(value.description ?? null) }
        case 'object':
          return value === null ? null : writeObject(value, depth)
      }
    }

    const writeObject = (value: object, depth: number): unknown => {
      const json = jsonTextOf(value)
      if (json !== undefined) {
        return { $: 'j', t: json.text, p: json.printsAsJson }
      }
      if (whole === true && depth > mostDepth) {
        refuseAll(new TypeError(formatReplCallTooDeepError(mostDepth)))
      }
      if (hides(value) || depth > mostDepth) {
        return UNDEFINED_NODE
      }
      const earlier = seen.get(value)
      if (earlier !== undefined) {
        return { $: 'r', i: earlier }
      }
      const text = shown?.(value)
      if (text !== undefined) {
        return counted(text)
      }
      const kind = Array.isArray(value) ? undefined : kindOf(value)
      if (kind === 'promise') {
        return PROMISE_WORDS
      }
      const id = seen.size
      seen.set(value, id)
      if (kind !== undefined) {
        try {
          return { ...slotNode(value, kind, depth), i: id }
        } catch {
          if (refusal !== undefined) {
            throw refusal
          }
          seen.forEach((entryId, each) => {
            if (entryId >= id) {
              seen.delete(each)
            }
          })
          const kindLabel =
            kind === 'weakmap' || kind === 'weakset'
              ? 'a value'
              : KIND_WORDS[kind]
          const words = `[${kindLabel} that could not be copied out of the script]`
          notCopied.add(words)
          return words
        }
      }
      const items: unknown[] = []
      if (Array.isArray(value)) {
        const { length } = value
        countItems(length)
        const cap = atMost(length)
        for (let i = 0; i < cap; i++) {
          items[i] = write(readOwnData(value, i), depth + 1)
        }
        return { $: 'a', i: id, v: items, n: length }
      }
      for (const name of namesOf(value)) {
        items.push(counted(name))
        items.push(write(readOwnData(value, name), depth + 1))
      }
      return { $: 'o', i: id, v: items }
    }

    return write(root, 0)
  }

  const readTree = (root: unknown): unknown => {
    const made = new Map<number, unknown>()
    let digitsLeft = mostDigits

    const keep = <T>(id: unknown, value: T): T => {
      if (typeof id === 'number') {
        made.set(id, value)
      }
      return value
    }

    const keepCut = <T extends object>(
      node: Record<string, unknown>,
      value: T,
    ): T => {
      const count = requireCount(node.n)
      if (count > mostItems) {
        defineDataProp(value, 'truncatedFrom', count)
      }
      return keep(node.i, value)
    }

    const bufferOf = (node: Record<string, unknown>): ArrayBuffer => {
      const from = requireArray(node.v)
      const bytes = new Uint8Array(from.length)
      for (let i = 0; i < from.length; i++) {
        bytes[i] = Number(from[i])
      }
      return bytes.buffer
    }

    const errorOf = (node: Record<string, unknown>): Error => {
      const ctorName =
        typeof node.c === 'string' && ERROR_CTORS.has(node.c) ? node.c : 'Error'
      const Ctor = ERROR_CTORS.get(ctorName) ?? Error
      const message = requireText(node.m)
      let err: Error
      if (ctorName === 'AggregateError') {
        err = new (Ctor as AggregateErrorConstructor)([], message)
      } else if (ctorName === 'SuppressedError') {
        err = new (
          Ctor as new (
            error: unknown,
            suppressed: unknown,
            message?: string,
          ) => Error
        )(undefined, undefined, message)
      } else {
        err = new (Ctor as ErrorConstructor)(message)
      }
      if (typeof node.n === 'string' && node.n !== ctorName) {
        defineDataProp(err, 'name', node.n, false)
      }
      defineDataProp(
        err,
        'stack',
        typeof node.s === 'string' ? node.s : undefined,
        false,
      )
      Reflect.ownKeys(err)
      keep(node.i, err)
      for (const member of requireArray(node.v)) {
        const tuple = requireArray(member)
        const key = requireText(tuple[0])
        if (!ERROR_KEYS_NOT_COPIED.has(key)) {
          defineDataProp(err, key, read(tuple[1]), tuple[2] === true)
        }
      }
      return err
    }

    const read = (tree: unknown): unknown => {
      if (tree === null || typeof tree !== 'object') {
        return tree
      }
      const node = tree as Record<string, unknown>
      switch (node.$) {
        case 'u':
          return undefined
        case 'n':
          return node.v === '-0' ? -0 : +requireText(node.v)
        case 'b': {
          const digits = requireText(node.v)
          digitsLeft -= digits.length
          return digitsLeft < 0
            ? `[a BigInt left out: the BigInts here have over ${mostDigits} digits together]`
            : BigInt(digits)
        }
        case 'y':
          return Symbol(typeof node.v === 'string' ? node.v : undefined)
        case 'r':
          return typeof node.i === 'number' ? made.get(node.i) : undefined
        case 'j':
          return parseJsonText(requireText(node.t), node.p === true)
        case 'o': {
          const obj: Record<string, unknown> = keep(node.i, {})
          const items = requireArray(node.v)
          for (let i = 0; i + 1 < items.length; i += 2) {
            defineDataProp(obj, requireText(items[i]), read(items[i + 1]))
          }
          return obj
        }
        case 'a': {
          const list: unknown[] = keep(node.i, [])
          const items = requireArray(node.v)
          const count = requireCount(node.n)
          if (atMost(count) !== items.length) {
            refuseCodec('not its length')
          }
          for (let i = 0; i < items.length; i++) {
            list[i] = read(items[i])
          }
          list.length = count
          return list
        }
        case 't': {
          const ctorName = requireText(node.c)
          const Ctor = TYPED_ARRAY_CTORS.get(ctorName)
          if (Ctor === undefined) {
            refuseCodec('not a typed array')
          }
          const items = requireArray(node.v)
          const typed = new Ctor(items.length)
          const isBig =
            ctorName === 'BigInt64Array' || ctorName === 'BigUint64Array'
          if (isBig) {
            const bigArr = typed as BigIntTypedArrayInstance
            for (let i = 0; i < items.length; i++) {
              bigArr[i] = BigInt(requireText(items[i], MOST_CHARS_OF_64_BITS))
            }
          } else {
            const numArr = typed as NumericTypedArrayInstance
            for (let i = 0; i < items.length; i++) {
              numArr[i] = Number(read(items[i]))
            }
          }
          return keepCut(node, typed)
        }
        case 'dv':
          return keepCut(node, new DataView(bufferOf(node)))
        case 'ab':
          return keepCut(node, bufferOf(node))
        case 're': {
          const re = new RegExp(requireText(node.s), requireText(node.f))
          re.lastIndex = Number(read(node.l))
          return keep(node.i, re)
        }
        case 'd':
          return keep(node.i, new Date(Number(read(node.v))))
        case 'wm':
          return keep(node.i, new WeakMap())
        case 'ws':
          return keep(node.i, new WeakSet())
        case 'm': {
          const map = keepCut(node, new Map<unknown, unknown>())
          for (const pair of requireArray(node.v)) {
            const tuple = requireArray(pair)
            map.set(read(tuple[0]), read(tuple[1]))
          }
          return map
        }
        case 's': {
          const set = keepCut(node, new Set<unknown>())
          for (const member of requireArray(node.v)) {
            set.add(read(member))
          }
          return set
        }
        case 'e':
          return errorOf(node)
        default:
          return refuseCodec('not a tag')
      }
    }

    return read(root)
  }

  return {
    isPlain,
    isPlainKind,
    namesOf,
    treeOf,
    readTree,
    tooLong,
    encode: (value, shown, whole) =>
      typeof value === 'string'
        ? `=${value}`
        : isPlain(value, shown)
          ? JSON.stringify(value)
          : `~${JSON.stringify(treeOf(value, shown, whole))}`,
    decode: text =>
      text[0] === '='
        ? text.slice(1)
        : text[0] === '~'
          ? readTree(JSON.parse(text.slice(1)) as unknown)
          : (JSON.parse(text) as unknown),
  }
}

/**
 * Official `ae(wireText)` (`chunk-gyvea1hp.js`): validate wire string length
 * (`<= mostTextChars + 1` for `=` strings, `<= mostJsonChars` for JSON/tree)
 * and JSON bracket/brace nesting depth (`<= maxWireDepth`) before decoding.
 */
export function decodeReplWireValue(
  wireText: unknown,
  codec: ReplCodec,
  limits?: ReplDosLimits,
): unknown {
  if (typeof wireText !== 'string') {
    throw new TypeError('not text')
  }
  const resolved = resolveReplDosLimits(limits)
  const isRawText = wireText[0] === '='
  const withinBounds =
    wireText.length <= resolved.mostTextChars + 1 &&
    (isRawText ||
      (wireText.length <= resolved.mostJsonChars &&
        isJsonNestingWithinLimit(
          wireText[0] === '~' ? wireText.slice(1) : wireText,
          resolved.maxWireDepth,
        )))
  if (!withinBounds) {
    throw new TypeError('too long, or nested too deep')
  }
  return codec.decode(wireText)
}

// ============================================================================
// Guard 4 & Guard 5: Primitive-Only Wire Args, Unknown/Oversized Host Call
// Validation, and Per-Turn Call Count / Data Budget
// (Official `Ae`, `be`, `qe`, `xe`, `MNt` in 2.1.331)
// ============================================================================

/**
 * Official `xe(value)` (`chunk-gyvea1hp.js`): only primitive wire values
 * (`string`, `number`, `boolean`, `null`, `undefined`) may cross the host link.
 */
export function isHostCallPrimitive(
  value: unknown,
): value is string | number | boolean | null | undefined {
  const t = typeof value
  return (
    value === null ||
    t === 'string' ||
    t === 'number' ||
    t === 'boolean' ||
    t === 'undefined'
  )
}

export type ReplHostOpMode = 'sync' | 'async' | 'notify'
export type ReplHostOpFieldType = 'string' | 'number' | 'boolean' | 'any'

export type ReplHostOpField = {
  name: string
  type: ReplHostOpFieldType
  optional?: boolean
  /** Optional integer non-negative constraint (mirrors `fHs().nonnegative()`). */
  nonnegativeInt?: boolean
  /** Optional enum whitelist (mirrors `La([...])`). */
  enumValues?: readonly string[]
}

export type ReplHostOpSpec = {
  name: string
  mode: ReplHostOpMode
  atOnce?: boolean
  followsCalls?: boolean
  fields: readonly ReplHostOpField[]
}

/**
 * Official `MNt` (`chunk-e44nxx45.js`): host-call operation schemas for the
 * Code Mode / REPL bridge.
 */
export function createDefaultReplHostOpSpecs(): Map<string, ReplHostOpSpec> {
  const str = (name: string, optional = false): ReplHostOpField => ({
    name,
    type: 'string',
    optional,
  })
  const num = (name: string, optional = false): ReplHostOpField => ({
    name,
    type: 'number',
    optional,
  })
  const count = (name: string): ReplHostOpField => ({
    name,
    type: 'number',
    nonnegativeInt: true,
  })
  const bool = (name: string): ReplHostOpField => ({
    name,
    type: 'boolean',
  })
  const anyField = (name: string): ReplHostOpField => ({
    name,
    type: 'any',
  })

  const specs: ReplHostOpSpec[] = [
    { name: 'firstWait', mode: 'notify', fields: [] },
    {
      name: 'returned',
      mode: 'notify',
      followsCalls: true,
      fields: [anyField('value')],
    },
    {
      name: 'threw',
      mode: 'notify',
      followsCalls: true,
      fields: [str('text'), str('stack'), bool('wasText')],
    },
    { name: 'reached', mode: 'notify', fields: [count('slot'), count('at')] },
    {
      name: 'stopped',
      mode: 'notify',
      fields: [
        {
          name: 'by',
          type: 'string',
          enumValues: ['clock', 'budget', 'memory'],
        },
      ],
    },
    { name: 'isOver', mode: 'sync', fields: [] },
    { name: 'isOverMemory', mode: 'sync', fields: [bool('isFirstRead')] },
    { name: 'now', mode: 'sync', fields: [] },
    { name: 'zone', mode: 'sync', fields: [] },
    {
      name: 'setTimer',
      mode: 'sync',
      fields: [num('ms', true), bool('repeats')],
    },
    { name: 'clearTimer', mode: 'notify', fields: [num('id', true)] },
    { name: 'sleep', mode: 'async', atOnce: true, fields: [num('ms', true)] },
    { name: 'log', mode: 'notify', fields: [str('line')] },
    { name: 'console', mode: 'notify', fields: [str('level'), str('line')] },
    { name: 'consoleToRing', mode: 'notify', fields: [str('line')] },
    { name: 'consoleTail', mode: 'sync', fields: [num('lines', true)] },
    { name: 'consoleBuffer', mode: 'sync', fields: [] },
    { name: 'consoleDropped', mode: 'sync', fields: [] },
    { name: 'note', mode: 'notify', fields: [str('line')] },
    { name: 'atob', mode: 'sync', fields: [str('text')] },
    { name: 'btoa', mode: 'sync', fields: [str('text')] },
    {
      name: 'sh',
      mode: 'async',
      fields: [
        str('cmd'),
        num('timeout', true),
        str('dir', true),
        bool('wantsWhole'),
        str('written', true),
      ],
    },
    {
      name: 'notePartialOutput',
      mode: 'notify',
      fields: [num('id', true), str('reader', true), bool('onCommand')],
    },
    { name: 'rawCheckIsOff', mode: 'sync', fields: [] },
    { name: 'placeCheckIsOff', mode: 'sync', fields: [] },
    {
      name: 'readFile',
      mode: 'async',
      fields: [
        str('path'),
        num('offset', true),
        num('limit', true),
        bool('probe'),
      ],
    },
    { name: 'writeFile', mode: 'async', fields: [str('path'), str('text')] },
    {
      name: 'editOnce',
      mode: 'async',
      fields: [
        str('path'),
        str('old'),
        str('next'),
        bool('all'),
        bool('notesMiss'),
      ],
    },
    {
      name: 'noteMissedEdit',
      mode: 'notify',
      fields: [str('path'), str('text'), str('old')],
    },
    { name: 'tool', mode: 'async', fields: [str('name'), anyField('input')] },
    {
      name: 'searchTools',
      mode: 'async',
      fields: [str('query', true), str('typeOf'), num('max', true)],
    },
    {
      name: 'describeTool',
      mode: 'async',
      fields: [str('name', true), str('typeOf')],
    },
    {
      name: 'contextSpawn',
      mode: 'async',
      fields: [str('name'), str('role'), str('prompt'), bool('fork')],
    },
    { name: 'contextRelease', mode: 'async', fields: [str('name')] },
    { name: 'contextList', mode: 'async', fields: [] },
    { name: 'contextView', mode: 'sync', fields: [str('name')] },
    { name: 'contextNames', mode: 'sync', fields: [] },
    { name: 'contextResult', mode: 'async', fields: [str('name')] },
    {
      name: 'contextTail',
      mode: 'async',
      fields: [str('name'), num('turns', true)],
    },
    {
      name: 'contextLog',
      mode: 'async',
      fields: [str('name'), str('message')],
    },
    { name: 'running', mode: 'sync', fields: [] },
    { name: 'abort', mode: 'sync', fields: [num('id', true)] },
    { name: 'toolNames', mode: 'sync', fields: [] },
    { name: 'hasTool', mode: 'sync', fields: [str('name')] },
  ]

  return new Map(specs.map(spec => [spec.name, spec]))
}

/**
 * Official `qe({ schema, fields }, args)` (`chunk-gyvea1hp.js`): validate
 * positional wire arguments against an op spec, rejecting extra trailing
 * non-null arguments, invalid types, strings > `mostTextChars`, and invalid
 * wire-encoded `any` values.
 */
export function parseReplHostOpArgs(
  spec: ReplHostOpSpec,
  args: readonly unknown[],
  codec: ReplCodec,
  limits?: ReplDosLimits,
): Record<string, unknown> | undefined {
  if (args.slice(spec.fields.length).some(v => v != null)) {
    return undefined
  }
  const resolved = resolveReplDosLimits(limits)
  const parsed: Record<string, unknown> = {}
  try {
    for (let i = 0; i < spec.fields.length; i++) {
      const field = spec.fields[i]!
      const raw = args[i] ?? undefined
      if (field.type === 'any') {
        parsed[field.name] = decodeReplWireValue(raw, codec, resolved)
        continue
      }
      if (raw === undefined) {
        if (!field.optional) return undefined
        parsed[field.name] = undefined
        continue
      }
      if (field.type === 'string') {
        if (typeof raw !== 'string' || raw.length > resolved.mostTextChars) {
          return undefined
        }
        if (field.enumValues !== undefined && !field.enumValues.includes(raw)) {
          return undefined
        }
        parsed[field.name] = raw
      } else if (field.type === 'number') {
        if (typeof raw !== 'number') {
          return undefined
        }
        if (field.nonnegativeInt && (!Number.isInteger(raw) || raw < 0)) {
          return undefined
        }
        parsed[field.name] = raw
      } else if (field.type === 'boolean') {
        if (typeof raw !== 'boolean') {
          return undefined
        }
        parsed[field.name] = raw
      }
    }
  } catch {
    return undefined
  }
  return parsed
}

/**
 * Official `we` (`chunk-gyvea1hp.js`): TypeError thrown when the host rejects
 * an unknown op name, mode mismatch, extra arguments, or an oversized/invalid
 * argument.
 */
export class ReplHostCallValidationError extends TypeError {
  constructor(message: string = REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR) {
    super(message)
    this.name = 'TypeError'
  }
}

export type ReplHostCall = {
  name: string
  args: readonly unknown[]
  tag: number
  id?: number
  reply: (json: string) => void
  refuse: (message: string) => void
}

/**
 * Official `Ae.#E` / `#w` / `#k` (`chunk-gyvea1hp.js`): per-turn queued call
 * count and cumulative string data budget.
 */
export class ReplTurnCallBudget {
  private readonly maxCalls: number
  private readonly maxChars: number
  private queuedCount = 0
  private queuedChars = 0

  constructor(limits?: ReplDosLimits) {
    const resolved = resolveReplDosLimits(limits)
    this.maxCalls = resolved.maxTurnCalls
    this.maxChars = resolved.maxTurnChars
  }

  get callCount(): number {
    return this.queuedCount
  }

  get charCount(): number {
    return this.queuedChars
  }

  /**
   * Official `Ae.#E(call)`: returns true and charges the turn budget if within
   * limits; returns false without mutating counters when the turn budget is
   * exhausted.
   */
  tryCharge(args: readonly unknown[], isNotifyFollowsCalls = false): boolean {
    if (
      isNotifyFollowsCalls
        ? this.queuedCount >= 2 * this.maxCalls
        : this.queuedCount >= this.maxCalls || this.queuedChars >= this.maxChars
    ) {
      return false
    }
    this.queuedCount++
    for (const arg of args) {
      if (typeof arg === 'string') {
        this.queuedChars += arg.length
      }
    }
    return true
  }

  /**
   * Charge the turn budget or throw the official 2.1.331 turn-budget error.
   */
  chargeOrThrow(args: readonly unknown[], isNotifyFollowsCalls = false): void {
    if (!this.tryCharge(args, isNotifyFollowsCalls)) {
      throw new Error(REPL_TURN_BUDGET_EXCEEDED_ERROR)
    }
  }

  reset(): void {
    this.queuedCount = 0
    this.queuedChars = 0
  }
}

/**
 * Official `Ae` host-link transport (`chunk-gyvea1hp.js` + `bunlink.prelude.js`):
 * enforces primitive-only wire arguments (`REPL: only text, numbers and flags
 * can be sent to the host.`) and per-turn call/data queuing limits (`REPL: too
 * many calls, or too much data, in one turn. Await some of the calls before
 * making more.`).
 */
export class ReplHostLink {
  private readonly ops: ReadonlyMap<string, ReplHostOpSpec>
  private readonly onCall: (call: ReplHostCall) => void
  private readonly onForget?: (id: number) => void
  private readonly maxCalls: number
  private readonly maxChars: number
  private nextCallId = 0
  private queued: ReplHostCall[] = []
  private queuedChars = 0

  constructor(options: {
    ops?: ReadonlyMap<string, ReplHostOpSpec>
    onCall: (call: ReplHostCall) => void
    onForget?: (id: number) => void
    limits?: ReplDosLimits
  }) {
    this.ops = options.ops ?? createDefaultReplHostOpSpecs()
    this.onCall = options.onCall
    this.onForget = options.onForget
    const resolved = resolveReplDosLimits(options.limits)
    this.maxCalls = resolved.maxTurnCalls
    this.maxChars = resolved.maxTurnChars
  }

  get queuedCallCount(): number {
    return this.queued.length
  }

  get queuedCharCount(): number {
    return this.queuedChars
  }

  /**
   * Official `Ae.#y(name, args)`: returns a wire reply string (`"!..."` on
   * refusal, string call ID for async ops, JSON payload for sync ops, `""` for
   * notify ops).
   */
  send(name: string, args: readonly unknown[], tag = 0): string {
    const spec = this.ops.get(name)
    if (spec === undefined || !args.every(isHostCallPrimitive)) {
      return `!${REPL_PRIMITIVE_ONLY_ARGS_ERROR}`
    }
    let replyText =
      spec.mode === 'sync' ? '!REPL: the host failed to answer.' : ''
    const call: ReplHostCall = {
      name,
      args,
      tag,
      id: spec.mode === 'async' ? ++this.nextCallId : undefined,
      reply: (json: string) => {
        replyText = json
      },
      refuse: (message: string) => {
        replyText = `!${message}`
      },
    }
    if ((spec.mode === 'async' && !spec.atOnce) || spec.followsCalls) {
      if (!this.enqueue(call)) {
        return `!${REPL_TURN_BUDGET_EXCEEDED_ERROR}`
      }
      return call.id === undefined ? '' : String(call.id)
    }
    this.onCall(call)
    return call.id === undefined ? replyText : String(call.id)
  }

  /**
   * Mirrors `bunlink.prelude.js` `send()`: throws `Error(reply.slice(1))` when
   * the host link refuses with a `!`-prefixed string.
   */
  invokeOrThrow(name: string, args: readonly unknown[], tag = 0): string {
    const reply = this.send(name, args, tag)
    if (reply[0] === '!') {
      throw new Error(reply.slice(1))
    }
    return reply
  }

  private enqueue(call: ReplHostCall): boolean {
    if (
      call.id === undefined
        ? this.queued.length >= 2 * this.maxCalls
        : this.queued.length >= this.maxCalls ||
          this.queuedChars >= this.maxChars
    ) {
      return false
    }
    this.queued.push(call)
    for (const arg of call.args) {
      if (typeof arg === 'string') {
        this.queuedChars += arg.length
      }
    }
    return true
  }

  /**
   * Official `Ae.#w()`: on execution timeout, drop queued async calls (forgetting
   * their IDs) and any trailing notify calls belonging to those tags.
   */
  handleTimeout(): void {
    const timedOutTags = new Set<number>()
    this.queued = this.queued.filter(({ id, tag }) => {
      if (id === undefined) return !timedOutTags.has(tag)
      this.onForget?.(id)
      timedOutTags.add(tag)
      return false
    })
  }

  /**
   * Official `Ae.#k()`: drain all queued calls into `onCall` and reset the
   * per-turn call/data budget to 0.
   */
  flushTurn(): void {
    const pending = this.queued
    this.queued = []
    this.queuedChars = 0
    for (const call of pending) {
      try {
        this.onCall(call)
      } catch {
        // Isolate host handler exceptions during turn flush.
      }
    }
  }
}

export type ReplHostOpHandler = (
  input: Record<string, unknown>,
  call: ReplHostCall,
) => unknown | Promise<unknown>

/**
 * Official `be` (`chunk-gyvea1hp.js`): validates incoming host calls against
 * the op schema registry (`MNt`) and wire decoder (`ae`), refusing unknown
 * calls, mode mismatches, extra args, or oversized/deeply-nested arguments
 * with `REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR`.
 */
export class ReplHostDispatcher {
  private readonly ops: ReadonlyMap<string, ReplHostOpSpec>
  private readonly handlers: ReadonlyMap<string, ReplHostOpHandler>
  private readonly codec: ReplCodec
  private readonly limits: ResolvedReplDosLimits
  private readonly onWarn?: (message: string) => void

  constructor(options: {
    ops?: ReadonlyMap<string, ReplHostOpSpec>
    handlers?: ReadonlyMap<string, ReplHostOpHandler>
    codec?: ReplCodec
    limits?: ReplDosLimits
    onWarn?: (message: string) => void
  }) {
    this.ops = options.ops ?? createDefaultReplHostOpSpecs()
    this.handlers = options.handlers ?? new Map()
    this.limits = resolveReplDosLimits(options.limits)
    this.codec =
      options.codec ??
      createReplCodec({
        mostItems: this.limits.mostItems,
        mostDepth: this.limits.mostDepth,
        mostDigits: this.limits.mostDigits,
        mostChars: Number.POSITIVE_INFINITY,
      })
    this.onWarn = options.onWarn
  }

  /**
   * Validate a host call's op name, sync/async mode, and positional args,
   * returning the decoded/validated input object or throwing
   * `ReplHostCallValidationError` (`REPL: the host takes no such call, or an
   * argument is too long.`).
   */
  validateCall(
    call: Pick<ReplHostCall, 'name' | 'args' | 'id'>,
  ): Record<string, unknown> {
    const spec = this.ops.get(call.name)
    const modeMatches =
      spec !== undefined && (spec.mode === 'async') === (call.id !== undefined)
    const parsed = modeMatches
      ? parseReplHostOpArgs(spec, call.args, this.codec, this.limits)
      : undefined
    if (parsed === undefined) {
      this.onWarn?.(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    return parsed
  }

  /**
   * Validate and execute a host call synchronously (for `sync`/`notify`) or
   * asynchronously (returning a Promise for `async` ops).
   */
  answer(call: ReplHostCall): Promise<unknown> | undefined {
    const spec = this.ops.get(call.name)
    const run = (): unknown => {
      const parsed = this.validateCall(call)
      const handler = this.handlers.get(call.name)
      if (handler === undefined) {
        this.onWarn?.(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)
        throw new ReplHostCallValidationError(
          REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
        )
      }
      return handler(parsed, call)
    }

    if (call.id !== undefined) {
      return Promise.resolve().then(() => run())
    }
    try {
      const result = run()
      if (spec?.mode === 'sync') {
        call.reply(JSON.stringify({ v: result }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      call.refuse(msg)
    }
    return undefined
  }
}

// ============================================================================
// Guard 6: Circular Value Transform Guard (Official `J.read` / `w.recall`:
// "A circular value cannot pass through a transform")
// ============================================================================

function collectChildValues(node: object): unknown[] {
  if (Array.isArray(node)) {
    const children: unknown[] = []
    for (let i = 0; i < node.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(node, i)
      if (desc !== undefined && 'value' in desc) {
        children.push(desc.value)
      }
    }
    return children
  }
  if (utilTypes.isMap(node)) {
    const children: unknown[] = []
    Reflect.apply(mapForEachFn, node, [
      (val: unknown, key: unknown) => {
        children.push(key, val)
      },
    ])
    return children
  }
  if (utilTypes.isSet(node)) {
    const children: unknown[] = []
    Reflect.apply(setForEachFn, node, [
      (val: unknown) => {
        children.push(val)
      },
    ])
    return children
  }
  const children: unknown[] = []
  for (const key of Object.keys(node)) {
    const desc = Object.getOwnPropertyDescriptor(node, key)
    if (desc !== undefined && 'value' in desc) {
      children.push(desc.value)
    }
  }
  return children
}

/**
 * Iterative DFS cycle detector: returns `true` iff `value` or any reachable
 * descendant forms a cycle. Shared non-cyclic DAG references (e.g.
 * `{ a: shared, b: shared }`) are NOT circular and return `false`.
 * Uses `acyclic` memoization so dense DAGs run in O(V + E).
 */
export function hasCircularReference(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false

  type Frame = { node: object; children: unknown[]; index: number }
  const inStack = new Set<object>()
  const acyclic = new WeakSet<object>()
  const stack: Frame[] = [
    { node: value, children: collectChildValues(value), index: 0 },
  ]
  inStack.add(value)

  while (stack.length > 0) {
    const top = stack[stack.length - 1]!
    if (top.index >= top.children.length) {
      stack.pop()
      inStack.delete(top.node)
      acyclic.add(top.node)
      continue
    }
    const child = top.children[top.index++]
    if (typeof child !== 'object' || child === null) continue
    if (inStack.has(child)) return true
    if (acyclic.has(child)) continue
    inStack.add(child)
    stack.push({
      node: child,
      children: collectChildValues(child),
      index: 0,
    })
  }
  return false
}

/**
 * Official 2.1.331 circular transform guard: throws
 * `Error("A circular value cannot pass through a transform")` if `value` is
 * circular; returns `value` unchanged otherwise.
 */
export function assertNotCircularForTransform<T>(value: T): T {
  if (hasCircularReference(value)) {
    throw new Error(REPL_CIRCULAR_TRANSFORM_ERROR)
  }
  return value
}

/**
 * Wrap a schema/value transform function so circular inputs are rejected with
 * `Error("A circular value cannot pass through a transform")`.
 */
export function guardCircularTransform<TIn, TOut>(
  transform: (value: TIn) => TOut,
): (value: TIn) => TOut {
  return (value: TIn): TOut => {
    assertNotCircularForTransform(value)
    return transform(value)
  }
}

type ZodSchemaDefLike = {
  type?: string
  in?: unknown
  out?: unknown
  shape?: Record<string, unknown>
  element?: unknown
  innerType?: unknown
  options?: readonly unknown[]
  left?: unknown
  right?: unknown
  items?: readonly unknown[]
  rest?: unknown
  keyType?: unknown
  valueType?: unknown
  getter?: () => unknown
}

type ZodSchemaLike = {
  _zod?: { def?: ZodSchemaDefLike }
  safeParse: (value: unknown) => {
    success: boolean
    data?: unknown
    error?: { message: string }
  }
}

function getZodDef(schema: unknown): ZodSchemaDefLike | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined
  const rec = schema as { _zod?: { def?: ZodSchemaDefLike } }
  return rec._zod?.def
}

const PRIMITIVE_ONLY_ZOD_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'literal',
  'enum',
  'null',
  'undefined',
  'void',
  'never',
  'nan',
])

function schemaCannotMatchObject(schema: unknown): boolean {
  const def = getZodDef(schema)
  if (def?.type === undefined) return false
  return PRIMITIVE_ONLY_ZOD_TYPES.has(def.type)
}

/**
 * Walk a Zod v4 schema alongside `value` (safely handling recursive `z.lazy`
 * schemas) and throw `Error("A circular value cannot pass through a transform")`
 * whenever a circular value would enter any `transform` node.
 */
export function assertNoCircularValueInSchemaTransforms(
  schema: unknown,
  value: unknown,
): void {
  const visited = new WeakMap<object, Set<unknown>>()

  const check = (currentSchema: unknown, currentValue: unknown): void => {
    const def = getZodDef(currentSchema)
    if (def === undefined) return

    if (typeof currentValue === 'object' && currentValue !== null) {
      let seenSchemas = visited.get(currentValue)
      if (seenSchemas === undefined) {
        seenSchemas = new Set()
        visited.set(currentValue, seenSchemas)
      }
      if (seenSchemas.has(currentSchema)) {
        return
      }
      seenSchemas.add(currentSchema)
    }

    switch (def.type) {
      case 'transform': {
        assertNotCircularForTransform(currentValue)
        return
      }
      case 'pipe': {
        const outDef = getZodDef(def.out)
        if (outDef?.type === 'transform' && !schemaCannotMatchObject(def.in)) {
          assertNotCircularForTransform(currentValue)
        }
        check(def.in, currentValue)
        if (outDef?.type !== 'transform') {
          check(def.out, currentValue)
        }
        return
      }
      case 'optional':
      case 'nullable':
      case 'nonoptional':
      case 'default':
      case 'prefault':
      case 'catch':
      case 'readonly': {
        if (currentValue !== undefined && currentValue !== null) {
          check(def.innerType, currentValue)
        }
        return
      }
      case 'lazy': {
        if (typeof def.getter === 'function') {
          check(def.getter(), currentValue)
        }
        return
      }
      case 'object': {
        if (
          typeof currentValue !== 'object' ||
          currentValue === null ||
          Array.isArray(currentValue) ||
          def.shape === undefined
        ) {
          return
        }
        const rec = currentValue as Record<string, unknown>
        for (const [key, fieldSchema] of Object.entries(def.shape)) {
          if (Object.hasOwn(rec, key)) {
            check(fieldSchema, rec[key])
          }
        }
        return
      }
      case 'array': {
        if (!Array.isArray(currentValue)) return
        for (let i = 0; i < currentValue.length; i++) {
          check(def.element, currentValue[i])
        }
        return
      }
      case 'tuple': {
        if (!Array.isArray(currentValue)) return
        const items = def.items ?? []
        for (let i = 0; i < items.length && i < currentValue.length; i++) {
          check(items[i], currentValue[i])
        }
        if (def.rest !== undefined) {
          for (let i = items.length; i < currentValue.length; i++) {
            check(def.rest, currentValue[i])
          }
        }
        return
      }
      case 'record': {
        if (
          typeof currentValue !== 'object' ||
          currentValue === null ||
          Array.isArray(currentValue)
        ) {
          return
        }
        for (const [k, v] of Object.entries(currentValue)) {
          check(def.keyType, k)
          check(def.valueType, v)
        }
        return
      }
      case 'map': {
        if (!utilTypes.isMap(currentValue)) return
        Reflect.apply(mapForEachFn, currentValue, [
          (v: unknown, k: unknown) => {
            check(def.keyType, k)
            check(def.valueType, v)
          },
        ])
        return
      }
      case 'set': {
        if (!utilTypes.isSet(currentValue)) return
        Reflect.apply(setForEachFn, currentValue, [
          (v: unknown) => {
            check(def.valueType, v)
          },
        ])
        return
      }
      case 'union':
      case 'discriminatedUnion': {
        for (const opt of def.options ?? []) {
          check(opt, currentValue)
        }
        return
      }
      case 'intersection': {
        check(def.left, currentValue)
        check(def.right, currentValue)
        return
      }
      default:
        return
    }
  }

  check(schema, value)
}

/**
 * Run `schema.safeParse(value)` after enforcing the 2.1.331 circular transform
 * guard (`"A circular value cannot pass through a transform"`).
 */
export function safeParseWithCircularTransformGuard<
  TSchema extends Pick<ZodSchemaLike, 'safeParse'>,
>(schema: TSchema, value: unknown): ReturnType<TSchema['safeParse']> {
  assertNoCircularValueInSchemaTransforms(schema, value)
  return schema.safeParse(value) as ReturnType<TSchema['safeParse']>
}
