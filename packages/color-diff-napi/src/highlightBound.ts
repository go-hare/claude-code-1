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

/** densable `ie`. */
function boundPlugin(
  wallet: BoundWallet,
  budget: (language: string | undefined, length: number) => number,
) {
  return {
    'before:highlight': (event: { language?: string; code: string }) => {
      wallet.left = budget(event.language, event.code.length)
    },
    'after:highlight': () => {
      const over = wallet.left < 0
      wallet.left = Number.POSITIVE_INFINITY
      if (over) throw new HighlightBoundError()
    },
  }
}

/** densable `z`. */
export function bindHighlightBudget(
  hljs: HljsBoundApi,
  fanoutCap: number = HIGHLIGHT_BOUND_SUBLANGUAGE_CAP,
): void {
  const raw =
    hljs.highlightAuto('', [])._emitter?.constructor ??
    hljs.highlightAuto('', []).emitter?.constructor
  if (!isUnboundedEmitter(raw)) return
  const wallet: BoundWallet = { left: Number.POSITIVE_INFINITY }
  hljs.configure({ __emitter: boundedEmitter(raw, wallet) })
  hljs.addPlugin(boundPlugin(wallet, budgetFor(hljs, fanoutCap)))
}

/** densable `Se`. */
export function bindDefaultHighlightBudget(hljs: HljsBoundApi): void {
  bindHighlightBudget(hljs, HIGHLIGHT_BOUND_SUBLANGUAGE_CAP)
}

export function resolveHljsApi(mod: unknown): HljsBoundApi {
  const rec = mod as { default?: HljsBoundApi } & HljsBoundApi
  return rec.default !== undefined &&
    typeof rec.default.highlightAuto === 'function'
    ? rec.default
    : rec
}
