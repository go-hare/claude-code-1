/**
 * densable `_803` `J` — concurrency-limited mapper (hs `ye=8`, Kt `ki=8`).
 */

export function seedPoolMap<T, R>(
  limit: number,
  fn: (item: T) => Promise<R>,
): (item: T) => Promise<R> {
  let active = 0
  const waiting: Array<() => void> = []
  return async (item: T) => {
    if (active >= limit) {
      await new Promise<void>(resolve => {
        waiting.push(resolve)
      })
    }
    active++
    try {
      return await fn(item)
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
