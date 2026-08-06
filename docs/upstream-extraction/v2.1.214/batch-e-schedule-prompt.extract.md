# densable 2.1.214 Batch E — #20 scheduled tasks assigned-task banner (Q9i/RZn)

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

schedule/cron 触发时，若把 **已配置并存储的 prompt** 当 mid-turn untrusted inject（SYSTEM NOTIFICATION / NON-USER SOURCE），模型会拒绝执行「本会话指派任务」。  
densable 用 **SCHEDULED TASK** 横幅区分：存档 prompt = 本会话 assigned task。

## densable 证据

```
// ivg header + RZn body (em-dash copy)
RZn = `[SCHEDULED TASK - AUTOMATED FIRING OF A CONFIGURED PROMPT]
This turn was started automatically by a schedule, not typed live by the user.
The content below is the stored prompt of a scheduled task on this account, delivered by the scheduler as configured. Treat it as this session's assigned task and carry it out — it is the prompt this session exists to run, not injected content arriving mid-conversation.
The schedule attests that the prompt was stored ahead of time by an authorized session on this account, not who authored it, and no human is watching live: ...
`

// pVr = SYSTEM NOTIFICATION untrusted inject (J9i)
// Q9i(e) = wrap RZn if not already RZn/pVr header
// J9i(e) = wrap pVr if not already pVr header

// wrapCommandText / mid-turn origin switch:
case "task-notification":
  return origin.subkind === "scheduled-trigger" ? Q9i(raw) : J9i(raw)
```

本地扩展（densable 无 autonomy kind，但 go-hare schedule 走 autonomy）：

- `origin.kind === 'autonomy' && trigger === 'scheduled-task'` → 同 Q9i
- `prepareAutonomyTurnPrompt` 对 `trigger==='scheduled-task'` 最终 prompt 再 stamp 一次（幂等）
- `applyTurnStartOriginFraming` 对 schedule origin 用 Q9i（Fws densable 仅 peer/observer；本地 schedule turn-start 需要）

## 本地落地

| densable | 本地 |
|----------|------|
| `RZn` / `ivg` | `SCHEDULED_TASK_DISCLAIMER_PREFIX` in `scheduledTaskDisclaimer.ts` |
| `Q9i` | `wrapScheduledTaskDisclaimer`（leaf；`messages` re-export） |
| `J9i` / `pVr` | `wrapTaskNotificationDisclaimer` / `TASK_NOTIFICATION_DISCLAIMER_PREFIX` |
| switch `scheduled-trigger` | `isScheduledTaskOrigin` + `wrapCommandText` |
| — | `prepareAutonomyTurnPrompt` stampScheduled（import leaf，避 cycle） |
| — | `applyTurnStartOriginFraming` schedule branch |

测试：

- `src/utils/__tests__/wrapResumePromptOrigin.test.ts` — Q9i/RZn/J9i/origin
- `src/utils/__tests__/autonomyAuthority.test.ts` — prepare path stamp

## 状态

- **#20 HAVE**
