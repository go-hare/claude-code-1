/**
 * densable 2.1.218 `Zlt` / `yir` — hard cap on recursive ink DOM walks.
 *
 * Deep trees (or pathological nesting) used to throw "Maximum call stack size
 * exceeded" during hit-test / render / screen-reader extraction. densable
 * skips the deeper subtree and logs once per walk kind.
 */
import { logForDebugging } from '../utils/debug.js'

/** densable `Zlt = 256` */
export const MAX_TREE_DEPTH = 256

const warned = new Set<string>()

/**
 * densable `yir` — once per walk kind (`hitTest`, `renderNodeToOutput`,
 * `renderNodeToScreenReaderOutput`, …).
 */
export function warnTreeDepthExceeded(kind: string, nodeName: string): void {
  if (warned.has(kind)) return
  warned.add(kind)
  logForDebugging(
    `${kind}: ink tree depth exceeded MAX_TREE_DEPTH (${MAX_TREE_DEPTH}) at <${nodeName}>; skipping deeper subtree instead of overflowing the call stack`,
    { level: 'warn' },
  )
}

/** Test helper — reset once-per-kind set. */
export function resetTreeDepthWarningsForTests(): void {
  warned.clear()
}
