# densable 2.1.234 #49 — 回合间 bg 通知与 mid-turn 同标签

> Changelog: *Background task notifications between turns sent to model inside tags matching mid-turn delivery.*

## Gold (SEA)

| Symbol | Role |
|--------|------|
| `HD(...)` | enqueue XML `<task-notification>` children |
| `NCn` / `ZDr` | `[SYSTEM NOTIFICATION - NOT USER INPUT]` disclaimer (J9i) |
| `$Cn` / `X5o` | scheduled-task assigned-task banner (Q9i) |
| `fXs` | `<system-reminder>\n${NCn(escaped)}${ekd}` — API normalize |
| `Erb` | `<system-reminder>\n` + `ZDr` (idempotent open) |
| `ekd` | `\n</system-reminder>` |
| `Fws` | turn-start framing — **does not** wrap task-notification |
| mid-turn | `wrapCommandText` (NCn/$Cn) then `wrapMessagesInSystemReminder` |
| API user branch | `origin.kind==="task-notification"` → `$Cn` if scheduled-trigger else `fXs`; then `origin:void 0` |

`queueOrigin` / `queueMode` / `CFn` / `iNp` / `udv` exist in gold `processUserInput`. Local has no `iNp` consumers — **do not invent**.

## Local 1:1

| densable | Local |
|----------|-------|
| `NCn` | `wrapTaskNotificationDisclaimer` |
| `$Cn` | `wrapScheduledTaskDisclaimer` |
| `fXs` | `wrapTaskNotificationForApi` |
| API branch | `hardenTaskNotificationForApi` inside `normalizeMessagesForAPI` |
| mid-turn | `queued_command` → `wrapCommandText` + `wrapMessagesInSystemReminder` |
| `Fws` | `applyTurnStartOriginFraming` — still no-op for plain task-notification |

## Not ported

- `queueOrigin` / `queueMode` stamps (no local `CFn`/`iNp`)
- Gold cloud restart / Desktop / Mantle

## Tests

- `wrapResumePromptOrigin.test.ts` — fXs wrap, idempotent, escape, scheduled `$Cn`, array join, origin cleared
