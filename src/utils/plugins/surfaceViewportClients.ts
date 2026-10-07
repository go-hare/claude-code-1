/**
 * densable 2.1.289 empty `Z1` / `ae` surface viewport client registry + `Epn`.
 *
 * Tip never attaches desktop|mobile|vscode surfaces; empty registry → Epn
 * returns undefined → placementAtOpen places (≡ today's columns-unknown place).
 * Do **not** invent ui_attach / Fco / fake fullscreen clients.
 * Do **not** export minify `Z1` / `Epn` / `xe` / `Spn`.
 */

import { createSignal } from '../signal.js'

export type SurfaceViewport = {
  columns?: number
  rows?: number
  /** densable Spn: key presence (not truthiness) marks pane-placing surface. */
  isFullscreen?: boolean
}

export type SurfaceViewportClient = {
  clientId: string
  surface: 'desktop' | 'mobile' | 'vscode' | string
  viewport?: SurfaceViewport
  answers?: unknown
  attachedAt?: number
}

const clients = new Map<string, SurfaceViewportClient>()
const detachSignal = createSignal<[clientId: string]>()

/**
 * densable `ae().attach` — first attach returns true; later viewport/answers merge
 * returns false.
 */
export function attachSurfaceViewportClient(
  client: SurfaceViewportClient,
): boolean {
  const prior = clients.get(client.clientId)
  if (prior === undefined) {
    clients.set(client.clientId, { ...client })
    return true
  }
  if (client.viewport !== undefined || client.answers !== undefined) {
    clients.set(client.clientId, {
      ...prior,
      ...client,
      ...(client.viewport !== undefined && {
        viewport: { ...prior.viewport, ...client.viewport },
      }),
    })
  }
  return false
}

/** densable `ae().detach`. */
export function detachSurfaceViewportClient(
  clientId: string,
): SurfaceViewportClient | undefined {
  const prior = clients.get(clientId)
  if (prior === undefined) return undefined
  clients.delete(clientId)
  detachSignal.emit(clientId)
  return prior
}

/** densable `ae().list`. */
export function listSurfaceViewportClients(): SurfaceViewportClient[] {
  return [...clients.values()]
}

/** densable `ae().hasSurface`. */
export function hasSurfaceViewportClient(surface: string): boolean {
  return listSurfaceViewportClients().some(c => c.surface === surface)
}

/** densable `ae().surfaces`. */
export function listAttachedSurfaces(): string[] {
  return [
    ...new Set(
      listSurfaceViewportClients()
        .map(c => c.surface)
        .filter(Boolean),
    ),
  ]
}

/** densable `ae().onDetach`. */
export function onSurfaceViewportClientDetach(
  listener: (clientId: string) => void,
): () => void {
  return detachSignal.subscribe(listener)
}

/** densable `xe` — clients with a viewport object present. */
export function clientsWithViewport(): SurfaceViewportClient[] {
  return listSurfaceViewportClients().filter(c => c.viewport !== undefined)
}

/**
 * densable `Spn` — clients where `viewport.isFullscreen` **key** is present
 * (presence, not truthiness).
 */
export function clientsWithFullscreenKey(): SurfaceViewportClient[] {
  return listSurfaceViewportClients().filter(
    c => c.viewport !== undefined && Object.hasOwn(c.viewport, 'isFullscreen'),
  )
}

/**
 * densable `Epn` — remote placement when terminal columns unknown.
 * - no viewport clients → undefined (caller places)
 * - any fullscreen-key client → placed
 * - else deny with gold reason string
 */
export function placementFromAttachedSurfaces():
  | { isPlaced: true }
  | { isPlaced: false; reason: string }
  | undefined {
  const sized = clientsWithViewport()
  if (sized.length === 0) return undefined
  if (clientsWithFullscreenKey().length > 0) return { isPlaced: true }
  const ids = sized.map(c => c.clientId).join(', ')
  return {
    isPlaced: false,
    reason: `no attached surface places panes (${ids}): placed when a surface that does attaches, or once they detach`,
  }
}

/** Test / dispose — clear registry. */
export function resetSurfaceViewportClientsForTests(): void {
  clients.clear()
  detachSignal.clear()
}
