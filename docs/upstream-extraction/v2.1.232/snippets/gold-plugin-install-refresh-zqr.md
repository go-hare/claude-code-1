# densable 2.1.232 #36 — `/plugin install` refreshes marketplace first

## Changelog

> `/plugin install` refreshes the marketplace before install (stale catalog)

## densable `zqr` (SEA ~300162000)

Scoped install path (`gvm`) **always** calls `zqr` before `xV` lookup:

```js
async function zqr(e, t) {
  if (Pa()) return { outcome: "ineligible" } // essential-traffic; NO FORCE exception
  if (!t?.source || !xO(t.source)) return { outcome: "ineligible" }
  if (t.installLocation && Uue(t.installLocation)) return { outcome: "ineligible" } // seed
  let r = t.source.source
  if (r !== "github" && r !== "git" && r !== "url") {
    if (pZ(t.source) || r === "settings") Du().marketplaces.delete(e)
    return { outcome: "ineligible" }
  }
  try {
    return (
      await E0e(e, void 0, { skipIfRecent: !0 }),
      Du().marketplaces.delete(e),
      { outcome: "refreshed" }
    )
  } catch (n) {
    return {
      outcome: "refresh-failed",
      errorMessage: iEe(de(n)),
    }
  }
}
```

`jqr` analytics: `plugin_install_refresh_first` (+ refresh_failed / ineligible).

### Not-found stale hint (`gvm`)

- Scoped **and** refresh did **not** succeed →  
  `. Your local copy may be out of date — try \`…plugin marketplace update…\`.`
- Refresh succeeded but still miss → **no** stale claim
- Install from cache after refresh-failed → success message  
  `. Warning: marketplace not refreshed (…) — installed from the cached catalog…`

### Contrast with 2.1.221 `zIr` / `pvm`

| | `zIr`/`pvm` (miss) | `zqr` (pre-install) |
|--|--------------------|---------------------|
| When | on catalog miss / UI | **always** for scoped install |
| essential-traffic | skip unless FORCE | always ineligible |
| autoUpdate gate | yes | **no** |
| seed path | n/a | ineligible |

## Local

- `tryRefreshMarketplaceBeforeScopedInstall` + `logScopedInstallRefreshOutcome`
- `installPluginOp` scoped path uses zqr-first
- `tryRefreshMarketplaceOnCatalogMiss` retained for discovery/UI miss paths
- Tests: `scopedInstallRefresh.232.test.ts`
