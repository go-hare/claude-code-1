# #35 — Expired Anthropic profile → `/login` when claude.ai would take precedence

> Status: **GAP**（2026-08-19）  
> SEA: `claude.exe` 2.1.234 · invent-ban · binary beats changelog

## Changelog

> Expired Anthropic profile credential points at `/login` when a claude.ai login would take precedence

## Gold (SEA)

### Error branch（产品 delta）

```js
function oRr(e){
  return e instanceof z_
    && e.statusCode === null
    && e.message.includes("has expired and no refresh is available")
}
// getAssistantMessageFromError:
if (oRr(e)) return qd({
  error: "invalid_request",
  content: Swn() ? ubS : cbS,
})
```

| 符号 | 文案 |
|------|------|
| `cbS` | `Anthropic profile login expired · Re-authenticate your Anthropic profile` |
| `ubS` | `Anthropic profile login expired · Run /login to use your claude.ai account instead, or re-authenticate the profile` |

`Swn()` = `A5()==="profile-implicit" && uzs()==="user_oauth"`  
→ 隐式 profile + user_oauth 时，已存 claude.ai login **会优先**，故过期文案指向 `/login`。

### 谓词来源 `z_`

`z_=class z_ extends qs{constructor(e,t=null,r=null,n=null){super(e);this.statusCode=t,this.body=r,this.requestId=n}}`

Throw site（user OAuth credentials refresh，~288422421）:

```text
Access token at ${e.credentialsPath} has expired and no refresh is available
(client_id ${e.clientId?"set":"empty"}, refresh_token ${a?"set":"empty"})
```

`statusCode===null` → 本地凭据过期且无法 refresh（非 HTTP 失败）。

### Profile auth 栈（前置产品面，go-hare 全无）

| 符号 | 作用 |
|------|------|
| `M$o()` | config dir：`ANTHROPIC_CONFIG_DIR` / `%APPDATA%/Anthropic` / `~/.config/anthropic` |
| `A5()` | `profile-explicit` \| `profile-implicit` \| `env-quad` \| `null` |
| `uzs()` | `oidc_federation` \| `user_oauth` \| `null` |
| `lzs` / `D$o` / `jYu` / `vwn` | configs/`${profile}.json` + credentials path |
| `P$o()` | `A5()!==null` |
| `Swn()` | implicit + user_oauth → claude.ai 优先 |
| `uD()` | 是否启用 profile auth（对 API key / OAuth env / Bedrock / Vertex / Mantle 等让路；implicit+Swn → `Vmd` skip） |
| `Vmd` / `qmd` | warn/info：skip implicit vs using profile |
| `o1_` | profile org/account metadata |
| `I$o` / `czs` | clear A5/uzs/o1_ caches |

Peels: `_peel_35_oRr_def.txt`, `_peel_35_A5_def.txt`, `_peel_35_Swn_full.txt`, `_peel_35_ubS_use.txt`, `_peel_35_z_class.txt`, `_peel_35_cred_refresh.txt`, `_peel_35_uD_profile_gate.txt`, `_peel_35_profile_warn.txt`, `_peel_35_wire_*.txt`.

## Local

- `src/services/api/errors.ts`：有 `TOKEN_REVOKED` / `Login expired` / `/login` 通用分支，**无** `oRr` / `ubS` / `cbS` / `Swn`。
- 全仓无 `ANTHROPIC_PROFILE` / `~/.config/anthropic` / `profile-implicit` / `oidc_federation` 产品实现（仅 docs/setup-bedrock 旁路提及）。
- `@anthropic-ai` SDK 侧亦无本地可挂的 `userOAuthProvider` / `z_` 同类导出可接。

## 判定

**GAP** — 非文案补丁。

- 只塞 `ubS`/`cbS`/`Swn` stub → **invent 死代码**（无 `z_` throw、无 `A5`/`uD` 接线，分支永不触发）。
- 真 1:1 需整栈：config dir + profile credentials + user_oauth refresh（`z_`）+ WIF/oidc `env-quad` + `uD`/`Vmd`/`qmd` 鉴权优先级 + `getAssistantMessageFromError` 的 `oRr` 分支。体量远超 changelog 单行，属独立产品轨，不在本轮 234 收口范围硬塞。

复开条件：先落地 Anthropic profile auth（`M$o`/`A5`/`uzs`/`uD` + credentials provider），再挂 `oRr`→`Swn()?ubS:cbS`。

## 不做

- 不 invent 假 `Swn()` / 永不抛的 `oRr`。
- 不把 Desktop/gateway/Mantle 路径折进来。
- 不 commit（未要求）。

## 2026-09-01 纠偏（不改上列 08-19 原文）

**HAVE。** 现码已落复开条件：`src/utils/anthropicProfile.ts`（`M$o`/`A5`/`Swn`/`uD`/`oRr`/`z_` + refresh）+ `errors.ts` oRr → `Swn()?ubS:cbS`。测：`anthropicProfile.234.test.ts` / `profileOauthExpired.234.test.ts`。上列「Local / 全无栈」过期。`/login` = `ConsoleOAuthFlow`（claude.ai OAuth）即 changelog 产品面。
