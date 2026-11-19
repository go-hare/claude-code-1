# Alignment board — densable 2.1.326–2.1.328

> **Wave 1 完成（2.1.326 DONE）** · 2026-11-19 · SEA `/tmp/official-328/plat/package/claude`（`2.1.328 (Claude Code)`）· 共 **684** 条
> HAVE **350** / PARTIAL **0** / GAP **0** / UNKNOWN **317** / N/A **17**（以 `official-326-328-checklist.md` 为准）
> 基线：本地 `e8d369fb`（`2.1.290`–`2.1.325` 主线已全量收口）
> 规则：逐条 1:1 核验；扫员单独结论不升 HAVE；函数体未锁不升 HAVE；遵守 invent-ban；三路独立代码审查并清零 P0/P1。

## 桶

| 桶 | 计数 / 范围 |
| -- | ----------- |
| HAVE | 350（2.1.326 全量 CLI 项 `#1`–`#350`） |
| PARTIAL | 0 |
| GAP | 0 |
| UNKNOWN | 317（2.1.327 `#368`–`#540` + 2.1.328 `#541`–`#684` 待 Wave 2） |
| N/A | 17（2.1.326 纯 `[VSCode]` 扩展侧项 `#351`–`#367`） |

## 分版本统计（按正序 2.1.326 → 2.1.328）

| 版本 | 编号范围 | 总计 | HAVE | PARTIAL | GAP | N/A | UNKNOWN | 状态 |
| ---- | -------- | ---- | ---- | ------- | --- | --- | ------- | ---- |
| 2.1.326 | #1–#367 | **367** | 350 | 0 | 0 | 17 | 0 | **DONE** |
| 2.1.327 | #368–#540 | **173** | 0 | 0 | 0 | 0 | 173 | PENDING (Wave 2) |
| 2.1.328 | #541–#684 | **144** | 0 | 0 | 0 | 0 | 144 | PENDING (Wave 2) |

## Wave 1（2.1.326）收口与三路审查记录

- **执行架构**：6 路扫描分拣 → 9 组零冲突并行实现（Sub-Wave 326-I 5 组后端 + Sub-Wave 326-II 4 组 UI/REPL/命令）→ 3 路跨组生产调用链接线 → 3 路只读独立代码审查 → 3 路并行修复。
- **独立审查发现与全量修复**：共发现并清零 **6 个 P0 + 23 个 P1 + 14 个 P2**（含 `lockfile.ts` ESM namespace 赋值崩溃、`bashPermissions.ts` `#306` env 前缀短路 deny、`pathValidation.ts` `#11` 重复 `cp` 源绕过、`bridgePermissionCallbacks.ts` `#325` `allowedSuggestions` 校验、`sandbox-adapter.ts` `#301` `.git/` 过度隔离、`Spinner.tsx` `#205` Rules of Hooks 崩溃、`REPL.tsx` `#188`/`#257` OSC 7501 `TerminalWriteContext` + `ProgramStatusController` 接通、`sessionStorage.ts` `#30`/`#31` `StringDecoder` 与重链顺序、`ghStandin.ts` `#339` GraphQL/Origin 安全加固等）。
- **验证门禁**：`tsc --noEmit` 0 错误、`biome ci .` 0 错误、`bun scripts/docs-check.ts --quiet` 通过、全部 Wave 326 + 回归单测 100% 通过。
