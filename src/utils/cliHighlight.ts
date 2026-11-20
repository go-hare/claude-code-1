// highlight.js's type defs carry `/// <reference lib="dom" />`. SSETransport,
// mcp/client, ssh, dumpPrompts use DOM types (TextDecodeOptions, RequestInfo)
// that only typecheck because the hljs import below pulls lib.dom in.
// tsconfig has lib: ["ESNext"] only — this ref preserves the status quo.
/// <reference lib="dom" />

import { extname } from 'path'
// Static import — dynamic import('highlight.js') fails in Bun --compile mode
// because module resolution points to the internal bunfs binary path.
import hljs from 'highlight.js'
import * as cliHighlight from 'cli-highlight'
import {
  bindDefaultHighlightBudget,
  HIGHLIGHT_MESSAGE_WORK_BUDGET,
  HighlightBoundError,
  HighlightLimitError,
  type HighlightWorkBudget,
  resolveHljsApi,
} from 'color-diff-napi'

export { HIGHLIGHT_MESSAGE_WORK_BUDGET, type HighlightWorkBudget }

export type CliHighlightOptions = import('cli-highlight').HighlightOptions & {
  /** Official 2.1.328 shared work budget decremented by highlight.js emitter work. */
  work?: HighlightWorkBudget
  /** Optional code fence token identity for per-render deduplication. */
  fence?: unknown
}

export type CliHighlight = {
  highlight: (code: string, options?: CliHighlightOptions) => string
  supportsLanguage: typeof import('cli-highlight').supportsLanguage
}

/**
 * densable 2.1.251 #69 — six rarely-used languages absent from SEA `Ec`/`Pwe`
 * (178 loaders; gold-251-f: name:"Mathematica"/maxima/isbl/"1c"/GML/SQF = 0
 * beside grammars). Official does not register them; local full highlight.js
 * still ships them. Strip via `unregisterLanguage` to match the SEA set.
 * Not an invented uninstall list beyond the changelog six.
 */
export const DENSABLE_REMOVED_HLJS_LANGUAGES = [
  '1c',
  'gml',
  'isbl',
  'mathematica',
  'maxima',
  'sqf',
] as const

type HljsLike = {
  getLanguage?: (name: string) => unknown
  unregisterLanguage?: (name: string) => void
  default?: HljsLike
}

/**
 * densable #69 product arm — drop the six ids from a highlight.js instance.
 */
export function stripDensableRemovedHljsLanguages(engine: HljsLike): void {
  const root = engine.default ?? engine
  const unregister = root.unregisterLanguage?.bind(root)
  const getLanguage = root.getLanguage?.bind(root)
  if (!unregister || !getLanguage) return
  for (const id of DENSABLE_REMOVED_HLJS_LANGUAGES) {
    try {
      if (getLanguage(id)) unregister(id)
    } catch {
      // ignore engines that reject unknown ids
    }
  }
}

// Match SEA at import time so getLanguageName / direct hljs readers agree.
stripDensableRemovedHljsLanguages(hljs as HljsLike)
// densable 2.1.289 `Se` / official 2.1.328 `Ir` — same hljs singleton ColorFile binds.
let chargeHighlightWork = bindDefaultHighlightBudget(resolveHljsApi(hljs))

let loadedGetLanguage:
  | ((name: string) => { name?: string } | undefined)
  | undefined

type HljsEmitterNode =
  | string
  | {
      scope?: string
      kind?: string
      children?: HljsEmitterNode[]
    }

function colorizeEmitterNode(
  node: HljsEmitterNode,
  theme: Record<string, ((s: string) => string) | undefined>,
  inToken = false,
): string {
  if (typeof node === 'string') {
    if (!inToken) {
      const fn = theme.default ?? cliHighlight.DEFAULT_THEME.default
      return typeof fn === 'function' ? fn(node) : cliHighlight.plain(node)
    }
    return node
  }
  const children = node.children ?? []
  const rawScope = node.scope ?? node.kind
  if (rawScope) {
    const scope = rawScope.replace(/^hljs-/, '')
    const baseScope = scope.split('.')[0] ?? scope
    const text = children
      .map(child => colorizeEmitterNode(child, theme, true))
      .join('')
    const fn =
      theme[scope] ??
      theme[baseScope] ??
      (cliHighlight.DEFAULT_THEME as Record<string, unknown>)[scope] ??
      (cliHighlight.DEFAULT_THEME as Record<string, unknown>)[baseScope]
    return typeof fn === 'function'
      ? (fn as (s: string) => string)(text)
      : cliHighlight.plain(text)
  }
  return children
    .map(child => colorizeEmitterNode(child, theme, inToken))
    .join('')
}

/**
 * densable oa `gN()` — sync. Official Markdown first-paints with highlight
 * already resolved. Dynamic import + Suspense remount DualInk leftoverGs-clears
 * the spinner row on the first streaming token.
 */
function loadCliHighlightSync(): CliHighlight | null {
  try {
    const hljsMod = hljs as {
      getLanguage?: typeof loadedGetLanguage
      highlight?: typeof hljs.highlight
      highlightAuto?: typeof hljs.highlightAuto
      default?: typeof hljs
    } & HljsLike
    stripDensableRemovedHljsLanguages(hljsMod)
    chargeHighlightWork = bindDefaultHighlightBudget(resolveHljsApi(hljsMod))
    const hljsRoot = hljsMod.default ?? hljsMod
    loadedGetLanguage = hljsRoot.getLanguage?.bind(hljsRoot)
    const supportsLanguage = (name: string): boolean => {
      const id = name.toLowerCase()
      if ((DENSABLE_REMOVED_HLJS_LANGUAGES as readonly string[]).includes(id)) {
        return false
      }
      return (
        Boolean(loadedGetLanguage?.(name)) ||
        cliHighlight.supportsLanguage(name)
      )
    }
    return {
      highlight: (code, options) => {
        const rawLang =
          options && typeof options === 'object' && 'language' in options
            ? String(options.language ?? '')
            : ''
        const lowerLang = rawLang.toLowerCase()
        const removedLang =
          Boolean(lowerLang) &&
          (DENSABLE_REMOVED_HLJS_LANGUAGES as readonly string[]).includes(
            lowerLang,
          )
        const effectiveLang = removedLang ? undefined : rawLang || undefined
        const work = options?.work
        try {
          const run = () => {
            if (effectiveLang && loadedGetLanguage?.(effectiveLang)) {
              return hljsRoot.highlight!(code, {
                language: effectiveLang,
                ignoreIllegals: options?.ignoreIllegals ?? true,
              })
            }
            if (!effectiveLang) {
              return hljsRoot.highlightAuto!(code, options?.languageSubset)
            }
            return null
          }
          const result = work ? chargeHighlightWork(work, run) : run()
          if (result !== null) {
            const emitter =
              (
                result as {
                  _emitter?: {
                    rootNode?: HljsEmitterNode
                    root?: HljsEmitterNode
                  }
                  emitter?: {
                    rootNode?: HljsEmitterNode
                    root?: HljsEmitterNode
                  }
                }
              )._emitter ??
              (
                result as {
                  emitter?: {
                    rootNode?: HljsEmitterNode
                    root?: HljsEmitterNode
                  }
                }
              ).emitter
            const rootNode = emitter?.rootNode ?? emitter?.root
            if (
              rootNode &&
              typeof rootNode !== 'string' &&
              Array.isArray(rootNode.children)
            ) {
              const theme = (options?.theme ??
                cliHighlight.DEFAULT_THEME) as Record<
                string,
                ((s: string) => string) | undefined
              >
              return rootNode.children
                .map(child => colorizeEmitterNode(child, theme))
                .join('')
            }
          }
          if (removedLang) {
            return cliHighlight.highlight(code, {
              ...options,
              language: undefined,
            })
          }
          return cliHighlight.highlight(code, options)
        } catch (err) {
          if (
            err instanceof HighlightBoundError ||
            err instanceof HighlightLimitError
          ) {
            return code
          }
          throw err
        }
      },
      supportsLanguage,
    }
  } catch {
    return null
  }
}

const highlightSnapshot: CliHighlight | null = loadCliHighlightSync()

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  return Promise.resolve(highlightSnapshot)
}

/** densable oa `gN()` */
export function peekCliHighlight(): CliHighlight | null {
  return highlightSnapshot
}

/**
 * eg. "foo/bar.ts" → "TypeScript". Awaits the shared cli-highlight load,
 * then reads highlight.js's language registry. All callers are telemetry
 * (OTel counter attributes, permission-dialog unary events) — none block
 * on this, they fire-and-forget or the consumer already handles Promise<string>.
 */
export async function getLanguageName(file_path: string): Promise<string> {
  await getCliHighlightPromise()
  const ext = extname(file_path).slice(1)
  if (!ext) return 'unknown'
  return loadedGetLanguage?.(ext)?.name ?? 'unknown'
}
