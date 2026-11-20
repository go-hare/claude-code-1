# Alignment board — densable 2.1.326–2.1.328

> **全量收口（2.1.326–2.1.328 100% DONE）** · 2026-11-19 · SEA `/tmp/official-328/plat/package/claude`（`2.1.328 (Claude Code)`）· 共 **684** 条
> HAVE **653** / PARTIAL **0** / GAP **0** / UNKNOWN **0** / N/A **31**（以 `official-326-328-checklist.md` 为准）
> 基线：本地 `e8d369fb`（`2.1.290`–`2.1.325` 主线已全量收口）；Wave 1（`2.1.326`）提交 `f56ba107`
> 规则：逐条 1:1 核验；扫员单独结论不升 HAVE；函数体未锁不升 HAVE；遵守 invent-ban；每波三路独立代码审查并清零全部 P0/P1/P2。

## 桶

| 桶 | 计数 / 范围 |
| -- | ----------- |
| HAVE | 653（`2.1.326` 350 + `2.1.327` 162 + `2.1.328` 141，全部 CLI 项） |
| PARTIAL | 0 |
| GAP | 0 |
| UNKNOWN | 0 |
| N/A | 31（纯 `[VSCode]` 扩展侧项 30 条 + 泛化汇总项 `#474` 1 条） |

## 分版本统计（按正序 2.1.326 → 2.1.328）

| 版本 | 编号范围 | 总计 | HAVE | PARTIAL | GAP | N/A | UNKNOWN | 状态 |
| ---- | -------- | ---- | ---- | ------- | --- | --- | ------- | ---- |
| 2.1.326 | #1–#367 | **367** | 350 | 0 | 0 | 17 | 0 | **DONE** (`f56ba107`) |
| 2.1.327 | #368–#540 | **173** | 162 | 0 | 0 | 11 | 0 | **DONE** |
| 2.1.328 | #541–#684 | **144** | 141 | 0 | 0 | 3 | 0 | **DONE** |

## Wave 1（2.1.326，`f56ba107`）收口与三路审查记录

- **执行架构**：6 路扫描分拣 → 9 组零冲突并行实现（Sub-Wave 326-I 5 组后端 + Sub-Wave 326-II 4 组 UI/REPL/命令）→ 3 路跨组生产调用链接线 → 3 路只读独立代码审查 → 3 路并行修复。
- **独立审查发现与全量修复**：共发现并清零 **6 个 P0 + 23 个 P1 + 14 个 P2**（及 `lockfile.ts` ESM namespace 赋值回归）。

## Wave 2（2.1.327–2.1.328）收口与三路审查记录

- **执行架构**：6 路扫描分拣（10 条已有 `HAVE`、14 条 `N/A`、293 条活跃项）→ 9 组零冲突并行实现（Sub-Wave 327/328-I 5 组后端 193 条 + Sub-Wave 327/328-II 4 组 UI/Ink/REPL/命令 100 条）→ 3 路跨组生产调用链接线 → 3 路只读独立代码审查 → 3 路并行修复。
- **独立审查发现与全量修复**：共发现并清零 **10 个 P0 + 23 个 P1 + 14 个 P2**：
  - **P0 修复**：`secretScanner.ts` `#489` 双 `://` URL 凭据泄漏、`sedValidation.ts`/`bashPermissions.ts` `#503` `sed` 未接 `buildOutsideReadSedAsk` 且晚于 allow 规则、`main.tsx`/`permissionSetup.ts` `#511`/`#512` `--worktree --add-dir` 初始化时序、`outsideReads.ts` `#503`/`#504` 管道解释器与 `cd &&` 绕过、`sessionHandler.ts`/`gitPrepare.ts` `#548` `--repository-folder` 未透传 `prepareSources`、`codeMode/executor.ts` `#581` 只读子代理泄漏 `Write`/`Edit`、`processUserInput.ts`/`attachments.ts` `#674` `$` 替换损坏/多段粘贴/首轮提示/`ultrathink` 剥离、`bgManager.ts` `#387` `heldSpare.dispose()` 空指针竞态与磁盘账号检测、`upstreamproxy/relay.ts` `#405` 503 拒连前未绑 socket `error` 监听器、`task/framework.ts`/`print.ts` `#593` `notifySweptBackgroundAgents` 误把已完成代理标为 `killed`。
  - **P1/P2 修复**：`autoModeClassifierTransport.ts` `#565` 德摩根反转、`powershellPermissions.ts` `#509`、`powershellProvider.ts` `#487` 退出清理/超时/错误监听/文件共享竞态、`GrepTool.ts` `#414` 单文件排序、`fsOperations.ts` `#489`/`#501`、`secretScanner.ts` `#627` 仅在惰性编译时检测 2 MiB headroom、`reactiveCompact.ts` `#567`、`inProcessRunner.ts`/`tokens.ts` `#423`、`pluginDevMods.ts` `#623`、`pluginEval/report.ts` `#518`、`ArtifactTool`/`toolExecution.ts` `#493`/`#419`/`#420`、`useManageMCPConnections.ts` `#412` timer 防泄漏、`App.tsx` `#603`、`dom.ts` `#404` `LayoutDisplay.None`、`BaseTextInput.tsx` `#464`、`BashPermissionRequest`/`ExitPlanModePermissionRequest` `#662`、`ComputerUseApproval` `#657`、`chrome.tsx` `#466`、`ccrClient.ts` `#585`、`ListPeersTool`/`SendMessageTool` `#658`、`REPL.tsx` `#582`/`#388`/`#606`、`autofix-pr` `#447`、`artifacts.tsx` `#422`、`sessionStorage.ts` `#562`/`#645`/`#391` 及全部 0-caller 接线缺口。
- **验证门禁**：`tsc --noEmit` 0 错误、`biome ci .` 0 错误、`bun scripts/docs-check.ts --quiet` 通过、全部 Wave 328 + Wave 326 + 关键回归单测 100% 通过。
