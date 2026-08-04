# KAIROS — 常驻助手模式

> Feature flags: `KAIROS`（主）、`KAIROS_BRIEF`、`KAIROS_CHANNELS`、`KAIROS_PUSH_NOTIFICATION`、`KAIROS_GITHUB_WEBHOOKS`；与 `PROACTIVE` 强绑定  
> 对齐目标：densable **2.1.211** 系（本机 densable 二进制常见为 2.1.220，字符串侧仍有 `tengu_kairos_*` / `SendUserMessage`）  
> 实现状态：**核心框架与本地 tick/Sleep/Brief/assistant latch 已落地**；云端权益与部分外围能力依赖 GrowthBook / OAuth / Bridge  
> **不要**再按「全是 stub」理解本文旧版描述

## 一、功能概述

KAIROS 把 Claude Code 从「一问一答 REPL」扩展成**可常驻的助手会话**：

| 能力 | 说明 |
|------|------|
| **Assistant latch** | `setKairosActive(true)` / `isAssistantMode()`：会话进入助手语义（system prompt 加篇、Brief 强约束等） |
| **Proactive 心跳** | `Sleep` + `<tick>` 循环；代码门控几乎全是 `feature('PROACTIVE') \|\| feature('KAIROS')` |
| **Brief** | 工具对外名 **`SendUserMessage`**（BriefTool）：对用户可见的短结构化更新 |
| **隐式 in-process team** | `initializeAssistantTeam()`：预建 team，便于 `Agent(name)` 不先 TeamCreate |
| **可选外围** | Channels / 推送 / PR webhook / SendUserFile（子 flag，默认 build 不全开） |
| **Bridge / daemon 路径** | `claude assistant` 安装/附着 CCR 会话、`--assistant` 强开 daemon 子路径 |

**不是**「多一个 cron 命令」。Cron 工具用 `tengu_kairos_cron*` 命名与 GB 门控，但 **`isKairosCronEnabled()` 不依赖 `feature('KAIROS')`**（见 `ScheduleCronTool/prompt.ts`）。

### 1.1 子 Feature 关系

```
KAIROS (主开关；build 默认 ON)
├── 自动带 proactive 语义          ← 代码 OR：PROACTIVE || KAIROS
├── KAIROS_BRIEF (SendUserMessage) ← build 默认 ON；也可单独开 BRIEF
├── KAIROS_CHANNELS                ← 默认 build 未列入
├── KAIROS_PUSH_NOTIFICATION       ← 默认 build 未列入
└── KAIROS_GITHUB_WEBHOOKS         ← 默认 build 未列入

PROACTIVE (独立 flag；默认 build 未列入)
└── 单独开也能拿到 Sleep / tick；开 KAIROS 时不必再开 PROACTIVE
```

**`KAIROS_DREAM`：文档历史名，代码中无 `feature('KAIROS_DREAM')`。**  
记忆整理是 **Auto Dream**（`src/services/autoDream/` + `src/tasks/DreamTask/` + `/dream`），见 `docs/features/auto-dream.md`，与 KAIROS 编译 flag **无关**。

### 1.2 Build 默认（`scripts/defines.ts` → `DEFAULT_BUILD_FEATURES`）

| Flag | 默认 build | 说明 |
|------|------------|------|
| `KAIROS` | ✅ | 主开关 |
| `KAIROS_BRIEF` | ✅ | Brief / SendUserMessage 编译进产物 |
| `PROACTIVE` | ❌ | 未列入；本地靠 KAIROS OR 门拿到同等 proactive 能力 |
| `KAIROS_CHANNELS` | ❌ | 代码有，需 `FEATURE_KAIROS_CHANNELS=1` 等 |
| `KAIROS_PUSH_NOTIFICATION` | ❌ | 同上 |
| `KAIROS_GITHUB_WEBHOOKS` | ❌ | 同上 |

Dev（`bun run dev`）通常注入更全的 feature 集；以 `scripts/dev.ts` / 当前环境 `FEATURE_*` 为准。

---

## 二、双层门控（最容易踩坑）

### 2.1 编译期 vs 运行时

| 层 | 机制 | 典型效果 |
|----|------|----------|
| **Build** | `feature('KAIROS')` 等 | 决定代码/工具是否编进产物 |
| **Runtime GB** | GrowthBook `tengu_kairos_*` | 权益 / kill-switch；本 fork GB 多为空实现时 **默认 false** 会卡住产品路径 |

`src/assistant/gate.ts`：

```ts
// feature('KAIROS') && tengu_kairos_assistant (default false)
export async function isKairosEnabled(): Promise<boolean>
```

**`main.tsx` 在 `setKairosActive(true)` 之前调用 gate**，不可在 gate 内读 `kairosActive`（会死锁）。

### 2.2 关键 GrowthBook / 环境变量

| 键 | 作用 |
|----|------|
| `tengu_kairos_assistant` | Assistant 模式运行时门（默认 **false**） |
| `tengu_kairos_brief` | Brief 权益 / kill-switch（`isBriefEntitled`） |
| `tengu_kairos_brief_config` | 如 `/brief` 是否可见（`enable_slash_command`，默认 false） |
| `tengu_kairos_brief_stop_hook_text` | Brief stop-hook 文案覆盖 |
| `tengu_kairos_cron` / `tengu_kairos_cron_durable` | Cron 工具可用性 / 持久 durable |
| `CLAUDE_CODE_BRIEF` | 开发用：强制 Brief 权益（仍常需 opt-in 激活） |
| `CLAUDE_CODE_PROACTIVE` / `--proactive` | 主动模式启动 |
| `settings.assistant` / `--assistant` | 助手模式；**`--assistant` 走 `markAssistantForced()` 跳过 GB** |

### 2.3 Brief 激活模型（`BriefTool.ts`）

- **`isBriefEntitled()`**：有没有资格（KAIROS/BRIEF + `kairosActive` **或** env **或** GB `tengu_kairos_brief`）
- **`isBriefEnabled()`**：本会话是否真启用工具  
  ≈ `(kairosActive || userMsgOptIn) && entitled`（另有 pewter_owl 旁路）
- **`/brief`、`--brief`、`defaultView: 'chat'`** 等主要写 **opt-in / UI 过滤（`isBriefOnly`）**  
  注释约定：显示过滤 **不再**单独关掉「模型侧应使用 SendUserMessage」的 prompt 语义；真正关工具看 `isBriefEnabled()` + GB kill-switch

---

## 三、激活路径

| 入口 | 行为摘要 |
|------|----------|
| **`--assistant`** | `markAssistantForced()` → 跳过 `tengu_kairos_assistant` → `setKairosActive(true)` + team 初始化 |
| **settings `assistant: true` / CLI `assistant`** | 需 `isKairosEnabled()`（feature + GB）为 true |
| **`/assistant`** | 安装/附着助手 daemon 会话的 UI 向导（`src/commands/assistant/`） |
| **`claude assistant [sessionId]`** | 附着远程 assistant 会话（viewer）；与本地 agentic loop 分工不同 |
| **`--proactive` / `CLAUDE_CODE_PROACTIVE` / `/proactive`** | `activateProactive()`；tick 循环 |
| **`--brief` / `CLAUDE_CODE_BRIEF` / `/brief` / `defaultView: 'chat'`** | Brief opt-in / brief-only 显示 |

本地**最稳验收**：**`claude --assistant`**（或 dev 下等价）绕过 GB；Brief 可用 **`CLAUDE_CODE_BRIEF=1`** + `--brief` 试。

---

## 四、系统提示

注入在 `src/constants/prompts.ts`（函数名稳定；行号会漂，以符号为准）：

### 4.1 Brief — `getBriefSection()`

- 条件：`feature('KAIROS') || feature('KAIROS_BRIEF')`，且 `isBriefEnabled()`
- Proactive 已激活时，brief 段落可能并入 proactive，**避免双份**

### 4.2 Proactive — `getProactiveSection()`

- 条件：`feature('PROACTIVE') || feature('KAIROS')`，且 `isProactiveActive()`
- 要点：`<tick>` 保活、`Sleep` 控节奏、无事必须 Sleep、首次 tick 先问候、后续偏向行动、对用户简洁

### 4.3 Assistant 加篇 — `getAssistantSystemPromptAddendum()`

- 文件：`src/assistant/index.ts`（`# Assistant Mode`）
- 强调：保持主循环可响应、用 **SendUserMessage** 做用户可见更新、长任务后台化、cron 跟进、别空转旁白

---

## 五、实现架构

### 5.1 核心模块（状态以代码为准）

| 模块 | 路径 | 状态 | 职责 |
|------|------|------|------|
| Assistant API | `src/assistant/index.ts` | **已实现** | `isAssistantMode` / force latch / team / system prompt addendum |
| Gate | `src/assistant/gate.ts` | **已实现** | `isKairosEnabled` = feature + `tengu_kairos_assistant` |
| Session 发现 | `src/assistant/sessionDiscovery.ts` | **已实现** | bridge/assistant session 发现 |
| Session 历史 | `src/assistant/sessionHistory.ts` | **已实现** | 历史辅助 |
| Session UI | `src/assistant/AssistantSessionChooser.tsx` | **已实现** | 选择会话 |
| deps | `src/assistant/deps.ts` | **已实现** | team/settings 等 re-export |
| `/assistant` | `src/commands/assistant/*` | **已实现** | slash + 安装向导 |
| `/brief` | `src/commands/brief.ts` | **已实现** | brief-only toggle（另受 GB config） |
| `/proactive` | `src/commands/proactive.ts` | **已实现** | proactive 开关 |
| Proactive 状态 | `src/proactive/index.ts` | **已实现** | activate / pause / tick 调度状态 |
| Tick hook | `src/proactive/useProactive.ts` | **已实现** | REPL 内 `<tick>` 注入 |
| BriefTool | `packages/builtin-tools/.../BriefTool/` | **已实现** | `SendUserMessage` |
| SleepTool | `packages/builtin-tools/.../SleepTool/` | **已实现** | 节奏；仅 PROACTIVE\|\|KAIROS 注册 |
| SendUserFile | `.../SendUserFileTool/` | **已实现** | `feature('KAIROS')` 时注册 |
| PushNotification | `.../PushNotificationTool/` | **已实现** | KAIROS \|\| PUSH 时注册 |
| SubscribePR | `.../SubscribePRTool/` | **已实现** | `KAIROS_GITHUB_WEBHOOKS` |
| Cron 命名门控 | `.../ScheduleCronTool/prompt.ts` | **已实现** | GB `tengu_kairos_cron*`，**不**绑 `feature('KAIROS')` |
| Channel 通知 | `src/services/mcp/channelNotification.ts` | **已实现** | 外部频道消息（CHANNELS 相关） |
| 工具注册 | `src/tools.ts` | **已实现** | 条件 require + 列表展开 |
| 启动编排 | `src/main.tsx` | **已实现** | `--assistant` / brief / proactive / kairosEnabled |
| REPL | `src/screens/REPL.tsx` | **已实现** | `useProactive`、assistant 相关 UI |
| automation 元数据 | `src/utils/sessionState.ts` | **已实现** | `standby` / `sleeping` 等给 bridge/CCR |
| 记忆目录 | `src/memdir/*` | **已实现** | 通用记忆；**非** KAIROS 子 flag |
| Auto Dream | `src/services/autoDream/*`、`src/tasks/DreamTask/` | **已实现** | 见 auto-dream 文档，**非** `KAIROS_DREAM` |

### 5.2 工具注册（`src/tools.ts`）

| 工具 | 编译门控 |
|------|----------|
| `Sleep` | `PROACTIVE \|\| KAIROS` |
| `BriefTool`（SendUserMessage） | 始终 import；**启用**看 `isBriefEnabled()` |
| `SendUserFile` | `KAIROS` |
| `PushNotification` | `KAIROS \|\| KAIROS_PUSH_NOTIFICATION` |
| `SubscribePR` | `KAIROS_GITHUB_WEBHOOKS` |

其它工具在 KAIROS 下的分支（示例）：

- `AgentTool`：`cwd` schema / `kairosEnabled` 强制 async
- `AskUserQuestion` / Enter·Exit PlanMode：CHANNELS 相关路由
- Bash / PowerShell：KAIROS 行为分支
- ConfigTool：推送相关 settings 项

### 5.3 与 Bridge / 远程控制

KAIROS **可以**叠 Bridge（`BRIDGE_MODE`）接到 claude.ai / 自托管 RCS，但：

- 本地 tick + Sleep **不依赖** bridge 也能跑
- 真·手机推送、云端 assistant 权益依赖 OAuth + 服务端 GB + bridge 会话
- 自托管 RCS 见 `docs/features/remote-control-self-hosting.md`

简化数据流（本地 proactive）：

```
activateProactive() / assistant 启动
        │
        ▼
useProactive 调度 <tick>
        │
        ├── 模型有工作 → 工具 / Agent / cron
        └── 无工作 → 必须 Sleep
        │
        ▼
SendUserMessage（Brief）→ 用户可见短更新
automation_state → bridge/CCR（standby | sleeping）
```

---

## 六、关键设计决策

1. **`KAIROS ⊃ PROACTIVE`（门控 OR）**  
   开 KAIROS 即具备 Sleep/tick 编译与运行门；不必同时 `FEATURE_PROACTIVE=1`。
2. **Tick 驱动而非纯事件驱动**  
   模型用 Sleep 自控唤醒；简化架构，但空转要靠「无事必 Sleep」省 token。
3. **双层门：feature + GrowthBook**  
   编译开了仍可能被 `tengu_kairos_assistant` / `tengu_kairos_brief` 挡住。
4. **`--assistant` 跳过 GB**  
   Daemon / Agent SDK 子进程不重复 entitlement 检查。
5. **Brief 显示 vs 工具**  
   `isBriefOnly` 管 UI；`isBriefEnabled()` 管工具与 prompt 段。
6. **Cron 名字带 kairos，flag 不绑 KAIROS**  
   避免把调度子系统和助手模式死绑。
7. **Dream ≠ KAIROS 子 flag**  
   记忆整理独立产品线（auto-dream）。

---

## 七、使用方式

### 7.1 日常 dev / 默认 build

默认 build 已含 `KAIROS` + `KAIROS_BRIEF`：

```bash
bun run dev
# 或产物
claude --assistant          # 强开 assistant latch（跳过 GB）
claude --proactive          # 主动 tick
claude --brief              # brief opt-in / 显示
```

### 7.2 需要外围能力时

```bash
FEATURE_KAIROS_CHANNELS=1 \
FEATURE_KAIROS_PUSH_NOTIFICATION=1 \
FEATURE_KAIROS_GITHUB_WEBHOOKS=1 \
FEATURE_PROACTIVE=1 \
bun run dev
```

### 7.3 Brief 本地调试

```bash
CLAUDE_CODE_BRIEF=1 claude --brief
```

### 7.4 与 Token Budget

可与 `TOKEN_BUDGET` 等同开，控制长驻会话消耗（独立 feature）。

---

## 八、外部依赖

| 依赖 | 何时需要 |
|------|----------|
| **Anthropic OAuth / claude.ai** | 官方云端 assistant、真推送、CCR 会话 |
| **GrowthBook `tengu_kairos_*`** | 非 `--assistant` 的 assistant 权益、Brief 权益、cron kill-switch |
| **Bridge API** | 远程控制 / `claude assistant` 云附着 |
| **本 fork GB stub** | 空实现时多数 `tengu_*` 为默认值 → **本地优先 `--assistant` / env 强开** |

---

## 九、与 densable 官方对齐（摘要）

| 维度 | 评估 |
|------|------|
| Flag 形状 / PROACTIVE OR / Brief 工具名 | **高**（~ densable 211 系） |
| Sleep + tick + assistant system prompt | **高** |
| 默认 build 含 KAIROS+BRIEF | **本 fork 已开** |
| 云端 entitlement、真推送、PR webhook 闭环 | **中低**（依赖服务端；本地代码有、默认不全开） |
| 文档历史「全 stub」 | **已过时**（以本文与源码为准） |

本机 densable 二进制（如 Cursor 自带 2.1.220）侧可见：`tengu_kairos_brief`、`SendUserMessage`、`tengu_kairos_push_notifications`、`assistant-daemon-state.json` 等，与本仓库结构一致。

---

## 十、文件索引（路径稳定；行数会变）

| 路径 | 职责 |
|------|------|
| `src/assistant/index.ts` | Assistant 模式 API、team、prompt 加篇 |
| `src/assistant/gate.ts` | `isKairosEnabled` |
| `src/assistant/sessionDiscovery.ts` | 会话发现 |
| `src/assistant/sessionHistory.ts` | 会话历史 |
| `src/assistant/AssistantSessionChooser.tsx` | 选择 UI |
| `src/assistant/deps.ts` | 依赖 re-export |
| `src/commands/assistant/*` | `/assistant` |
| `src/commands/brief.ts` | `/brief` |
| `src/commands/proactive.ts` | `/proactive` |
| `src/commands/subscribe-pr.ts` | `/subscribe-pr`（GITHUB_WEBHOOKS） |
| `src/proactive/index.ts` | proactive 状态机 |
| `src/proactive/useProactive.ts` | REPL tick hook |
| `src/main.tsx` | 启动：assistant / brief / proactive / kairosEnabled |
| `src/tools.ts` | 条件工具注册 |
| `src/constants/prompts.ts` | `getBriefSection` / `getProactiveSection` |
| `src/bootstrap/state.ts` | `getKairosActive` / `setKairosActive` / userMsgOptIn |
| `src/screens/REPL.tsx` | UI 集成 |
| `src/utils/sessionState.ts` | automation_state |
| `src/services/mcp/channelNotification.ts` | 频道通知 |
| `packages/builtin-tools/.../BriefTool/` | SendUserMessage |
| `packages/builtin-tools/.../SleepTool/` | Sleep |
| `packages/builtin-tools/.../SendUserFileTool/` | SendUserFile |
| `packages/builtin-tools/.../PushNotificationTool/` | Push |
| `packages/builtin-tools/.../SubscribePRTool/` | SubscribePR |
| `packages/builtin-tools/.../ScheduleCronTool/prompt.ts` | kairos cron GB 门 |
| `scripts/defines.ts` | `DEFAULT_BUILD_FEATURES` |
| `docs/features/proactive.md` | Proactive 专文 |
| `docs/features/auto-dream.md` | 记忆整理（非 KAIROS_DREAM flag） |

---

## 十一、相关文档

- `docs/features/proactive.md` — tick / Sleep / automation_state  
- `docs/features/auto-dream.md` — 记忆蒸馏（勿称 KAIROS_DREAM flag）  
- `docs/features/remote-control-self-hosting.md` — Bridge / RCS  
- `docs/internals/feature-flags.mdx` / `docs/internals/three-tier-gating.mdx` — feature + GB 分层  
- `CLAUDE.md` — Feature Flag 总表与 build 默认列表  

**维护约定**：改 KAIROS 门控或工具注册时同步更新本文 §1.2、§2、§5.2；不要把 Auto Dream 写回 KAIROS 子 flag 树。
