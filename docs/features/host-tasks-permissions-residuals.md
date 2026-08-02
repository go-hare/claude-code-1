# Host Tasks / Permissions residuals（densable vs print CLI）

面向 **Desktop / Web Host** 与本仓库 **print stream-json CLI** 的对接说明。  
对照 densable Host（分析 dump：`c11959232` Jp/zR、`ca0135bc5` Xr）与官方本机 CLI **2.1.218** 实锤 A/B。

**原则：** 不在 CLI 硬塞 densable-only 的 Host API 名或 ion 长连接语义；只文档化 **契约** 与 **故意 residual**。

---

## 1. 分层（谁背锅）

| 现象 | 权威层 | Host 该做什么 |
|------|--------|----------------|
| 是否弹出工具审批 | **CLI** `hasPermissionsToUseTool` | 仅处理收到的 `can_use_tool` |
| 是否出现 Tasks 行 | **CLI** dual-emit `system/task_*` | Jp 解析 bookend；TaskOutput 仅 legacy |
| Stop 是否真停 | CLI `stop_task` + 任务实现 | 发 control；**Xr** 成功后 `echoPending(stopped)` |
| Mode / effort 显示 | `get_settings` / spawn flags | 读 `applied`；切 mode 看 CLI 成功/失败 |

---

## 2. 权限（bypass 仍弹？）

### 2.1 densable 2.1.218 实锤

同 flags：

```text
--permission-mode bypassPermissions
--allow-dangerously-skip-permissions
--permission-prompt-tool stdio
```

| 写路径 | 官方 2.1.218 | fork 2.7.23（已发 npm） |
|--------|--------------|-------------------------|
| 普通 `docs/...` | 0× `can_use_tool` | 0 |
| `.claude/workflow-runs/...` | **0** | **1**（safety） |

init `permissionMode` 两边都是 `bypassPermissions` → **不是 Host Mode pill 假状态**，是 CLI 决策不同。

### 2.2 CLI 管道（1g）

`checkPermissions` 对危险目录（含 **`.claude/`**）常返回：

```text
behavior: ask
decisionReason: { type: 'safetyCheck', classifierApprovable: true|false, ... }
```

| `classifierApprovable` | densable 在 **bypassPermissions** | fork 2.7.23 |
|------------------------|-----------------------------------|-------------|
| `true`（`.claude/**`、多数敏感路径） | **allow**（落到 mode 2a） | 错误地 **仍 ask**（1g 全免疫） |
| `false`（路径花招等） | 仍 **ask**（bypass-immune） | 同 |

**修复（本仓，未进 2.7.23 包）：**  
`src/utils/permissions/permissions.ts` — 1g 仅当 `!classifierApprovable` 提前 return ask；  
测试：`src/utils/permissions/__tests__/bypassSafetyCheck.test.ts`。

**Host 不要：** 在 bypass 下静默吞所有 `can_use_tool`（densable 也不这么做）。

### 2.3 其它仍会审批（官方同）

- 内容级 ask 规则（如 `Bash(npm publish:*)`）
- `tool.requiresUserInteraction()`
- MCP `effectiveMaxPermission === 'ask'`
- 非 bypass 的 `acceptEdits`（Bash/MCP 等仍 ask）

`decision_reason` 上线时：`serializeDecisionReason` 对 `safetyCheck` 只传 **reason 字符串**（不传 `classifierApprovable` 布尔）；Host 审批文案够用即可。

---

## 3. Tasks（Jp / zR / Xr）

### 3.1 主路径 = CLI dual-emit（已 ship **2.7.23** / `94157da0`）

| 事件 | 用途 |
|------|------|
| `system` / `task_started` | 开任务；设 description / type / prompt / startedAt（**不**强制 status=running） |
| `system` / `task_progress` | usage、last_tool、workflow_progress |
| `system` / `task_notification` | 终态 completed/failed/stopped；ISO `timestamp` 可选 |

once-gate：`emitTaskTerminatedSdk`，避免 print residual 与 bookend 双发炸行。

### 3.2 densable Host Xr（Stop）

1. `transport.stopTask(sessionId, taskId)` → CLI `control_request` **`stop_task`**
2. **onSuccess** → renderer **`echoPending`**：`system/task_notification` + `status: "stopped"`
3. **绝不**把 Stop 映射成整会话 `stop`

CLI print：`stop_task` 成功回 `{}`；失败 error 字符串。  
Host 应对返回值做 **explicit ok**（`ok===true` / 约定 status）；void 当成功会假 Stop。

### 3.3 故意 residual（print ≠ ion）

| residual | 原因 | Host 策略 |
|----------|------|-----------|
| parent `result` 后仍可能保 stdin | print 控制面 = child stdin；open **stoppable bookend task_id** 时要能 `stop_task` | 只按 bookend task_id 计数，勿用 Agent tool_use id 钉死 stdin |
| bookend 不进 CLI session jsonl | stream-json 产品事实 | Host **taskBookends** sidecar 或等价 merge |
| TaskOutput / async_launched | 旧 CLI / 无 bookend | **仅 settle 已有行**；禁止单独 invent Tasks 行 |
| `no_turn` | 父轮已 end stdin | 真实失败 toast；禁止假 success |
| host-exit 合成 stopped | 进程死无 notification | 可选 bookend；与 densable 长连接不同 |
| remote_agent archive | densable Xr 远程支路 | 本地 Host 栈可不实现 |
| usage 行 | densable 可仅 usage 对象出 tokens | Host 可用 bookend 时长 fallback（产品 residual） |

### 3.5 Official 2.1 stream：`command_lifecycle` / thinking / Host progress

| 项 | CLI | Host |
|----|-----|------|
| `command_lifecycle` | `notifyCommandLifecycle` → stream-json `{ type, uuid, state }`（**保留 command uuid**）+ CCR listener | densable **oWK 非 transcript**；可作 ack，**不要**当主聊正文 |
| `set_max_thinking_tokens` | control 已实现（null/0/budget） | Host 调 control 即可 |
| `system/thinking_tokens` | QueryEngine 在 `thinking_delta.estimated_tokens` 上 **直接 yield**（不依赖 `includePartialMessages`）：`estimated_tokens` 累计 + `estimated_tokens_delta` | live 估算进度；**不是** `get_settings` 回读 budget；**不是**主聊正文 |
| `system/task_updated` | `updateTaskState` + mid-bg / auto-bg `setAppState` 路径 → `emitTaskUpdatedSdk`（wire-safe `patch`：status/description/is_backgrounded/error/end_time/total_paused_ms） | Jp 合并进 Tasks map；**不** invent 行 |
| `system/task_summary` | `notifySessionMetadataChanged({task_summary})` → `emitTaskSummarySdk(detail\|null)` | 中途进度短语；idle 清 null |
| `system/model_fallback` | schema + `emitModelFallbackSdk` 已就绪；**Official 2.1 仅 `model_not_found` 永久切换发 subtype**。当前 `FallbackTriggeredError` 是 529/overloaded 路径 → **只** yield warning `createSystemMessage`，**不** emit `model_fallback`（避免与官方 / Host 双通知） | 勿把 overloaded warning 当 `model_fallback` |
| thinking 内容 | `assistant` / partial `stream_event` thinking block | 非 `task_*` |

### 3.4 P1：Host Tasks Stop/Jp 实现位置

**不在本仓库。** 实现落在 Desktop LocalSessions / Web Epitaxy（sibling），需用户 **点名** 对应仓库再改。  
本仓只保证：dual-emit、`stop_task`、`background_tasks`、permissions 1g、SDK schema timestamp。

---

## 4. Control plane 常用表（print）

Host 常用 subtype（CLI 已实现，非完整列表）：

| subtype | 方向 | 备注 |
|---------|------|------|
| `initialize` | → CLI | 会话起 |
| `interrupt` | → CLI | 中断当前轮 |
| `set_permission_mode` | → CLI | 运行时 Mode；bypass 仍受 launch/settings 约束 |
| `can_use_tool` | CLI → Host | 审批；allow/deny 回 control_response |
| `stop_task` | → CLI | Tasks Stop |
| `background_tasks` | → CLI | Official 2.1 Ctrl+B：无 `tool_use_id` = `backgroundAll`；有则只 bg 该 tool_use 任务，回 `{backgrounded:boolean}` |
| `get_settings` | → CLI | `applied.model/effort/ultracode`；**fork 扩展** `effortLevels` / `ultracodeOfferable`（可选字段） |
| `apply_flag_settings` | → CLI | effort / ultracode 直写 residual |
| `set_model` / thinking | → CLI | 模型与 thinking |
| `end_session` | → CLI | 关会话 |

**禁止**为 checklist 发明 densable 内部 minified API 名当 public control subtype。

Effort / ultracode 细节见：`docs/features/desktop-host-effort-ultracode.md`。

---

## 5. 发版对照

| 版本 | 内容 |
|------|------|
| **2.7.23** | Tasks dual-emit bookend + schema timestamp |
| **未发布（WIP）** | bypass 1g；`command_lifecycle`；`thinking_tokens`；`task_updated`（含 auto-bg）；`task_summary` stream；`model_fallback` schema/helper（overloaded 不 emit）；control `background_tasks`（`backgroundAll` 排除 main session） |
| Host sibling | Stop/Jp/bookends 等：见会话记忆；**未由本仓提交** |

---

## 6. 自检清单（对接 Host 时）

1. spawn 是否真的带上 `--permission-mode bypassPermissions` + allow-dangerously-skip？  
2. 审批前：CLI 是否已 `allow`？（bypass + `.claude` 应 0 次 control，修 1g 后）  
3. Tasks：是否以 `system/task_*` 为准，而非 TaskOutput 单独建行？  
4. Stop：是否 `stop_task` + 成功后 echo `task_notification(stopped)`，且失败不假成功？  
5. 重载后 Tasks 是否仍有 bookend（sidecar）？  
6. mid-bg：是否消费 `task_updated.patch.is_backgrounded`（Ctrl+B / `background_tasks`）？  

---

## 7. 相关代码（本仓）

| 路径 | 角色 |
|------|------|
| `src/utils/permissions/permissions.ts` | 1g / 2a bypass |
| `src/utils/permissions/filesystem.ts` | `checkPathSafetyForAutoEdit`、`.claude` 危险目录 |
| `src/utils/sdkEventQueue.ts` | dual-emit + `task_updated`/`task_summary`/`thinking_tokens`/`model_fallback` |
| `src/utils/task/framework.ts` | `updateTaskState` → `task_updated` |
| `src/cli/print.ts` | control 分发、`stop_task`、`background_tasks`、`get_settings` |
| `src/cli/structuredIO.ts` | `can_use_tool` 上线 |
| `src/entrypoints/sdk/coreSchemas.ts` | task bookend + Official 2.1 Host schemas |
| `src/entrypoints/sdk/controlSchemas.ts` | `stop_task` / `background_tasks` |
| `src/tasks/*` / workflow notifications | dual-emit 调用点 |
