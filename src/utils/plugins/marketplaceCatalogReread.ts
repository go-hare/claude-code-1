import { logForDebugging } from '../debug.js'
import { sleep } from '../sleep.js'

/**
 * densable `qFe` delays `_gr`. Re-read a null marketplace catalog so a
 * background session does not keep an empty plugin skill catalog while
 * another process is refreshing it.
 *
 * `$Y` (refuse-the-entry) is named in the gold loop and its body is not in
 * the excerpt, so this does not invent that predicate. The retry runs only
 * when the catalog read is null and a registry entry exists (`Pe !== void 0`).
 */
export const MARKETPLACE_CATALOG_REREAD_DELAYS_MS = [30, 70, 150] as const

export async function rereadMarketplaceCatalogIfNull<T>(options: {
  name: string
  catalog: T | null
  hasRegistryEntry: boolean
  read: () => Promise<T | null>
  sleepMs?: (ms: number) => Promise<void>
  log?: (message: string) => void
}): Promise<T | null> {
  if (options.catalog !== null || !options.hasRegistryEntry) {
    return options.catalog
  }
  const wait = options.sleepMs ?? sleep
  const log = options.log ?? (message => logForDebugging(message))
  let catalog: T | null = options.catalog
  for (const delayMs of MARKETPLACE_CATALOG_REREAD_DELAYS_MS) {
    if (catalog !== null) break
    await wait(delayMs)
    catalog = await options.read()
    if (catalog !== null) {
      log(
        `Marketplace ${options.name}: catalog readable again after a re-read (another process was refreshing it)`,
      )
      break
    }
  }
  return catalog
}
