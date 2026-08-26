# Claude Code（go-hare）

[English README](./README_EN.md)

[![GitHub Stars](https://img.shields.io/github/stars/go-hare/claude-code-1?style=flat-square&logo=github&color=yellow)](https://github.com/go-hare/claude-code-1/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/go-hare/claude-code-1?style=flat-square&color=orange)](https://github.com/go-hare/claude-code-1/issues)
[![Last Commit](https://img.shields.io/github/last-commit/go-hare/claude-code-1?style=flat-square&color=blue)](https://github.com/go-hare/claude-code-1/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![npm](https://img.shields.io/npm/v/@go-hare/claude-code?style=flat-square&logo=npm)](https://www.npmjs.com/package/@go-hare/claude-code)

基于官方 Claude Code CLI 的**源码还原 / 工程化重建**项目。目标是在保留 Claude Code 终端交互体验的同时，补齐多模型接入、自托管 Remote Control、ACP、daemon / 后台会话、MCP、插件与本地自动化等能力。

> 本仓库**不是** Anthropic 官方产品。商标与官方 Claude Code 权利归 [Anthropic](https://www.anthropic.com/) 所有；本项目仅供学习与研究。

| 能力 | 说明 |
| ---- | ---- |
| **多模型** | `/login` 配置 Anthropic / OpenAI / Gemini / Grok 兼容端点 |
| **Remote Control** | 自托管 RCS + Web UI；`claude remote-control` / bridge |
| **ACP** | Agent Client Protocol，可对接 IDE / 代理宿主 |
| **Agents / Daemon** | `claude agents` dashboard、daemon job、后台会话 resume / fork |
| **Fullscreen** | 对齐 densable 滚轮、Jump-to-bottom、alt-screen 等交互 |
| **Poor Mode** | `/poor` 穷鬼模式：跳过记忆提取 / 建议等，降 token |
| **KAIROS / Buddy** | 常驻助手与终端 buddy（feature 可开关） |
| **Computer Use / Chrome** | 截图键鼠、Chrome MCP（平台完整度不一） |
| **Artifacts** | HTML 上传托管（独立 Cloudflare Worker 包） |
| **Voice** | 语音输入（含豆包 ASR 路径） |
| **Web Search** | 内置搜索工具 |
| **Langfuse** | Agent loop 可观测（可选） |

部分能力由 **feature flag** 控制（见下方）；Analytics / GrowthBook / Sentry 等为占位实现，**不要当成可用企业集成**。

---

## 项目定位

这是 **CLI-first** 的 Claude Code 兼容运行时：

- 主交互宿主：`src/screens/REPL.tsx` + `src/main.tsx` / `src/entrypoints/cli.tsx`
- 查询主链：`src/query.ts` / `src/QueryEngine.ts`
- 工具：`packages/builtin-tools`（经 `@claude-code/builtin-tools` 导出）
- 远程 / 守护：`src/bridge/`、`src/daemon/`、`packages/remote-control-server/`
- ACP：`src/services/acp/`、`packages/acp-link/`

仓库里**没有**独立的 `src/core` / `src/hosts` / `src/runtime` 包级 Agent Core 分层；旧文档里的 `createAgent from 'claude/core'`、`./core` 子路径描述已过时，请勿依赖。

近期主线已收口 **densable 2.1.211 → … → 2.1.229 → 2.1.231 → 2.1.232 → 2.1.233 → 2.1.234 → 2.1.235 → 2.1.236 → 2.1.237 → 2.1.238** 产品对齐（229 REACTIVE_COMPACT + **231 OAuth FLv** + **232 大包 HAVE 45 / N/A 4** + **233 MCP v2 单栈 HAVE 14** + **234 quota auto-resume** + **235 HAVE 18 / N/A 1** + **236 HAVE 20 / PARTIAL 12** + **237 HAVE 3** + **238 HAVE 34 / PARTIAL 5**；官方无 2.1.230）。**npm 包版本以 `package.json` / npm 为准**（当前发布线 **2.7.46**），与 git tag 可能不同步。

#### densable 2.1.236–2.1.238 对齐说明（2.7.46）

对照文档：

- `docs/upstream-extraction/v2.1.236/official-236-checklist.md`（**HAVE 20 / PARTIAL 12 / N/A 1**）
- `docs/upstream-extraction/v2.1.237/official-237-checklist.md`（**HAVE 3**）
- `docs/upstream-extraction/v2.1.238/official-238-checklist.md`（**HAVE 34 / PARTIAL 5 / GAP 0**）

叠在 **2.7.45**（235 + 234 quota）之上。**2.7.46** 一次收口 **236–238** CLI 产品面，并把官方 238 SEA 仍保留的 **234 leftover**（stale Enter `qvm`/`hSl`、SendMessage `to` 300/`searchTruncated`、sessionRestore `GGc`、session persist、markdown `d0l`、marketplace allowlist）按金标接回。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **236** | `ANTHROPIC_DEFAULT_MODEL`、SendMessage `notify_when_idle`、sandbox `**/.env` deny、fullscreen 单次失败回退 classic、goal idle check-in、`/model` `LFh`/`sgM` | gold-weak / live E2E 仍 PARTIAL；**#33 VSCode host a11y N/A** |
| **237** | gateway/custom baseURL `canMarkApiSystem`；内置 **Concise** output style；`isOutputLineTruncated` `r7` typeof+wrap | **不** invent Proactive |
| **238** | `keybindingFlavor` readline、marketplace/MCP `headersHelper`、runner defer-shutdown / Proxy-Authorization、isolation `work-tree-elsewhere`、RC Stop/sign-out/403、update check 10s、`⊘ Disabled` 等 34 HAVE | PARTIAL：#4 live ceiling、#16 live discover、#18 用户可见 isolation、#24 chrome UI、#25 live remint。**不** invent leftover #3 `identity_changed` / G0S / storageV5 |
| **234 leftover** | stale Enter 续跑、`to` 单行+300、`searchTruncated`、UNC/NT 拒 chdir、session persist + `permissionRecheck`、markdown href/表/HR | 不 invent G0S unknowable-rescan |

#### densable 2.1.234–2.1.235 对齐说明（2.7.45）

对照文档：

- `docs/upstream-extraction/v2.1.235/official-235-checklist.md`（**HAVE 18 / PARTIAL 0 / GAP 0 / N/A 1**；官方 19 条）
- `docs/upstream-extraction/v2.1.235/changelog-2.1.235.md`、`progress.md`
- 邻版：`docs/upstream-extraction/v2.1.235/changelog-2.1.234-neighbor.md`（quota auto-resume 等 tip 已有）

叠在 **2.1.233**（npm **2.7.40–2.7.44**）之上。**2.7.45** 一次收口 **2.1.235** CLI 产品面（#1–#18）+ tip 已有 **2.1.234** quota auto-resume，并补 adversarial 残留：**C1** Edit/Write `contentWithheld`、**I1** cloud-session RC 门；另含 CLI IDE bridge `uSm` 与 quota rearm `HEv=2`（非 checklist 主行）。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **输入 / 渲染** | #1 `settings.spellcheck` underline-as-you-type；#3 md-list OIl=32 + hanging；#4 multiline highlight 偏移；#8 slash `oX` 解 `&amp;|&lt;|&gt;`；#15 vim `savedCursorOffset`；#16 dialog `getFocusedValue` 同 tick | spawn env / cleanup residual 见 checklist |
| **权限 / Agent** | #5 Shift+Tab `confirm:cycleMode`（comment 开→折叠字段）；#6 omit `subagent_type` + GP 不可用明确错误；#7 notebook `contentWithheld`；#12 `suppressAlwaysAllowRule` + grant 覆盖一致；**C1** Edit/Write B7S withhold（`GFt`/`sRe`，one-time-only） | UNC network withhold 仍 Windows-only（同 #7 residual） |
| **工具 / 上下文** | #2 LSP `hasEverConnected` latch；#9 update footer `failureHint`；#10 `showExpandedTodos` 持久化；#11 cloud bg delta poll；#13 embedded rg **15.0.x 新于** SEA 14.1.1（patho fail-fast + `-m/-A/-C`）；#14 autocompact-off hint；#17 SendMessage `message_too_large` | **禁止** rg 15→14 / JS fake fail-fast；sidecar≠SEA argv0 仅笔记 |
| **RC / IDE** | #18 `claude rc`↔interactive enterprise-gateway 同门；**I1** `CLAUDE_CODE_REMOTE`/`mX` cloud-session 拒绝串；**uSm** CLI IDE bridge 14 gates + survey/nudge 路由 | **#19 VSCode host focus N/A**（invent-ban）；不 invent gateway / Desktop·cloud handoff |
| **234 邻版 / rearm** | tip **2.1.234** quota auto-resume；rearm `REARM_CAP=2` + xxi same-family | 不 invent storageV5 / overage_included 客户端 |

#### densable 2.1.231–2.1.233 对齐说明（2.7.40 → 2.7.43；2.7.44 产品补丁）

对照文档：

- `docs/upstream-extraction/v2.1.231/official-231-checklist.md`（**HAVE 1** + cup/r8o residual）
- `docs/upstream-extraction/v2.1.232/official-232-checklist.md`（**HAVE 45 / N/A 4 / PARTIAL 0**；官方 49 条）
- `docs/upstream-extraction/v2.1.233/official-233-checklist.md`（**HAVE 14** + verify-only/pre-exist；**N/A 3**）

叠在 **2.1.229**（npm **2.7.39**）之上。**2.7.40** 一次收口 231→233（含 232 review residual：G7 `cse_*`、thinking-only re-stream、ERA 探测、remint 接线）。**2.7.41** 补齐 MCP v2 残留类型迁移：全量 method+params `setNotificationHandler`（channel/IDE/VSCode/print）、`ctx.mcpReq`、elicitation complete 守卫顺序、以及 `mock.module` 进程全局污染隔离。**2.7.42** 收口 tools/list 边界与 residual cast：`listToolsResult`、`createSdkMcpServer`/`tools/call` densable 路径、`k0i` implements、channel origin。**2.7.43** 审查收口：thinking-only cost credit、G7 `cse_*` abandon clear、`epoch_stale`-only Ot；OpenAI/Grok/Gemini catch 走 `getAssistantMessageFromError` 使 PTL 进 reactive compact。**2.7.44** teammate 默认模型：unset/null 跟随 leader / `ANTHROPIC_MODEL`（Opus 仅兜底），并转发 Anthropic 模型 env pin。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **231 OAuth** | MCP 预注册 client（Slack 等）redirect：**JFr=`localhost`**（listen 仍 `127.0.0.1`）；preferred-port 复用；`preserveClientRegistration`；custom `redirectUri` 不启 localhost listener | 与 229「strict AS 用 127.0.0.1 redirect」目标不同——**redirect host ≠ listen host** 故意分离 |
| **232 Agent / 跨会话** | fork 产品默认 ON（runtime gate，非 compile `FORK_SUBAGENT`）；`@` peer mention；SendMessage 裸名直达；本机 session 名唯一；Dialog expiry / 跨会话 inbound 策略 | 完整 cloud sessions / inProcess team-file 不 invent |
| **232 安全 / 市场** | GitLab token 家族脱敏 + `glab` 路径保护；marketplace 别名；GitLab nested subgroup clone；PS `PSDefaultParameterValues`；nested git 独立 trust；UDS socket dir 硬化 | **#10/#11/#22 gateway、#45 Cowork N/A** |
| **232 RC / 流** | remint ~30min / Ls+Hde/gzp；G7 teleported + `cse_*` 失败重连保留；thinking-only re-stream（Po=1/sr=2）；stream idle→`api_timeout`；mTLS 热更；region sanitize | 真网 e2e remint harness 非默认 |
| **232 其它** | MCP connect timeout（y0/Obf/ERA/probe）；sandbox.ripgrep 仅 user/managed/`--settings`；plugin install 先 refresh；`/code-review` high+ bg；OpenAI/Grok max prompt length→PTL | — |
| **233 MCP v2** | 产品路径 **`@modelcontextprotocol/client@2` + `server@2` 单栈**（listen reopen/park、BVa probe、string handlers、`mcpServerKeyHash`）；类型 re-export v2；auth 结构守卫 | **不 invent apps gateway**；agent-sdk 传递依赖仍可能带 sdk 1.x |
| **233 硬化 / UX** | cgroup `TOOL_MEMORY_LIMIT`；`WEBFETCH_CACHE_TTL_MS`；参数二次展开哨兵；`\??\` UNC；bare skills validate；`/effort` 读屏列表；Todo/Tds opt-in；GitHub tip 非 GH 隐藏；`cd && >` discard 目标 | — |
| **233 官方回滚** | **回滚 232 Cygwin symlink 写门 + Bash `< file` 产品门**；`TREE_SITTER_BASH` 不进 DEFAULT；`validateInputRedirections` residual 保留勿产品调用 | 待 densable narrower 版再接；**勿为 checklist 默认开回** |
| **Feature 默认** | 继承 229：**REACTIVE_COMPACT** + UDS/LAN/TEAMMEM/KAIROS 外围 ON | collapse/snip/ULTRAPLAN 仍 OFF；`FORK_SUBAGENT` compile 仍 optional |

#### densable 2.1.229 对齐说明（2.7.39，已并入）

对照文档：`docs/upstream-extraction/v2.1.229/official-229-checklist.md`（**HAVE 27 / N/A 5 / GAP 0**）、`changelog-2.1.229.md`。叠在 **2.1.228** 之上。**2.7.39** 在 229 产品线上补了 **DEFAULT_BUILD `REACTIVE_COMPACT`**（长会话 413/PTL withhold + try 恢复；**不含** CONTEXT_COLLAPSE / HISTORY_SNIP）与 densable **ex / Jsa / Rhe** 门控。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **上下文 / PTL** | #20 messages-only >32MB `request_body_over_limit`；#25 Ysa/bua「automatic compaction failed」；**`REACTIVE_COMPACT` 产品默认 ON**；try 经 densable **ex()**（=`isAutoCompactEnabled`）+ **Jsa**（source/$Ir/yAt）+ **Rhe**（remote GB） | **CONTEXT_COLLAPSE / HISTORY_SNIP** 仍 OFF；precompute swap 未 ship |
| **OAuth / 归因 / 1M** | #12 MCP OAuth `127.0.0.1`；#10 attribution `ignoreEnvOptOut` + auto-mode force；#11 subscriber 1M 仅 first-party/unix socket | — |
| **SHR / Windows** | #2 server launcher hooks；#23 GCM fail-fast；#29 win32 强制 `--base-dir`；#22 managed-mcp exclusive soft-skip | — |
| **插件 / 列表 / 流** | #4 marketplace `command`+`link`；#5 ListAgents offline/cloud；#6 VirtualMessageList keys；#16 plugin in-use markers | — |
| **工具 / 路径 / 空白** | #7 safeToolInput non-string；#8 ProgressBar/MarkdownTable clamp；#9 Windows `\\?\`/UNC strip；#19 stream-json blank gate | — |
| **工作流 / 其它** | #17 host cores 并发；#24 prefix stagger；#26 IPv6 doctor；#27 login OAUTH 复告；#28 commit-push-pr deny；#13/#14/#15/#18 RC/GH/diagnostics/cron | **#3** SSE host ping、**#21** Desktop OTEL、**#30–#32** VSCode **N/A** invent-ban |
| **Feature 默认** | **REACTIVE_COMPACT** + UDS/LAN/TEAMMEM/KAIROS 外围 ON | collapse/snip/ULTRAPLAN 仍 OFF |

#### densable 2.1.228 对齐说明（2.7.37，已并入）

对照文档：`docs/upstream-extraction/v2.1.228/official-228-checklist.md`（**HAVE 17 + PARTIAL 1 / GAP 0**；#12 core-only）、`changelog-2.1.228.md`、`cross-pack-residuals.md`。叠在 **2.1.227** 之上（中间 223–227 已并入 git；本 npm 线一次收口到 228）。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **Ink / 输入** | layout fault 立即 re-layout + reportLayoutFault*；**kTd** text 仅 whole-token SGR/X10 re-ESC；incomplete CSI 在 tokenizer buffer / NORMAL_TIMEOUT flush | 不 invent pendingSgr/absorbMm/2-param KE empty；KE progressive sinks = local delta |
| **Windows / SHR** | `uio` parent-of-Git where 过滤；checkout hook 非 push 跳过 + warn；follow-up hold + `countNonMonitorTasks`；emit→clear densable 序 | 不 invent clear-first / re-arm idle |
| **UDS / LAN / RC** | `key_publish_failed` 启动硬失败 + `CLAUDE_CODE_MESSAGING_TOKEN`；LAN TCP pre-auth + timing-safe；RC reattach owner meta / noHistoryBackfill；left-arrow stash bridge | 不 invent dual UDS token / pairing code |
| **技能 / 工具 / 云** | syncedSkills harden core（shadow/sanitize/no `!`/`@`）；Write/Edit Jqy/MCt + l8t `errorCode:13`（validateInput+call）；Vertex fail-fast + Bedrock GKd 接线；St mid-turn attachments | #12 **core only**（无完整 claude.ai ingest）；#3 `/tui` 仅 Bxa `--model` pin |
| **其它** | cleanup 保 memory；plugin symlink 不 orphan；marketplace ssn whole-entry；title ◐/◑；auto-mode 去掉 expensive 句；cross-session from-name；PR 本地订阅 store | **223 #3 teleport** invent-ban；**221 #12** DEP-HAVE（srt） |
| **Feature 默认** | **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS 外围** DEFAULT_BUILD **ON** | **ULTRAPLAN** 仍 OFF；`tengu_ccr_bridge` 不默认 true |

#### densable 2.1.222 对齐说明（2.7.36，已并入）

对照文档：`docs/upstream-extraction/v2.1.222/official-222-checklist.md`（**HAVE 21 / GAP 0**）、`changelog-2.1.222.md`。叠在 **2.1.221** 之上。**2.7.36** 在 222 发布线上修了 streaming residual：collapsed 工具组后的空 `●`（`hasContentAfter` 去掉 invent 的 `||streamingPreview`；whitespace / strip-empty 不画 XEl）。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **worktree / 权限** | 全会话 worktree isolation fences（file edits + Bash）；PreToolUse auto-allow 不绕过 `requireCanUseTool`；SendMessage auto-mode classifier；`disable-model-invocation` 请用户跑 skill | — |
| **流式 UI / 可靠性** | UNf/BNf/WNf/Qci streaming store；salvage 在 pH.clear 保留；close-after-complete 不误报 mid-response；gateway keep-alive ping；preflight proxy + 10s 超时；file watcher error teardown；SR EOL 删除；**2.7.36：空 streaming `●` / 假 past-tense “Ran N…”** | — |
| **RC / 设置 / host** | `remoteControlAtStartup`：project/local 不能开、可关；`flagSettings` + `projectSettingsAliasesUserSettings`；host model overlay 优先于 stale managed-settings | — |
| **工具 / 成本 / git** | MCP 份额仅计真消费；SendMessage summary 截断；tool-gone 仍展示；post-push PR link；raw git diff `--no-textconv`/`--no-ext-diff`；agent 族别名 step-down | — |
| **Feature 默认** | **ULTRAPLAN** 产品默认 OFF（`FEATURE_ULTRAPLAN=1` 可复活 residual） | **UDS_INBOX / LAN_PIPES / TEAMMEM** 默认 ON（2026-08-12）；**KAIROS 外围** channels/push/webhook 默认 ON；**ULTRAPLAN** 仍 OFF |

#### densable 2.1.219–2.1.221 对齐说明（2.7.37，已并入）

对照文档：
- `docs/upstream-extraction/v2.1.219/official-219-checklist.md`（**HAVE 24 / GAP 0**）
- `docs/upstream-extraction/v2.1.220/official-220-checklist.md`（public 1 行 N/A + SEA residual **HAVE**）
- `docs/upstream-extraction/v2.1.221/official-221-checklist.md`（**HAVE 35 / GAP 2 / N/A 2**）

叠在 **2.1.218** 之上。**历史 snapshot 叙述（见下表「故意不扩」列）**：旧文曾写 #10 constructor / #12 large-upload TLS 为 GAP。**现状**见 `docs/upstream-extraction/v2.1.221/official-221-checklist.md` 与 `cross-pack-residuals.md`：**#10 HAVE**（API-request null-proto/hasOwn；registry plain densable 1:1）；**#12 DEP-HAVE**（sandbox-runtime，非 CLI invent）。#1 VSCode Focus view / #38 gateway model 400 仍为 **N/A**。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **2.1.219 模型 / caps** | Opus 5 catalog（EHl/ON）+ 1M picker「Opus (1M context)」；nest depth 默认 3（hazel_trellis）；`workflowSizeGuideline`；stream-json nested `--forward-subagent-text`；Fable credits stale cache | — |
| **2.1.219 权限 / hooks / UX** | `sandbox.network.strictAllowlist`；`DirectoryAdded` hook；init `mcp_server_errors`；GIT_BASH basename 校验；Vim ← empty→agent view；SR 后缀 append；RC endpoint 点名；MCP policy `${VAR}` | — |
| **2.1.220 residual** | `isEntitlementOverlayUnavailable` / entitlement deny-set；`entitlement_blind` 遥测；blind opus-5 → opus-4-8 替身 | 官方 public 无逐条 product list（N/A） |
| **2.1.221 安全 / 权限** | sandbox credential `mode:"mask"`；zsh `[[ ]]` unquoted `&`；**PowerShell 引号路径 pWo fail-closed ask**；Bash U5e/cle `bareAssignmentNames` 全量（for 危险集 / declaration 旗标 / Pws·uVu）+ ZRu 只读 bare 字段；**#10 constructor API-request HAVE**（null-proto/hasOwn） | **#12 large-upload TLS** = **DEP-HAVE**（srt，非 CLI locus）；勿当 open GAP invent CLI handler |
| **2.1.221 会话 / 插件 / UI** | prompt-audit；session title sanitize；Vim yank 共享 / undo-to-empty；plugin install catalog refresh + reload 清 notice；`/status` session kind；Stats cache 分解；ultrareview no-branches；bg commit/draft-PR policy；Vertex ToolSearch native wire | **#1 VSCode Focus** N/A；**#38 gateway** N/A |
| **Feature 默认** | 构建默认 feature 集见 `build.ts` | **UDS_INBOX / LAN_PIPES / TEAMMEM** 默认 ON（2026-08-12）；**KAIROS 外围** channels/push/webhook 默认 ON；**ULTRAPLAN** 仍 OFF |

#### densable 2.1.218 对齐说明（2.7.33，已并入）

对照文档：`docs/upstream-extraction/v2.1.218/official-218-checklist.md`（**HAVE 35 / N/A 1 / GAP 0**）、`changelog-2.1.218.md`。叠在 **2.1.217** 之上。**禁止**写「36/36 solid HAVE」— #9 官方 gateway spend metering 为 **N/A**（go-hare 不发 gateway）；CLI cousin `application-inference-profile` 另计 HAVE。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **code-review / ultrareview** | `/code-review` bg subagent + stacked slash；`/code-review ultra` 非交互 cloud；`/ultrareview` 描述性参数 + 无效参数反馈 | — |
| **a11y / 输入** | SR 删除播报；VoiceOver 末尾空格；plugin/settings `declareCursor`；多行粘贴 Ctrl+J→换行；← 确认 + AgentView Esc 回原会话 | — |
| **权限 / auto-mode / sandbox** | dangerous-rm/`&`/Win path circuitBreaker；plan+auto RO Bash→classifier；sandbox IDE 命令 fail-closed；agent frontmatter hooks 需 workspace trust | — |
| **会话 / 引擎** | Host teardown phantom turn + sticky permissionLayers；假 interrupt 抑制；fork `logical_parent_uuid`；prompt history race；overflow 重试 + Ctrl+B shell caps | — |
| **云 / 远程 / IDE** | Bedrock setup assume-role/partition/proxy；CCR closed-gate 停 heartbeat；IDE selection mid-emoji + sibling_context_error；PR link flush 2s | — |
| **frontmatter / 技能 / 信任** | agent 名禁 `:`；fork skill 默认 background；布尔 yes/no/on/off/1/0；plugin `--config KEY=VALUE`；`/deep-research` 仅手动；trust 标 repository root + RC multi-env Add-server | **#9 gateway metering** N/A |
| **Ink / Agent Views（发版加固）** | skipSyncMarkers；unmount 不写 paused previous-output；无 empty-frame skip；Esc= densable JH done + O7 `suppressResumeHint`（不 attach-origin 黑屏） | UDS/LAN/TEAMMEM 默认 OFF |

#### densable 2.1.217 对齐说明（2.7.32，已并入）

对照文档：`docs/upstream-extraction/v2.1.217/official-217-checklist.md`（**HAVE 20 / GAP 0**）、`changelog-2.1.217.md`。叠在 **2.1.216** 之上。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **Caps / 预算** | concurrent subagents 默认 20；nested depth 默认 1（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` / hazel_trellis）；`--max-budget-usd` halt bg subagents | — |
| **paths brace** | frontmatter brace budget（Xug=1000 / Jug=4MB）；超限 unexpanded + warn | — |
| **Hyperlink / tips / login** | `FORCE_HYPERLINK`；frontend-design tip 终身 ≤3；login-expiry 警告 3 天 | — |
| **emoji** | shortcode typeahead + `emojiCompletionEnabled` | — |
| **bg isolation #5** | cwd 符号链接 canonicalize（`eq`/`N6g`/`XNe`/`hsr`）；Shell `context_lost`→`worktree_gone`→VRu→bash ZRu；`bareAssignmentNames`+YPg/FJi/tLg；Write e7 / Edit·Notebook e12 | **U5e 解析失败本地更严**（`parse-unavailable` fail-closed，非 densable 空 simple） |
| **可靠性** | transcript writer ENOSPC；MCP truncate 不回灌 full；Opus 4.8 Bedrock 1M；SR 启动 quiet；managed OTEL endpoint 统管；malformed attachment resume；attach footer gap；Win absolute taskkill | UDS/LAN/TEAMMEM 默认 OFF |

#### densable 2.1.216 对齐说明（2.7.31，已并入）

对照文档：`docs/upstream-extraction/v2.1.216/official-216-checklist.md`（**HAVE 38 / N/A 1 / GAP 0**）、`pack-report.md`、各 extract。叠在 **2.1.214/215** 之上。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **Sandbox** | `sandbox.filesystem.disabled`（跳过 FS 隔离、保留网络 egress）；credentials 一等公民 | — |
| **长会话 / 归一化** | message normalize 二次方优化（Map + cursor）；`/context` 超窗警告；失败 compact 标 error | — |
| **Auth / auto mode** | OAuth 401 sideQuery 重试；AskUser free-text 中立措辞；Chrome 缺 scope 403 循环；MCP re-auth 不提前吊销 | — |
| **worktree / bg** | git 隔离（防 `git -C`/`GIT_DIR` 指回 shared checkout）；foreign-repo resume；无 git worktree 可删；daemon `stop --any` 不误杀；resume agent identity；bg startup cancel 免疫 interrupt | — |
| **权限 / Shell / PS** | list/negation redirect；Win 网络路径 RO 弹窗；非 ASCII 词边界；PS 不可见 Unicode；git/gh 参数加强 | — |
| **UI / 会话 UX** | @-mention/hooks/vim paste/statusline/resume-picker；Esc-Esc rewind；agent list Ctrl+X 删除；GUI 编辑器 handoff；fullscreen dialog/config/footer；skill 菜单热刷新；plugin skill 前缀；fork 一行确认 | — |
| **其它** | `/rewind` 不经 symlink/hardlink；ultrareview 体积/empty-diff；spend-limit reason；telemetry user_abort；needs-input park；dataviz palette；cloud interrupted turn re-run | **#39 VSCode RTL** N/A；UDS/LAN/TEAMMEM 默认 OFF |

#### densable 2.1.215 对齐说明（已并入 2.7.31）

对照文档：`docs/upstream-extraction/v2.1.215/official-215-checklist.md`（**HAVE 2 / N/A 1 / GAP 0**）。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **Skills 策略** | `/verify`、`/code-review`：`disableModelInvocation: true` + 用户仍可 `/` 调用 | **不**误改 `/simplify`（仍可被模型调用）；verification agent 文案 N/A |

#### densable 2.1.214 对齐说明（2.7.30，已并入）

对照文档：`docs/upstream-extraction/v2.1.214/official-214-checklist.md`（**HAVE 47 / GAP 0**）、各 batch extract。在 **2.1.212** 收口之上叠 214 安全阀 / EndConversation / PS·Bash / bg daemon / RC ready-push 等。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **权限 / Bash / PS** | 单段 `dir/` allow cwd-only；PS 5.1 bypass；fd redirect fail-closed；>10k prompt；zsh `[[ ]]`；help/man；docker daemon-redirect；PS stdin/encoding/where·fc·diff | — |
| **会话 / 工具** | EndConversation；长工具 progress heartbeat；stream cost 双计修复；advisor network stall；hooks exit 2 优先 | — |
| **GrowthBook / OAuth** | null/畸形 payload 不崩不清缓存；OAuth 轮换后 refresh flags | — |
| **bg daemon** | yield 不删继任 control socket；idle retire；`claude rm`/AgentView deleteJob；非 git force 删；transcript 目录伪命中 | — |
| **RC ready-push** | 仅显式 RC + GB nudge；拒绝 outbound/reattach/bg/agentId；impression 计数；`onInteraction` 活动闩 | 不扩 KAIROS 其它产品面 |
| **OTel / MCP / 其它** | message.uuid / client_request_id / tool_source；OTEL content max；out-of-context trace；MCP list_changed 保留；flag settings plugins；ultrareview empty-tree；SessionStart `source:"fork"` 等 | — |
| **Feature 默认** | 构建默认 feature 集见 `build.ts` | **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS 外围** 默认 ON（2026-08-12）；**ULTRAPLAN** 仍 OFF |

#### densable 2.1.212 对齐说明（2.7.29，已并入）

对照文档：`docs/upstream-extraction/v2.1.212/official-212-checklist.md`（**HAVE 44 + N/A 1，0 GAP**）、`pack-report.md` closeout、`residual-qre-jes-2026-08-06.md`。

| 面 | 已 1:1 落地 | 故意不扩 / 不动 |
| -- | ----------- | --------------- |
| **会话安全阀** | WebSearch / subagent 默认 200 + env；`/clear` 重置；MCP 长调用自动后台（默认 2min / env） | — |
| **`/fork` · `/subtask`** | `/fork` = 后台会话副本 + keepParent；原会话内 full-context 工人 = `/subtask` | 不把 legacy in-session 仍叫 `/fork` |
| **Agents UX** | agent-view `/resume` picker→bg；重开 stopped；冷 attach transcript；footer `N done`；**Needs input** | — |
| **`claude auto-mode reset`** | 确认提示 + `--yes` | — |
| **可靠性 / UX 批次** | plan bash 写权限、worktree 符号链接、hook `continue:false`、print SIGTERM 143、Win PS7 bg、shell `!` 路径、btw 重开、SendMessage 预览、Web 529、mid-conv cache 等（见 checklist） | 不补 **2.1.210** collapsed-tool 实时 elapsed（邻版） |
| **ultrareview / teleport** | Qre 创建仍 `POST /v1/sessions`；OTe/KLc/H8/F1g/nts 走 `/v1/code/sessions`；o9t token、payload wrap、archive=kill | 主 CLI 不发明 densable 未注册的 `--project/--ref/--on-branch` 旗标（中间层 rts 已就绪） |
| **Feature 默认** | 构建默认 feature 集见 `build.ts` | **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS 外围** 默认 ON（2026-08-12）；**ULTRAPLAN** 仍 OFF |

### 近期更新（2.7.5 → 2.7.46）

| 版本 | 要点 |
| ---- | ---- |
| **2.7.46** | **densable 2.1.236–2.1.238**：236 HAVE 20 / PARTIAL 12（`ANTHROPIC_DEFAULT_MODEL`、`notify_when_idle`、sandbox deny、fullscreen fallback、goal check-in、`/model` `LFh`/`sgM`）；237 HAVE 3（`canMarkApiSystem`、Concise、`r7` truncate）；238 HAVE 34 / PARTIAL 5（`keybindingFlavor`、marketplace/MCP `headersHelper`、runner defer-shutdown / Proxy-Authorization、isolation pin、RC Stop/sign-out/403、update check 10s）。并接回官方 238 仍保留的 **234 leftover**（stale Enter、SendMessage `to`/truncated、`GGc`、session persist、markdown `d0l`）。不 invent leftover #3 / G0S / chrome UI。 |
| **2.7.45** | **densable 2.1.235（HAVE 18 / N/A 1）** + tip **2.1.234** quota auto-resume：spellcheck / LSP latch / md-list / highlight / Shift+Tab cycleMode / Agent GP 门 / notebook+**Edit/Write contentWithheld** / slash oX / update footer / tasklist expand / cloud CPU / suppressAlways / rg 15.x / autocompact-off / vim cursor / dialog race / SendMessage size / rc gateway + **cloud-session mX 门**；CLI IDE bridge `uSm`；quota rearm `HEv=2`。**#19 VSCode host focus N/A**。 |
| **2.7.44** | **teammate 默认模型跟随 leader**：`teammateDefaultModel` unset/null 经 leader → `mainLoopModel` / `ANTHROPIC_MODEL` 解析，硬编码 Opus 仅最后兜底；Config/ModelPicker 文案对齐；向 teammate 转发 `ANTHROPIC_MODEL` 与 `ANTHROPIC_DEFAULT_*_MODEL`。 |
| **2.7.43** | **densable 1:1 审查收口 + 兼容层 PTL**：thinking-only re-stream 前 credit session cost；G7 mint-time `cse_*` 放弃/teardown 清理（reattach 暂态保留）；`epoch_stale`-only Ot（`epoch_conflict` 不进 Ba remint）；OpenAI/Grok/Gemini catch 经 `getAssistantMessageFromError`，`maximum prompt length` 可进 reactive compact。 |
| **2.7.42** | **MCP tools/list 边界 + residual cast 收口**：`listToolsResult` 统一 wire 边界（chrome/weixin `as unknown as ListToolsResult`）；`createSdkMcpServer` densable `cr4` registerTool 无 cast；`entrypoints/mcp.ts` tools/call 对齐 `coerceInput`→`safeParse`→`validateInput`→`call`；`DensableAjvJsonSchemaValidator implements jsonSchemaValidator`；channel enqueue `origin` 无 `as any`。 |
| **2.7.41** | **MCP v2 residual 收口**：全量 densable string `setNotificationHandler`（channel/IDE/VSCode/print enable+reconnect）；`ctx.mcpReq` / elicitation complete 守卫顺序；type residual（deny source keys、callTool 二元、GB boolean）；测试隔离 process-global `mock.module`/env。 |
| **2.7.40** | **densable 2.1.231–2.1.233 收口**（无官方 2.1.230）：**231** MCP OAuth 预注册 redirect FLv（`localhost` + port 复用 + preserveClient）；**232** HAVE 45 / N/A 4 — fork 默认、@mention/SendMessage 裸名、session 名唯一、GitLab token/marketplace、PS/nested-git、MCP connect timeout、RC remint/G7 `cse_*`、thinking-only re-stream、OpenAI/Grok PTL、sandbox.ripgrep 源限制等；**233** HAVE 14 — MCP **client@2/server@2 产品单栈**、cgroup 内存、WebFetch TTL、`\??\` UNC、Todo/Tds、`/effort` a11y；**官方回滚 232 Cygwin + Bash `<` 产品门**（residual 保留）。N/A：gateway / Desktop Notification / Cowork。 |
| **2.7.39** | **densable 2.1.229（HAVE 27 / N/A 5 / GAP 0）** + 产品默认 **`REACTIVE_COMPACT`**：长会话 413/PTL withhold + try 恢复（Ysa/bua #25；messages >32MB unrecoverable #20）；try 门控 densable **ex/Jsa/Rhe**；OAuth `127.0.0.1`、attribution force、SHR launcher hooks/GCM/base-dir、plugin command 源、ListAgents offline/cloud、safeToolInput、UNC path、workflow host 并发/prefix stagger、IPv6 doctor、commit-push-pr deny 等。N/A：#3 SSE host、#21 Desktop OTEL、#30–32 VSCode。**不含** collapse/snip。 |
| **2.7.38** | **Grok 4.6 推理档 catalog**：按模型 ID 最长匹配加 `grok-4.6` 行（不按厂商启发式）。官方 [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)（2026-08-12）：`grok-4.6` 为 `low \| medium \| high \| xhigh`（默认 `high`）；`grok-4.5` 仍三档（xhigh 当 high）。另有 `grok-4.20-reasoning` 三档、`grok-4.20-multi-agent` 含 xhigh（agent count）。`queryModelGrok` 对**映射后** id 发 Chat Completions `reasoning_effort`。不加裸 `grok-4` / `grok-4.20` 行。 |
| **2.7.37** | **densable 2.1.228（HAVE 17 + PARTIAL 1 / GAP 0；#12 core-only）** + 已并入 223–227：Ink layout recover；kTd whole-token re-ESC + incomplete buffer；Windows `uio`；SHR checkout skip + follow-up hold；UDS `key_publish` fail-closed + LAN TCP auth；RC reattach owner / left-arrow；syncedSkills harden core；Write/Edit Jqy/MCt+l8t；Vertex fail-fast + Bedrock GKd；St mid-turn；cross-session from-name；cleanup memory / plugin symlink / marketplace ssn；`/tui` model pin；title ◐/◑；auto-mode 去 expensive；DEFAULT_BUILD **UDS/LAN/TEAMMEM/KAIROS 外围 ON**；221 #10 null-proto + createSdkMcpServer。跨 pack 残差见 `cross-pack-residuals.md`（teleport invent-ban）。 |
| **2.7.36** | **streaming 空 `●` hotfix（densable 222 residual）**：`hasContentAfter` 对齐 densable `y\|\|aem`（去掉 invent `\|\|streamingPreview`）；whitespace / strip-empty 不画 XEl；`Qci` trim-empty 清 `STREAM_FLAG_DISPLAYED`。避免 collapsed 工具组后假 past-tense「Ran N…」+ Cooking 前 lone bullet。 |
| **2.7.35** | **densable 2.1.222 全量 1:1（21/21 HAVE）** + 已并入 219–221：全会话 worktree isolation；streaming UNf/WNf/Qci + salvage clear 契约；RC `remoteControlAtStartup` 源限制（flag/aliases）；host model overlay；ULTRAPLAN 产品 OFF；preflight proxy 超时；MCP 份额归因；SendMessage classifier/截断；tool-gone 展示；post-push PR link；raw git diff；agent 族 step-down；SR EOL 删除；file watcher teardown 等。并入 219 **24/24** / 220 residual / 221（发版时 snapshot **HAVE 35 / GAP 2 / N/A 2**；**之后** #10→HAVE、#12→DEP-HAVE，见 checklist / cross-pack-residuals，**勿当现状 GAP**）。UDS/LAN/TEAMMEM 发版时默认 OFF（后翻 ON）。 |
| **2.7.33** | **densable 2.1.218 全量 1:1（35 HAVE / 1 N/A / 0 GAP）**：code-review bg + ultra cloud；ultrareview 描述/无效参数；SR a11y / Ctrl+J / ←确认 / AgentView Esc；Host teardown + permissionLayers；auto-mode/sandbox IDE；fork lineage；Bedrock wizard；CCR heartbeat；frontmatter 布尔/`--config`/禁 `:`；`/deep-research` 仅手动；RC multi-env trust。**#9 gateway metering N/A**。发版加固：Ink skipSyncMarkers/unmount/alt-screen；Agent Views Esc 不 attach-origin 黑屏 + O7 退出。UDS/LAN/TEAMMEM 默认 OFF。 |
| **2.7.32** | **densable 2.1.217 全量 1:1（20/20 HAVE）**：subagent concurrent 20 / nest depth 1；brace budget；`FORCE_HYPERLINK`；emoji shortcode typeahead；tip lifetime 3；login 3d；transcript ENOSPC；MCP truncate；Opus 4.8 Bedrock 1M；SR startup quiet；managed OTEL；malformed attachment；attach footer gap；Win taskkill；bg isolation `eq`/`N6g`/`ZRu` bare+YPg（ZRu 仅 Shell.exec）。**故意更严**：parse-unavailable fail-closed。UDS/LAN/TEAMMEM 默认 OFF。 |
| **2.7.31** | **densable 2.1.215 + 2.1.216 收口**：215 `/verify`·`/code-review` 禁止模型自启（HAVE 2）；216 **HAVE 38 / N/A 1 / GAP 0**（sandbox.filesystem.disabled、长会话 normalize、auto-mode 401、worktree git 隔离、daemon stop --any、bg/agents UX、Win 网络路径、fullscreen UI、skill 菜单热刷新、`/rewind` symlink 安全等）。故意不扩 UDS/LAN/TEAMMEM；VSCode RTL N/A。 |
| **2.7.30** | **densable 2.1.214 全量 1:1（47/47 HAVE）**：权限/Bash/PS 安全阀；EndConversation；tool heartbeat；GrowthBook null payload + OAuth flag refresh；bg daemon control-socket/retire/deleteJob；RC session-ready push 门闩；stream cost / advisor stall / hooks exit2 / OTel / MCP list_changed 等。故意不扩 UDS/LAN/TEAMMEM。 |
| **2.7.29** | **densable 2.1.212 收口**：官方 48 条 0 GAP；`/fork` keepParent + `/subtask`；会话 caps / MCP auto-bg / auto-mode reset；ultrareview + Qre/code-sessions（OTe/KLc/H8/F1g/nts）1:1。故意不扩 UDS/LAN/TEAMMEM。 |
| **2.7.28** | **Win 打包剪贴板贴图**：`bun --compile` 下 sharp 原生模块不可用时改走 System.Drawing 缩放/JPEG；dev 仍用 sharp。 |
| **2.7.27** | **Prompt 通知条高度**：绝对定位区 height 2→1，避免最新通知盖住 prompt 顶边框（如剪贴板图片 `alt+v` 提示）。 |
| **2.7.26** | **Win 剪贴板图片粘贴**：Git Bash 下 PowerShell `shell:false` argv；空 paste 开 Windows；优先 PNG 流；客户端 ≥8px 拦截 1×1；Buddy/KAIROS 文档对齐 densable 211。 |
| **2.7.25** | **Host densable 211 生产路径**：永久 `model_not_found` → `system/model_fallback`；`system/background_tasks_changed`（REPLACE live set）；mid-bg `didBackground` 真 flip；eviction 保 Host progress 事件。 |
| **2.7.24** | **Official 2.1 Host 流/控制 + bypass 1g**：`command_lifecycle` / `thinking_tokens` / `task_updated` / `task_summary` / `background_tasks`（Ctrl+B）对齐；mid-bg 发 `task_updated`；`backgroundAll` 排除 main-session；bypass 下 `classifierApprovable` safetyCheck 可过（densable 1g）。 |
| **2.7.23** | **Tasks dual-emit**：agent/shell/monitor/dream/workflow 终止时 once-gated 发 `system/task_notification` bookend（含 ISO `timestamp`），Host Tasks 可按 densable Jp 结算；print residual 再发一次-gated，不再只靠 TaskOutput 冒充生命周期。 |
| **2.7.22** | **REPL 更新提示 / go-hare 自动升级路径**：去掉 `ENABLE_AUTOUPDATER` 默认关闭；`autoUpdates=false` 仍 toast「Update available」；Notifications 挂载 AutoUpdater；npm 包二进制识别为 `npm-global`；`claude update` 使用 `@go-hare/claude-code`。 |
| **2.7.21** | **Workflow / ultracode densable 对齐**：完整 playbook 挂在 Workflow 工具 prompt（ONLY-call-when opt-in）；`/ultracode` 改为 `disableModelInvocation` 用户只读，去掉宽 whenToUse 自举路径。 |
| **2.7.20** | **Workflow host densable 对齐**：`/workflows` 改为历史浏览器（GsK）；live 监控走 Tasks `WorkflowDetailDialog`（fv_）+ `task.workflowProgress`；删除双栏 `WorkflowsPanel`；补 progress fold / SDK `task_progress` 桥接与 history 导航键位修复。 |
| **2.7.19** | **Provider 优先级修复**：`modelType=anthropic` 不再被残留 `USE_OPENAI` / `USE_GEMINI` / `USE_GROK` 等环境变量抢优先级。 |
| **2.7.18** | **Chrome multi-browser 无 OAuth**：无 OAuth 时也暴露并支持本地 multi-browser 工具（对齐 densable 本地 Chrome MCP 能力）。 |
| **2.7.17** | **Claude in Chrome 扩展链路**：默认放行 agent-extension fork ID、可追加扩展白名单；本地扩展下载改走 go-hare/agent-extension release；Install local 打开仓库页；`/chrome` 去掉 (Beta) 后缀。 |
| **2.7.16** | **Host effort 元数据**：`get_settings.applied` 增加 `effortLevels` / `ultracodeOfferable`，桌面端可据此渲染可用 effort 档位与 ultracode 入口。 |
| **2.7.15** | **Host Effort/Ultracode 链路**：densable Host `get_settings.ultracode` + `apply_flag` 直写；`eee` 剥 fence 再 parse，fenced JSON 不再刷 ERROR。 |
| **2.7.14** | **贴图降级修复**：图片 resize 失败时降级为文本提示，不再整轮吞消息。 |
| **2.7.13** | **贴图 Enter 抢键修复**：贴图时清 footer，避免两个 shell 同时响应 Enter 吞消息；Fable consent 拒绝时不再错误写入 sticky effort / N9。 |
| **2.7.12** | **贴图后打字吞消息修复**：共享 live ref，避免贴图 pill 后被同 tick 键入冲掉；Enter 路径进一步对齐。 |
| **2.7.11** | **Effort densable 对齐**：模型驱动 effort resolve、ultracode 会话模式、ModelPicker pin 约定、effort pin 落盘；粘性滚动白屏与 effort toast 同 key 刷新修复；文字+图片同 tick Enter 吞消息修复。 |
| **2.7.10** | **Shell 对话框 hooks 崩溃修复**：打开 BackgroundTasksDialog 时 PromptInput 的 `onKeyDownBefore` useCallback 位于 early return 之后导致 "Rendered fewer hooks than expected"；钩子上移 + onDoneEvent 延后触发。 |
| **2.7.9** | 全平台二进制重编发布（含 2.7.8 Enter 吞消息修复等当前 main）。 |
| **2.7.8** | **Enter 偶发吞消息修复**：对齐 densable Enter 路径（typeahead / history search / PromptInput），避免提交键在部分状态下丢输入。 |
| **2.7.7** | **OpenAI 兼容流多 ● 修复**：坏代理对每个 chunk 重发全文并带 `finish_reason` 时，不再反复开闭 text block（`normalizeMessages` 一行一个 ●）；累计全文 delta 只 emit 后缀；assemble 侧合并相邻相同 text block 作防御。 |
| **2.7.6** | densable streaming 对齐：Esc 仅 salvage thinking；streaming / final 双 ● 渲染修复；daemon lifecycle 只 log 不写 stderr；agents handoff 期间 quiet daemon takeover。 |
| **2.7.5** | densable FileEdit/FileWrite 结果渲染；spinner 用主线程队列长度（避免 subagent 假转）；idle-return 不清草稿；OSe 剪枝不写 paste ref。 |

---

## 安装（npm）

发布包名：**`@go-hare/claude-code`**（平台二进制在 `@go-hare/claude-code-<os>-<arch>` optionalDependencies）。

```sh
npm i -g @go-hare/claude-code

# Windows 若 claude.exe 被占用导致 EBUSY，先结束占用进程再装
# taskkill /F /IM claude.exe

claude                 # 启动（postinstall 落到 bin/）
claude --version
claude agents          # 后台会话 dashboard（需 daemon）
claude update          # 更新

# 自托管 Remote Control 示例（按你的 RCS 改 URL / token）
CLAUDE_BRIDGE_BASE_URL=https://your-rcs.example/ \
CLAUDE_BRIDGE_OAUTH_TOKEN=your-token \
claude --remote-control
```

安装失败时：`npm rm -g @go-hare/claude-code` 后再装 `@latest`（可钉版本 `@2.7.17`）。  
旧文档里的全局包名 `claude-code` **不再**对应本仓库发布流。

---

## 源码开发

### 环境

需要较新的 [Bun](https://bun.sh/)（建议 ≥ 1.3.11）：

```bash
curl -fsSL https://bun.sh/install | bash   # macOS / Linux
# Windows: powershell -c "irm bun.sh/install.ps1 | iex"
bun upgrade
```

### 安装与运行

在**仓库根目录**（含本 `package.json` 的目录）：

```bash
bun install
bun run dev          # 开发模式（MACRO.* 由 scripts/dev.ts 注入）
bun run build        # 代码分割产物 → dist/cli.js + chunks
bun run precheck     # typecheck + biome fix + 全量测试（改完请跑）
```

跨平台二进制与发布：

```bash
bun run build:compile                          # 仅编译当前/指定平台二进制
bun run scripts/publish.ts --build-only        # 同上（publish 脚本路径）
bun run scripts/publish.ts --dry-run           # 构建 + npm publish --dry-run
bun run scripts/publish.ts --with-main         # 含主包 @go-hare/claude-code
```

> 平台包内的 `claude` 二进制由 build 生成，**不应**长期提交进 git。

### `/login` 配置模型

REPL 中 `/login` 可选 Anthropic Compatible / OpenAI / Gemini 等：

| 字段 | 说明 | 示例 |
| ---- | ---- | ---- |
| Base URL | API 地址 | `https://api.example.com/v1` |
| API Key | 密钥 | `sk-xxx` |
| Haiku / Sonnet / Opus | 模型 ID 映射 | 按你的上游填写 |

Tab / Shift+Tab 切字段，Enter 确认。

### Feature Flags

```bash
FEATURE_BUDDY=1 bun run dev
```

构建默认会打开一批 flag（见 `build.ts` / `scripts/defines.ts`）。**现默认 ON**：`UDS_INBOX` / `LAN_PIPES` / `TEAMMEM` / `KAIROS`+外围（channels/push/webhook）。仍默认关闭：`FORK_SUBAGENT`、`ULTRAPLAN` 等。

### VS Code 调试

TUI 需真实终端，用 attach：

```bash
bun run dev:inspect   # 输出 ws://localhost:… 
```

VS Code F5 → **Attach to Bun (TUI debug)**。

### Teach Me

```text
/teach-me Claude Code 架构
/teach-me React Ink 终端渲染 --level beginner
```

进度在 `.claude/skills/teach-me/`（若已安装该 skill）。

---

## 仓库结构（精简）

| 路径 | 作用 |
| ---- | ---- |
| `src/entrypoints/cli.tsx` | 真入口与快速路径 |
| `src/main.tsx` | Commander CLI 与启动装配 |
| `src/screens/REPL.tsx` | 交互 REPL |
| `src/query.ts` / `QueryEngine.ts` | API 查询与 turn 编排 |
| `packages/builtin-tools/` | 内置工具 |
| `packages/@ant/ink/` | 终端 Ink 框架 |
| `src/bridge/` / `packages/remote-control-server/` | Remote Control |
| `src/daemon/` | 长驻 daemon |
| `src/services/acp/` / `packages/acp-link/` | ACP |
| `scripts/publish.ts` | 平台二进制编译与 npm 发布 |
| `CLAUDE.md` | 给 agent / 贡献者的详细工程说明 |

更完整的架构与测试约定见 [`CLAUDE.md`](./CLAUDE.md)。

---

## Contributors

<a href="https://github.com/go-hare/claude-code-1/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=go-hare%2Fclaude-code-1&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
  </picture>
</a>

## 致谢

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — 豆包 ASR，Voice Mode 可选路径

## 许可证

仅供学习研究。Claude Code 相关权利归 Anthropic。请遵守上游与依赖的许可条款。
