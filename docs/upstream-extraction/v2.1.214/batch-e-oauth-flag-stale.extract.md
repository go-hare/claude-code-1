# densable 2.1.214 Batch E — #34 OAuth 轮换后 feature flags 变 stale

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

长会话中 OAuth access token 静默轮换后，GrowthBook 客户端仍带着创建时的 `Authorization` header；remote eval 继续用旧 token，feature flags 不再刷新到当前身份。

## densable 证据

### 导出符号

```
refreshGrowthBookAfterAuthChange → Iwe
refreshGrowthBookFeatures        → X8n
resetGrowthBook                  → mYt
setupPeriodicGrowthBookRefresh   → MUc (interval mYh=21600000)
```

### 客户端创建时戳记（rji）

```js
q8n = hasAuth
oji = hasAuth ? authHeaders.Authorization : undefined
iji = oauthAccount?.accountUuid
sji = oauthAccount?.organizationUuid
```

### 周期/主动 refresh（X8n）— #34 核心

```js
async function X8n() {
  if (!ire()) return
  try {
    if (q8n) {
      let { checkAndRefreshOAuthTokenIfNeeded: r } = await import(auth)
      await r().catch(() => {})
      let n = H5() // getAuthHeaders
      let o = n.error ? undefined : n.headers.Authorization
      if (o !== undefined && o !== oji) {
        let i = bt().oauthAccount
        let s = i?.accountUuid === iji && i?.organizationUuid === sji
        if (!s) gLe() // resetUserCache
        Iwe({ preserveLoggedExposures: s })
        return
      }
    }
    let e = await e2()
    if (!e) return
    await e.refreshFeatures({ skipCache: true })
    // process payload → disk → emit
  } catch (e) { ke(hn(e)) }
}
```

### 硬重建（Iwe / mYt）

```js
function Iwe(e) {
  if (!ire()) return
  mYt({
    preservePendingExposures: true,
    preserveLoggedExposures: e?.preserveLoggedExposures,
  })
  pYt.emit()
  e2() // re-init → 新 Authorization
}
function mYt(e) {
  // destroy client, clear oji/iji/sji/q8n
  // !preservePendingExposures → clear V8n
  // !preserveLoggedExposures → clear W8n + one-shot error flags
  // always clear Ble (remoteEval map) + memo caches
}
```

### gLe（account switch）

```js
function gLe() {
  // clear user core cache slots (local densable: resetUserCache 对等)
}
```

## 本地落地

| densable | 本地 |
|----------|------|
| oji/iji/sji 戳记 | `clientAuthAuthorization` / `clientAuthAccountUuid` / `clientAuthOrganizationUuid` |
| X8n Authorization 分支 | `decideGrowthBookAuthRefresh` + `refreshGrowthBookFeatures` 前置 |
| Iwe options | `refreshGrowthBookAfterAuthChange({ preserveLoggedExposures })` |
| mYt preserve* | `resetGrowthBook({ preservePendingExposures, preserveLoggedExposures })` |
| gLe | `resetUserCache()` when `!sameAccount` |
| `refreshFeatures({skipCache:true})` | light path 同步 densable |
| pure decision | `src/utils/growthbookAuthRefresh.ts` + `growthbookAuthRefresh.214.test.ts` |

## 状态

- **#34 HAVE**（GrowthBook 真集成路径 1:1；本地仍可能因 `is1PEventLoggingEnabled`/adapter 关断而不跑 GB，但代码路径对齐 densable）
