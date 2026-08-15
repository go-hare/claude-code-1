# densable 2.1.233 — 官方更新清单 × go-hare 对照

> 来源：GitHub release **v2.1.233**（2026-08-14）+ densable SEA win32-x64。  
> 更新：2026-08-15 — #6 单栈 client@2+server@2；P2：v2 类型 re-export + auth 结构守卫（HAVE 14）。  
> 约定：extract densable first → 1:1；不 invent gateway；不自动 commit/push。

## 计数（审查口径）

| 状态 | 数 | 说明 |
| ---- | -- | ---- |
| **HAVE** | **14** | 含 #6 MCP v2 Client.listen + reopen park；#15 gSi；#18 Tds |
| **HAVE (verify-only)** | **1** | #5：SEA 对照既有 `awaitRemoteSessionResult`，无新 diff |
| **HAVE (pre-exist)** | **2** | #9 / #12：既有代码，本 pack 无实质 diff |
| **PARTIAL** | **0** | — |
| **N/A** | **3** | #2 / #13 gateway；#7 Desktop Notification |
| **GAP** | **0** | — |

## 全量对照

| # | 官方条目 | 状态 | 本地 |
| - | -------- | ---- | ---- |
| 1 | GitLab MR → worktree / agents `!N` | **HAVE** | 解析 + `PrBadge` `!N`；fetch 按 densable Oxr：gitlab→MR-only、github→pull-only、other→[pull,mr] |
| 2 | apps gateway `forward_user_identity` | **N/A** | 不发 gateway |
| 3 | Linux cgroup `TOOL_MEMORY_LIMIT` | **HAVE** | densable `cgroup:y?Qfp():void 0`：Bun 下 `child_process.spawn({cgroup})` 原子；纯 Node fallback `cgroup.procs` post-attach |
| 4 | `WEBFETCH_CACHE_TTL_MS` | **HAVE** | densable C9s / `$J_=900000`；构造时注入 LRU ttl |
| 5 | cloud 等权限时 env 关 → 勿标 lost | **HAVE (verify-only)** | densable `XBa` ≡ `awaitRemoteSessionResult`：`requires_action` throw；对照 SEA，本 pack 无新代码 |
| 6 | MCP listen 勿死循环重开 | **HAVE** | densable `hNf`/`npS`/`opS`/`rpS`/`LVa`；**单栈** `client@2`+`server@2`（**无 sdk 1.x**）；string handlers + `listTools`/`callTool`；`timeout:k0()` + `mcpServerKeyHash`；BVa `probe:{timeoutMs}`；默认 legacy 同 densable GB |
| 7 | Desktop/VS Code Notification 权限 | **N/A** | 宿主扩展面 |
| 8 | Linux sandbox idle 单核 100% | **HAVE** | SRT HTTP CONNECT 死 peer EPIPE 不 destroy → Bun 空转；修自 **SRT ≥0.0.72**；本仓 **`@anthropic-ai/sandbox-runtime@0.0.73`** |
| 9 | skill 别名 headless Unknown command | **HAVE (pre-exist)** | densable GtS ≈ `stripCollidingPluginAliases`（221+）；本 pack **无 diff** |
| 10 | 参数勿二次模板展开 | **HAVE** | densable `iCt` 哨兵 `U+FFFF`/`U+FFFE` @ `argumentSubstitution.ts` |
| 11 | Windows `\??\` UNC/NTLM | **HAVE** | `containsVulnerableUncPath` + `stripWindowsExtendedPathPrefix` |
| 12 | self-hosted-runner 更快起会话 | **HAVE (pre-exist)** | 既有 BYOC `gitPrepare`；本 pack **无 233 新符号** |
| 13 | apps gateway 400/413 | **N/A** | gateway |
| 14 | `plugin validate` 裸 `.claude/skills` | **HAVE** | `tryValidateBareSkillsDirectory` / `validateSkillsDirOnly`；空结果 success（去死分支）；`looksLikeSkillsDir` 无冗余 |
| 15 | 读屏 `/effort` 编号列表；hint 不裁切 | **HAVE** | help = densable **gSi** dash 列表（模型过滤 levels）；Panel `accessibility role=list/listitem` 编号 label + hint wrap 不截断 |
| 16 | print unrecognized_model | **HAVE** | `unrecognizedModelSignal` + `queryModel` 入口 |
| 17 | GitHub tip 对 gitlab/bitbucket 隐藏 | **HAVE** | tip `isRelevant` 用 `getRemoteUrl`+`gitRemoteHostname`（嵌套 GitLab path）；非 `parseGitRemote` 两段 path |
| 18 | Todo 模型门 + ENABLE_TODO_TOOLS | **HAVE** | densable `h5` 默认 true；`uX` 含 QR(bg)、Ads（`setTodoToolsOptIn` + env）；**Tds**：`--tools`/`--allowedTools` 含 Task*/TodoWrite → opt-in；TodoWrite `!h5&&uX`；Task* `Eee` |
| 19 | 回滚 232 Cygwin + Bash `<` | **HAVE** | 产品路径摘除；`TREE_SITTER_BASH` 出 DEFAULT；residual 模块/测试保留 |
| 20 | auto mode `cd && >` 误批 | **HAVE** | `isDiscardOutputRedirectTarget`：`/dev/null` 全平台；`NUL`/`nul`/`\\.\NUL` **仅 Windows**（Unix 真文件） |

## Explicit non-claims

- 不 invent apps gateway（#2/#13）。  
- residual Cygwin / `validateInputRedirections`：**默认产品路径不得调用**，直到 densable 再上 narrower 版。  
- #6：单栈 **`client@2`+`server@2`**（已移除 sdk）。densable 形：string handlers、`listTools`/`callTool`、listen reopen/park、`timeout:k0()`、`mcpServerKeyHash`、**k0i/kpS 精确 draft 集合**。协议类型 **re-export v2**（`types.ts`）；ant/mcp-client 用 `server`/`client` 的 `CallToolResult`/`JSONRPCMessage`。auth OAuth body 用 **结构守卫**（非本地 zod Schema 袋）。**禁止**再引入 sdk/适配包。  
- #8：依赖对齐 SRT，非 CLI 内再实现一遍 proxy。  
- 提交时 **勿 stage** logos、`nul`、`docs/upstream-extraction/v2.1.212/**`。  

## 提交建议 stage 范围

```text
package.json bun.lock
docs/upstream-extraction/v2.1.233/
src/utils/todoToolsGate.ts src/utils/tasks.ts
src/utils/shell/toolMemoryCgroup.ts
src/utils/argumentSubstitution.ts
src/utils/worktree.ts src/components/PrBadge.tsx
src/utils/path.ts src/utils/shell/readOnlyCommandValidation.ts
src/utils/plugins/validatePlugin.ts
src/utils/managedEnvConstants.ts
src/utils/Shell.ts src/services/api/claude.ts
src/services/mcp/mcpListenReopen.ts src/services/mcp/mcpV2Client.ts
src/services/mcp/client.ts src/services/mcp/mcpConnectTimeout.ts
src/services/mcp/useManageMCPConnections.ts src/services/mcp/types.ts
src/services/mcp/InProcessTransport.ts src/services/mcp/SdkControlTransport.ts
src/services/mcp/elicitationHandler.ts src/utils/mcpWebSocketTransport.ts
src/utils/ide.ts
src/utils/model/unrecognizedModelSignal.ts
src/services/tips/tipRegistry.ts
src/commands/effort/effort.tsx src/components/EffortPanel/EffortPanel.tsx
packages/builtin-tools/... (Todo/Task/WebFetch/Bash/PowerShell pathValidation 等)
scripts/defines.ts (+ 相关 defaultBuildFeatures 测试)
**/*233*.test.ts 及 232 residual 测试改动
src/utils/sandbox/__tests__/sandbox.filesystem.disabled.216.test.ts
```
