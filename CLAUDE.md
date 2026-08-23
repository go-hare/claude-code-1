# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other AI coding agents when working with code in this repository.

## Project Overview

This is a **reverse-engineered / decompiled** version of Anthropic's official Claude Code CLI tool. The goal is to restore core functionality while trimming secondary capabilities. Many modules are stubbed or feature-flagged off. TypeScript strict mode is enforced — **`bun run precheck` 必须零错误通过**（typecheck + lint fix + docs 体检 + test）。

## Git Commit Message Convention

使用 **Conventional Commits** 规范：

```
<type>: <描述>
```

常见 type：`feat`、`fix`、`docs`、`chore`、`refactor`

示例：
- `feat: 添加模型 1M 上下文切换`
- `fix: 修复初次登陆的校验问题`
- `chore: remove prefetchOfficialMcpUrls call on startup`

## Commands

```bash
# Install dependencies
bun install

# Dev mode (runs cli.tsx with MACRO defines injected via -d flags)
bun run dev

# Dev mode with debugger (set BUN_INSPECT=9229 to pick port)
bun run dev:inspect

# Pipe mode
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# Build (code splitting, outputs dist/cli.js + chunk files)
bun run build

# Build with Vite (alternative build pipeline)
bun run build:vite

# Test
bun test                                    # run all tests
bun test src/utils/__tests__/hash.test.ts   # run single file
bun test --coverage                         # with coverage report

# Lint & Format (Biome) — 日常开发用 precheck 代替单独调用
bun run lint              # lint check (全项目)
bun run lint:fix          # auto-fix lint issues
bun run format            # format all (全项目)
bun run check             # lint + format check (全项目)
bun run check:fix         # lint + format auto-fix

# Check unused exports
bun run check:unused

# 产物完整性
bun run check:bundle

# Full check (typecheck + lint fix + test + docs) — 任务完成后必须运行
bun run precheck

# 文档站体检（导航完整性 / 代码路径引用 / 行号越界 / 孤儿页）
bun run docs:check

# Remote Control Server
bun run rcs

# Docs dev server (Mintlify)
bun run docs:dev
```

**注意：`bun run health` 和 `bun run test:production` 系列脚本指向的
`scripts/health-check.ts` / `scripts/production-test.ts` 当前不存在**，跑了会直接失败。
要么补上脚本，要么把这些条目从 `package.json` 删掉。

## Architecture

### Runtime & Build

- **Runtime**: Bun (not Node.js). All imports, builds, and execution use Bun APIs.
- **Build**: `build.ts` 执行 `Bun.build()` with `splitting: true`，入口 `src/entrypoints/cli.tsx`，输出 `dist/cli.js` + chunk files。Build 默认启用 19 个 feature（见下方 Feature Flag 段）。构建后自动替换 `import.meta.require` 为 Node.js 兼容版本（产物 bun/node 都可运行）。构建时会将 `vendor/audio-capture/` 和 `src/utils/vendor/ripgrep/` 复制到 `dist/vendor/` 下。
- **Build (Vite)**: `vite.config.ts` + `scripts/post-build.ts`，代码分割模式，chunk 输出到 `dist/chunks/`。post-build 遍历 `dist/` 和 `dist/chunks/` 下所有 `.js` 文件做 `globalThis.Bun` 解构 patch，复制 vendor 文件到 `dist/vendor/`。
- **Vendor 路径解析**: 构建后 chunk 文件位于 `dist/` 或 `dist/chunks/` 下，vendor 二进制在 `dist/vendor/`。`src/utils/distRoot.ts` 提供共享的 `distRoot` 函数，通过 `import.meta.url` 路径中 `lastIndexOf('dist')` 或 `lastIndexOf('src')` 定位根目录。`ripgrep.ts`、`computerUse/setup.ts`、`claudeInChrome/setup.ts`、`updateCCB.ts` 均使用 `distRoot` 而非内联 `import.meta.url` 路径推算。`packages/audio-capture-napi/src/index.ts` 有独立的 `lastIndexOf('dist')` 逻辑，功能等价。
- **为什么 Vite 必须代码分割**: Bun/JSC 会全量解析单个大 JS 文件的 bytecode 和 JIT，单文件 17MB 产物导致 RSS 暴涨至 ~1GB（Node/V8 懒解析仅需 ~220MB）。代码分割为 600+ 小 chunk 后 Bun 按需加载，`--version` RSS 从 966MB 降至 35MB，完整加载从 1GB+ 降至 ~500MB。
- **Dev mode**: `scripts/dev.ts` 通过 Bun `-d` flag 注入 `MACRO.*` defines，运行 `src/entrypoints/cli.tsx`。默认启用全部 feature。
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — `packages/*`、`packages/@ant/*`、`packages/@anthropic-ai/*`、`packages/@go-hare/*`，共 **27 个** workspace packages，其中 8 个是 `@go-hare/claude-code-<platform>` 发布产物包（由 `scripts/publish.ts` 生成，不含源码），实际有源码的是 **19 个**。
- **Lint/Format**: Biome (`biome.json`)。覆盖 `src/`、`scripts/`、`packages/` 全项目（含 `packages/@ant/`）。`bun run lint` / `bun run lint:fix` / `bun run format` / `bun run check` / `bun run check:fix`。42 条规则因 decompiled 代码被关闭，仅保留 `recommended` 基线。
- **Pre-commit**: husky + lint-staged。提交时自动对暂存文件执行 `biome check --fix`（TS/JS）和 `biome format --write`（JSON）。
- **Defines**: 集中管理在 `scripts/defines.ts`，`MACRO.VERSION` **从 `package.json` 读取**以避免版本漂移。改版本号只改 `package.json`。
- **CI**: ⚠️ **`.github/` 目录当前不在工作树中**，所以下面描述的 workflow 本地都不存在——提交前无法依赖 CI 兜底，必须自己跑 `bun run precheck`。历史上有 `ci.yml`（`bunx biome ci .` + 构建 + 测试）、`release-rcs.yml`、`update-contributors.yml`。

### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint。`main()` 函数按优先级处理多条快速路径：
   - `--version` / `-v` — 零模块加载
   - `--dump-system-prompt` — feature-gated (DUMP_SYSTEM_PROMPT)
   - `--claude-in-chrome-mcp` / `--chrome-native-host`
   - `--computer-use-mcp` — 独立 MCP server 模式
   - `--daemon-worker=<kind>` — feature-gated (DAEMON)
   - `remote-control` / `rc` / `remote` / `sync` / `bridge` — feature-gated (BRIDGE_MODE)
   - `daemon` [subcommand] — feature-gated (DAEMON)
   - `ps` / `logs` / `attach` / `kill` / `--bg` — feature-gated (BG_SESSIONS)
   - `new` / `list` / `reply` — Template job commands
   - `environment-runner` / `self-hosted-runner` — BYOC runner
   - `--tmux` + `--worktree` 组合
   - 默认路径：加载 `main.tsx` 启动完整 CLI
2. **`src/main.tsx`** (~6300 行) — Commander.js CLI definition。注册大量 subcommands：`mcp` (serve/add/remove/list...)、`server`、`ssh`、`open`、`auth`、`plugin`、`agents`、`auto-mode`、`doctor`、`update` 等。主 `.action()` 处理器负责权限、MCP、会话恢复、REPL/Headless 模式分发。
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog)。

### Core Loop

- **`src/query.ts`** — The main API query function. Sends messages to Claude API, handles streaming responses, processes tool calls, and manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, attribution, and turn-level bookkeeping. Used by the REPL screen.
- **`src/screens/REPL.tsx`** — The interactive REPL screen (React/Ink component). Handles user input, message display, tool permission prompts, and keyboard shortcuts.

### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events.
- **10 providers**（`APIProvider` 联合类型，见 `src/utils/model/providers.ts`）: `firstParty`（Anthropic 直连，默认）、`bedrock`、`vertex`、`foundry`、`anthropicAws`、`mantle`、`gateway`、`openai`、`gemini`、`grok`。其中 `firstParty` / `anthropicAws` / `gateway` 共享 Anthropic 风格 API，用 `isAnthropicStyleApiProvider()` 判定，**不要逐个比字符串**。
- Provider 优先级（`getAPIProvider()`，对齐上游 `xn()`，改动前先读代码注释）：
  1. `modelType` 显式为 `openai`/`gemini`/`grok` → 直接钉住，压过一切
  2. `getGatewayAuth()` 有值 → `gateway`
  3. 环境变量依次：`bedrock` → `foundry` → `anthropicAws` → `mantle` → `vertex`
  4. `modelType === 'anthropic'` → **提前返回 `firstParty`**
  5. 环境变量：`openai` → `gemini` → `grok`
  6. 兜底 → `firstParty`
- ⚠️ 第 4 步的提前返回是**刻意**的：OAuth 登录会把 `modelType` 设成 `anthropic`，但常在 `settings.env` 里留下上次 `/login` 写的 `CLAUDE_CODE_USE_OPENAI` 残留。不截断的话用户明明登录了 Anthropic 却会被路由到 OpenAI。**别把它「优化」掉。**

### Tool System

- **`src/Tool.ts`** — Tool interface definition (`Tool` type) and utilities (`findToolByName`, `toolMatchesName`).
- **`src/tools.ts`** — Tool registry. Assembles the tool list; tools are imported from `@claude-code/builtin-tools` package. Some tools are conditionally loaded via `feature()` flags or `process.env.USER_TYPE`.
- **`src/constants/tools.ts`** — `CORE_TOOLS` 常量（核心工具名集合，供文档/分析等引用）。**defer 策略不再用 CORE_TOOLS 白名单**。
- **`packages/builtin-tools/.../SearchExtraToolsTool/prompt.ts`** — densable `TX` `isDeferredTool`（opt-in）：`alwaysLoad` → `eGu`/`non_deferrable_builtins` → MCP always defer → ToolSearch never → Agent+fork / Brief / SendUserFile / PushNotification+remote_trigger / ScheduleWakeup+kairos / EnterWorktree+bg → else `shouldDefer===true`。Foundry 能力门 `$Fe` 在 `src/utils/foundryCapabilities.ts`。
- **`packages/builtin-tools/src/tools/`** — 67 个工具目录（含 `shared/`、`testing/` 等非工具目录），通过 `@claude-code/builtin-tools` 包导出。主要分类：
  - **文件操作**: FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool
  - **Shell/执行**: BashTool, PowerShellTool, REPLTool
  - **Agent 系统**: AgentTool, TaskCreateTool, TaskUpdateTool, TaskListTool, TaskGetTool
  - **规划**: EnterPlanModeTool, ExitPlanModeV2Tool, VerifyPlanExecutionTool
  - **Web/MCP**: WebFetchTool, WebSearchTool, MCPTool, McpAuthTool
  - **调度**: CronCreateTool, CronDeleteTool, CronListTool
  - **工具发现**: ToolSearch（`SearchExtraToolsTool`，wire 名 `ToolSearch`）、ExecuteExtraTool（compat core）、SyntheticOutput
  - **其他**: LSPTool, ConfigTool, SkillTool, EnterWorktreeTool, ExitWorktreeTool 等
- **`packages/builtin-tools/src/tools/shared/`** — Tool 共享工具函数。⚠️ **`src/tools/` 目录已不存在**，整个工具树都在 `packages/builtin-tools/` 下；看到旧文档或注释里写 `src/tools/...` 一律按 `packages/builtin-tools/src/tools/...` 理解。
- **`src/services/searchExtraTools/`** — TF-IDF 工具索引模块（`toolIndex.ts`），为延迟工具提供语义搜索能力。复用 `localSearch.ts` 的 TF-IDF 算法函数（`computeWeightedTf`、`computeIdf`、`cosineSimilarity` 已导出）。修改这些函数时需同步检查工具索引测试。`prefetch.ts` 的 `extractQueryFromMessages` 复用了 `skillSearch/prefetch.ts` 的同名导出函数，修改 skill prefetch 的该函数时需同步检查工具预取行为。工具预取使用独立的 `discoveredToolsThisSession` Set，与 skill prefetch 的去重集合互不影响。

### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`packages/@ant/ink/`** — Custom Ink framework（forked/internal），包含 components、core、hooks、keybindings、theme、utils。注意：不是 `src/ink/`。
- **`src/components/`** — 169 个组件目录/文件，渲染于终端 Ink 环境中。关键组件：
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics)
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering
  - `PromptInput/` — User input handling
  - `permissions/` — Tool permission approval UI
  - `design-system/` — 复用 UI 组件（Dialog, FuzzyPicker, ProgressBar, ThemeProvider 等）
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout.

### State Management

- **`src/state/AppState.tsx`** — Central app state type and context provider. Contains messages, tools, permissions, MCP connections, etc.
- **`src/state/AppStateStore.ts`** — Default state and store factory.
- **`src/state/store.ts`** — Zustand-style store for AppState (`createStore`).
- **`src/state/selectors.ts`** — State selectors.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state (session ID, CWD, project root, token counts, model overrides, client type, permission mode).

### Workspace Packages

| Package | 说明 |
|---------|------|
| `packages/@ant/ink/` | Forked Ink 框架（components、hooks、keybindings、theme） |
| `packages/@ant/computer-use-mcp/` | Computer Use MCP server（截图/键鼠/剪贴板/应用管理） |
| `packages/@ant/computer-use-input/` | 键鼠模拟（dispatcher + darwin/win32/linux backend） |
| `packages/@ant/computer-use-swift/` | 截图 + 应用管理（dispatcher + per-platform backend） |
| `packages/@ant/claude-for-chrome-mcp/` | Chrome 浏览器控制（通过 `--chrome` 启用） |
| `packages/@ant/model-provider/` | Model provider 抽象层 |
| `packages/builtin-tools/` | 内置工具集（67 个目录，通过 `@claude-code/builtin-tools` 导出） |
| `packages/agent-tools/` | Agent 工具集 |
| `packages/acp-link/` | ACP 代理服务器（WebSocket → ACP agent 桥接） |
| `packages/mcp-client/` | MCP 客户端库 |
| `packages/remote-control-server/` | 自托管 Remote Control Server（Docker 部署，含 Web UI）— Web UI 已重构为 React + Vite + Radix UI，支持 ACP agent 接入 |
| `packages/cloud-artifacts/` | 独立 Cloudflare Worker + R2 服务：POST `/upload` HTML 上传返回 hash URL，GET `/<7d\|30d>/<id>.html` 由 Worker 代理读取；R2 lifecycle rule 自动 7/30 天过期 |
| `packages/audio-capture-napi/` | 原生音频捕获（已恢复） |
| `packages/color-diff-napi/` | 颜色差异计算（完整实现，11 tests） |
| `packages/image-processor-napi/` | 图像处理（已恢复） |
| `packages/modifiers-napi/` | 键盘修饰键检测（macOS FFI 实现） |
| `packages/url-handler-napi/` | URL scheme 处理（环境变量 + CLI 参数读取） |
| `packages/workflow-engine/` | Workflow 引擎 |
| `packages/weixin/` | 微信集成 |

**`packages/` 下当前没有「非 workspace 辅助目录」**——除 `@ant/` 和 `@go-hare/` 这两个纯命名空间目录外，每个子目录都有 `package.json`。旧文档提到的 `langfuse-dashboard`、`shared-web-ui`、`highlight-code`、`claude-pencil`、`vscode-ide-bridge`、`pokemon` 均已删除。

另有 `packages/@go-hare/claude-code-<platform>/` 共 8 个（darwin/linux/win32 × arch，含 linux musl 变体）：由 `scripts/publish.ts` 生成的**发布产物包**，只含编译后的原生二进制和对应平台的 vendor，**没有源码，不要往里手写代码**。

### Bridge / Remote Control

- **`src/bridge/`** — Remote Control / Bridge 模式。feature-gated by `BRIDGE_MODE`。包含 bridge API、会话管理、JWT 认证、消息传输、权限回调等。Entry: `bridgeMain.ts`。
- **`packages/remote-control-server/`** — 自托管 RCS，支持 Docker 部署，含 Web UI 控制面板（React 19 + Vite + Radix UI）。支持 ACP agent 通过 acp-link 接入（ACP WebSocket handler、relay handler、SSE event stream）。通过 `bun run rcs` 启动。
- CLI 快速路径: `claude remote-control` / `claude rc` / `claude bridge`。
- 详见 `docs/features/remote-control-self-hosting.md`。

### HTML Artifact Hosting

- **`packages/cloud-artifacts/`** — 独立 Cloudflare Worker + R2 服务，类似 `remote-control-server/` 的"独立部署服务"定位，**不被主 CLI import**。Worker 处理 `POST /upload`（Bearer token 鉴权 + text/html 校验 + 10MB 上限 + ttl∈{7,30}）和 `GET /<7d|30d>/<id>.html`（从 R2 读 + Cache-Control: max-age=86400）。R2 用 prefix + lifecycle rule 实现 TTL（`7d/` 删 7 天、`30d/` 删 30 天），Worker 不参与过期处理。ID 默认 `nanoid(21)`（126 bit 熵），可指定 `?hash=` 自定义 ID（覆盖语义：先删 7d/30d prefix 旧 key 再写新 key）。Worker 用 `wrangler types` 生成的全局 `Env` 类型（`worker-configuration.d.ts`，已 gitignore），不依赖 `@cloudflare/workers-types`。部署用 `npm create cloudflare@latest` 初始化 + `bun run setup`（创建 bucket + lifecycle + secret）+ `bun run deploy`。生产出口经 Deno Deploy 边缘代理（`https://cloud-artifacts.claude-code-best.win`），副作用是 HTTP status code 被抹平为 200（body 的 `{error}` 字段仍保留）。详见 `packages/cloud-artifacts/README.md`。

### ACP Protocol (Agent Client Protocol)

- **`src/services/acp/`** — ACP agent 实现，包含 `agent.ts`（AcpAgent 类）、`bridge.ts`（Claude Code ↔ ACP 桥接）、`permissions.ts`（权限处理）、`entry.ts`（入口）。
- **`packages/acp-link/`** — ACP 代理服务器，将 WebSocket 客户端桥接到 ACP agent。提供 `acp-link` CLI 命令，支持自定义端口/HTTPS/认证/会话管理、RCS 集成（REST 注册 + WS identify 两步流程）、权限模式透传（fallback: 客户端传值 > config > `ACP_PERMISSION_MODE` 环境变量）。
- ACP 权限管道改进：`createAcpCanUseTool` 统一权限流水线，`applySessionMode` 模式同步，`bypassPermissions` 可用性检测（非 root/sandbox 环境）。
- ACP Plan 可视化已支持 `session/update plan` 类型的消息展示（PlanView 组件，含进度条/状态图标/优先级标签）。

### Daemon Mode

- **`src/daemon/`** — Daemon 模式（长驻 supervisor）。feature-gated by `DAEMON`。包含 `main.ts`（entry）和 `workerRegistry.ts`（worker 管理）。

### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files).
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy.

### Feature Flag System

Feature flags control which functionality is enabled at runtime. 代码中统一通过 `import { feature } from 'bun:bundle'` 导入，调用 `feature('FLAG_NAME')` 返回 `boolean`。

**启用方式**: 环境变量 `FEATURE_<FLAG_NAME>=1`。例如 `FEATURE_BUDDY=1 bun run dev`。

**Build 默认 features**：**42 个**，唯一来源是 `scripts/defines.ts` 的 `DEFAULT_BUILD_FEATURES`（`build.ts` 和 `vite.config.ts` 都从这里 import，不要在别处维护第二份清单）：

- 基础: `BUDDY`, `TRANSCRIPT_CLASSIFIER`, `BRIDGE_MODE`, `AGENT_TRIGGERS_REMOTE`, `CHICAGO_MCP`, `VOICE_MODE`
- 统计/缓存: `SHOT_STATS`, `PROMPT_CACHE_BREAK_DETECTION`, `TOKEN_BUDGET`
- P0 本地: `AGENT_TRIGGERS`, `ULTRATHINK`, `BUILTIN_EXPLORE_PLAN_AGENTS`, `LODESTONE`
- P1 API 依赖: `EXTRACT_MEMORIES`, `VERIFICATION_AGENT`, `KAIROS_BRIEF`, `AWAY_SUMMARY`
- P2: `DAEMON`, `ACP`
- 工作流: `WORKFLOW_SCRIPTS`, `MONITOR_TOOL`, `KAIROS`
- 上下文恢复: `REACTIVE_COMPACT`（413/PTL withhold + tryReactiveCompact；对齐 densable SEA；**不含** collapse/snip）
- KAIROS 外围: `KAIROS_CHANNELS`, `KAIROS_PUSH_NOTIFICATION`, `KAIROS_GITHUB_WEBHOOKS`
- 多 worker: `COORDINATOR_MODE`, `BG_SESSIONS`, `TEMPLATES`
- 本机/LAN 协作: `UDS_INBOX`（inbox/peers/pipes）、`LAN_PIPES`（TCP + UDP beacon；依赖 UDS）— densable 产品面默认 ON（1:1）
- 团队记忆: `TEAMMEM`（`memory/team` 同步；需 OAuth + GitHub remote 运行时门）
- 连接器: `CONNECTOR_TEXT`, `COMMIT_ATTRIBUTION`, `DIRECT_CONNECT`
- 实验性: `EXPERIMENTAL_SKILL_SEARCH`, `EXPERIMENTAL_SEARCH_EXTRA_TOOLS`
- 模式: `POOR`, `SSH_REMOTE`
- 其他: `AUTOFIX_PR`, `NATIVE_CLIPBOARD_IMAGE`, `GOAL`

**已注释禁用（7 个）**——每条上方都有注释写明原因，**不要随手加回来**：

`ULTRAPLAN`（densable 2.1.222 #21 产品拆除，残留模块留作 `FEATURE_ULTRAPLAN=1` 复活，注释明确要求不得重新加入）、`TREE_SITTER_BASH`、`HISTORY_SNIP`、`CONTEXT_COLLAPSE`（后两者 stub 风险会抑制 proactive autoCompact）、`FORK_SUBAGENT`、`REVIEW_ARTIFACT`、`SKILL_LEARNING`

**Dev mode 默认**: 全部启用（见 `scripts/dev.ts`）。

**类型声明**: `src/types/internal-modules.d.ts` 中声明了 `bun:bundle` 模块的 `feature` 函数签名。

**统计口径**：想知道当前准确的启用/禁用数量，直接数 `scripts/defines.ts` 的 `DEFAULT_BUILD_FEATURES`——本文的分组是为了可读性，条目变动时容易漏改。

**新增功能的正确做法**: 保留 `import { feature } from 'bun:bundle'` + `feature('FLAG_NAME')` 的标准模式，在运行时通过环境变量或配置控制，不要绕过 feature flag 直接 import。

### Multi-API 兼容层

所有兼容层均采用流适配器模式：将第三方 API 格式转为 Anthropic 内部格式，下游代码完全不改。通过 `/login` 命令配置。

#### OpenAI 兼容层

通过 `CLAUDE_CODE_USE_OPENAI=1` 启用，支持 Ollama/DeepSeek/vLLM 等任意 OpenAI Chat Completions 协议端点。含 DeepSeek thinking mode 支持。

- **`src/services/api/openai/`** — client、消息/工具转换、流适配、模型映射
- 关键环境变量：`CLAUDE_CODE_USE_OPENAI`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`

#### Gemini 兼容层

通过 `CLAUDE_CODE_USE_GEMINI=1` 启用。独立环境变量体系。

- **`src/services/api/gemini/`** — client、模型映射、类型定义
- 关键环境变量：`GEMINI_API_KEY`（必填）、`GEMINI_MODEL`（直接指定）、`GEMINI_DEFAULT_SONNET_MODEL`/`GEMINI_DEFAULT_OPUS_MODEL`（按能力映射）
- 模型映射优先级：`GEMINI_MODEL` > `GEMINI_DEFAULT_*_MODEL` > `ANTHROPIC_DEFAULT_*_MODEL`(已废弃) > 原样返回

#### Grok 兼容层

通过 `CLAUDE_CODE_USE_GROK=1` 启用。自定义模型映射支持 xAI Grok API。

- **`src/services/api/grok/`** — client、模型映射

详见各兼容层的 docs 文档。

### 穷鬼模式（Budget Mode）

- 通过 `/poor` 命令切换，持久化到 `settings.json`。
- 启用后跳过 `extract_memories`、`prompt_suggestion` 和 `verification_agent`，显著减少 token 消耗。
- 实现在 `src/commands/poor/poorMode.ts`。

### Effort / launch pin（densable 对齐约定）

Effort 解析对齐 densable 2.1.211 的 model-driven 链路：`resolveAppliedEffort` ≈ `cme`，catalog 在 `src/utils/model/effortCatalog.ts`，UI 经 `getSupportedEffortLevels` 过滤。`ultracode` **不是** `EffortLevel`，而是 session flag + wire 顶档 + Workflow 编排。

**Launch pin（densable `Ave` / `N9` / `St`·`pr`）**：

- 模型族：`opus-4-7` / `opus-4-8` / `fable-5` 启动时 pin catalog 默认 effort（忽略 session 旧值）。
- 存储：`GlobalConfig.unpinOpus*LaunchEffort`（对齐 densable `St()`/`pr()` 全局配置，**落盘跨会话**；不是 React AppState，也不是进程模块变量）。
- `N9` = `unpinAllEffortLaunchPins()`：用户**真正改 effort** 后释放 pin（写 config）。
- 必须 N9 的本地入口：`/effort`（interactive）、EffortPanel confirm、`ModelPicker` **confirm（Dan）**、settings `effortLevel` 变更、bootstrap CLI effort / ultracode。
- **禁止**在 ModelPicker ←/→ cycle 时 N9（densable `gbp` 只动本地 cursor；Esc 必须保留 pin）。

**densable 有、我们故意不补的 N9 入口（勿发明）**：

| densable 路径 | 含义 | 我们的策略 |
|---------------|------|------------|
| slash skill/command `getEffort` 展开 | 命令自带 effort，交互会话里 N9 | 无对等 `getEffort` 产品 API；**不**造假入口 |
| remote / bridge 下发 `effortLevel` 或 `ultracode` | 云端控制面改会话 effort 时 N9 | 未接 remote 改 effort 协议；**不**在 bridge 硬塞 N9 |

以后若真正接上「skill 可指定 effort」或「remote 可改 effort」，在**写入 session effort 的那一刻**补 `unpinAllEffortLaunchPins()`，不要为 checklist 写死代码。

### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Restored — macOS + Windows + Linux（后端完整度不一） |
| `*-napi` packages | 全部已恢复/实现：`audio-capture-napi`、`image-processor-napi` 已恢复；`color-diff-napi` 完整；`modifiers-napi`（macOS FFI）；`url-handler-napi`（环境变量+CLI） |
| Voice Mode | Restored — Push-to-Talk 语音输入（需 Anthropic OAuth） |
| OpenAI/Gemini/Grok 兼容层 | Restored |
| Remote Control Server | Restored — 自托管 RCS + Web UI |
| `packages/shell/`, `packages/swarm/`, `packages/mcp-server/`, `packages/cc-knowledge/` | Removed — 功能合并或废弃 |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / LSP Server | Restored — Magic Docs 自动更新 + LSP 服务器管理器 |
| Plugins / Marketplace | Restored — 插件安装/卸载/启用/禁用 + Marketplace 浏览（`src/services/plugins` + `src/utils/plugins`） |
| MCP OAuth | **完整 densable 客户端**（`src/services/mcp/auth.ts`：浏览器 OAuth、refresh、step-up、XAA 实验路径）。旧文档 “Simplified” 已过时；边角：XAA GA 锁 / IDE lockfile token |

### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

## Testing

- **框架**: `bun:test`（内置断言 + mock）
- **单元测试**: 就近放置于 `src/**/__tests__/`，文件名 `<module>.test.ts`
- **集成测试**: `tests/integration/` — 7 个文件（cli-arguments, context-build, message-pipeline, tool-chain, autonomy-lifecycle-user-flow, dependency-overrides, goal-lifecycle）
- **规模**: 约 1,218 个测试文件
- **对齐回归测试**: `*.NNN.test.ts`（`NNN` = densable 版本号，如 `hasReleasedTerminal.238.test.ts`）约 450 个。这些锁的是「官方在 2.1.NNN 的行为」，看起来测得琐碎正是它们的价值，**删不得**
- **共享 mock/fixture**: `tests/mocks/`（api-responses, file-system, fixtures/）
- **命名**: `describe("functionName")` + `test("behavior description")`，英文
- **包测试**: `packages/` 下各包也有独立测试（如 `color-diff-napi` 11 tests）

### Mock 使用规范

**只 mock 有副作用的依赖链，不 mock 纯函数/纯数据模块。**

被迫 mock 的根源：`log.ts` / `debug.ts` → `bootstrap/state.ts`（模块级 `realpathSync` / `randomUUID` 副作用）。必须 mock 的模块：`log.ts`、`debug.ts`、`bun:bundle`、`settings/settings.js`、`config.ts`、`auth.ts`、第三方网络库。

**`log.ts` 和 `debug.ts` 使用共享 mock**（`tests/mocks/log.ts` / `tests/mocks/debug.ts`），不要在测试文件中内联 mock 定义。使用方式：

```ts
import { logMock } from "../../../tests/mocks/log";
mock.module("src/utils/log.ts", logMock);

import { debugMock } from "../../../../tests/mocks/debug";
mock.module("src/utils/debug.ts", debugMock);
```

源文件导出变更时只需更新 `tests/mocks/` 下的对应文件，不需要逐个修改测试。

不要 mock：纯函数模块（`errors.ts`、`stringUtils.js`）、mock 值与真实实现相同的模块、mock 路径与实际 import 不匹配的模块。

路径规则：统一用 `.ts` 扩展名 + `src/*` 别名路径，禁止双重 mock 同一模块。

#### 跨文件 mock 污染（process-global `mock.module`）

**Bun 的 `mock.module` 是进程全局的（last-write-wins），不是 per-file 隔离的。** 一个测试文件的 `mock.module` 会污染同一进程中所有其他测试文件的 `require`/`import`。

**关键事实（Bun 1.x 实测验证）：**
- 测试文件执行顺序**不是严格字母序**，不要假设文件 A 一定在文件 B 之前执行。
- `mock.module` 在 `beforeAll` 内部调用时**不会被提升**（hoist），但仍会污染后续加载的文件。
- `require()` 和 `import()` 共享同一模块注册表，`mock.module` 对两者都生效。
- 一个模块一旦被某个文件的 `mock.module` 替换，同一进程中所有后续 `require`/`import` 都会返回 mock 值，即使调用方使用不同的 specifier 路径。

**核心规则：不要 mock 被测模块的上层业务模块。**

错误做法（会污染同目录的 `api.test.ts`）：
```ts
// launchSchedule.test.ts — 直接 mock 源 API 模块 ❌
mock.module('src/commands/schedule/triggersApi.js', () => ({
  listTriggers: listTriggersMock,
  // ...
}))
```

正确做法（mock 底层 HTTP 层，不污染业务模块）：参考 `launchSkillStore.test.ts`、`launchVault.test.ts` 的模式。
```ts
// launchSchedule.test.ts — mock axios 而非 triggersApi ✅
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = axiosGetMock
axiosHandle.stubs.post = axiosPostMock

beforeAll(() => { axiosHandle.useStubs = true })
afterAll(() => { axiosHandle.useStubs = false })
```

**判断标准：** 如果目录下同时有 `launch*.test.ts`（集成测试）和 `api.test.ts`（回归测试），`launch*.test.ts` 必须 mock axios 而非源 API 模块。`api.test.ts` 需要测试真实 API 模块的 HTTP 方法/URL/错误处理逻辑，被 mock 后就无法测试。

**排查 mock 污染的方法：**
1. 单独运行可疑文件确认其通过：`bun test path/to/suspect.test.ts`
2. 与同目录其他文件一起运行定位污染源：`bun test path/to/__tests__/`
3. 在两个文件中各加 `console.error('[file] milestone')` 追踪实际执行顺序
4. 检查 `mock.module` 的 specifier 是否与同目录其他测试的 `require`/`import` 路径解析到同一模块

### 类型检查

项目使用 TypeScript strict 模式，**tsc 必须零错误**。每次修改后运行：

```bash
bun run precheck
```

**类型规范**：
- 生产代码禁止 `as any`；测试文件中 mock 数据可用 `as any`
- 类型不匹配优先用 `as unknown as SpecificType` 双重断言，或补充 interface
- 未知结构对象用 `Record<string, unknown>` 替代 `any`
- 联合类型用类型守卫（type guard）收窄，不要强转
- `msg.request` 属性访问：`const req = msg.request as Record<string, unknown>`
- Ink `color` prop：用 `as keyof Theme` 而非 `as any`

## Working with This Codebase

- **precheck must pass** — `bun run precheck`（typecheck + lint fix + `docs:check` + test）必须零错误，任何修改都不能引入新的类型/lint/文档/测试错误。
- **Feature flags** — **runtime** 无 env 时 `feature()` 返回 `false`；**dev/build** 注入 `DEFAULT_BUILD_FEATURES`（42 个默认 ON，含 `UDS_INBOX`/`LAN_PIPES`/`TEAMMEM`/KAIROS 外围等，见上文 Feature Flag System 与 `scripts/defines.ts`）。不要写成「本地默认全 OFF」。不要在 `cli.tsx` 中重定义 `feature` 函数——它从 `bun:bundle` 导入。
- **React Compiler output** — Components have decompiled memoization boilerplate (`const $ = _c(N)`). This is normal.
- **`bun:bundle` import** — `import { feature } from 'bun:bundle'` 是 Bun 内置模块，由运行时/构建器解析。不要用自定义函数替代它。**`feature()` 只能直接用在 `if` 语句或三元表达式的条件位置**（Bun 编译器限制），不能赋值给变量、不能放在箭头函数体里、不能作为 `&&` 链的一部分。正确：`if (feature('X')) {}` 或 `feature('X') ? a : b`。
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
- **MACRO defines** — 集中管理在 `scripts/defines.ts`。Dev mode 通过 `bun -d` 注入，build 通过 `Bun.build({ define })` 注入。修改版本号等常量只改这个文件。
- **构建产物兼容 Node.js** — `build.ts` 会自动后处理 `import.meta.require`，产物可直接用 `node dist/cli.js` 运行。
- **Biome 配置** — 42 条 lint 规则因 decompiled 代码被关闭，仅保留 `recommended` 基线。格式化覆盖全项目（`src/`、`scripts/`、`packages/`，含 `packages/@ant/`）。`.tsx` 文件用 120 行宽 + 强制分号；其他文件 80 行宽 + 按需分号。JSON 格式化已启用。`.editorconfig` 与 Biome 配置对齐（2-space 缩进）。修改任何代码后应运行 `bun run precheck` 确认无类型/lint/格式/测试问题，pre-commit hook 会自动拦截不合格提交。
- **tsc 与 Biome 冲突处理** — 当 tsc 要求声明属性（赋值使用）但 biome 报 `noUnusedPrivateClassMembers`（只写不读）时，用 `// biome-ignore lint/correctness/noUnusedPrivateClassMembers: <原因>` 抑制 lint 警告，保留类型声明。`biome ci` 必须零 warnings。
- **`@ts-expect-error` 维护** — 只在下方代码确实有类型错误时保留 `@ts-expect-error`。如果类型系统已更新导致 directive 变为 unused（TS2578），直接移除注释。MACRO 替换产生的永假比较（如 `'production' === 'development'`）仍需保留 `@ts-expect-error`。
- **Ink 框架在 `packages/@ant/ink/`** — 不是 `src/ink/`（该目录不存在）。Ink 相关的组件、hooks、keybindings 都在 packages 中。
- **Provider 优先级** — 见上文 API Layer 段的 6 级链条（`modelType` 第三方钉住 > gateway > 云厂商 env > `modelType === 'anthropic'` 提前返回 > 第三方 env > 兜底）。新增 provider 需在 `src/utils/model/providers.ts` 注册，并想清楚插在哪一格。
- **搬迁代码时同步改文档** — `docs/` 下有 900+ 处形如 `` `src/xxx.ts` `` 的代码路径引用。挪动或改名文件后跑 `bun run docs:check`，它会列出所有解析不到的路径和越界的行号引用。`precheck` 已包含这一步，所以不跑就提交会被拦。
- **哪些文档不该跟随代码改** — `docs/upstream-extraction/`（逐版本 densable 提取快照）和 `docs/superpowers/`（带日期的设计/评审记录）是**冻结归档**，里面的旧路径是历史事实，不要"修正"。`docs-check.ts` 已把它们排除。

## Design Context

Impeccable 设计上下文保存在 `.impeccable.md` 中。设计 Web UI（RCS 控制面板、文档站、着陆页）时必须参考该文件。

### 核心设计原则

1. **Considered over clever** — 每个设计选择都应感觉有意为之，而非追逐潮流
2. **Warmth through subtlety** — 通过橙色色调的中性色、留白布局、有温度的文案来传达温暖
3. **Density with clarity** — 技术用户需要信息密度，但不能混乱
4. **Community voice** — 设计应感觉是由使用者创造的，而非遥远的设计团队
5. **Anthropic's shadow** — 遵循 Anthropic 的设计直觉：干净的布局、充足的间距、温暖的色温

### 品牌色

- 主色：Claude Orange `#D77757`（terra cotta）
- 辅色：Claude Blue `#5769F7`
- 暗色模式使用温暖的深色表面（非冷蓝黑色）

### 目标用户

技术团队/企业，在专业工作流中使用 AI 辅助编程。友好的开源社区氛围，非企业 SaaS 风格。

### 视觉参考

Anthropic 公司的设计风格 — 干净、考究、温暖的底色。大量留白，以排版为核心。避免 AI 产品常见的设计套路（渐变文字、玻璃态、霓虹色）。
