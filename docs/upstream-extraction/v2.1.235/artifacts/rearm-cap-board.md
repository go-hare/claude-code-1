# densable rearm 上限 · go-hare

> Living board · SEA dig → wire REARM_CAP · **no auto commit** · 2026-08-20

## Status

| Phase | State |
| ----- | ----- |
| SEA dig `T0S` / consecutiveRearms | **done** — same-episode after continuation claim |
| Local hollow confirm | **done** |
| Wire increment + cap | **landed** |
| xxi polarity | **fixed** — same-family eligible (`yDe`/`ZWs`/`Wjo`) |
| Tests | focused `quotaAutoResume.234` |
| Docs residual / gold | `snippets/gold-quota-rearm-T0S.txt` |
| Commit | wait 「提交」 |

## SEA rule (s0v)

Continuation claim + `main_thread` 429 → `consecutiveRearms++` then `$Za`/`rearmed`.
When `consecutiveRearms >= HEv(2)` → cancel `rearm_cap` + emit `cap-exhausted`.
Not merely new `resetsAt` autoArm (that path still resets via M4f `consecutiveRearms=0`).

`xxi`: `five_hour|seven_day|overage` always; `seven_day_opus` iff opus family; `seven_day_sonnet` iff sonnet family.

## Local land

- `quotaAutoResume.ts`: `onQuotaRejectedForAutoResume` / JEv `p4f` / xxi / `$Za`
- `claudeAiLimits.ts`: `quotaRejectedListeners` + emit on error path
- `claude.ts`: hAm bucket → `extractQuotaStatusFromError`
- UI already consumed `rearmed` / `cap-exhausted` in `useQuotaAutoResume.ts`

## Non-claims

- No invent Desktop/cloud handoff clients
- No invent full seven_day_overage_included / storageV5
- Do **not** commit until 「提交」
