# densable 2.1.214 Batch E — #33 `--settings` enabled plugins load

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

≥2.1.181 回归：仅通过 `--settings`（`flagSettings.enabledPlugins`）启用的插件不写入 `installed_plugins.json` / 不 materialize versioned cache → 会话加载不到。

## densable 证据（`async function Dhy`）

```js
// editable sources d5: user/project/local → r.set(id, {scope, projectPath})
let o = new Set();
for (let [f,m] of Object.entries(Cr("flagSettings")?.enabledPlugins||{})) {
  if (m !== true || !valid(f) || r.has(f) || iI(f)) continue;
  // iI = policy enabledPlugins[id] === false
  r.set(f, { scope: "user", projectPath: void 0 });
  o.add(f);
}
for (let f of policyTrue) {
  r.set(f, { scope: "managed", projectPath: void 0 });
  o.delete(f);
}
// later: if o.has(f) → LPt materialize versioned cache from marketplace source
// log: "Cannot materialize versioned cache for --settings-enabled ${f}..."
// log: "Skipping --settings-enabled ${f}: blocked by policy..."
```

## 本地落地

| densable | 本地 |
|----------|------|
| flag true → user scope + flagOnly | `resolveEnabledPluginScopesForInstallSync` |
| iI policy false skip | `isPluginForceDisabledByPolicy` |
| early-return 不只看 merged | `shouldRunEnabledPluginsInstallSync` |
| materialize LPt | `migrateFromEnabledPlugins` → `copyPluginToVersionedCache` when flagOnly |
| pure tests | `flagSettingsEnabledPlugins.214.test.ts` |

## 状态

- **#33 HAVE**
