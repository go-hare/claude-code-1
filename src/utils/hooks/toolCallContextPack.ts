/**
 * densable 2.1.289 IVt / P0e / kcn / MVt / n2o / rlt @189561111–189563222.
 *
 * tool.call `context` strings: rewrite gate, pack to 100k/entry 200k/dispatch,
 * persist via Wue/lre, emit rlt before kce messages with attachment dedup.
 */
import { randomUUID } from 'crypto'
import { logForDebugging } from '../debug.js'
import { persistHookOutput } from './persistHookOutput.js'

/** densable MEn = ckn */
export const TOOL_CALL_CONTEXT_DISPATCH_CHARS = 200_000
/** densable z6t = P5r * oOe = 25000 * 4 */
export const TOOL_CALL_CONTEXT_ENTRY_CHARS = 100_000
/** densable PVt = 2 * Rxe */
export const TOOL_CALL_CONTEXT_PACK_FLOOR = 4_000

const PERSISTED_OUTPUT_OPEN = '<persisted-output>'

/** densable rL — dense string list, else undefined. */
export function listOfContextTexts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const out: string[] = []
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i) || typeof value[i] !== 'string') {
      return undefined
    }
    out.push(value[i])
  }
  return out
}

/** densable P0e */
function nonEmptyTexts(entries: string[]): string[] | undefined {
  const kept = entries.filter(entry => entry !== '')
  return kept.length === 0 ? undefined : kept
}

export type ManagedContextRewrite = {
  rewritten: boolean
  output: unknown
}

/**
 * densable IVt — keep original list unless managed PostToolUse rewrote to
 * a text or a list of texts.
 */
export function rewrittenToolCallContext(
  original: string[],
  rewrite: ManagedContextRewrite,
): string[] | undefined {
  if (!rewrite.rewritten) {
    return original
  }
  if (typeof rewrite.output === 'string') {
    return nonEmptyTexts([rewrite.output])
  }
  const list = listOfContextTexts(rewrite.output)
  if (list !== undefined) {
    return nonEmptyTexts(list)
  }
  logForDebugging(
    'tool.call: the managed rewrite of a context is neither a text nor a list of texts; dropped',
  )
  return undefined
}

/** densable MVt */
async function persistPackedContextEntries(opts: {
  entries: string[]
  limit: number
  event: string
}): Promise<string> {
  const joined = opts.entries.join('\n\n')
  try {
    const out = await persistHookOutput(
      joined,
      `${opts.event}-${randomUUID()}`,
      'additionalContext',
      { threshold: opts.limit },
    )
    if (out.includes('[Hook additionalContext truncated at ')) {
      return `${joined.slice(0, opts.limit)}\n\n[${opts.event} context of ${joined.length} characters cut at ${opts.limit}: writing it to disk failed]`
    }
    return out
  } catch {
    return `${joined.slice(0, opts.limit)}\n\n[${opts.event} context of ${joined.length} characters cut at ${opts.limit}: writing it to disk failed]`
  }
}

/** densable kcn */
export async function packToolCallContext(
  entries: string[],
  event = 'tool.call',
): Promise<string[]> {
  const packed: string[] = []
  let used = 0
  let i = 0
  while (i < entries.length) {
    const current = entries[i] ?? ''
    const remaining = TOOL_CALL_CONTEXT_DISPATCH_CHARS - used
    const fits =
      current.length <= Math.min(TOOL_CALL_CONTEXT_ENTRY_CHARS, remaining)
    const batch =
      fits || remaining >= TOOL_CALL_CONTEXT_PACK_FLOOR
        ? [current]
        : entries.slice(i)
    const next = fits
      ? current
      : await persistPackedContextEntries({
          entries: batch,
          limit: Math.max(
            0,
            Math.min(TOOL_CALL_CONTEXT_ENTRY_CHARS, remaining),
          ),
          event,
        })
    packed.push(next)
    used += next.length
    i += batch.length
    if (!fits) {
      const label =
        batch.length === 1
          ? 'a context entry'
          : `${batch.length} context entries`
      const persisted = next.startsWith(PERSISTED_OUTPUT_OPEN)
        ? 'written to disk, its head and path kept'
        : 'not written to disk (the persist failed), its head kept inline'
      logForDebugging(
        `${event}: ${label} of ${batch.join('\n\n').length} characters ${persisted} (${TOOL_CALL_CONTEXT_ENTRY_CHARS} an entry, ${TOOL_CALL_CONTEXT_DISPATCH_CHARS} a dispatch; nothing refused)`,
      )
    }
  }
  return packed
}

export function pinHookAttachment(attachment: unknown): string {
  if (attachment === null || typeof attachment !== 'object') {
    return JSON.stringify(attachment)
  }
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(attachment as Record<string, unknown>).toSorted(
        ([a], [b]) => a.localeCompare(b),
      ),
    ),
  )
}
