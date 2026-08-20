# densable 2.1.235 · adversarial review dig

> Living board · 2026-08-20 · **no auto commit** · SEA `/tmp/official-235/plat/package/claude`
> Scope: checklist **#1–#19** + extras (CLI IDE bridge / SDK host / quota rearm)
> Concurrency **3** · invent-ban intact · **不修代码**（本 board 仅审查收口）

## Status

| Phase | State |
| ----- | ----- |
| Fan-out dig | **done**（ux-input + tools-perm + rc/rearm clusters） |
| Spot-check | **done** — #12 / #18 production confirmed |
| Synthesis | **done** |
| C1 + I1 | **FIXED**（landed on main · wait 「提交」） |
| progress 计数 | **未改**（HAVE 18 暂留；本 board 记 honesty / residual closed） |
| Artifact | `6jEwzRCaA5lsTpOMLlZyz` → https://cloud-artifacts.claude-code-best.win/7d/6jEwzRCaA5lsTpOMLlZyz.html |
| Commit | wait 「提交」 |

## Numbering note（勿混）

| 标签 | 含义 |
| ---- | ---- |
| checklist **#12** | 主验收 = `suppressAlwaysAllowRule` consumer/UI/accept strip（**HAVE**）；文案另含「无法完整展示则 withhold」——**notebook (#7)** + **Edit/Write C1 FIXED** |
| checklist **#7** | notebook preview / `contentWithheld`（已接线 · HAVE） |
| checklist **#18** | 主验收 = `claude rc`↔interactive **enterprise-gateway** 同门（`vqo`/`mib`/`Glt` · **HAVE**） |
| 本审查 **C1** | Edit/Write SEA `B7S` withhold — **FIXED**（landed；非 checklist #12 整条假阳性） |
| 本审查 **I1** | `getBridgeDisabledReason` SEA `mX()` cloud-session 门 — **FIXED**（`vqo` 邻接分支 · 独立 residual 已闭合；#18 主验收仍 HAVE） |

## Findings

| id | sev | title | verdict |
| -- | --- | ----- | ------- |
| **C1** | **Critical→FIXED** | Edit/Write `contentWithheld`（SEA `B7S`/`GFt`/`sRe`） | **landed** — `filePermissionPreviewWithhold.ts` + Edit/Write + dialog wiring；测试 `filePermissionPreviewWithhold.235` / `getFilePermissionOptions.235` / `notebookPermissionPreview.235` |
| **I1** | **Important→FIXED** | cloud-session RC 门（SEA `mX`） | **landed** — `getBridgeDisabledReasonForCloudSession` 接线 `getBridgeDisabledReason`；测试 `bridgeCloudSessionGate.235` |
| #1 | clean | spellcheck underline-as-you-type | production path real |
| #3 | clean | md-list OIl=32 + hanging | ANSI + Ink both |
| #4 | clean | highlight multiline shift | HighlightedInput wired |
| #5 | clean | Shift+Tab ERg collapse | handleCycleMode |
| #8 | suggestion | oX unescape | display real；部分写路径 omit EHe/Ua |
| #15 | clean | vim savedCursorOffset | store + Oyr clamp |
| #16 | clean | getFocusedValue race | C4i bag live-read |
| #7 | clean | notebook `contentWithheld` | notebook HAVE；Edit/Write 同语义见 C1 FIXED |
| #12 checklist | **nuance→closed** | suppressAlways HAVE；withhold 文案 | suppress consumer **HAVE**；Edit/Write B7S withhold **C1 FIXED**（主验收口径不变） |
| #13 | clean | embedded rg 15.x | invent-ban 守住（不降 15→14） |
| #18 checklist | **nuance→closed** | rc gateway HAVE | gateway/`mib` **HAVE**；`mX` cloud 门 **I1 FIXED**（独立 residual 闭合） |
| #19 | N/A | VSCode host focus | invent-ban |
| rearm | clean | `HEv=2` / xxi same-family | wire+tests PASS（xxi 纠偏后） |
| uSm | clean | CLI IDE bridge 14 gates | HAVE（非 #19） |

### Critical — C1 Edit/Write `contentWithheld` · **FIXED**

**Why（产品）**：SEA `B7S` 对 Edit（`gN`）在 `old/new.length > GFt(200000)` 或 `sRe(...)` 时：

- `content: { kind:"no-changes", message:"Proposed edit is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected)." }`
- `contentWithheld: true` → standing accept-session / don't-ask-again 被否决

Write（`RL`）同类：过大 / 网络路径 / remote 不可检 → `contentWithheld` + one-time 文案。

**Landed（main，非仅 worktree）**：

- `/Users/apple/work-py/hare-code/claude-code-1/src/components/permissions/FilePermissionDialog/filePermissionPreviewWithhold.ts`
- wired through Edit/Write + `FilePermissionDialog` / `useFilePermissionDialog` / `permissionOptions`
- Worktree `wf_4f3b2e54-738-68920` 曾有 narrower C1-only 变体；**main 为 fuller landing**（另含 `#12 suppressPersistentAllow` + `#5 confirm:cycleMode`）
- No further merge/copy required

**Tests**：`filePermissionPreviewWithhold.235` / `getFilePermissionOptions.235` / `notebookPermissionPreview.235` — PASS（见 Result）

**Residual（non-blocking）**：UNC network withhold 仍 Windows-only（`containsVulnerableUncPath(..., true)`），同 notebook `#7`。

### Important — I1 cloud-session RC gate · **FIXED**

**SEA `vqo` / `getBridgeDisabledReason`**（`snippets/hit-rc-gateway.txt`）：

```js
if (mX()) return "Remote Control is not available inside a cloud session.";
// then managed policy / subscription / scope / org / GB …
```

`mX` ≈ `CLAUDE_CODE_REMOTE` 真值（232 gold 亦见 `$Y` / remote-env）。

**Landed（main）**：

- `/Users/apple/work-py/hare-code/claude-code-1/src/bridge/bridgeEnabled.ts`
  （`getBridgeDisabledReasonForCloudSession` / `mX`）
- `/Users/apple/work-py/hare-code/claude-code-1/src/bridge/__tests__/bridgeCloudSessionGate.235.test.ts`
- 接线进共享 `getBridgeDisabledReason`（endpoint 后、subscription 前）；densable 拒绝串对齐

**Tests**：`bridgeCloudSessionGate.235` — PASS（见 Result）

**Checklist #18**：enterprise-gateway 主验收仍 **HAVE**；I1 为独立 residual，现已闭合。

## Result

C1 and I1 are already present on main (not only in worktrees). No further merge/copy was required.

### Reconciliation

- **C1** on main:
  `/Users/apple/work-py/hare-code/claude-code-1/src/components/permissions/FilePermissionDialog/filePermissionPreviewWithhold.ts`
  wired through Edit/Write + `FilePermissionDialog` / `useFilePermissionDialog` / `permissionOptions`
- Worktree `wf_4f3b2e54-738-68920` had a narrower C1-only variant; **main is the fuller landing** (also includes `#12 suppressPersistentAllow` + `#5 confirm:cycleMode`)
- **I1** on main:
  `/Users/apple/work-py/hare-code/claude-code-1/src/bridge/bridgeEnabled.ts`
  (`getBridgeDisabledReasonForCloudSession` / `mX`) +
  `/Users/apple/work-py/hare-code/claude-code-1/src/bridge/__tests__/bridgeCloudSessionGate.235.test.ts`

### Tests

```text
bun test
  filePermissionPreviewWithhold.235.test.ts
  getFilePermissionOptions.235.test.ts
  notebookPermissionPreview.235.test.ts
  bridgeCloudSessionGate.235.test.ts
```

**20 pass / 0 fail** (36 expect calls)

### Remaining issues

None for these four files. Known non-blocking residual: UNC network withhold remains Windows-only (`containsVulnerableUncPath(..., true)`), same as notebook `#7`.

## Hollows checked（not hollow）

- `resolveConfirmCycleModeAction` — used by `useFilePermissionDialog.handleCycleMode`
- `getFocusedValue` — mutates `bag.state` sync；accept live-read
- `unescapeXmlEntities` — UserCommand/Bash/LocalCommand display
- `savedCursorOffset` — PromptInput remount/unmount
- `useSpellcheckHighlights` — PromptInput merge
- quota rearm — `REARM_CAP=2` + consecutiveRearms + xxi same-family（非空壳）

## Docs drift

- `snippets/gold-dialog-getFocusedValue.txt` / `hit-dialog-race.txt` 仍可能写 ABSENT — **stale**
- `snippets/gold-shift-tab-comment.txt` 仍可能写 always-accept-session — **stale**
- `progress.md` / `official-235-checklist.md` 仍写 HAVE **18** / #18 HAVE — **honesty 见下**（本轮**不改计数**；C1/I1 residual 已在 board 记闭合）

## Progress honesty（计数暂不改）

用户指示：本轮只写 review board + 报告，**不改** progress HAVE 数字。

诚实状态（修后 · wait 「提交」）：

- **C1 FIXED**：Edit/Write B7S withhold 已接线（复用 notebook `GFt`/`sRe`）；network UNC 仍 Windows-only（同 #7 residual）
- **I1 FIXED**：`mX`/`CLAUDE_CODE_REMOTE` 已进共享 diagnostic（endpoint 后、subscription 前）
- checklist #12 suppressAlways / #18 gateway HAVE 口径不变；progress 计数本轮仍未改
- residual closed 仅记于本 board / artifact，**不** bump HAVE

## Invent-ban

No #19 / gateway invent / Desktop·cloud handoff clients / storageV5 / rg 15→14 / JS fake fail-fast.

## Commit-staging risk

Working tree dirty：`*222*` / `*229*` / `*233*` 无关测试、可能的 win32 `rg.exe` churn、rearm 未提交 land、`claude.ts` 可能混 LSP import move。
**禁止**混 stage；**禁止**自动 commit / bump。

## Suggestions（非阻塞）

- #8：部分 slash 写路径相对 SEA 少 EHe/Ua（display oX 已有）
- rearm：合并重复 bucket 类型名；`isQuotaAutoResumeArmedOrPending` 命名易误导
- tip 历史：`1f8f61db` 曾 hollow REARM（工作树已 wire）；`goalCheckin` 混 commit 噪音
- UNC withhold：跨平台非阻塞 residual（同 #7）

## Spot-check log

```
SEA B7S Edit: contentWithheld + "Proposed edit is too large…"
Local FileEdit/FileWrite: contentWithheld wired via filePermissionPreviewWithhold (C1 FIXED)
Local Notebook: contentWithheld wired
SEA vqo: mX() → cloud session string
Local getBridgeDisabledReason: getBridgeDisabledReasonForCloudSession / mX (I1 FIXED)
Tests: 20 pass / 0 fail across four *.235.test.ts files
```
