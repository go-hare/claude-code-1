# densable 2.1.235 · adversarial review — tools-perm

> Cluster: **#2 #6 #7 #12 #13 #17** · SEA `/tmp/official-235/plat/package/claude` · 2026-08-20  
> Do **not** trust HAVE labels. No auto commit.

## Verdict matrix

| id | sev | title | note |
| -- | --- | ----- | ---- |
| #2 | clean | LSP `hasEverConnected` latch | manager latch + `LSPTool.isEnabled` + `shouldDeferLspTool` → schema path |
| #6 | clean | Agent AVo/Abf omit-gate | call throws before GP default; prompt + telemetry wired |
| #7 | clean | notebook `contentWithheld` | `buildNotebookPermissionPreview` → dialog omit accept-session |
| #12 | critical | Edit/Write withhold + suppress producers | consumer stack real; local Edit/Write never set `contentWithheld`; no CLI ask producers; no tool hook impl |
| #13 | clean | embedded rg 15.0.x + `RipgrepUsageError` | newer than SEA 14.1.1; Grep/Glob rejectOnInputError; no JS invent |
| #17 | clean | SendMessage `message_too_large` / X1r | send refuse + recv drop + tool `errorClass` |

## Hollows checked

- `hasEverConnected` / `shouldDeferLspTool` — production, not test-only
- `isGeneralPurposeAvailable` — used in `AgentTool.call` + prompt
- `buildNotebookPermissionPreview` — used by `NotebookEditPermissionRequest`
- `shouldShowPersistentAllowOption` / `stripWholeToolGrantsForAsk` — consumers real; **producers sparse**
- `RipgrepUsageError` — thrown from `ripgrep.ts` when Grep/Glob set `rejectOnInputError`
- `UdsMessageTooLargeError` — thrown in `udsClient` before connect; SendMessage maps `errorClass`

## Invent-ban

- No #19 / gateway control plane / Desktop / `seven_day_overage_included` / storageV5 invent.
- #13: no JS patho engine; no 15→14 downgrade.
- #12 artifact `suppressAlwaysAllowRule:!0` SEA producers correctly **not** ported (Cowork/notification).

## Commit-staging risk

- Dirty `packages/@go-hare/claude-code-win32-x64/vendor/ripgrep/x64-win32/rg.exe` binary — do not mix silently into docs-only / non-#13 commits.
- Working tree mixes many 235 files + unrelated earlier test mods — stage per cluster.
