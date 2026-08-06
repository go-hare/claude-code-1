# densable 2.1.212 pack report

> Pack only — **do not implement from this note alone**. Extract densable first for each work item.
> Pack date: 2026-08-05
> Local product baseline: `@go-hare/claude-code` **2.7.27** / git `3dbad654` (211 fork-gate wrap-up)
> Alignment target moves: densable **2.1.211 → 2.1.212**

## 0. Artifacts

| Item | Path |
|------|------|
| Main npm shell (thin wrapper) | `npm pack @anthropic-ai/claude-code@2.1.212` → ~23KB, no bundle |
| Platform densable binary | `npm pack @anthropic-ai/claude-code-win32-x64@2.1.212` |
| Extracted SEA | `C:\Users\Administrator\AppData\Local\Temp\densable-212\package\claude.exe` (**255 334 560** bytes) |
| Upstream CHANGELOG full | `docs/upstream-extraction/v2.1.212/CHANGELOG.upstream.md` |
| Slice 2.1.212 / 211 / 210 | `changelog-2.1.212.md` etc. |
| Binary extracts | `spawnForkFromDirective.extract.md`, `fork_subtask_commands.extract.md`, `keepParent-fork.extract.md` (`D$t` session-copy), `websearch_cap_defaults.extract.md`, … |
| Cursor extension | local only **2.1.220 / 2.1.221** (no 212 dir); pack used **npm win32-x64@2.1.212** |

Notes:

- Main package `@anthropic-ai/claude-code@2.1.212` is install-wrapper only (`cli-wrapper.cjs` / `install.cjs` / stub `bin/claude.exe`).
- Real densable is platform package `claude.exe` (Node SEA). Prefer this over empty `~/.local/share/claude/versions/*`.

---

## 1. CHANGELOG headline (2.1.212 only)

Source: upstream `CHANGELOG.md` section `## 2.1.212` (also `changelog-2.1.212.md`).

### P0 product surface (alignment candidates)

1. **`/fork` semantics flip**
   - **New:** copies conversation into a **new background session** (own row in `claude agents`); user keeps working in main.
   - **Old in-session fork worker** → renamed **`/subtask`**.
   - Session copy named from **prompt** when untitled (`deriveForkName`: first 3 tokens, lowercased, ≤24 chars, fallback `"fork"`).
   - `/fork` live-parent protection must survive state write failure (changelog fix).

2. **`/subtask`**
   - New slash command; densable reuses same spawn helper as old fork path (`spawnForkFromDirective` / mangled `xZr`).
   - Description densable: *“Send a subagent off with your full context; its result comes back here”*.

3. **Session caps (runaway guards)**
   - WebSearch: default **200** / session — `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` (`zpg=200`, `vtu()`).
   - Subagent spawns: default **200** / session — `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` (`qpg=200`, `Etu()`).
   - `/clear` resets budgets (changelog).
   - taskRegistry densable API: `incrementTotalAgentSpawns` / `getTotalAgentSpawns` / `resetTotalAgentSpawns` + `incrementWebSearchCalls` / `getWebSearchCalls` / `resetWebSearchCalls`.

4. **MCP auto-background**
   - MCP tools running **> threshold** auto-move to background (changelog default **2 minutes**).
   - Env: `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (0 / unset / invalid = off in our partial resolver; densable uses positive ms).
   - Tool result copy densable: `MCP tool "…" is still running after …s. It was moved to the background as task …`.

5. **Agent-view `/resume`**
   - Opens picker of past sessions (including deleted-from-list); resume pick as **background** session.

6. **`claude auto-mode reset`**
   - Restore default auto-mode config; confirm prompt; `--yes` skip.
   - Telemetry/event densable: `cli_auto_mode_reset`; error: `auto-mode reset write failed`.

### P1 reliability / UX (selectively align if product cares)

- Plan mode: stop auto-running file-modifying Bash without permission / SDK `canUseTool`.
- Worktree: do not follow repo-committed symlink at `.claude/worktrees`.
- Hook `continue:false` halt not dropped mid-stream; hook infra errors ≠ user rejection.
- SIGTERM + Bash in print/SDK: abort turn, kill tree, exit **143**.
- Windows `/background` & `--bg`: prefer PowerShell **7** when GP blocks PS 5.1 (`uv_spawn` EUNKNOWN).
- Shell mode `!` + path autocomplete: still run commands with paths.
- Auto-mode denial truncation mid-emoji → broken chars fixed.
- Agent view Ctrl+J newline + `?` help.
- `/ultrareview` PR ref / branch fetch / billing after `/clear` / Desktop git error copy.
- Hosted sessions: ignore mTLS / extra CA / OAuth scopes from repo settings with warning.
- Edit after partial read resume: no false “File has not been read yet”.
- `ExitWorktree` after `--continue`/`--resume` print/SDK.
- Workflow grid empty for mid-run Remote Control joiners.
- Streaming control requests marked complete too early.
- Reopen stopped bg session: resume or show force-restart reason.
- Agent teams: no duplicate idle notifications on re-init.
- Plan-approval footer long path; welcome banner resize; narrow diff +/- markers.
- @-mention partial read; plugin uninstall marketplace; exit 143 false timeout.
- OTel HTTP non-chunked for Azure Monitor; OTLP TRACEPARENT span ids in SDK/headless.
- Large multi-image “Request too large” false fail + better message.
- WebSearch/WebFetch: don’t surface “API Error” as content; retry **529** + rate limit with backoff.
- Prompt caching mid-conversation system block behind gateways / custom base URLs.
- Cold attach shows formatted transcript immediately.
- `SendMessage` bodies not duplicated into replay history (token).
- Bare `/btw` reopens last side-question panel.
- `←` footer pulses **`N done`** briefly when bg agent finishes.
- Task tool **`mode` parameter deprecated** (ignored); subagents inherit parent permission mode.
- Enterprise `forceLoginMethod` enforced more surfaces (VS Code / SDK / setup-token / install-github-app).
- Transcripts record reasoning **effort** on assistant messages.
- Headless/SDK `set_model` mid-turn applies next round-trip.
- Agent view / `claude agents --json`: sandbox/MCP-input/managed-settings wait → **“Needs input”** not “Working”.
- Auth panel title: **“Authentication”** (was “Cloud authentication”).

### Adjacent (not 212 but in pack window)

| Ver | Why in pack |
|-----|-------------|
| **2.1.210** | Live elapsed-time on **collapsed tool** summary; worktree isolation git-mutation fix; ultracode human-only; attach settle; Bash timeout auto-bg messaging; agents footer “waiting on input”. |
| **2.1.211** | Host already partially landed (model_fallback / background_tasks_changed); `--forward-subagent-text`; many bg-agent fixes; always-allow rules at repo root; prompt-cache Bedrock/Vertex trailing system block. |
| **2.1.214** | EndConversation; progress heartbeat; more Bash permission fail-closed; bg session lifecycle fixes; SessionStart source `"fork"`. *Out of 212 scope unless user expands window.* |

---

## 2. Binary densable confirmation (2.1.212 `claude.exe`)

| Needle | Result |
|--------|--------|
| `2.1.212` version string | HIT |
| `/fork` + `Usage: /fork` | HIT (command + dual descriptions) |
| `/subtask` + `Usage: /subtask` | HIT |
| `spawnForkFromDirective` export name | HIT (mangled impl `xZr`) |
| `deriveForkName` | HIT (`pwd` impl) |
| `Fork started — processing in background` | HIT (`dfg`) |
| `tengu_fork_subagent_enabled` / `CLAUDE_CODE_FORK_SUBAGENT` | HIT |
| `isForkSubagentEnabled` / `buildForkedMessages` | HIT |
| `FORK_AGENT` `agentType:"fork"`, tools `*`, maxTurns 200, model inherit, permissionMode bubble | HIT |
| `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` / `MAX_SUBAGENTS` | HIT; defaults **`qpg=200,zpg=200`** |
| `incrementWebSearchCalls` / `incrementTotalAgentSpawns` | HIT |
| `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | HIT + MCP moved-to-background message |
| `cli_auto_mode_reset` / `auto-mode reset write failed` | HIT |
| `Needs input` agent status | HIT |
| `windowsHide` / `taskkill.exe` / `gracefulShutdown` | HIT (prior Windows notes still valid) |
| `UDS_INBOX` / `LAN_PIPES` / `TEAMMEM` / `KAIROS` string | MISS (feature DCE or rename; not proof of absence of all behavior) |
| `FEATURE_FORK` compile string | MISS (portable env/GB path present) |

### Densable `/fork` vs `/subtask` (from extract)

Both call the same `spawnForkFromDirective` (`xZr`):

```
// /fork (local-jsx)
description: "Copy this conversation into a new background session and keep working here"
// alternate registration still present in bundle:
// "Spawn a background agent that inherits the full conversation"

// /subtask
description: "Send a subagent off with your full context; its result comes back here"
Usage: /subtask <task>
```

`xZr` highlights:

- Reject: `endedByModel`, coordinator (`fb()`), missing system prompt.
- `replHydration: { kind: "fork", log: replayLog | resume transcript | [] }`.
- `deriveForkName(prompt)` → `taskRegistry.incrementTotalAgentSpawns()`.
- `isAsync: true`, `isBackgroundAgent: true`, `useExactTools: true`, `forkContextMessages: t.messages`.
- Child first user message via `buildChildMessage` / `o3r(e)` (fork boilerplate).
- Success toast: `` `${KW} forked ${name} (${agentId.slice(-4)})` ``.

**Implication for go-hare (resolved 2026-08-06):** densable 212 product `/fork` = **background session copy** (`spawnBackgroundSessionFork` + keepParent); in-session full-context worker = **`/subtask`**. Local tree matches; do **not** re-read this section as “still GAP”.

---

## 3. Gap matrix vs go-hare — **STALE SNAPSHOT (2026-08-05 pack day)**

> **2026-08-06 closeout:** 官方 checklist `official-212-checklist.md` = **HAVE 44 + N/A 1**，**0 GAP/PARTIAL**。  
> 下表是 pack 当日历史矩阵，**禁止当现状**。以 checklist + `residual-qre-jes-2026-08-06.md`（Qre/code-sessions 深挖）为准。  
> 对抗抽查已确认：`/fork` keepParent、`/subtask`、`sessionSpawnCaps`、`mcpAutoBackground` wire、`auto-mode reset`、ultrareview→Qre、OTe/KLc/H8/F1g/nts 均在树。

Legend: **GAP** = not present or wrong semantics · **PARTIAL** · **HAVE** · **N/A** product fork choice

| # | densable 212 item | Pack-day status (stale) | Notes / entry points |
|---|-------------------|-------------------------|----------------------|
| 1 | `/fork` → **bg session copy** | ~~GAP~~ → **HAVE** | `spawnBackgroundSessionFork` + keepParent |
| 2 | `/subtask` in-session full-context worker | ~~GAP~~ → **HAVE** | `src/commands/subtask` |
| 3 | `spawnForkFromDirective` + `deriveForkName` | ~~GAP~~ → **HAVE** | launchInSessionForkAgent / deriveForkName |
| 4 | WebSearch session cap (200 + env) | ~~GAP~~ → **HAVE** | `sessionSpawnCaps` + WebSearchTool |
| 5 | Subagent spawn cap (200 + env + `/clear` reset) | ~~GAP~~ → **HAVE** | `assertCanSpawnSubagent` + clear |
| 6 | MCP auto-background (threshold + move task) | ~~PARTIAL~~ → **HAVE** | wired `mcp/client.ts` + `mcpAutoBackground` |
| 7 | Agent-view `/resume` picker → bg | ~~PARTIAL?~~ → **HAVE** | openResumePicker batch3 |
| 8 | `claude auto-mode reset` | ~~GAP~~ → **HAVE** | autoModeResetHandler |
| 9–16 | reliability / UX audits | ~~audit~~ → **HAVE** | see official checklist rows |
| 17 | Live elapsed on collapsed tool (210) | PARTIAL (out of 212) | 210 adjacent |
| 18–20 | gates / host / intentional off | **HAVE** | unchanged |

---

## 4. Suggested alignment phases (when implementing)

**Phase A — caps & MCP auto-bg (low product risk, high safety)**  
1. Port densable env resolvers + defaults 200/200.  
2. taskRegistry counters + WebSearchTool / AgentTool call sites + `/clear` reset.  
3. Wire `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (default densable 120_000 if confirmed at call site — changelog says 2 minutes; env override).  
*Extract full call sites from binary before coding.*

**Phase B — `/fork` / `/subtask` semantics (largest product change)**  
1. Implement densable `spawnForkFromDirective` path for **background session** `/fork`.  
2. Move current AgentTool fork UX to **`/subtask`**.  
3. Docs: `docs/features/fork-subagent.md` currently describes **in-session** fork as `/fork` — will need rewrite.  
4. Gate: keep `isForkSubagentEnabled` for **subtask**/AgentTool fork; `/fork` bg-session may use different enablement (densable `isEnabled: () => !coordinator`).

**Phase C — agent view / resume / auto-mode reset**  
Depends on BG_SESSIONS / agents dashboard maturity.

**Phase D — cherry-pick 212 fixes**  
Permission/hooks/Windows bg/Web retry — one extract per fix.

**Out of default 212 pack unless asked:** 2.1.214 EndConversation, full 210–214 bugfarm, enabling UDS/LAN/TEAMMEM.

---

## 5. Densable identifiers (mangled → role)

| Role | Mangled / symbol |
|------|------------------|
| `spawnForkFromDirective` | `xZr` |
| `deriveForkName` | `pwd` |
| `/fork` call | `i$y` |
| `/subtask` call | `s$y` |
| max subagents getter | `Etu` → `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION ?? qpg` |
| max web searches getter | `vtu` → `…_WEB_SEARCHES… ?? zpg` |
| defaults | `qpg=200`, `zpg=200`, `t3r=5` (unrelated constant nearby) |
| FORK_AGENT | `UX`, `Hge="fork"`, placeholder `dfg` |
| GB | `tengu_fork_subagent_enabled`, `tengu_copper_fox` |

---

## 6. Open questions (resolve at implement time)

1. densable ships **two** `/fork` command registrations in one binary (`Spawn a background agent…` vs `Copy this conversation…`) — which is active under which flag? Pack assumes changelog wins: **bg session copy**.  
2. Exact default for `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` when unset: changelog “2 minutes” vs our local resolver “0 = disabled”. Need call-site extract (`?? 120000` vs require env).  
3. Cap enforcement UX: hard error vs tool deny message (need string extract for web/subagent limit).  
4. Whether go-hare should keep legacy `/fork` = in-session as alias until users migrate.

---

## 7. Pack completeness checklist

- [x] Locate densable 2.1.212 binary (npm win32-x64)
- [x] Upstream CHANGELOG 212 (+ 211/210 context)
- [x] Keyword / surface inventory on binary
- [x] Gap matrix vs current main
- [x] Raw extracts under `docs/upstream-extraction/v2.1.212/`
- [x] Official 48-row checklist → **HAVE 44 + N/A 1** (`official-212-checklist.md`)
- [x] Phases A–D product paths landed (caps/MCP auto-bg, `/fork`+`/subtask`, auto-mode reset, reliability/UX)
- [x] Ultrareview / Qre / code-sessions peripheral 1:1 (`residual-qre-jes-2026-08-06.md`)

## 8. Closeout (2026-08-06)

| 范围 | 结论 |
|------|------|
| 官方 2.1.212 changelog 48 条 | **收口** — 0 产品 GAP |
| densable Qre/Jes/eHu/ZCu + OTe/KLc/H8/F1g/nts | **1:1 落地** — 见 residual 文档 |
| 故意不扩 | UDS/LAN/TEAMMEM OFF；KAIROS 不再动；不混 **214** EndConversation / **210** collapsed-tool elapsed |
| 工程债（非 212 产品） | autofix `mock.module` 与 sibling 套件同进程污染；全量 precheck 可能慢 |

**权威状态源：** `official-212-checklist.md` + `residual-qre-jes-2026-08-06.md`。本 pack-report §2–§4 含历史叙事，仅作考古。
