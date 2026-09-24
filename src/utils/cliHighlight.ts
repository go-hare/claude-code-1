// highlight.js's type defs carry `/// <reference lib="dom" />`. SSETransport,
// mcp/client, ssh, dumpPrompts use DOM types (TextDecodeOptions, RequestInfo)
// that only typecheck because the hljs import below pulls lib.dom in.
// tsconfig has lib: ["ESNext"] only — this ref preserves the status quo.
/// <reference lib="dom" />

import { extname } from 'path'
// Static import — dynamic import('highlight.js') fails in Bun --compile mode
// because module resolution points to the internal bunfs binary path.
import hljs from 'highlight.js'

export type CliHighlight = {
  highlight: typeof import('cli-highlight').highlight
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

// One promise shared by Fallback.tsx, markdown.ts, events.ts, getLanguageName.
let cliHighlightPromise: Promise<CliHighlight | null> | undefined

let loadedGetLanguage:
  | ((name: string) => { name?: string } | undefined)
  | undefined

async function loadCliHighlight(): Promise<CliHighlight | null> {
  try {
    const cliHighlight = await import('cli-highlight')
    // highlight.js CJS interop: `export =` wraps in .default under ESM
    const hljsMod = hljs as {
      getLanguage?: typeof loadedGetLanguage
      default?: typeof hljs
    } & HljsLike
    // Re-strip in case another import re-registered (or cli-highlight
    // resolved a separate hljs copy that we cannot see — still lock ours).
    stripDensableRemovedHljsLanguages(hljsMod)
    loadedGetLanguage = hljsMod.getLanguage ?? hljsMod.default?.getLanguage
    const supportsLanguage = (name: string): boolean => {
      const id = name.toLowerCase()
      if ((DENSABLE_REMOVED_HLJS_LANGUAGES as readonly string[]).includes(id)) {
        return false
      }
      return cliHighlight.supportsLanguage(name)
    }
    return {
      highlight: (code, options) => {
        const lang =
          options && typeof options === 'object' && 'language' in options
            ? String(
                (options as { language?: string }).language ?? '',
              ).toLowerCase()
            : ''
        if (
          lang &&
          (DENSABLE_REMOVED_HLJS_LANGUAGES as readonly string[]).includes(lang)
        ) {
          // densable: no grammar → plain text (cli-highlight without language)
          return cliHighlight.highlight(code, {
            ...options,
            language: undefined,
          })
        }
        return cliHighlight.highlight(code, options)
      },
      supportsLanguage,
    }
  } catch {
    return null
  }
}

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  cliHighlightPromise ??= loadCliHighlight()
  return cliHighlightPromise
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
