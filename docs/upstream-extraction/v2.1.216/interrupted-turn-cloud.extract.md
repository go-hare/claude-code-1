# densable 2.1.216 #40 — cloud / resume interrupted turn

Official:

> Cloud sessions drop in-flight message on container restart mid-turn; resume
> re-runs interrupted turn

## densable gold

### Classification (`ku_` / local `detectTurnInterruption`)

- Last non-system/progress (skip api-error assistants) is:
  - **assistant** → completed (`none`)
  - **user** meta/compact → `none`
  - **user** tool_result → if terminal tool (SendUserMessage etc.) `none` else
    `interrupted_turn`
  - **user** plain → `interrupted_prompt` (resubmit same message)
  - **attachment** → walk back; often `interrupted_turn`

### Transform (`D_s` / `deserializeMessagesWithInterruptDetection`)

- `interrupted_turn` → append meta user `Oho()` (`CLAUDE_CODE_RESUME_PROMPT` or
  `"Continue from where you left off."`) → consumer only sees
  `interrupted_prompt`
- **Szu**: if `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` set and last
  turn message older than max (default 1h when non-numeric), force `none` and
  `tengu_resume_stale_turn_suppressed`
- Env gate `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` controls whether stale
  telemetry fires and whether print auto-enqueues

### Consume (`print` BJr)

- When kind ≠ none and resume env / `--reply-on-resume`: remove interrupted
  pair + enqueue content; `tengu_resume_interrupted_turn` with
  `surface:print|repl_restore`, `kind:synthetic_continue|resubmit`

### Cloud product

Strings like `Resumed your cloud container` / CCR are Anthropic cloud control
plane. Local CLI reuses the same transcript interrupted-turn path for gateway
restart / print resume — that is the 1:1 landable surface.

## Local land

| File | Change |
|------|--------|
| `conversationRecovery.ts` | `isResumeInterruptedTurnStale` (Szu) + wire suppress + stale event |
| `cli/print.ts` | BJr `tengu_resume_interrupted_turn` on auto-resume |

Prior HAVE: detect + transform + print auto-resume env gate.

tests: `interruptedTurnStale.216.test.ts`
