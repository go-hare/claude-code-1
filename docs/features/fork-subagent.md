# FORK_SUBAGENT — 上下文继承子 Agent

> 产品门：`isForkSubagentProductEnabled()`（densable 2.1.289 `Omo`）。编译旗标 `FORK_SUBAGENT` 保持注释，Agent 不读它。
> 实现状态：完整可用

## 一、功能概述

AgentTool 在 `subagent_type: "fork"` 时生成 fork 子 agent，继承父级完整对话上下文。子 agent 看到父级的所有历史消息、工具集和系统提示，并且与父级共享 API 请求前缀以最大化 prompt cache 命中率。交互会话默认允许这条路径。

### 核心优势

- **Prompt Cache 最大化**：多个并行 fork 共享相同的 API 请求前缀，只有最后的 directive 文本块不同
- **上下文完整性**：子 agent 继承父级的完整对话历史（包括 thinking config）
- **权限冒泡**：子 agent 的权限提示上浮到父级终端显示
- **Worktree 隔离**：支持 git worktree 隔离，子 agent 在独立分支工作

## 二、用户交互

### 触发方式

AgentTool 只有显式 `subagent_type: "fork"` 才走 fork。省略 type 是普通 agent，不是隐式 fork。

```
// Fork 路径（继承上下文）
Agent({ subagent_type: "fork", prompt: "修复这个 bug" })

// 普通 agent 路径（全新上下文）
Agent({ subagent_type: "general-purpose", prompt: "..." })
```

### /fork 与 /subtask（densable 2.1.212 — `D$t keepParent` / `xZr`）

| 命令 | densable | 行为 | 门控 |
|------|----------|------|------|
| **`/fork [prompt]`** | `L2p` → `D$t(..., {keepParent:true})` via=`fork_session` | **复制当前对话到新后台 session**（`claude agents` 独立一行），**主会话继续**。flush 10s 硬失败；parent transcript **快照**到 `jobs/<short>/tmp/parent-transcript.jsonl`（live-parent）；job 写 `forkSourceAlive` + boundary/ids + `bgIsolation:"default"`；densable 多行 toast | 非 coordinator；`BG_SESSIONS` + daemon |
| **`/subtask <task>`** | `s$y` → `xZr` | **会话内**全上下文 fork worker（212 前 `/fork`），结果经 task-notification 回主会话 | 显式 `subagent_type: "fork"`；产品门 `isForkSubagentProductEnabled()` |

实现入口：

- `src/utils/spawnBackgroundSessionFork.ts` — keepParent spawn + toast helpers
- `src/commands/fork/fork.tsx` — slash body
- `src/commands/subtask/subtask.tsx` — AgentTool omit `subagent_type`
- extract：`docs/upstream-extraction/v2.1.212/keepParent-fork.extract.md`

`/branch` **不再**占用 `fork` 别名（`/fork` 始终注册为独立命令）。

**densable agent-view OFF**：旧 `gwd` 把 `/fork` 指到 `xZr`。本地产品默认 agent view 路径（session-copy）；关闭 agent view 时仍用 session-copy（不回退到 directive-only xZr），避免双语义混淆。

交互会话里 subtask / `subagent_type: "fork"` 默认可用。headless 需要：

```bash
CLAUDE_CODE_FORK_SUBAGENT=1 claude
```

`CLAUDE_CODE_FORK_SUBAGENT=0` 或 coordinator 关闭。编译 `FEATURE_FORK_SUBAGENT` 不是产品门。

## 三、实现架构

### 3.1 门控

| 路径 | 门控 |
|------|------|
| **`/fork` session copy** | 始终注册；`isCoordinatorMode()` 禁用；运行时 `feature('BG_SESSIONS')` + daemon |
| **`/subtask` + AgentTool `subagent_type: "fork"`** | `isForkSubagentProductEnabled()`：coordinator 与 `CLAUDE_CODE_FORK_SUBAGENT` 假值先关；否则读会话 sticky。未 sticky 时 env 真值 → `env`（headless 也开），headless 且未设 env → `disabled`（不写入），交互默认 → `default` 并 sticky |

文件：`packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts`

```ts
export function isForkSubagentProductEnabled(): boolean
```

编译 `FORK_SUBAGENT` 不在 `DEFAULT_BUILD_FEATURES` 里，函数也不读 `feature('FORK_SUBAGENT')`。`src/utils/forkSubagentGate.ts` 是 2.1.232 的 `Drb`，289 的 `Yne` 不调用它。**`/fork` session copy 只看 coordinator，不看 Yne。**

### 3.2 FORK_AGENT 定义

```ts
export const FORK_AGENT = {
  agentType: 'fork',
  tools: ['*'],              // 通配符：使用父级完整工具集
  maxTurns: 200,
  model: 'inherit',          // 继承父级模型
  permissionMode: 'bubble',  // 权限冒泡到父级终端
  getSystemPrompt: () => '', // 不使用：直接传递父级已渲染 prompt
}
```

### 3.3 核心调用流程

```
AgentTool.call({ prompt, name })
      │
      ▼
isForkSubagentEnabled() && !subagent_type?
      │
      ├── No → 普通 agent 路径
      │
      └── Yes → Fork 路径
            │
            ▼
      递归防护检查
      ├── querySource === 'agent:builtin:fork' → 拒绝
      └── isInForkChild(messages) → 拒绝
            │
            ▼
      获取父级 system prompt
      ├── toolUseContext.renderedSystemPrompt（首选）
      └── buildEffectiveSystemPrompt（回退）
            │
            ▼
      buildForkedMessages(prompt, assistantMessage)
      ├── 克隆父级 assistant 消息
      ├── 生成占位符 tool_result
      └── 附加 directive 文本块
            │
            ▼
      [可选] buildWorktreeNotice()
            │
            ▼
      runAgent({
        useExactTools: true,
        override.systemPrompt: 父级,
        forkContextMessages: 父级消息,
        availableTools: 父级工具,
      })
```

### 3.4 消息构建：buildForkedMessages

文件：`packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts:107-169`

构建的消息结构：

```
[
  ...history (filterIncompleteToolCalls),  // 父级完整历史
  assistant(所有 tool_use 块),              // 父级当前 turn 的 assistant 消息
  user(
    占位符 tool_result × N +               // 相同占位符文本
    <fork-boilerplate> directive           // 每个 fork 不同
  )
]
```

**所有 fork 使用相同的占位符文本**：`"Fork started — processing in background"`。这确保多个并行 fork 的 API 请求前缀完全一致，最大化 prompt cache 命中。

### 3.5 递归防护

两层检查防止 fork 嵌套：

1. **querySource 检查**：`toolUseContext.options.querySource === 'agent:builtin:fork'`。在 `context.options` 上设置，抗自动压缩（autocompact 只重写消息不改 options）
2. **消息扫描**：`isInForkChild()` 扫描消息历史中的 `<fork-boilerplate>` 标签

### 3.6 Worktree 隔离通知

当 fork + worktree 组合时，追加通知告知子 agent：

> "你继承了父 agent 在 `{parentCwd}` 的对话上下文，但你在独立的 git worktree `{worktreeCwd}` 中操作。路径需要转换，编辑前重新读取。"

### 3.7 强制异步

当 `isForkSubagentEnabled()` 为 true 时，所有 agent 启动都强制异步。`run_in_background` 参数从 schema 中移除。统一通过 `<task-notification>` XML 消息交互。

## 四、Prompt Cache 优化

这是整个 fork 设计的核心优化目标：

| 优化点 | 实现 |
|--------|------|
| **相同 system prompt** | 直传 `renderedSystemPrompt`，避免重新渲染（GrowthBook 状态可能不一致） |
| **相同工具集** | `useExactTools: true` 直接使用父级工具，不经过 `resolveAgentTools` 过滤 |
| **相同 thinking config** | 继承父级 thinking 配置（非 fork agent 默认禁用 thinking） |
| **相同占位符结果** | 所有 fork 使用 `FORK_PLACEHOLDER_RESULT` 相同文本 |
| **ContentReplacementState 克隆** | 默认克隆父级替换状态，保持 wire prefix 一致 |

## 五、子 Agent 指令

`buildChildMessage()` 生成 `<fork-boilerplate>` 包裹的指令：

- 你是 fork worker，不是主 agent
- 禁止再次 spawn sub-agent（直接执行）
- 不要闲聊、不要元评论
- 直接使用工具
- 修改文件后要 commit，报告 commit hash
- 报告格式：`Scope:` / `Result:` / `Key files:` / `Files changed:` / `Issues:`

## 六、关键设计决策

1. **Fork ≠ 普通 agent**：fork 继承完整上下文，普通 agent 从零开始。选择依据是 `subagent_type` 是否为 `"fork"`
2. **renderedSystemPrompt 直传**：避免 fork 时重新调用 `getSystemPrompt()`。父级在 turn 开始时冻结 prompt 字节
3. **占位符结果共享**：多个并行 fork 使用完全相同的占位符，只有 directive 不同
4. **Coordinator 互斥**：Coordinator 模式下禁用 fork，两者有不兼容的委派模型
5. **非交互式默认禁用**：pipe / SDK 未设 `CLAUDE_CODE_FORK_SUBAGENT=1` 时 `Imo` 返回 `disabled`。一旦本会话记过 `env` 或 `default`，清掉环境变量不会重跑 headless 判定；假值环境变量和 coordinator 仍关

## 七、使用方式

```bash
# 交互会话默认可用。headless：
CLAUDE_CODE_FORK_SUBAGENT=1 claude

# Agent({ subagent_type: "fork", prompt: "研究这个模块的结构" })
```

## 八、文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts` | ~210 | 核心定义 + 消息构建 + 递归防护 |
| `packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx` | — | Fork 路由 + 强制异步 |
| `packages/builtin-tools/src/tools/AgentTool/prompt.ts` | — | "When to Fork" 提示词段落 |
| `packages/builtin-tools/src/tools/AgentTool/runAgent.ts` | — | useExactTools 路径 |
| `packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts` | — | Fork agent 恢复 |
| `src/constants/xml.ts` | — | XML 标签常量 |
| `src/utils/forkedAgent.ts` | — | CacheSafeParams + ContentReplacementState 克隆 |
| `src/commands/fork/index.ts` + `fork.tsx` | — | densable 212 `/fork`：bg session 拷贝 |
| `src/utils/spawnBackgroundSessionFork.ts` | — | `/fork` → writeA8q + submitDispatch resume/fork |
| `src/commands/subtask/index.ts` + `subtask.tsx` | — | densable 212 `/subtask`：`subagent_type: "fork"` |
| `src/utils/forkSubagentGate.ts` | — | 2.1.232 `Drb` sticky。289 `Yne` 不调用 |
