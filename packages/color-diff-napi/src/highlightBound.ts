/**
 * densable 2.1.289 `C` / `b` / `te` / `oe` / `ie` / `z` / `Se`.
 * Caps highlight.js work so short blocks with many unclosed `<` tags or
 * nested `${` substitutions throw instead of freezing the terminal.
 */

export class HighlightBoundError extends Error {
  override name = 'HighlightBoundError'
  constructor() {
    super('highlighting this text takes more work than its length allows')
  }
}

export class HighlightLimitError extends Error {
  override name = 'HighlightLimitError'
  constructor() {
    super('this text is too long, or its lines are, for a grammar')
  }
}

/** densable `he` — max emitter tree height before the bound is spent. */
export const HIGHLIGHT_BOUND_MAX_HEIGHT = 32
/** densable `me` — `Se(e)` sublanguage fan-out cap. */
export const HIGHLIGHT_BOUND_SUBLANGUAGE_CAP = 64
/** densable `pe` — base budget. */
export const HIGHLIGHT_BOUND_BASE = 4096
/** densable `we` — per-character budget addend. */
export const HIGHLIGHT_BOUND_PER_CHAR = 24
/** densable `Le` — per-character × sublanguage weight. */
export const HIGHLIGHT_BOUND_PER_SUBLANG = 3
/** densable `xe` — constructor charge. */
export const HIGHLIGHT_BOUND_CONSTRUCTOR = 16

/** densable `E` — default max code length for syntax highlighting. */
export const HIGHLIGHT_MAX_LENGTH = 50000
/** densable `d` — per-language length caps for expensive grammars. */
export const HIGHLIGHT_LANG_MAX_LENGTH = new Map<string, number>([
  ['asciidoc', 16000],
  ['gcode', 20000],
  ['http', 8000],
  ['nestedtext', 8000],
  ['sas', 20000],
  ['wren', 20000],
])
export const HIGHLIGHT_MIN_LANG_MAX_LENGTH = Math.min(
  HIGHLIGHT_MAX_LENGTH,
  ...HIGHLIGHT_LANG_MAX_LENGTH.values(),
)
/** densable `UBn` — line/whitespace-run length threshold before quadratic work check. */
export const HIGHLIGHT_LINE_LENGTH_SOFT_LIMIT = 256
/** densable `hOr` — max cumulative long-line/whitespace-run work. */
export const HIGHLIGHT_LINE_WORK_LIMIT = 16000000
/** Official 2.1.328 `Bbl = H + E * I` — per-message highlight work budget. */
export const HIGHLIGHT_MESSAGE_WORK_BUDGET =
  HIGHLIGHT_BOUND_BASE + HIGHLIGHT_MAX_LENGTH * HIGHLIGHT_BOUND_PER_CHAR

export type HighlightWorkBudget = { left: number }
export type ChargeHighlightWork = <T>(
  work: HighlightWorkBudget,
  fn: () => T,
) => T

const COUNTED_LANGUAGES = new Set([
  'abnf',
  'accesslog',
  'ada',
  'angelscript',
  'applescript',
  'arcade',
  'arduino',
  'asciidoc',
  'aspectj',
  'autohotkey',
  'awk',
  'bash',
  'brainfuck',
  'c',
  'cal',
  'clojure',
  'clojure-repl',
  'coffeescript',
  'cos',
  'cpp',
  'crmsh',
  'crystal',
  'csharp',
  'css',
  'dart',
  'delphi',
  'django',
  'dns',
  'dockerfile',
  'dos',
  'dsconfig',
  'dts',
  'dust',
  'elixir',
  'erb',
  'erlang',
  'excel',
  'fsharp',
  'gams',
  'gauss',
  'gcode',
  'go',
  'graphql',
  'groovy',
  'haml',
  'handlebars',
  'haskell',
  'http',
  'ini',
  'java',
  'javascript',
  'jboss-cli',
  'julia',
  'julia-repl',
  'kotlin',
  'latex',
  'leaf',
  'less',
  'livecodeserver',
  'livescript',
  'llvm',
  'markdown',
  'matlab',
  'mipsasm',
  'mojolicious',
  'monkey',
  'moonscript',
  'nestedtext',
  'nginx',
  'nim',
  'nix',
  'node-repl',
  'nsis',
  'objectivec',
  'ocaml',
  'parser3',
  'perl',
  'pgsql',
  'php',
  'php-template',
  'pony',
  'powershell',
  'processing',
  'profile',
  'properties',
  'protobuf',
  'puppet',
  'python',
  'python-repl',
  'qml',
  'r',
  'reasonml',
  'roboconf',
  'routeros',
  'ruby',
  'rust',
  'sas',
  'scala',
  'scheme',
  'scilab',
  'scss',
  'shell',
  'smali',
  'smalltalk',
  'sml',
  'stan',
  'stata',
  'stylus',
  'swift',
  'tap',
  'tcl',
  'tp',
  'twig',
  'typescript',
  'vbnet',
  'vbscript',
  'vbscript-html',
  'verilog',
  'wren',
  'x86asm',
  'xl',
  'xml',
  'xquery',
  'yaml',
  'zephir',
])
const KNOWN_LANGUAGES = new Set([
  ...HIGHLIGHT_LANG_MAX_LENGTH.keys(),
  ...COUNTED_LANGUAGES,
])
const SPECIAL_CHAR_MAP = new Map<string, [string, RegExp]>([
  ['markdown', ['[`~<', /<(?:script|style)(?=\s|>)/iu]],
])
const LINE_OR_SPACES_RE = /\s+|[^\n]+/g

type BoundWallet = { left: number }

type EmitterInstance = {
  stack?: unknown[]
  openNode(name: unknown): void
  addText(text: string): void
  __addSublanguage(other: unknown, name?: string): void
  toHTML(): string
}

type EmitterCtor = (new (
  opts?: unknown,
) => EmitterInstance) & {
  prototype: { openNode?: unknown; isBounded?: unknown }
  isBounded?: boolean
}

export type HljsBoundApi = {
  highlightAuto: (
    code: string,
    languages?: string[],
  ) => {
    _emitter?: { constructor?: unknown }
    emitter?: { constructor?: unknown }
  }
  configure: (opts: { __emitter: unknown }) => void
  addPlugin: (plugin: {
    'before:highlight': (event: { language?: string; code: string }) => void
    'after:highlight': () => void
  }) => void
  getLanguage: (name: string | undefined) => unknown
  listLanguages: () => string[]
}

/** densable `b`. */
function charge(wallet: BoundWallet, n: number): void {
  wallet.left -= n
  if (wallet.left < 0) throw new HighlightBoundError()
}

/** densable `ee`. */
function countNewlines(text: string): number {
  let n = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    n += 1
  }
  return n
}

/** densable `ne`. */
function isUnboundedEmitter(ctor: unknown): ctor is EmitterCtor {
  return (
    typeof ctor === 'function' &&
    'openNode' in ctor.prototype &&
    !('isBounded' in ctor)
  )
}

/** densable `te`. */
function boundedEmitter(Base: EmitterCtor, wallet: BoundWallet): EmitterCtor {
  return class Bounded extends Base {
    static isBounded = true
    held = 0
    breaks = 0
    height = 0
    constructor(opts?: unknown) {
      super(opts)
      charge(wallet, HIGHLIGHT_BOUND_CONSTRUCTOR)
    }
    openNode(name: unknown): void {
      this.held += 1
      charge(wallet, 1)
      super.openNode(name)
      this.grownTo((this.stack?.length ?? 1) - 1)
    }
    addText(text: string): void {
      const breaks = countNewlines(text)
      this.held += text.length
      this.breaks += breaks
      charge(
        wallet,
        text.length + breaks * ((this.stack?.length ?? 1) - 1) ** 2,
      )
      super.addText(text)
    }
    __addSublanguage(other: unknown, name?: string): void {
      if (other instanceof Bounded) {
        const height = (this.stack?.length ?? 0) + other.height
        this.held += other.held
        this.breaks += other.breaks
        this.grownTo(height)
        charge(wallet, other.breaks * height ** 2)
      }
      super.__addSublanguage(other, name)
    }
    toHTML(): string {
      charge(wallet, this.held)
      return super.toHTML()
    }
    grownTo(height: number): void {
      this.height = Math.max(this.height, height)
      if (this.height > HIGHLIGHT_BOUND_MAX_HEIGHT) {
        charge(wallet, Number.POSITIVE_INFINITY)
      }
    }
  }
}

type LangNode = {
  subLanguage?: unknown
  contains?: unknown[]
  variants?: unknown[]
  starts?: unknown
}

/** densable `re`. */
function sublanguageFanout(hljs: HljsBoundApi, node: unknown): number {
  const seen = new Set<object>()
  const stack: unknown[] = [node]
  let max = 0
  while (stack.length > 0) {
    const cur = stack.pop()
    if (typeof cur !== 'object' || cur === null || seen.has(cur)) continue
    seen.add(cur)
    const rec = cur as LangNode
    const sub = 'subLanguage' in rec ? rec.subLanguage : undefined
    const isList = Array.isArray(sub)
    max = Math.max(max, isList ? sub.length || Number.POSITIVE_INFINITY : 0)
    stack.push(
      ...[sub ?? []]
        .flat()
        .filter((id): id is string => typeof id === 'string')
        .map(id => hljs.getLanguage(id)),
      ...(rec.contains ?? []),
      ...('variants' in rec ? (rec.variants ?? []) : []),
      'starts' in rec ? rec.starts : undefined,
    )
  }
  return max
}

/** densable `oe`. */
function budgetFor(
  hljs: HljsBoundApi,
  fanoutCap: number,
): (language: string | undefined, length: number) => number {
  let cache = new WeakMap<object, number>()
  let languageCount = 0
  const fanoutOf = (lang: unknown): number => {
    const listed = hljs.listLanguages().length
    if (lang === undefined) return 0
    if (listed !== languageCount) {
      cache = new WeakMap()
      languageCount = listed
    }
    if (typeof lang !== 'object' || lang === null) return 0
    const hit = cache.get(lang)
    if (hit !== undefined) return Math.min(hit, listed, fanoutCap)
    const next = sublanguageFanout(hljs, lang)
    cache.set(lang, next)
    return Math.min(next, listed, fanoutCap)
  }
  return (language, length) =>
    HIGHLIGHT_BOUND_BASE +
    length *
      (HIGHLIGHT_BOUND_PER_CHAR +
        HIGHLIGHT_BOUND_PER_SUBLANG * fanoutOf(hljs.getLanguage(language)))
}

type SpentTally = { spent: number }

const noopChargeHighlightWork: ChargeHighlightWork = (_work, fn) => fn()
const chargeByHljs = new WeakMap<object, ChargeHighlightWork>()

/** densable `ie` / official 2.1.328 `er`. */
function boundPlugin(
  wallet: BoundWallet,
  budget: (language: string | undefined, length: number) => number,
  tally: SpentTally,
) {
  return {
    'before:highlight': (event: { language?: string; code: string }) => {
      wallet.left = budget(event.language, event.code.length)
      tally.spent = wallet.left
    },
    'after:highlight': () => {
      const over = wallet.left < 0
      tally.spent -= Math.max(wallet.left, 0)
      wallet.left = Number.POSITIVE_INFINITY
      if (over) throw new HighlightBoundError()
    },
  }
}

/** densable `X` / `T` / `Y` / `zPs` / `VPs` / `Q` — pre-highlight length & long-line/whitespace guards. */
function countSpecialChars(segment: string, chars: string | undefined): number {
  if (chars === undefined) return segment.length
  let count = 0
  for (const ch of segment) {
    if (chars.includes(ch)) count += 1
  }
  return count
}

function measureLongLineWork(code: string, chars: string | undefined): number {
  let work = 0
  if (code.length <= HIGHLIGHT_LINE_LENGTH_SOFT_LIMIT) return work
  for (const [segment] of code.matchAll(LINE_OR_SPACES_RE)) {
    if (segment.length > HIGHLIGHT_LINE_LENGTH_SOFT_LIMIT) {
      work += countSpecialChars(segment, chars) * segment.length
    }
  }
  return work
}

function passesFastCheck(code: string): boolean {
  return (
    code.length <= HIGHLIGHT_MIN_LANG_MAX_LENGTH &&
    measureLongLineWork(code, undefined) <= HIGHLIGHT_LINE_WORK_LIMIT
  )
}

function getSpecialCharsForLanguage(
  code: string,
  language: string | undefined,
): string | undefined {
  if (language === undefined) return undefined
  const entry = SPECIAL_CHAR_MAP.get(language)
  return entry === undefined || entry[1].test(code) ? undefined : entry[0]
}

function measureLanguageLineWork(
  code: string,
  language: string | undefined,
): number {
  if (
    language !== undefined &&
    COUNTED_LANGUAGES.has(language) &&
    code.length > HIGHLIGHT_LINE_LENGTH_SOFT_LIMIT
  ) {
    return measureLongLineWork(code, getSpecialCharsForLanguage(code, language))
  }
  return 0
}

function passesLanguageCheck(
  code: string,
  language: string | undefined,
): boolean {
  const maxLen =
    (language !== undefined
      ? HIGHLIGHT_LANG_MAX_LENGTH.get(language)
      : undefined) ?? HIGHLIGHT_MAX_LENGTH
  return (
    code.length <= maxLen &&
    measureLanguageLineWork(code, language) <= HIGHLIGHT_LINE_WORK_LIMIT
  )
}

function resolveLanguageForLimit(
  hljs: HljsBoundApi,
  language: string | undefined,
): string | undefined {
  if (language === undefined) return undefined
  const langToName = new Map<unknown, string>(
    [...KNOWN_LANGUAGES].flatMap(name => {
      const langObj = hljs.getLanguage(name)
      return langObj === undefined ? [] : [[langObj, name]]
    }),
  )
  const seen = new Set<object>()
  const queue: unknown[] = KNOWN_LANGUAGES.has(language)
    ? []
    : [hljs.getLanguage(language)]
  let resolved: string | undefined = language
  while (queue.length > 0) {
    const cur = queue.pop()
    if (typeof cur !== 'object' || cur === null || seen.has(cur)) continue
    const rec = cur as LangNode
    const match =
      'subLanguage' in rec &&
      Array.isArray(rec.subLanguage) &&
      rec.subLanguage.length === 0
        ? ([...langToName.values()].find(name => !SPECIAL_CHAR_MAP.has(name)) ??
          langToName.values().next().value)
        : langToName.get(cur)
    if (match !== undefined && !SPECIAL_CHAR_MAP.has(match)) return match
    resolved = match ?? resolved
    seen.add(cur)
    if (match === undefined) {
      queue.push(
        ...[rec.subLanguage ?? []]
          .flat()
          .filter((id): id is string => typeof id === 'string')
          .map(id => hljs.getLanguage(id)),
        ...(rec.contains ?? []),
        ...('variants' in rec ? (rec.variants ?? []) : []),
        'starts' in rec ? rec.starts : undefined,
      )
    }
  }
  return resolved
}

function limitPlugin(hljs: HljsBoundApi) {
  return {
    'before:highlight': (event: { language?: string; code: string }) => {
      if (
        !passesFastCheck(event.code) &&
        !passesLanguageCheck(
          event.code,
          resolveLanguageForLimit(hljs, event.language),
        )
      ) {
        throw new HighlightLimitError()
      }
    },
    'after:highlight': () => {},
  }
}

/** densable `z` / official 2.1.328 `R` + `Z`. */
export function bindHighlightBudget(
  hljs: HljsBoundApi,
  fanoutCap: number = HIGHLIGHT_BOUND_SUBLANGUAGE_CAP,
): ChargeHighlightWork {
  const existing = chargeByHljs.get(hljs)
  if (existing) return existing
  const raw =
    hljs.highlightAuto('', [])._emitter?.constructor ??
    hljs.highlightAuto('', []).emitter?.constructor
  if ('isBounded' in ((raw as object) ?? {})) return noopChargeHighlightWork
  hljs.addPlugin(limitPlugin(hljs))
  if (!isUnboundedEmitter(raw)) return noopChargeHighlightWork
  const wallet: BoundWallet = { left: Number.POSITIVE_INFINITY }
  const tally: SpentTally = { spent: 0 }
  hljs.configure({ __emitter: boundedEmitter(raw, wallet) })
  hljs.addPlugin(boundPlugin(wallet, budgetFor(hljs, fanoutCap), tally))
  const charge: ChargeHighlightWork = (work, fn) => {
    tally.spent = 0
    try {
      return fn()
    } finally {
      work.left -= tally.spent
    }
  }
  chargeByHljs.set(hljs, charge)
  return charge
}

/** densable `Se` / official 2.1.328 `Ir`. */
export function bindDefaultHighlightBudget(
  hljs: HljsBoundApi,
): ChargeHighlightWork {
  return bindHighlightBudget(hljs, HIGHLIGHT_BOUND_SUBLANGUAGE_CAP)
}

export function resolveHljsApi(mod: unknown): HljsBoundApi {
  const rec = mod as { default?: HljsBoundApi } & HljsBoundApi
  return rec.default !== undefined &&
    typeof rec.default.highlightAuto === 'function'
    ? rec.default
    : rec
}
