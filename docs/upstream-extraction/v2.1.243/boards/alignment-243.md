# Alignment board — densable 2.1.243

> Living board · 2026-09-03 · SEA **已下载**（win32-x64 sha256 `895a32a6…`）  
> 计数 HAVE **49** / PARTIAL **0** / GAP **0** / UNKNOWN **0** / N/A **11**  
> tip：npm **2.7.47** + 239 leftover · **不**折入 240/241 空节、245+  
> 计数以 `official-243-checklist.md` 为准。

## 桶

| 桶 | # |
| -- | - |
| HAVE | #1–#11 #13–#16 #18–#39 #44 #48–#58 |
| PARTIAL | — |
| GAP | — |
| N/A | #12 #17 #40–#43 #45–#47 #59 #60 |
| UNKNOWN | — |

## 本轮落地

- `#23` **HAVE**：`Yl=W` / `aT=u` 已锁。`Hs`/`V0`/`Xl`/`uT` + `if(y) f$e()→yz` + mapper `account_on_hold`/`YOn`。dead-token：`ql`/`Ms`/`$s`/`Vk` mutate 清盘 + refresh `$s.has` skip。`oi`/`$0`/`G0`/`K0=32` 已搬；官方调用方 `jwo` 同缺。
- `#34` `getNoProxy`/`S`/`Ne`：两 casing 合并；EnvHttpProxyAgent 用同一列表。
- `#26` hook `if`：`C5s`/`P7r` 回退，`$()` / backtick 后参数不再误匹配 `Bash(cat *)`。
- `#35` exit 0 仍把 annotate 增量写进 Bash `stderr`。
- `#38` `yh` 旧 `gh` fallback + `/web-setup` `gh_too_old`（2.17.0）。
- `#36` `Y0a` 管 statusline；`/usage` `y()` headers seed + persist `I()`=`K0a`/`V0a` 落 `cachedUsageUtilization`（1h TTL / 5m 防抖）。live API 不再做自造 ISO 过滤。
- `#11` 官方架构：`AppState.mcp.resourceTemplates` / `suppressedPluginMcpServers`；`mcpClientModule` 的 `peekSettledConnection`/`detachAndCloseConnection`/`Hl`/`rS`/`du`/`$d`。
- `#48` **HAVE**：`D`/`XCb` headless 立刻出 URL；`c` 报 `dt` path；`fr` Hold `Ht` hint；`Vo`=`jt` probe。
- `#25` **HAVE**：`si` 写 `ut().companyAnnouncement`（`Oe.of(session.root)` / `SessionNoticeStore`）。空列表不 persist。
- `#13` **HAVE**：`Vo`/`wd` 在 `qc` 前等 GB 最多 1500ms；disk disable → `gb-killswitch-recheck`。
- `#14` **HAVE**：`tBt` + `wzr`/`bzr`/`p$s`/`f$s`。`Pzr`=`auto-mode-classifier-2026-07-16`；`ASe=$O=null`（latch 死）。
- `#18` **HAVE**：默认根 XDG/TMPDIR；`Vi`/`qi` 祖先 walk；leaf 仍 `cc-socks/.../messaging.sock`。
- `#57` **HAVE**：`It()` 首行 30s deadline，不是 idle-on-any-data。
- `#19` **HAVE**：`q=(useIsInsideModal()?2:0)+urlOutdent`；URL 盒 `marginX:-q`；login/teleport Pane 1/2；setup-token/onboarding `F=1`。
- `#20` **HAVE**：`w8e` 首字 `\p{L}`，emoji VS 不再粘词。
- `#21` **HAVE**：`Lfe` Jeo 扫 `bash:`（notified+terminal）；`qJ` 只闸 `uBn`/`pBn`。
- `#24` **HAVE**：`y`/`pe`/`me`/`H`/`Ee`/`lt`。TokenCache 形 last-issued（非 force 不 clobber disk）；`lt` 清 cached；不 pin rejected disk；pending 在 pin 前合并。
- `#27` **HAVE**：`@inline` declarer → name-only dep satisfaction；closure fallback `name@inline`。
- `#28` **HAVE**：`Fn`/`Me` cache impact + LSP latch clear on 0-server reinit；`/reload-plugins` `--force` gate。
- `#33` **HAVE**：`zb` 纯 Ctrl+[ → escape（kitty CSI u / modifyOtherKeys）；ctrl 清掉。
- `#39` **HAVE**：native host wrapper 走 `buildCliLaunch` 稳定 `~/.local/bin/claude`；versioned + launcher 缺失才 pin 当前 binary。
- `#53` **HAVE**：`At`/`lr`/`Ze`；空 hit-test → Finder；desktop-shell 要授 Finder/File Explorer。
- `#58` **HAVE**：`w` 占用文案 + `localHolderGuard` decline / `/remote-control` observe。
- `#55` **HAVE**：work-bridge poll 404 remint（`It`/`pn`/`tr`/`u`/`yt`/`ar`）。`An()` 无 gate 名，产品路径 ON。
- `#56` **HAVE**：`gn` 把 403 `BridgeFatalError` 当 rejected，reconnect 不空转。无 admin/owner 文案。
- `#12`/`#17`/`#42`–`#43`/`#45`–`#47` **N/A 同缺**：Desktop/cloud/官方 installer。不 invent。
- `#44` **HAVE**（审查补接）：官方 `Qf` env pin，不是 JWT。

## 已对齐（禁止当 243 待办）

- **#40 / #41 / #59 / #60** VSCode host · 同缺 = 对齐（同 239 #59）。
- **#12** Desktop CIMD redirect · **#17** 云 mid-turn hook · **#42 / #43 / #45–#47** native 包装 / heap_gc · 同缺 = 对齐。
- Desktop·cloud handoff / cowork · 同缺 = 对齐。
- **storageV5 `Rc`** · 已 HAVE（`cross-pack-residuals` §2）。
- 245+（glibc、`--restricted`、`experimental.cacheTtl`）· 下一 pack，不折入。

## 下一刀

1. **243 pack 已收口。** 下一 pack 才看 245–248。不 invent installer / Sentry / JWT-org。

## 邻版

| 版本 | 处理 |
| ---- | ---- |
| 240 / 241 | 无 bullets，不折入 |
| 242 / 244 | 无节 |
| 245–248 | 下一 pack |
