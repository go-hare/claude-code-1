# densable 2.1.212 — #30 plugin uninstall wrong marketplace

Changelog (partial):

> Fixed … wrong marketplace targeting on plugin uninstall …

## densable `_Fe` (uninstallPluginOp)

```js
async function _Fe(e, t="user", r=!0) {
  let { marketplace: n } = hi(e)
  // managed marketplace gate...
  let a = N9d(e, s)  // find loaded plugin
  // if found:
  //   candidates = exact e, Lwe(e), then IF !e.includes("@"):
  //     name, name@*, case variants
  //   then fallback e | a.name
  //   pick first candidate with V2 install matching scope+projectPath
  // else wu_(e,t,m) delisted:
  //   are(keys,e); else name match with (!has@ || !keyMarketplace)
  u = are(installedKeys, u) ?? u
  // remove settings key, V2 install, options, data dir...
}
```

## densable helpers

| densable | local |
|----------|-------|
| `hi` | `parsePluginIdentifier` |
| `Lwe` | `pluginIdEquals` |
| `are` | `findPluginKeyCaseInsensitive` |
| `N9d` | `findPluginByIdentifier` (case + marketplace source) |
| `wu_` | `resolveDelistedPluginId` (scope + `!a\|\|!p`) |

## Bug fixed

Bare-name settings expansion (`name@*`) ran even when user passed `plugin@marketplace`, so uninstall could delete the **wrong marketplace** install. densable only expands when `!e.includes("@")`.

## Related

- `src/services/plugins/pluginOperations.ts`
- `src/utils/plugins/pluginIdentifier.ts`
- tests: `pluginIdentifier.212.test.ts`, `uninstallPluginMarketplace.212.test.ts`
