# v2.1.290–325 Alignment Scan: Batch A (#1–#32)

- **Checklist**: `docs/upstream-extraction/v2.1.290-325/official-290-325-checklist.md` (#1–#32, all `2.1.290`)
- **SEA binary**: `/tmp/official-325/plat/package/claude` (`2.1.325 (Claude Code)`)
- **Local baseline**: `src/` + `packages/builtin-tools/`

## Summary Counts

| Status | Count | Items |
| --- | ---: | --- |
| **HAVE** | 0 | — |
| **PARTIAL** | 4 | #17, #22, #23, #26 |
| **GAP** | 24 | #1, #2, #3, #5, #7, #8, #9, #10, #11, #12, #13, #14, #16, #18, #19, #20, #21, #24, #25, #27, #28, #29, #31, #32 |
| **N/A** | 1 | #6 |
| **UNKNOWN** | 3 | #4, #15, #30 |
| **Total** | **32** | |

## Scan Results (#1–#32)

| # | 状态 | 本地文件/符号 | SEA 关键词/片段摘要 | 差异说明 |
| --- | --- | --- | --- | --- |
| 1 | **GAP** | `src/query/turnStepHooks.ts` (`TurnStepResult`) | `@282723166` `dc.check` (`serverToolUses` 校验); `@297791022` `Nr`/`Lr` 收集 `server_tool_use`/`mcp_tool_use` 的 `{id,name,input,startedAt,endedAt}` 写入 `serverToolUses` | 本地 `TurnStepResult` 仅含 `turnId,index,answer,toolUses,stopReason,usage`，缺少 `serverToolUses` 收集与返回。 |
| 2 | **GAP** | `src/utils/permissions/permissions.ts:1011` (`evaluatePermissionWithToolCheck`), `src/utils/plugins/functionHooksModules.ts:12356` (`runToolCheck`) | `@288768172` `G0t` 注入 `oEs(e,s,{input:n,agentId:r.agentId})`，`K0t` 传入 `Li("tool.check",{...PB(n),agentId:s.agentId})` | 本地 `tool.check` payload 仅传 `{ tool, input, tool_use_id }`，未透传 `agentId`。 |
| 3 | **GAP** | `src/utils/permissions/permissions.ts:837,1011` (`permissionDecisionToToolCheckRecord`) | `@288768172` `G0t`/`W0t` 展开 `...$ye(e,r)` 与 `...B0t(s,r)`；`@135243440` `orgLimit` | 本地虽有 `org_ask_ceiling` (`permissions.ts:2383`)，但未把 `ceiling` 写入 `tool.check` 问题载荷与核心裁决结果。 |
| 4 | **UNKNOWN** | `src/skills/bundled/plugin-authoring/reference.md`, `src/components/StatusLine.tsx` | SEA 与 `/tmp/official-325/package/sdk-tools.d.ts` 中 `ThemeKey` 均 0 命中（`@138461985` 有 `declare module 'claude-code' { interface EngineInterface ... }` 校验） | 本地无包含 `ThemeKey`/`Color` 的 plugin hooks `.d.ts` 类型文件；但 SEA 二进制未直接包含该 `.d.ts` 声明原文，标 `UNKNOWN`。 |
| 5 | **GAP** | `src/utils/plugins/validatePlugin.ts:142` (`ValidationResult`) | `@331934142` `ue(e)` 序列化 `gatingHooks: e.gatingHooks.map(n => ({module, pattern, hook, hasCatch: n.hasCatch}))` | 本地 `ValidationResult` 及 `src/` 全文均无 `gatingHooks` 字段与 `hasCatch` 统计。 |
| 6 | **N/A** | — | `@133731351` `--gateway-json` | 「Claude apps gateway 的登录审批页新增 Deny 按钮」属网关侧 Web 审批页服务端/前端改动，不涉及本地 CLI 源码。 |
| 7 | **GAP** | `src/cli/bg.ts:137-282` (`logsHandler`, `attachHandler`, `resolveLogsJobId`) | `@296861656` `claude logs <id\|name>` / `claude attach <id\|name>`，`No session name matches ...`，支持部分会话名匹配与提示 | 本地 `resolveLogsJobId` 仅调用 `resolveJobShortByPrefix` 按 ID 前缀查找，`LOGS_USAGE` 仍为 `claude logs <id>`，不支持按部分名称匹配。 |
| 8 | **GAP** | `src/skills/bundled/claudeApi.ts`, `src/skills/bundled/claude-api/SKILL.md` | `@138139241` `managed-agents-onboarding-from-url.md.zst`；`@299654939` `I(n)` 解析 URL 参数 | 本地 `claude-api/shared/` 缺少 `managed-agents-onboarding-from-url.md`，`claudeApi.ts` 未处理 `<url>` 子参数分发。 |
| 9 | **GAP** | `src/skills/bundled/claudeApi.ts`, `src/skills/bundled/claude-api/shared/` | `@299654939` `shared/managed-agents-quickstarts/`、`deep-researcher.md`、`G(n)`/`P(n,e)` quickstart 模板分发 | 本地 `claude-api/shared/` 无 `managed-agents-quickstarts/*` 及 `managed-agents-onboarding-from-quickstart.md`。 |
| 10 | **GAP** | `src/utils/settings/settings.ts` | `@279152092` `GVo` 检测 `"is reached through a link"` + `"that leads outside ..."`；`@279192551` `Iu`/`managedDocumentLinks` | 本地 `settings.ts` 无 `managedDocumentLinks` 及托管配置文件软链接指向目录外时的告警逻辑。 |
| 11 | **GAP** | `src/utils/settings/settings.ts`, `src/utils/plugins/pluginEval/evalSandboxFence.ts:1874` | `@279245949` `allowReadCount` / `allowedDomainsCount` 生成 `statusOnly: true` 的 `sandbox.filesystem.allowRead is ignored` / `sandbox.network.allowedDomains is ignored` 告警 | 本地仅 `evalSandboxFence.ts` 检查这两个字段；`settings.ts` / `/status` / `doctor` 缺少对应的忽略告警。 |
| 12 | **GAP** | `src/services/api/claude.ts`, `src/utils/thinking.ts:1344`, `src/utils/permissions/classifierBetaLatch.ts:107` | `@291861900` `M0o` 调用 `rdt(eo, [...qS,...pye])` 一次剥离多个被拒 beta 并记录 `tengu_beta_400_healed`（含非 400 `status`） | 本地无 `M0o`/`rdt` 多 beta 及非 400 状态码的 beta-header 自动降级重试逻辑。 |
| 13 | **GAP** | `src/services/api/claude.ts`, `src/services/api/errors.ts` | `@290619146` `qvn(e)` 匹配 `ijr="Request rejected as unprocessable by the model..."`；`@291851997` `OLt` 通过 `mediaItemCap`/`eKn` 裁剪图片重试 | 本地 `src/` 中 `Request rejected as unprocessable` 与 `mediaItemCap` 均 0 命中。 |
| 14 | **GAP** | `src/services/api/claude.ts`, `src/services/api/errors.ts` | `@291919441` `if (lg?.cause==="outputFiltered")` 在 `hy==="retry"` 时打点 `tengu_streaming_output_filter_retry` 并 `continue e` 重试一次 | 本地 `src/` 中 `outputFiltered` / `tengu_streaming_output_filter_retry` / `output_content_filtered` 均 0 命中。 |
| 15 | **UNKNOWN** | `src/tasks/LocalAgentTask/LocalAgentTask.tsx` (`resumeAgentBackground`) | `@298060519` `resumedAgentId` 调度；`@291696445` `thinking_drop` | 扫描预算内未能在 SEA 定位到「resumed subagent 收到 mid-run 消息后保留历史 thinking 与 prompt cache」的精确修复函数体。 |
| 16 | **GAP** | `packages/builtin-tools/src/tools/WebFetchTool/WebFetchTool.ts:40` | `@330322632` `WebFetchTool` | 本地 `WebFetchTool` 的 `inputSchema` 仅包含 `{ url, prompt }`，缺少 `offset` 参数及超 100,000 字符时的未读提示。 |
| 17 | **PARTIAL** | `src/utils/markdown.ts:38-39,761` (`LIST_INK_MAX_DEPTH = 64`, `shouldUseInkListLayout`) | `@287496491` `marked` `Lexer.blockquote` / `list` | 本地 `shouldUseInkListLayout` 对 Ink 布局限制了 `LIST_INK_MAX_DEPTH = 64`、`LIST_INK_MAX_NODES = 300`，但 `formatToken` / `listItemNeedsBlankBefore` 及底层 `marked` 解析仍为递归，千层嵌套列表/引用仍可能栈溢出。 |
| 18 | **GAP** | `src/components/MessageSelector.tsx` (`selectableUserMessagesFilter`), `src/components/VirtualMessageList.tsx:510` | `@289326406` `R4t`/`transcript_new_prompt_past_rewind`；`@288892620` `queued_command` | 本地 `selectableUserMessagesFilter` 仅过滤 `type === 'user'` 消息，不会列出 Claude 仍在工作时提交的 `queued_command` 提示。 |
| 19 | **GAP** | `src/utils/cronTasks.ts`, `src/services/compact/compact.ts` | `@278154340` `sessionCronTasks`；`@280533243` `session_crons` | 本地 `src/services/compact/` 压缩流程完全未引用或保留会话级定时任务（`cronTasks` / `/loop`），压缩后恢复会丢失。 |
| 20 | **GAP** | `src/utils/cronScheduler.ts`, `src/utils/cronTasks.ts` | `@278155270` `Wie(e, {handOff})`；`@308905353` `endedLoopWakeup` | 本地 `cronScheduler.ts` / `cronTasks.ts` 无 `handOff`、`/background` 交接或 `resume`/`respawn`/`fork` 去重防重跑逻辑。 |
| 21 | **GAP** | `src/QueryEngine.ts:1680`, `src/cli/print.ts:1706` | `@309525526` `A.subtype==="success"&&A.is_error&&A.deferred_tool_use===void 0` 等 structured output 断连处理 | 本地 `QueryEngine.ts` 与 `print.ts` 无「structured output 已送达但连接断开导致 `success` 结果仍置 `is_error: true`」的修正逻辑。 |
| 22 | **PARTIAL** | `src/utils/permissions/permissions.ts:2383` (`mcpServerPolicy`, `effectiveMaxPermission`) | `@292165065` `ekt` / `Zce` / `bis`；`@292170616` `planModeWriteFloor` | 本地已有 `mcpServerPolicy` 与 `org_ask_ceiling`，但缺少 SEA 中 `planModeWriteFloor` / `ekt` / `bis` 在 plan + auto mode 下对非只读 connector 工具放行的拦截。 |
| 23 | **PARTIAL** | `src/utils/claudemd.ts` (`isHeldOutside`), `src/utils/permissions/outsideReads.ts` | `@290278104` `zPe`/`p3`/`f_n` 以 `hb(context)`（含 `blockReadsOutsideWorkingDirectories`）约束 `CLAUDE.md`/`AGENTS.md`/`.claude/rules` 符号链接 | 本地 `claudemd.ts` 已有 `isHeldOutside`/`lstat`/`realpath` 校验，但 `outsideReads.ts` 的 `blockReadsOutsideWorkingDirectories` 未与 `CLAUDE.md` / `rules` / `AGENTS.md` 加载链耦合。 |
| 24 | **GAP** | `src/utils/sandbox/sandbox-adapter.ts:1694`, `packages/builtin-tools/src/tools/WebFetchTool/utils.ts` | `@292601501` `Q7n`/`Bwt`/`J7n` 使用随机 `zzpunycode${randomBytes(8)}zz` 占位保护 `xn--` host label 后再调 `new URL` | 本地 `src/` 0 命中 `Q7n` / `zzpunycode` 逻辑，URL 通配符匹配未处理 `xn--` 标签中的 `*`。 |
| 25 | **GAP** | `src/services/mcp/config.ts`, `src/services/mcp/useManageMCPConnections.ts` | `@293140977` `Ih`/`ICt`；`@293143784` `Oio`/`Mxr`/`AM`/`Mw` | 本地 MCP 配置合并与重连/SDK 晚到达结果处理缺少 SEA `Oio`/`Mxr` 对应的组织托管 MCP 作用域保护，登录/重连后可能被重列为本地/用户配置。 |
| 26 | **PARTIAL** | `src/utils/teleport/gitBundle.ts:1044-1065` | `@304913418` `Wi()` 检查 `s.exitCode === 1 && a`；`deletedUnstaged: []` 记录 `git add -N` 删除/移动文件 | 本地 `gitBundle.ts` 已有 `git stash create` 与空 stderr 兜底，但未区分 Windows 失败告警（`exitCode === 1` vs 非 1）也未处理 `deletedUnstaged`（`git add -N` 删除/移动）。 |
| 27 | **GAP** | `src/utils/plans.ts:94-96` (`getPlansDirectory`) | `@284739870` `wl()` 调用 `cu(e)` 检查非 Windows 下的反斜杠：`plansDirectory must be within project root, with no backslash in its path off Windows` | 本地 `plans.ts` 仅校验 `resolved.startsWith(cwd + sep) || resolved === cwd`，无反斜杠检查。 |
| 28 | **GAP** | `src/bridge/` | `@307904988` `bufferLoneDelta` / `streamEventFlushIntervalMs`；`@307911417` `takeStreamEventBuffer` / `flushOnSamplingEnd` | 本地 `src/bridge/` 中上述流式增量缓冲/定时刷新机制均 0 命中。 |
| 29 | **GAP** | `src/daemon/main.ts`, `src/cli/bg.ts`, `src/daemon/attachTranscriptPreview.ts` | `@296275000` `daemonMain` / `wn`；`@277945471` `qPt`/`mV` `\uXXXX` 转义 | 本地 `daemon/main.ts` 与 `cli/bg.ts` 未对 `claude daemon run` / `claude daemon logs` 输出做终端控制字符 `\uXXXX` 转义（仅 `attachTranscriptPreview.ts` 转义预览文本）。 |
| 30 | **UNKNOWN** | `src/self-hosted-runner/sessionHandler.ts:483`, `src/self-hosted-runner/sessionText.ts:7` (`truncateSessionErrorText`) | `@294886826` `insteadOfRetryHint: rd ? BLa(Gt.stderrTail) : void 0` | 本地 `sessionHandler.ts` 已在 `readline` 处将 `stderr` 单行截断到 500 字符、`sessionText.ts` 也限制 500 字符；SEA 中对应导致卡死的长行正则/逻辑（如 `BLa`）未完整定位，标 `UNKNOWN`。 |
| 31 | **GAP** | `src/utils/plugins/functionHooksModules.ts:15229` (`FunctionHooksWorkerClient`) | `@139693768` `"the hooks worker was replaced; the plugin stays loaded for its .catch"` / `"waits for the hooks worker's replacement"` | 本地 `functionHooksModules.ts` 无 hooks worker 替换后保留插件以执行 `.catch` 的机制。 |
| 32 | **GAP** | `src/query/turnStepHooks.ts` (`tailGen`, `heldItems`) | `@297791022` `Ir(e, n)` 处理 `streaming_fallback_began` 清空缓冲与 `server_fallback` 剔除 `discardedMessages` | 本地 `turnStepHooks.ts` 无 `streaming_fallback_began` 与 `server_fallback` `discardedMessages` 过滤，fallback 丢弃的 tool call 仍可能留在 `turn.step` 结果中。 |
