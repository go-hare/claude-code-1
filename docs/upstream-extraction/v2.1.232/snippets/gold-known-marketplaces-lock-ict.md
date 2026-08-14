# densable 2.1.232 #29 — known_marketplaces.json concurrent write race

## Changelog

> Fixed a race that could corrupt `known_marketplaces.json` when multiple
> marketplace operations wrote concurrently

## densable gold (SEA ~290847296 / ~284802562)

### `TL` — per-key serial queue (`KKd = TL()`)

```js
function TL() {
  let e = new Map
  return {
    run(t, r) {
      let o = (e.get(t) ?? Promise.resolve()).then(() => r())
      let i = o.then(() => {}, () => {})
      return e.set(t, i), i.then(() => { if (e.get(t) === i) e.delete(t) }), o
    },
    has(t) { return e.has(t) },
    get size() { return e.size },
    async settle() { await Promise.all([...e.values()]) },
    async drain() {
      for (let t = 0; t < KTy; t++) {
        let r = [...e.values()]
        if (r.length === 0) return
        await Promise.all(r)
      }
    },
    clearForTest() { e.clear() },
  }
}
var KTy = 5
```

### `G_` / `yY` — lock acquire + safe release

```js
async function G_(e, t) {
  let r = await yUu().lock(e, t)
  return Object.assign(r, { [Symbol.asyncDispose]: r })
}
async function yY(e, t) {
  if (!e) return
  try { await e() }
  catch (r) {
    // ERELEASED / ENOTACQUIRED → warn exclusivity may have been lost
    // else → stale lock dir warn
  }
}
```

### `ict` — locked RMW

```js
async function ict(e, t) {
  let r = FRn() // known_marketplaces path
  return KKd.run(r, async () => {
    await br().mkdir(Dh.join(r, '..'))
    let o, i = !1
    try {
      o = await G_(r, {
        lockfilePath: `${r}.lock`,
        realpath: !1,
        retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
        onCompromised: (s) => {
          w(`known_marketplaces.json lock compromised: ${s}`, { level: 'error' })
        },
      })
    } catch (s) {
      w(`Failed to acquire known_marketplaces.json lock, writing without it: ${de(s)}`,
        { level: 'error' })
      i = !0
    }
    try {
      let s = await BE(t) // load config
      let a = e(s)         // mutator; null → no write
      if (a === null) return !1
      if (await QAb(a, t), i) N('tengu_known_marketplaces_fallback_write', {})
      return !0
    } finally {
      await yY(o, 'known_marketplaces.json')
    }
  })
}
```

Callers like `ysa` (lastUpdated bump) and seed register (`e8o`) go through `ict`
instead of unlocked load→mutate→save.

## Local

- `createKeyedSerialQueue` ≈ `TL`
- `knownMarketplacesSerialQueue` ≈ `KKd`
- `updateKnownMarketplacesConfig` ≈ `ict`
- `saveKnownMarketplacesConfig` remains the pure write (`QAb` filesystem path)
- Wired: seed register, add/remove source, getMarketplace lastUpdated,
  refreshAll/refreshMarketplace timestamps, setMarketplaceAutoUpdate
- Tests: `knownMarketplacesLock.232.test.ts`
