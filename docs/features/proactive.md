# PROACTIVE — 主动模式

> Feature Flag: `FEATURE_PROACTIVE=1`（与 `FEATURE_KAIROS=1` 共享功能）
> 实现状态：核心循环与 SleepTool 已落地，部分外围文档仍在补齐
> 引用数：37

## 一、功能概述

PROACTIVE 实现 Tick 驱动的自主代理。CLI 在用户不输入时也能持续工作：定时唤醒执行任务，配合 SleepTool 控制节奏。适用于长时间运行的后台任务（等待 CI、监控文件变化、定时检查等）。

### 与 KAIROS 的关系

所有代码检查都是 `feature('PROACTIVE') || feature('KAIROS')`，即：
- 单独开 `FEATURE_PROACTIVE=1` → 获得 proactive 能力
- 单独开 `FEATURE_KAIROS=1` → 自动获得 proactive 能力
- 两者都开 → 相同效果（不重复）

## 二、实现架构

### 2.1 模块状态

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| 核心逻辑 | `src/proactive/index.ts` | **已实现** | `activateProactive()`、`deactivateProactive()`、`pause/resume`、`nextTickAt` 调度状态 |
| Tick hook | `src/proactive/useProactive.ts` | **已实现** | REPL 内注入 `<tick>`（`PROACTIVE \|\| KAIROS` 时挂载） |
| SleepTool | `packages/builtin-tools/src/tools/SleepTool/` | **完整** | 工具名 `Sleep`；注册门控 `PROACTIVE \|\| KAIROS` |
| 命令 | `src/commands/proactive.ts` | **已实现** | `/proactive`；`src/commands.ts` 条件注册 |
| 工具注册 | `src/tools.ts` | **布线** | 条件 `require` SleepTool |
| REPL 集成 | `src/screens/REPL.tsx` | **已实现** | tick、standby/sleeping、页脚与 bridge automation metadata |
| 系统提示 | `src/constants/prompts.ts` → `getProactiveSection()` | **完整** | 自主工作行为指令（行号会漂，以函数名为准） |
| 远控状态镜像 | `src/utils/sessionState.ts` | **已实现** | 向 remote-control/CCR 暴露 `automation_state` 元数据 |
| 交叉文档 | `docs/features/kairos.md` | — | 常驻助手全栈（KAIROS ⊃ proactive 门控） |

### 2.2 系统提示内容

`getProactiveSection()` 注入的自主工作指令包含：

| 章节 | 内容 |
|------|------|
| Tick 驱动 | `<tick_tag>` prompt 保持存活，包含用户本地时间 |
| 节奏控制 | SleepTool 控制等待间隔，prompt cache 5 分钟过期 |
| 空操作规则 | 无事可做时**必须**调用 Sleep，禁止输出 "still waiting" |
| 首次唤醒 | 简短问候，等待方向（不主动探索） |
| 后续唤醒 | 寻找有用工作：调查、验证、检查（不 spam 用户） |
| 偏向行动 | 读文件、搜索代码、commit — 不需询问 |
| 终端焦点 | `terminalFocus` 字段调节自主程度 |

### 2.3 数据流

```
activateProactive()
      │
      ▼
Tick 调度器启动
      │
      ├── 定时生成 <tick_tag> 消息
      │   ├── 包含用户当前本地时间
      │   └── 注入到对话流（sessionStorage）
      │
      ▼
模型处理 tick
      │
      ├── 有事可做 → 使用工具执行 → 可能再次 Sleep
      └── 无事可做 → 必须调用 SleepTool
      │
      ▼
SleepTool 等待
      │
      ├── 用户插入新工作 / 队列中有命令 → 立即唤醒
      ├── proactive 被关闭 → 立即中断
      └── 进入休眠时向远端 surfaces 上报 `automation_state = sleeping`
      │
      ▼
下一个 tick 到达
```

## 三、当前行为补充

- `standby`：proactive 已开启，当前没有执行中的 turn，且已调度下一个 tick。
- `sleeping`：模型显式调用 `SleepTool` 进入等待窗口。
- remote-control/CCR 通过 `external_metadata.automation_state` 接收这两个状态，用于 Web UI 的 Autopilot 状态显示。
- `SleepTool` 现在不是纯定时器；它会在共享命令队列出现新工作时提前醒来。

## 四、关键设计决策

1. **Tick 驱动**：模型通过 SleepTool 自行控制唤醒频率，不是外部事件推送
2. **空操作必须 Sleep**：防止 "still waiting" 类空消息浪费 turn 和 token
3. **Prompt cache 考量**：SleepTool 提示中提到 cache 5 分钟过期，建议平衡等待时间
4. **Terminal Focus 感知**：模型根据用户是否在看终端调整自主程度

## 五、使用方式

```bash
# 默认 build 已含 KAIROS → 已具备 proactive 编译门控
bun run dev
claude --proactive          # 启动即 activate
# 或会话内 /proactive

# 若产物未编入 KAIROS，可单独开 PROACTIVE
FEATURE_PROACTIVE=1 bun run dev
```

## 六、文件索引

| 文件 | 职责 |
|------|------|
| `src/proactive/index.ts` | 核心逻辑与 next-tick 状态 |
| `src/proactive/useProactive.ts` | REPL tick 调度 hook |
| `packages/builtin-tools/src/tools/SleepTool/` | Sleep 工具 |
| `src/constants/prompts.ts` | `getProactiveSection()` |
| `src/screens/REPL.tsx` | REPL tick 集成与 automation 状态上报 |
| `src/utils/sessionState.ts` | bridge/CCR metadata 镜像 |
| `src/commands/proactive.ts` | `/proactive` |
| `docs/features/kairos.md` | KAIROS 全栈与门控 |
