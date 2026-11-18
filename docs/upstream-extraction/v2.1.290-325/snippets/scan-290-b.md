# 2.1.290 Checklist Scan (#33–#64)

> 对照基线：本地 `src/` + `packages/builtin-tools/` + `packages/@ant/ink/` + `vendor/claude-code-mods/`（`2.1.289` tip） vs 官方 SEA `/tmp/official-325/plat/package/claude`（`2.1.325`）。

## 汇总统计（共 32 条：#33–#64）

| 状态 | 数量 | 条目 |
| ---- | ---- | ---- |
| **HAVE** | 0 | — |
| **PARTIAL** | 3 | #36, #46, #52 |
| **GAP** | 27 | #34, #35, #37, #38, #40, #41, #42, #43, #44, #45, #47, #48, #49, #50, #51, #53, #54, #55, #56, #57, #58, #59, #60, #61, #62, #63, #64 |
| **N/A** | 1 | #33 |
| **UNKNOWN** | 1 | #39 |

## 明细表

| # | 状态 | 本地文件/符号 | SEA 关键词/片段摘要 | 差异说明 |
| - | ---- | ------------- | ------------------- | -------- |
| 33 | N/A | 无 Cowork 云容器重启收尾逻辑 | `@282235934` 仅在遥测事件白名单出现 `ccs_container_version_restart` / `ccs_container_restart_by_ccr` | 属于 Cowork Cloud Session（`ccs_`）云端容器侧修复，CLI 本地不适用 |
| 34 | GAP | `src/utils/plugins/validatePlugin.ts`；`src/utils/plugins/functionHooksModules.ts` (`scanFunctionHookSource`) | `@289630894` `EQt`/`rrr`/`Zor` AST 静态检查；`@331934119` `gatingHooks` | 本地 `validatePlugin.ts` 仅校验 JSON manifest，`scanFunctionHookSource` 仅扫描 `on("...")` 字面量，缺少官方 hooks 模块 AST 静态校验与选项解构冲突修复 |
| 35 | GAP | `src/utils/teleport/gitBundle.ts:1044` (`runTCtHu(gitRoot, ['stash', 'create'], ...)`) | `@286301547` `KHs=["-c","core.safecrlf=false"]`；`@304913149` `Wi` 调用 `kb(e,[..._he,...znt(o),...KHs,"stash","create"])` | 本地 `git stash create` 未传 `-c core.safecrlf=false`，当仓库配置 `core.safecrlf=true` 时会失败 |
| 36 | PARTIAL | `src/utils/effort.ts:1341-1410,1636-1673` (`carriedEffort`)；`src/bootstrap/state.ts:854-884` (`RefusalFallbackModelLatch`) | `@278058746` / `@278130332` `RefusalFallbackModelLatch.carriedEffort` 与 `takeCarriedEffortEnd`；`@283093942` `Mjr`/`VSa`/`qSa`/`KSa` | `effort.ts` 已具备下游 `carriedEffort` 参数与解析逻辑，但 `state.ts` 的 `RefusalFallbackModelLatch` 及 `query.ts` 缺少 `carriedEffort` 锁存与传递 |
| 37 | GAP | `src/utils/promptShellExecution.ts:50` (`BLOCK_PATTERN`) | `Zds`/`Umo` 处理 CRLF 并在出错时提示 `"A \uFFFD at the end of a line is a carriage return from Windows (CR LF) line endings"` | 本地 `BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g` 未剥离 `\r\n` 中的 `\r` 或提供 CRLF 兼容处理 |
| 38 | GAP | `packages/@ant/ink/src/theme/Tabs.tsx:202` (`blurHeader`)；`src/components/permissions/rules/PermissionRuleList.tsx:213`；`AutoModeRulesTab.tsx:162` | `@308291446` `Tabs` `zn=(Jn)=>{if(Jn)N(Jn);else We();...}`；`@334208344` / `@334232071` `ee(ue.current)` / `T(k.current)` | 本地 `blurHeader()` 不接受目标节点且总是调用 `focusManager?.blur()`，`PermissionRuleList`/`AutoModeRulesTab` 未传 `containerRef.current`，全屏点击 tab 时与 `useFocusReclaim` 产生焦点死循环/卡死 |
| 39 | UNKNOWN | `src/services/compact/compact.ts` (`compactConversation`)；`autoCompact.ts` | `@291516890..291537547` `compactConversation` / `partialCompactConversation` | SEA 压缩代码体积大且未见明确对应的 `"null is not an object"` 单点报错字面量，无法确定具体缺失的空值保护位置 |
| 40 | GAP | `src/utils/plugins/functionHooksModules.ts:16722`；`src/utils/processUserInput/turnHookQueuedPrompts.ts` | `@297807516` `_i` / `$d` 子代理退出时触发 `turn.complete` 并传入 `answer: we ?? O` | 本地仅声明 `'turn.complete'` 事件名，`AgentTool`/`QueryEngine.ts` 尚无子代理 `turn.complete` 派发与 `answer` 传递 |
| 41 | GAP | `src/utils/plugins/functionHooksModules.ts` (`loadFunctionHooksModules`)；`src/utils/plugins/pluginDevMods.ts` | `@293363291` `var XI="; the version loaded before is unloaded"`，`auo` 在 `NAt` 重载失败时报告并卸载旧版本 | 本地缺少热重载失败后卸载前版并提示 `"; the version loaded before is unloaded"` 的 `auo`/`NAt` 逻辑 |
| 42 | GAP | `src/utils/processUserInput/promptSubmit.ts:948-956`；`src/utils/plugins/functionHooksModules.ts` | `@282629297` `im` (`prompt.submit`) 站点；`@289669084` `nWa`；`hookFailed` 按插件名报错 | 本地仅 `logForDebugging('prompt.submit: dropped (...)')`，未将调用 `next(e)` 后又 drop 的 `prompt.submit` hook 按插件名报告为 `hookFailed` |
| 43 | GAP | `src/components/PluginRasterPanes.tsx:938-969`；`src/utils/plugins/functionHooksModules.ts:10321` | `@320012193` `mo(()=>yt(!0))` 与 `an(()=>{if(st&&nt()!==$e)Xe($e)},[st,$e,nt,Xe])` | 本地 `PluginRasterPanes.tsx:938-942` 直接依赖 `[followEnd, input.maxOffset, placed]` 并触发 `setPlaced`，当树高度每次绘制都变化且 `followEnd` 开启时会反复触发重绘 |
| 44 | GAP | `packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts:960,1295`；`src/utils/fsOperations.ts:675` (`readFileBytes`) | `@278263642` `readFileFdGated`（`O_RDONLY \| O_NOFOLLOW \| O_NONBLOCK` + Windows 常规文件校验） | 本地 `readImageWithTokenBudget` 通过路径调用 `readFileBytes`（普通 `readFile`/`open(fsPath, 'r')`），未使用 `O_NOFOLLOW` 文件描述符校验，存在读取中途被掉包软链的风险 |
| 45 | GAP | `src/utils/plugins/functionHooksModules.ts:17133` (`admitUserPluginIfAllowed`)、`notifyHookFailed` | `@293363024` `suo`/`ruo`/`NAt` 分层接纳；`@293410336` `Mco`/`Pco`/`vnt` hook 失败处理 | 本地仅在加载前执行 `admitUserPluginIfAllowed`，缺少用户 mod 导致组织插件被卸载时改为卸载该用户 mod 的运行时/重载隔离逻辑 |
| 46 | PARTIAL | `src/services/mcp/config.ts:630-737` (`isMcpServerAllowedByPolicy`)；`src/services/mcp/claudeai.ts:113`；`src/utils/plugins/mcpPluginIntegration.ts:618` | `@293129100` `ek` 检查 `claudeai-proxy`（`gpe(n)===null` / `ACt(n)!=="admit"`）及 `YUs`/`vUs`/`TCt` URL 策略 | 本地已有基础 `allowedMcpServers` URL 匹配和 `disableClaudeAiConnectors` 开关，但 `isMcpServerAllowedByPolicy` 缺少对 `claudeai-proxy` 及 `.mcp.json`/插件/子代理 MCP 条目的完整策略过滤 |
| 47 | GAP | `src/components/PluginRasterPanes.tsx:938-969`；`src/components/hooks/useUiRenderHost.ts` | `@320012193` `followEnd` / `NKe` | 与 #43 同源，内联窗格在树高度每次重绘变化时缺少稳定的 `followEnd` 钳制而无限重绘 |
| 48 | GAP | `src/utils/attachments.ts:2665-2730` | `@292503100` `qps`/`zps`：`hb(h)` 触发 `Ez` 落地路径解析、`zPe`、`through-open` 检查 | 本地 `@`-mention 仅在读取前调用一次 `pathInAllowedWorkingPath`，随后直接 `stat` 与 `generateFileAttachment`，缺少读锁/`--restricted` 下防中途换链的 `Ez`/`zPe`/`O_NOFOLLOW` 检查 |
| 49 | GAP | `src/screens/AgentView.tsx:3222-3254`；`src/screens/fleetView/helpers.ts` | `@301402660` `let z=k!=="esc"&&(ua(...,bl)||ua(...,gl))&&A.restartOfferedJobId===w.id`、`Hi(h,w)` | 本地 `AgentView.tsx` 仅有 `deadEpochOfferedJobId`，尚未实现 `restartOfferedJobId`（无响应重开提示 `bl`）及 `k !== "esc"` 防误触逻辑 |
| 50 | GAP | `src/screens/fleetView/fhFields.ts:1147-1153` (`fleetTranscriptPath`)、`refreshLoopKicks` | `scanLoopTranscript` / `probeFleetTranscript` / `readLogTail` | 本地 `fleetTranscriptPath(state)` 仅用 `state.cwd` 拼接 transcript 路径，未考虑后台会话进入自建 worktree（`worktreePath`）后的路径变化，导致 `/loop` 计数与倒计时丢失 |
| 51 | GAP | `src/utils/permissions/filesystem.ts:2386,2584` | `@284852383` `if(kc(h))return Se(n,"Job tmp/ subtree for current bg session is allowed for reading")` | 本地仅放行 `Scratchpad files for current session`（`G7(h)`），缺少 `kc(h)` 对后台会话 `jobs/<id>/tmp/` 粘贴图片的只读自动放行 |
| 52 | PARTIAL | `src/cli/extraReach.ts:3648-3655`；`src/utils/bash/ast.ts:705-875,2265` | `@319299518` `let C=/^(?:export\|declare\|typeset\|local\|readonly)$/.test(y.text)?[...x,...v]:x` 与 `!De(I[2],pt)`；`@284465495` `Bt` | 本地 `extraReach.ts:3649` 与 `ast.ts:705` 已处理 `declare`/`typeset`/`export`/`readonly` 变量赋值，但 `extraReach.ts:3653` 条件及命令/路径前缀变量在 deny/ask 规则中的展开仍不完整 |
| 53 | GAP | `src/utils/imagePaste.ts:852-863` (`tryReadImageFromPath`)；`src/utils/attachments.ts:2691-2711` | `@290280099` `DWa`/`y_n` (`"Pasted path is not read: the read is refused"`)；`@292503100` `KMr` 目录项 `isDenied` 过滤 | 本地粘贴/拖拽图片路径直接 `readFileBytesSync`，未做 Read deny 检查；`@`-mention 目录 `readdir` 未过滤被 Read deny 规则禁止的文件名 |
| 54 | GAP | `src/utils/plugins/functionHooksModules.ts` | `@293410336` `Mco`/`Pco`/`vnt` 与组织 guard 保护机制 | 与 #45 同源，本地缺少当用户 mod 导致组织 guard 跳过检查时自动卸载该用户 mod 的机制 |
| 55 | GAP | `packages/@ant/ink/src/core/wrapAnsi.ts:144` | `@280065434` `j(e,n,s)` 仅对匹配正则 `Y` 的片段运行 `Intl.Segmenter` 分词 | 本地 `HAS_NON_ASCII = /[^\x00-\x7f]/` 只要含任意非 ASCII（含非拉丁多行文本）即对整段文本全量运行 `tokenizeForOutput` + `Intl.Segmenter`，导致每次重绘卡顿 |
| 56 | GAP | `src/screens/AgentView.tsx:2448,4221-4248` | `@301407800` `rf` (`deleteArmed` / `ctrl+x` 分组与行删除保护) | 本地删除分区底部会话后仅将 `selectedIndex` 夹紧到 `flatRows.length`，可能落到下一个分区的 `header`（如 `done`），连续按 Ctrl+X 会触发 `'*done*'` 整区删除 |
| 57 | GAP | `vendor/claude-code-mods/mods/cc-plugin-you-should-know/hooks/register.ts:1471,1519` | `@322585807` / `@322601797` `"Write the learn line, the title and the explanation in the language the session’s Language instruction names; if there is none, in the language the user has been writing in."` | 本地 `you-should-know` 提示词仍硬编码 `"plain-English"`，未遵循 `language` 设置 |
| 58 | GAP | `src/components/messages/`；`src/utils/`（无 `ROa`） | `@280450075` `ROa`（超过 `q9e=4096` 字符的整行按 `WP=256` 分块切分）与 `@283023719` `h$o` | 本地缺少发送超长单行消息时的 `ROa` 256 字符软分段逻辑，易在渲染/测量时卡死 |
| 59 | GAP | `packages/@ant/ink/src/core/wrapAnsi.ts:31,144` (`HAS_NON_ASCII`) | `@280065434` 正则 `Y` 排除 `\u2010-\u205F`（破折号）、`\u2100-\u2BFF`（箭头/制表符）、CJK 等区间，直接走 `Bun.wrapAnsi` 快路径 | 本地 `HAS_NON_ASCII = /[^\x00-\x7f]/` 将箭头、破折号、盒线字符等全部拖入慢速 `Intl.Segmenter` 包装路径，导致 `ctrl+o` 展开或 resize 卡慢 |
| 60 | GAP | `src/daemon/forceRespawnJob.ts:58-64`；`src/daemon/bgManager.ts:1281-1290` | `@296902981` `Ee=!Ae&&(...\|\|!oe&&k.bgIsolation==="none"&&!P)`，在无 transcript 重启时将 `intent` 置为 `void 0` | 本地 `bgManager.ts` 仅在 `hasMessages \|\| resumePointsElsewhere` 时跳过 `intent`，无 transcript 时 `claude respawn` 仍会重发旧 `intent` |
| 61 | GAP | `src/screens/AgentView.tsx:4108-4135,4292-4317,4224-4248` | `@301395676..301432610` `AgentView` 搜索清空与焦点恢复 | 本地按 Esc 清空 `n:` / Ctrl+F 搜索后未把焦点避开 `header` 行，且 `header` 行允许连按两次 Ctrl+X 清空/取消整区 |
| 62 | GAP | `src/daemon/bgManager.ts:1284`；`src/daemon/transcriptProbe.ts:357` | `@296902981` `ye=WIt(k);if(ye!==k.queuedPrompt)t("bg: respawn ... — the saved reply starts with / or !, so no restart sends it")` | 本地未对 `queuedPrompt` 过滤以 `/` 或 `!` 开头的命令（`WIt`），导致无法投递到已停止会话的斜杠命令在重启后被自动执行 |
| 63 | GAP | `src/utils/teleport/gitBundle.ts`；`src/utils/teleport/seedGitInclude.ts` | `@286247089` `Ti=new Set(["unset","unspecified"])`, `Woa`；`@305003336` `ambiguous_filter_driver` 报错中止上传 | 本地缺少 `Woa` 与 `ambiguous_filter_driver` 检查，存在名为 `unset` 或 `unspecified` 的 git filter driver 时仍会继续上传未过滤内容 |
| 64 | GAP | `src/utils/messages.ts:517`；`src/utils/permissions/` | `@292159219` `allowRuleToolName:v?wBr(Zs(r)):void 0`；`@294226019` `Bvo` / `wBr` | 本地自动模式拒绝提示缺少 `wBr` 对会绕过分类器的整工具规则或被忽略规则的过滤 |
