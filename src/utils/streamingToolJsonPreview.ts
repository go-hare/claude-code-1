/**
 * densable CLp / xLp / ALp — streaming tool_use input JSON preview for REPL.
 *
 * When CLAUDE_REPL_VERBOSE is on and REPL mode is enabled, partial JSON for
 * tool name "REPL" is decoded from `{"code":"...` into contentBlock.input.code
 * for live display (throttled 100ms, cap 8192).
 */

import { isEnvTruthy } from './envUtils.js'

/** densable XAb — min ms between REPL code preview flushes */
export const REPL_STREAM_PREVIEW_FLUSH_MS = 100
/** densable TLp — max decoded code chars shown while streaming */
export const REPL_STREAM_PREVIEW_MAX_CHARS = 8192
/** densable JAb = TLp*2 — raw partial_json buffer cap */
export const REPL_STREAM_PREVIEW_RAW_CAP = REPL_STREAM_PREVIEW_MAX_CHARS * 2
/** densable wLp — JSON prefix for REPL code field */
const REPL_CODE_JSON_PREFIX = '{"code":"'
/** densable Py */
export const REPL_STREAM_TOOL_NAME = 'REPL'

type PreviewBuf = { raw: string; flushedAt: number }

const previewByIndex = new Map<number, PreviewBuf>()

/**
 * densable g4e — REPL verbose streaming preview gate.
 * CLAUDE_REPL_VERBOSE && isReplModeEnabled (f$).
 */
export function isReplStreamingPreviewEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEnvTruthy(env.CLAUDE_REPL_VERBOSE)) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isReplModeEnabled } =
      require('@claude-code/builtin-tools/tools/REPLTool/constants.js') as typeof import('@claude-code/builtin-tools/tools/REPLTool/constants.js')
    return isReplModeEnabled()
  } catch {
    return false
  }
}

/**
 * densable ALp — decode JSON string body after `{"code":"` until unescaped `"`.
 */
export function decodePartialReplCodeJson(raw: string): string {
  if (!raw.startsWith(REPL_CODE_JSON_PREFIX)) return ''
  const t = raw.slice(REPL_CODE_JSON_PREFIX.length)
  const out: string[] = []
  for (let n = 0; n < t.length; n++) {
    const o = t[n]!
    if (o === '"') break
    if (o !== '\\') {
      out.push(o)
      continue
    }
    const i = t[n + 1]
    if (i === undefined) break
    n++
    if (i === 'n') out.push('\n')
    else if (i === 't') out.push('\t')
    else if (i === 'r') out.push('\r')
    else if (i === 'u') {
      const s = t.slice(n + 1, n + 5)
      if (s.length < 4) break
      out.push(String.fromCharCode(parseInt(s, 16)))
      n += 4
    } else out.push(i)
  }
  return out.join('')
}

/** densable CLp */
export function clearStreamingToolJsonPreview(): void {
  previewByIndex.clear()
}

/**
 * densable xLp — throttle-update REPL tool contentBlock.input.code from partial JSON.
 * Generic so callers can pass StreamingToolUse[] updaters without cast.
 */
export function updateStreamingToolJsonPreview<
  T extends {
    index: number
    contentBlock: { name?: string; input?: unknown }
  },
>(
  index: number,
  partialJson: string,
  onStreamingToolUses?: ((f: (tools: T[]) => T[]) => void) | null,
): void {
  if (!onStreamingToolUses || !isReplStreamingPreviewEnabled()) return
  let n = previewByIndex.get(index)
  if (!n) {
    n = { raw: '', flushedAt: 0 }
    previewByIndex.set(index, n)
  }
  if (n.raw.length < REPL_STREAM_PREVIEW_RAW_CAP) {
    n.raw += partialJson
  }
  const o = Date.now()
  if (o - n.flushedAt < REPL_STREAM_PREVIEW_FLUSH_MS) return
  n.flushedAt = o
  const code = decodePartialReplCodeJson(n.raw).slice(
    0,
    REPL_STREAM_PREVIEW_MAX_CHARS,
  )
  onStreamingToolUses(s => {
    const a = s.findIndex(l => l.index === index)
    if (a === -1) return s
    const cur = s[a]!
    if (cur.contentBlock.name !== REPL_STREAM_TOOL_NAME) return s
    const copy = s.slice()
    copy[a] = {
      ...cur,
      contentBlock: {
        ...cur.contentBlock,
        input: { code },
      },
    }
    return copy
  })
}
