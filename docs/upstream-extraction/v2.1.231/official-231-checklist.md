# densable 2.1.231 — 官方更新清单 × go-hare 对照

> 来源：官方 CHANGELOG / GitHub release **v2.1.231**（**1 条**）。  
> densable SEA：`%TEMP%/official-231/plat/package/claude.exe`（win32-x64）；`// Version: 2.1.231` HIT ×3；size **307186848**；sha256 `99dbf97ef1b03ca94db818977bfc0970889bb5bbe6e981405a55f225d0fbf603`。  
> 基线：本地 tip densable **2.1.229**（HAVE 27 / N/A 5）+ npm **2.7.39**。**本 pack 只对齐 2.1.231**（npm **无 2.1.230**）。  
> 状态：**HAVE 1 / PARTIAL 0 / GAP 0**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。  
> 更新：2026-09-02 — 钉：本 pack **覆盖 229 #12** redirect 主机名（229 SEA `eBr`=`127.0.0.1` → tip `JFr`=`localhost`；listen 仍 `127.0.0.1`）。勿按 229 清单把 tip 改回。此前 08-14 — FLv 1:1 + cup/r8o residual。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.229** | 32 条大包 | tip 已收口；**#12 redirect 主机名被本 pack 覆盖** |
| **2.1.230** | npm **不存在** | — |
| **2.1.231** | MCP OAuth redirect URI mismatch（pre-registered client / Slack） | **本 pack HAVE** |
| **2.1.232** | 多条（fork 默认 / @mention / GitLab / 权限…） | **勿折入** |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `function JFr` | `http://localhost:${port}/callback` | **HAVE** `buildRedirectUri` |
| `function gIt` / `wMa` / `AMa=3118` | preferred port + random + fallback | **HAVE** `findAvailablePort(preferred)` |
| `function ILv` | loopback host 127.0.0.1 \| localhost | **HAVE** `isLoopbackOAuthRedirectUri` |
| `FLv` redirect select | custom / config / reusing registered port | **HAVE** `performMCPOAuthFlow` |
| `PMa` `preserveClientRegistration` | 清 token 保 clientId+redirect | **HAVE** `clearServerTokensFromLocalStorage` |
| `Using custom redirectUri` / `reusing registered port` | 日志 1:1 | **HAVE** |
| `function cup` / `r8o` | PTL/media withhold optional outer | **HAVE** residual（产品面） |
| `function n8o` | full reactive compact | **HAVE** residual |

## 全量对照（1 条）

| # | 官方条目 | 状态 | 本地备注 |
| - | -------- | ---- | -------- |
| 1 | Fixed MCP OAuth sign-in failing with redirect URI mismatch for servers that use a pre-registered OAuth client (e.g. Slack) | **HAVE** | SEA `FLv`：`u`=stored loopback port；`h`=callbackPort；`g`=options.redirectUri；`y`/`S`/`v` 1:1。`JFr`=**localhost**（非 127.0.0.1 主机名；listen 仍 127.0.0.1）。`PMa` preserveClientRegistration。证据：`snippets/gold-flv-oauth-redirect.md`、`oauthPort.ts`、`auth.ts`、`oauthPort.231.test.ts`、`oauthPreRegisteredRedirect.231.test.ts`。 |

## 附带 residual（非 231 官方条目，本轮一并 1:1）

| densable | 本地 | 状态 |
| -------- | ---- | ---- |
| `cup` / `r8o` | `isWithheldPromptTooLong` / `isWithheldMediaSizeError` null-safe | **HAVE** |
| media+PTL → `n8o` | full tryReactiveCompact（非 query strip） | **HAVE** |
| abort → `reason:"aborted"` | tryReactiveCompact catch | **HAVE** |

## SEA 获取

```text
npm pack @anthropic-ai/claude-code-win32-x64@2.1.231
# → %TEMP%/official-231/plat/package/claude.exe
```

## Explicit non-claims

- **不要**把 2.1.232 折入 231。  
- **不要**把 listen bind `127.0.0.1` 与 redirect host `localhost` 混为一谈。  
- 229 文档曾写 redirect 用 127.0.0.1 主机名；**231 SEA 金标是 localhost** — 以二进制为准。
