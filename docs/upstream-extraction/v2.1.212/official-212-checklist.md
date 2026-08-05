# densable 2.1.212 — 官方更新清单 × go-hare 对照

> 来源：用户提供的官方 2.1.212 release notes（与 upstream CHANGELOG `## 2.1.212` 一致）。  
> 基线：产品 2.7.27 / git `3dbad654`。  
> 状态图例：**GAP** 未对齐 · **PARTIAL** 有半截 · **AUDIT** 需对照 densable 再判 · **HAVE** 已有/非本版目标 · **LOW** 可选 cherry-pick

| # | 官方条目 | 状态 | 本地备注 |
|---|----------|------|----------|
| 1 | **`/fork` → 复制对话到新后台会话**（`claude agents` 单独一行，主会话继续）；原会话内子代理改 **`/subtask`** | **HAVE** | 2026-08-05 densable `nZ_→L2p→D$t keepParent` + residual-3 + P0–P1：L2p `Forking…`、`kei/Iei`、`Hei/xei` sticky、`gXe/rti`、`D6e` leaf、dual reg live、gwd/subtask agentId toast、bgIsolation/git/permission-mode/memory。extract: `keepParent-fork.extract.md` |
| 2 | **`claude auto-mode reset`**（确认提示，`--yes` 跳过） | **HAVE** | 2026-08-05 densable `PbS`：`autoModeResetHandler` + `--yes`；userSettings 删 `autoMode` |
| 3 | **WebSearch 会话上限** 默认 200，`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` | **HAVE** | densable `vtu`+soft return；`sessionSpawnCaps` + WebSearchTool |
| 4 | **子代理 spawn 上限** 默认 200，`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`；`/clear` 重置 | **HAVE** | densable `Etu`+throw；AgentTool `N()` + `/clear` reset |
| 5 | **MCP 调用 >2min 自动后台**，`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | **HAVE** | densable `Ncy`/`$cy`：默认 120s GB on；wired in mcp `client.ts` via monitor_mcp |
| 6 | **Agent view `/resume`**：含已删列表项的 picker → 作后台会话恢复 | **AUDIT** | agents/LogSelector 需对照 densable |
| 7 | Plan mode 不再自动跑改文件类 Bash（`touch`/`rm`…），需权限或 SDK `canUseTool` | **AUDIT** | permission / plan mode 路径 |
| 8 | worktree 创建不跟随仓库内 `.claude/worktrees` 符号链接（防写出仓外） | **AUDIT** | EnterWorktree |
| 9 | hook `continue:false` 在 tool 失败/中流完成时不丢 halt；hook 基建错误 ≠ 用户拒绝 | **AUDIT** | `src/utils/hooks.ts` 有 continue 相关，需 densable 对照 |
| 10 | print/SDK 下 Bash + SIGTERM：中止 turn、杀进程树、exit **143** | **AUDIT** | BashTool / gracefulShutdown |
| 11 | Windows `/background` & `--bg`：GP 禁 PS5.1 时 `uv_spawn` → 守护进程优先 **PS7** | **AUDIT** | daemon/bg |
| 12 | shell mode `!`：路径 autocomplete 打开时仍能执行含路径命令 | **AUDIT** | PromptInput |
| 13 | auto-mode 拒绝通知截断半个 emoji 不乱码 | **LOW** | UI |
| 14 | agent view 调度输入 Ctrl+J 换行 + `?` help 展示 | **LOW** | agent view |
| 15–18 | `/ultrareview`：PR 引用、远程 branch fetch、`/clear` 后计费确认、Desktop 非 git 文案 | **LOW/N/A** | 产品是否有 ultrareview 再定 |
| 19 | 托管会话：忽略 repo settings 的 mTLS/extra CA/OAuth scopes + 警告 | **AUDIT** | hosted / settings |
| 20 | resume 后编辑曾 offset/limit 读过的文件 → 假 “File has not been read yet” | **AUDIT** | FileEdit / read tracker |
| 21 | print/SDK `--continue`/`--resume` 后 `ExitWorktree` “no active EnterWorktree” | **AUDIT** | ExitWorktreeTool 存在 |
| 22 | Remote Control 中途加入 → workflow agent 网格空 | **AUDIT** | RC + Workflow |
| 23 | streaming control 请求 handler 未完就 mark complete → 重启丢请求 | **AUDIT** | control / stream-json |
| 24 | `/fork` 建的后台会话 state 写失败后丢 live-parent 保护 | **HAVE**（随 #1） | keepParent：先 snapshot 再 writeA8q；snapshot/write 失败 rm jobDir 且不伤 parent transcript；`forkSourceAlive:true` |
| 25 | 从 agent view 重开已停后台会话：resume 或说明原因+强制重启 | **AUDIT** | bg agents |
| 26 | agent teams：停止中 teammate 重复 idle 通知 | **AUDIT** | swarm in-process |
| 27 | plan 审批 footer 长路径拆开 “ctrl+g to edit” | **LOW** | UI |
| 28 | fullscreen 欢迎 banner 宽高同时 resize 后宽度不更新 | **LOW** | FullscreenLayout |
| 29 | 窄布局 diff 丢行号 / +/- | **LOW** | diff UI |
| 30 | @-mention 部分读后空附件；plugin 卸载错 marketplace；exit 143 假 “Command timed out” | **AUDIT** | 多点 |
| 31 | OTel HTTP 非 chunked（Azure Monitor 411/400） | **AUDIT** | OTel exporter |
| 32 | OTLP + TRACEPARENT 缺 trace_id/span_id（SDK/headless） | **AUDIT** | OTel |
| 33 | 多图对话误 “Request too large” + 更好错误文案 | **AUDIT** | API client |
| 34 | WebSearch/Fetch 过载时别把 “API Error” 当结果正文 | **AUDIT** | web tools |
| 35 | WebSearch/Fetch 重试 529 + rate-limit 有界 backoff | **AUDIT** | web tools |
| 36 | prompt cache：中段 system block 在 gateway/自定义 baseURL 可用 | **AUDIT** | 211 相关 cache 工作可能部分重叠 |
| 37 | 后台 agent 冷 attach 立即显示格式化 transcript | **AUDIT** | attach |
| 38 | `SendMessage` 正文不重复进 replay history / tool results | **AUDIT** | teammate messaging |
| 39 | `/fork` 无标题时用 prompt 命名副本行 | **HAVE**（随 #1） | `resolveForkSessionName` / `deriveForkName` + densable glyph+prompt label |
| 40 | bare `/btw` 重开最近 side-question 面板 | **AUDIT** | `src/commands/btw` |
| 41 | `←` footer 在 bg agent 完成时短暂闪 `N done` | **AUDIT** | agents footer |
| 42 | Task/`Agent` **`mode` 参数废弃**（忽略）；子代理默认继承父 permission mode | **AUDIT** | AgentTool schema |
| 43 | Enterprise `forceLoginMethod` 扩到 VS Code / SDK / setup-token / install-github-app | **AUDIT** | settings `forceLoginMethod` 存在 |
| 44 | transcript 记录每条 assistant 的 **reasoning effort** | **AUDIT** | effort 链路 |
| 45 | headless/SDK 中途 `set_model` 下轮即生效 | **AUDIT** | controlSchemas 有 set_model 相关 |
| 46 | agents view / `--json`：等 sandbox/MCP-input/managed-settings → **“Needs input”** 非 “Working” | **AUDIT** | fleet/agents |
| 47 | Auth 面板标题 “Cloud authentication” → **“Authentication”** | **LOW** | OAuth UI 文案 |
| 48 | 2.1.200 说明勘误：tmux 3.6 无 synchronized output | **N/A** | 文档勘误 |

---

## 推荐实施批次（仍 extract-first）

### Batch 1 — 安全阀（#3 #4 #5）
会话级 WebSearch / subagent 上限 + MCP 长调用自动后台。风险低、与 UI 语义解耦。

### Batch 2 — Fork 语义分裂（#1 #24 #39）
- `/fork` = bg session copy + `deriveForkName` + live-parent  
- `/subtask` = 现有 in-session full-context fork（AgentTool / `spawnForkFromDirective` 会话内路径）  
- 文档 `fork-subagent.md` 同步改写  

### Batch 3 — Agents 体验（#6 #25 #37 #41 #46）
`/resume` picker、重开 stopped session、冷 attach transcript、`N done`、Needs input。

### Batch 4 — 可靠性 cherry-pick（#7–12 #20–23 #33–36 #38 #42–45）
按痛点选做；每项先 binary extract，禁止“简化版”替代。

### 暂不默认开
UDS_INBOX / LAN_PIPES / TEAMMEM；KAIROS 不再动；不把 214 EndConversation 混进 212。

---

## densable 关键常量（已从 2.1.212 二进制确认）

| 符号/env | 值 |
|----------|-----|
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | default **200** (`qpg`) |
| `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` | default **200** (`zpg`) |
| `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | 配置阈值；changelog **2 minutes** 默认行为需 call-site 再确认 |
| taskRegistry | `increment/get/reset` × (AgentSpawns, WebSearchCalls) |
| `/fork` / `/subtask` | 共用 `spawnForkFromDirective`（`xZr`）；description 不同 |

完整 pack：`docs/upstream-extraction/v2.1.212/pack-report.md`
