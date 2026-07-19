/**
 * densable app:diffFileListUp/Down — Global ctrl/meta+up/down when a diff
 * file list is mounted (DiffDialog / future DiffPanel). Handlers register
 * while the list is active so Global bindings stay in defaultBindings even
 * when no panel is open (no-op).
 */

type DiffFileListNav = {
  up: () => void
  down: () => void
}

let nav: DiffFileListNav | null = null

/** Register while a diff file list is focused; returns unregister. */
export function registerDiffFileListNav(handlers: DiffFileListNav): () => void {
  nav = handlers
  return () => {
    if (nav === handlers) nav = null
  }
}

/** densable app:diffFileListUp */
export function diffFileListUp(): boolean {
  if (!nav) return false
  nav.up()
  return true
}

/** densable app:diffFileListDown */
export function diffFileListDown(): boolean {
  if (!nav) return false
  nav.down()
  return true
}
