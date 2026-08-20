# densable rearm 上限 · go-hare

> Living board · SEA dig → wire REARM_CAP · **no auto commit** · 2026-08-20

## Status

| Phase | State |
| ----- | ----- |
| SEA dig `T0S` / consecutiveRearms | **done** — same-episode after continuation claim |
| Local hollow confirm | **done** |
| Wire increment + cap | **landed** |
| xxi polarity | **fixed** — same-family eligible (`yDe`/`ZWs`/`Wjo`) |
| Tests | **25 pass** (`quotaAutoResume.234`) |
| Verification | **PASS**（xxi 纠偏后 spot-check 一致） |
| Docs / gold | `snippets/gold-quota-rearm-T0S.txt` · `progress.md` #16 |
| Commit | wait 「提交」 |

## SEA rule (s0v)

Continuation claim + `main_thread` 429 → `consecutiveRearms++` then `$Za`/`rearmed`.
When `consecutiveRearms >= HEv(2)` → cancel `rearm_cap` + emit `cap-exhausted`.
Not merely new `resetsAt` autoArm (M4f still resets `consecutiveRearms=0`).

`xxi`: `five_hour|seven_day|overage` always; `seven_day_opus` iff opus family; `seven_day_sonnet` iff sonnet family.

## Local land

- `quotaAutoResume.ts`: `onQuotaRejectedForAutoResume` / JEv `p4f` / xxi / `$Za`
- `claudeAiLimits.ts`: `quotaRejectedListeners` + emit on **error** path only
- `claude.ts`: hAm bucket → `extractQuotaStatusFromError`
- UI already consumed `rearmed` / `cap-exhausted` in `useQuotaAutoResume.ts`

## Spot-check

```
REARM_CAP 2
opus+opus true · opus+sonnet false · sonnet+sonnet true · sonnet+opus false
25 pass / 0 fail
```

## Non-claims

- No invent Desktop/cloud handoff clients
- No invent full `seven_day_overage_included` / storageV5
- Do **not** commit until 「提交」
