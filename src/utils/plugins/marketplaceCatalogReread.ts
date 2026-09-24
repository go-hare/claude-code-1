import { logForDebugging } from '../debug.js'
import { sleep } from '../sleep.js'
import { reservedMarketplaceLoadRefusal } from './marketplaceManager.js'

/**
 * densable `qFe` delays `_gr`. Re-read a null marketplace catalog so a
 * background session does not keep an empty plugin skill catalog while
 * another process is refreshing it.
 *
 * Gold `Be=Pe!==void 0&&$Y(ke,Pe)===null`. `$Y` null = do not refuse.
 * `registryEntry` is `Pe`. Do not fold `Be` at the caller.
 */
export const MARKETPLACE_CATALOG_REREAD_DELAYS_MS = [30, 70, 150] as const

function qFeRereadBe(options: {
  name: string
  registryEntry?: { installLocation?: string; source?: unknown }
}): boolean {
  const Pe = options.registryEntry
  return (
    Pe !== undefined &&
    reservedMarketplaceLoadRefusal(options.name, Pe) === null
  )
}

export async function rereadMarketplaceCatalogIfNull<T>(options: {
  name: string
  catalog: T | null
  registryEntry?: { installLocation?: string; source?: unknown }
  read: () => Promise<T | null>
  sleepMs?: (ms: number) => Promise<void>
  log?: (message: string) => void
}): Promise<T | null> {
  const Be = qFeRereadBe(options)
  if (options.catalog !== null || !Be) {
    return options.catalog
  }
  const wait = options.sleepMs ?? sleep
  const log = options.log ?? (message => logForDebugging(message))
  let catalog: T | null = options.catalog
  for (const delayMs of MARKETPLACE_CATALOG_REREAD_DELAYS_MS) {
    if (catalog !== null || !Be) break
    await wait(delayMs)
    catalog = await options.read()
    if (catalog !== null) {
      log(
        `Marketplace ${options.name}: catalog readable again after a re-read (another process was refreshing it)`,
      )
    }
  }
  return catalog
}
