/**
 * densable 2.1.246 `$vo` / `nq` / `Ipn=["ui.render"]`.
 * `/cd` `ft` calls `pe.invalidateAllRenders()` after watcher rehome.
 *
 * Version counters alone do not re-render React. `App` observes bumps via
 * useSyncExternalStore so cwd-sensitive UI refreshes after `/cd`.
 */
export const RENDER_EVENTS = ['ui.render'] as const

const renderVersions = new Map<string, number>()
const listeners = new Set<() => void>()

/** densable `nq`. */
export function invalidateRender(event: string): void {
  renderVersions.set(event, (renderVersions.get(event) ?? 0) + 1)
  for (const listener of listeners) {
    listener()
  }
}

/** densable `$vo`. */
export function invalidateAllRenders(): void {
  for (const event of RENDER_EVENTS) {
    invalidateRender(event)
  }
}

export function getRenderVersion(event: string): number {
  return renderVersions.get(event) ?? 0
}

/**
 * Subscribe to any render-event bump. Used by useSyncExternalStore so a
 * version change schedules a React update (Ink then paints on the next frame).
 */
export function subscribeRenderInvalidation(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function resetRenderVersionsForTests(): void {
  renderVersions.clear()
  listeners.clear()
}
