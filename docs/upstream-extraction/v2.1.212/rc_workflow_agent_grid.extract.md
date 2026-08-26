# densable 2.1.212 — #22 RC mid-join empty workflow agent grid

Changelog:

> Fixed the workflow agent grid staying empty for Remote Control clients that join a session mid-run

## Root cause (densable vs local)

Remote Control clients rebuild the workflow agent grid from `system/task_progress` frames that carry **`workflow_progress`** (full cumulative snapshot, not only the latest delta). densable wires three pieces:

| densable | role |
|----------|------|
| `JT` | enqueue SDK event when `dn()` (non-interactive) **or** `FC()` (replBridgeActive) |
| `FC` / `eDe` | process flag: bridge connected/ready → true; failed/teardown → false |
| `MGe` / `NZc` | post-enqueue listener; REPL bridge drains `DCt()` → `writeSdkMessages` |
| `IGg` + `j8r` onSdkEmit | HGg=16 coalesce; xGg=250 min gap when interactive+bridge; attach full `U.workflowProgress.filter(UNu)` when batch not progress-only **or** every kGg=10s |
| mid-flight agent tick | `state:"progress"` (not `"start"`) so progress-only batch gate works |

Local gaps before this fix:

1. `isReplBridgeActive()` always returned `false` → interactive RC sessions never queued `task_progress`.
2. `enqueueSdkEvent` only accepted non-interactive sessions.
3. No MGe drain in `useReplBridge` for task_* frames (only task_list `task_state` snapshot).
4. `taskProgressBridge` always emitted **batch deltas** as `workflowProgress`, never the cumulative task snapshot; agent_progress mapped to `state:"start"`.

## densable constants

| symbol | value |
|--------|-------|
| HGg | 16 ms coalesce |
| xGg | 250 ms min SDK gap (interactive+bridge) |
| kGg | 10000 ms full-snapshot throttle for progress-only batches |
| UNu | strip `workflow_log` from SDK payload |

## Local alignment

- `bootstrap/state.ts`: real `replBridgeActive` + `setReplBridgeActive` / `isReplBridgeActive`
- `sdkEventQueue.ts`: JT gate `!nonInteractive && !bridgeActive` skip; `setSdkEventEnqueueListener` (MGe)
- `useReplBridge.tsx`: eDe on connect/fail/teardown; MGe drain → `writeSdkMessages` task_* filter
- `taskProgressBridge.ts`: state `progress`; full snapshot + kGg; xGg when `!dn()&&FC()` (production default; `rateLimitSdk` test override only)
- `workflowProgress.ts` / `coreSchemas.ts`: agent state union includes `progress`

## Related

- `src/workflow/taskProgressBridge.ts`
- `src/utils/sdkEventQueue.ts`
- `src/hooks/useReplBridge.tsx`
- tests: `taskProgressBridge.test.ts`, `sdkEventQueue.bridgeActive.212.test.ts`
