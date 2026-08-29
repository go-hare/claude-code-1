# densable 2.1.239 SEA — 236 #11 managed-settings / dual Ink

SEA: `%TEMP%\official-239\package\claude.exe` (337672352)  
Probe: `probe-managed-settings-11.mjs` + inline Q2m window.

## Verdict (钉死)

| 说法 | 对错 |
| --- | --- |
| tip `void loadRemoteManagedSettings()` 相对 densable「错误」 | **不对**。densable preAction 默认也是 `Promise.resolve(showSecurityDialog).then(Rco).catch` **不 await** |
| 「必须单 Ink / 禁止单独 render」 | **不对**。densable 在 **无** active Ink 时会 `claimForStandaloneRender` + 调 `showSecurityDialog(settings, hasActiveInk=false)` |
| tip 永远 `showSecurityDialog(settings, false)` + 另起 `wrappedRender` | **相对 densable 缺口**。官方有 `Yp.has(process.stdout)` + `replRequester` 优先走 **同一 Ink 面** |
| 吞首键 / 对话框缺失 | 与 tip「REPL 已占 stdout 仍 standalone 第二 Ink」路径吻合；官方靠 requester / wait 避免 |

## densable Q2m（完整合同，SEA offs≈315332606）

```js
async function Q2m(e, t, r /* showSecurityDialog */) {
  if (!t || !PDt(ROe(t))) return 'no_check_needed'
  if (!CKu(e, t)) return 'no_check_needed'
  if (!fD()) return 'deferred_non_interactive'
  let n = lMl()
  // 1) REPL 已注册 requester → 同面 review，不另起 Ink
  if (n.replRequester) return n.review(n.replRequester, t)
  // 2) stdout 上已有 Ink → 等 requester（帽 Tqw=5000）
  if (Yp.has(process.stdout)) {
    let a = await Cqw() // "managed-settings security dialog requester wait timed out"
    if (a) return n.review(a, t)
  }
  // 3) 无 surface 回调 → defer
  if (r === void 0) return 'deferred_no_consent_surface'
  N('tengu_managed_settings_security_dialog_shown', {})
  let o = Yp.has(process.stdout)
  let i = r(t, o) // hasActiveInkSurface
  // 4) 仅当无 active Ink 才 claim standalone（允许单独 render）
  if (!o) Yp.claimForStandaloneRender(i)
  try {
    return await i
  } catch (a) {
    throw (pe('remote_managed_settings_security_check', 'dialog_unavailable'), a)
  }
}
```

`Cqw` 文案：`managed-settings security dialog requester wait timed out`（5s）。

## densable preAction（offs≈327222596）

```js
// forceRemote / gateway → await Rco(...)
// NaT() → await … singleAttempt
// else（普通交互）→ 不 await：
Promise.resolve(e.showSecurityDialog?.())
  .then(b => Rco(b, n, { credentials: o }))
  .catch(Te)
```

→ tip `main.tsx` `void loadRemoteManagedSettings()` ≈ densable else 臂。**把交互改成强制 await 全量 load 不是 densable 1:1。**

## tip 对照

| densable | tip |
| --- | --- |
| `Yp.has(process.stdout)` Ink 注册表 | `@ant/ink` 有 `instances` Map，**未**接到 securityCheck |
| `replRequester` / `registerRequester` / `review` | **无** |
| `claimForStandaloneRender` 仅 `!hasInk` | **无**；`securityCheck.tsx` 注释写死 `pass false` |
| `showSecurityDialog(settings, hasActiveInk)` | 第二参 `_hasActiveInkSurface` **未用**，永远 `wrappedRender` 新根 |
| policyHelpers：`not yet approved…` / `remote_consent_missing` | tip **未 port** 这两句（SEA 在 policyHelpers 臂） |

## 金标文案（SEA 命中）

- `not yet approved in the managed-settings dialog` + `remote_consent_missing`（policyHelpers 未同意）
- `Remote settings: No consent surface in this interactive session; keeping the consented baseline`
- `dialog_unavailable` / `tengu_managed_settings_security_dialog_{shown,accepted,rejected}`
- UI：`Managed settings require approval` / `Yes, I trust these settings` / `No, exit Claude Code`
- doctor：`Settings errors are currently blocking the approval prompt — run \`claude doctor\`…`

## 1:1 落地范围（若开修，勿 invent）

1. 接 Ink `instances.has(process.stdout)` ≈ `Yp.has`
2. REPL 注册 `replRequester`，Q2m 优先 `review` 同面
3. 仅 `!hasInk` 时 standalone `wrappedRender` + claim
4. policyHelpers 同意门文案（若 tip 有对等臂）
5. **不要**把默认交互 preAction 改成强制 `await load…`（densable 也不 await）

## Checklist

236 #11 → **HAVE**：
- 双 Ink：Q2m / J2m / `$yf` / mSs / createRoot·pAS
- DialogStore 总线：`src/dialog/*`（`bGl`/`kdy`/`Bgp`/`hLo`/`NMs`/`GSn`+`queueBehind`）
- REPL：`installManagedSettingsSxg` + `DialogHost`（取代 focusedInputDialog 本地 promise）
- 默认交互 preAction 仍 **不 await**
- 旁注：`foo`/`Lno`/`X_w` + jsu permission_* + 非权限 tip-bridge 已落地

## Residual dig（2026-08-26）→ 已落地

完整 call chain 见 **`gold-sXg-queueBehind-dig.md`**。
