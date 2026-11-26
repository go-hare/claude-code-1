/**
 * densable 2.1.246 `$vo` / `nq` / `Ipn=["ui.render"]`.
 * `/cd` `ft` calls `pe.invalidateAllRenders()` after watcher rehome.
 *
 * Version counters alone do not re-render React. `App` observes bumps via
 * useSyncExternalStore so cwd-sensitive UI refreshes after `/cd`.
 */
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

export const RENDER_EVENTS = ['ui.render'] as const

type RenderInvalidationHostState = {
  renderVersions: Map<string, number>
  listeners: Set<() => void>
}

const renderInvalidationHostSlot = new HostSlot<RenderInvalidationHostState>(
  () => ({
    renderVersions: new Map<string, number>(),
    listeners: new Set<() => void>(),
  }),
)

function getRenderInvalidationHostState(): RenderInvalidationHostState {
  return renderInvalidationHostSlot.of(getBootstrapSessionHost())
}

/** densable `nq`. */
export function invalidateRender(event: string): void {
  const state = getRenderInvalidationHostState()
  state.renderVersions.set(event, (state.renderVersions.get(event) ?? 0) + 1)
  for (const listener of state.listeners) {
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
  return (
    renderInvalidationHostSlot
      .peek(getBootstrapSessionHost())
      ?.renderVersions.get(event) ?? 0
  )
}

/**
 * Subscribe to any render-event bump. Used by useSyncExternalStore so a
 * version change schedules a React update (Ink then paints on the next frame).
 */
export function subscribeRenderInvalidation(
  onStoreChange: () => void,
): () => void {
  const state = getRenderInvalidationHostState()
  state.listeners.add(onStoreChange)
  return () => {
    state.listeners.delete(onStoreChange)
  }
}

export function resetRenderVersionsForTests(): void {
  const state = renderInvalidationHostSlot.peek(getBootstrapSessionHost())
  if (!state) return
  state.renderVersions.clear()
  state.listeners.clear()
}
