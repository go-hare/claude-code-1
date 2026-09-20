import type { ReactNode } from 'react'
import {
  createRoot as createInkRoot,
  type RenderOptions,
  type Root,
} from '@anthropic/ink'
import { wrapWithSessionServices } from '../context/sessionServices.js'
import { getPinnedStorageV5 } from './storageV5/index.js'

/**
 * densable `h8` / `m8` / `H0`. Official:
 *   l = o?.storageV5 !== void 0 ? ce(o.storageV5) : void 0
 *   render(s) => ink.render(H0(s, l))
 *   H0(e,o) = o !== void 0 ? z({...o, children: inkTree}) : inkTree
 *
 * Ink itself stays storage-free. This is the Claude `_490.js` wrap.
 * Callers that omit `storageV5` leftover-wire the CLI pin (official Pe/h8
 * option), not a We() read.
 */
export type SessionRenderOptions = RenderOptions & {
  storageV5?: unknown
}

export async function createRoot(
  options: SessionRenderOptions = {},
): Promise<Root> {
  const { storageV5: optionStorageV5, ...inkOptions } = options
  const storageV5 =
    'storageV5' in options ? optionStorageV5 : getPinnedStorageV5()
  const root = await createInkRoot(inkOptions)
  return {
    render(node: ReactNode) {
      root.render(wrapWithSessionServices(node, storageV5))
    },
    unmount: () => root.unmount(),
    waitUntilExit: () => root.waitUntilExit(),
    handoffRawMode: () => root.handoffRawMode(),
    handoffAltScreen: () => root.handoffAltScreen(),
  }
}
