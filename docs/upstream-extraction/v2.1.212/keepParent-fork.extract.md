# densable 2.1.212 — `/fork` keepParent session copy (`D$t`)

> Binary: `@anthropic-ai/claude-code-win32-x64@2.1.212` `claude.exe`  
> Extracted: 2026-08-05 · residual-3 pass same day

## Call graph

| Symbol | Role |
|--------|------|
| `_wd` | Slash meta: name=`fork`, desc=*Copy this conversation…*, `[prompt]` — session-copy when agent view ON |
| `L2p` / `nZ_` | React/local-jsx body: nZ_ preflight → L2p `Forking…` pane → `D$t keepParent` |
| `D$t` | Shared background spawn (`keepParent` branch = session fork) |
| `xZr` / `pwd` | In-session full-context agent (old `/fork`, now `/subtask` or gwd) |
| `gwd` / `i$y` | Agent-view **off**: `/fork` → `xZr` (directive required) |
| `vwd` / `s$y` | `/subtask` → `xZr` when agent view ON |
| `kei` / `Iei` | Process-level `forkReplayLaunchConfig` (appendSystemPrompt/agent/agents) |

Registration (binary):

```
CP() && !IS_DEMO ? [_wd, vwd] : [gwd]
// CP = agent view enabled
// _wd = session-copy /fork → nZ_ → L2p
// vwd = /subtask → s$y → xZr
// gwd = /fork → i$y → xZr
```

## `L2p` intermediate pane

```
useRef(false); useEffect once → D$t(..., { keepParent: true }, via="fork_session")
return jsx(Text, { dimColor: true, children: "Forking…" })
```

nZ_ returns the L2p element after preflight (not null). Toast/error via `onDone` after spawn.

## `D$t(..., { keepParent: true })` (offset ~243588362)

via = `"fork_session"` from L2p.

### Behavior when `keepParent`

1. **Coordinator**: `{ok:false, reason:"coordinator_mode"}`
2. **Name**: seed name + KW glyph + collapsed prompt label (60), or glyph+label alone; `nameSource: "auto"` when synthesized
3. **Do NOT hand off worktree** (`x = !keepParent && createdWorktree` → false)
4. **Flush**: `D6e(lastMessageUuid)` then `wa(flush, 10000)` — on fail hard error  
   `"Couldn't fork — this conversation is still being saved…"` / `flush_incomplete`
5. **Snapshot**: copy parent transcript → `jobs/<short>/tmp/parent-transcript.jsonl`  
   resume arg becomes **path** (not live parent session id) — live-parent (#24)
6. **Job fields**: `forkSourceAlive:true`, `forkBoundaryAt`, `forkSessionId`, `forkParentSessionId`, `bgIsolation:"default"`
7. **CLI args**: `--resume <snapshot> --fork-session` + optional `--permission-mode`, **`kei()`** merge:
   - `...$.agent ? ["--agent", $.agent] : []`
   - `...$.agents ? ["--agents", $.agents] : []`
   - `D = [...kei.append?, isolation?]` joined with **two spaces** → `--append-system-prompt`
   - `-- <prompt>`
8. **On spawn fail**: rm job dir if `!alive`; left_arrow-only queue_for_later (not for fork_session)
9. **Success toast** (L2p): multi-line system message  
   `` `${KW} forked into a background session · ${name|short}` `` + working/waiting lines + editsIn + attach tip

### `kei` / `Iei`

```
function kei(){ return Dt.forkReplayLaunchConfig }
function Iei(e){ Dt.forkReplayLaunchConfig = e }
// launch:
Iei({
  ...typeof a.appendSystemPrompt==="string" && a.appendSystemPrompt!=="" && {appendSystemPrompt:a.appendSystemPrompt},
  ...typeof a.agent==="string" && a.agent!=="" && {agent:a.agent},
  ...typeof a.agents==="string" && a.agents!=="" && {agents:a.agents},
})
```

### Toast strings (verbatim)

- `⑂ forked into a background session · …` (KW = fork glyph; local uses `FORK_GLYPH` U+2442)
- prompt: *it is already working, with everything from this conversation up to now · nothing here changes*
- no prompt: *…waiting for your first prompt…* + *tip: /fork \<prompt\> starts the copy working right away*
- edits: *this-tree* / *own-worktree* / relocated
- attach: `claude attach ${short}` / `← opens the agent view`

### Telemetry

- success: `repl_session_fork` + `tengu_session_fork` (`had_prompt`, `message_count`, `had_worktree`, `relocated`, …)
- fail: `repl_session_fork` + reason (`spawn_failed` / `flush_incomplete` / …)

## Local mapping (go-hare) — 2026-08-05 residual-3 pass

| densable | Local |
|----------|-------|
| `nZ_` guards | `getForkSessionPreflightError` + `isForkRestrictedLaunch` + persistence + coordinator + M9e null |
| `M9e` seed | `deriveForkSessionSeed` → `deriveBackgroundSeed` with `(forked)` default |
| `L2p` Forking… | `src/commands/fork/fork.tsx` `ForkingPane` (`<Text dimColor>Forking…</Text>`) |
| `D$t` keepParent | `spawnBackgroundSessionFork` |
| `kei`/`Iei` | `src/utils/forkReplayLaunchConfig.ts`; `Iei` at `main.tsx` launch; merge in spawn |
| worktree relocate `I.to=originalCwd` | child `cwd` = `wt.originalCwd`, `relocatedTo` / isolation prompt |
| snapshot resume path | `jobs/<short>/tmp/parent-transcript.jsonl`; `bgWorker.getTranscriptPath` accepts path |
| CLI inherit | `--permission-mode` `--model` `--effort` `--add-dir` tools + kei agent/agents/append |
| L2p toast | `formatForkSessionToast` |
| telemetry | `repl_session_fork` / `tengu_session_fork` via `logEvent` |
| job live-parent fields | `forkSourceAlive`… `bgIsolation:"default"` |
| `/subtask` → `xZr` | `src/commands/subtask/subtask.tsx` (agent view ON only) |
| agent-view-off `gwd→xZr` | `src/commands/fork/inSessionFork.tsx` + dual reg in `commands.ts` |

## Residual (after structured xZr toast pass 2026-08-05)

**None blocking for `/fork` 1:1.** Last two residuals closed:

| densable | Local (closed) |
|----------|----------------|
| gwd/subtask await `xZr` → `{name, agentId}` then toast with `agentId.slice(-4)` | `launchInSessionForkAgent` (xZr-shaped) + `inSessionFork` / `subtask` — no name-only soft toast |
| `_wd` meta no `load()`; real body `M2p`/`nZ_`/`L2p` | product `commands/fork/index.ts` `load → fork.tsx` intentionally implements L2p body (not densable incomplete shell) |

### Closed this pass (were residual)

| densable | Local |
|----------|-------|
| toast `.join(\`\\n\`)` | already `\n` (extract misread period earlier; binary is ``.join(`\n`)``) |
| L2p live qe(mode/effort/dirs/rules) | `ForkingPane` re-reads via `getAppState` at spawn |
| `Lle="EnterWorktree"` isolation | `isolate with EnterWorktree before…` |
| `v$e` / `currentSessionAiTitle` | `getCurrentSessionAiTitle` + cache on `saveAiGeneratedTitle` |
| `--plugin-dir-no-mcp` / `pluginDirNoMcp` / `skipMcpDiscovery` | CLI option + bootstrap state + loader + gXe merge |
| `xZr` → `{agentId, name}` for gwd/subtask toast | `src/commands/fork/launchInSessionForkAgent.ts` |

## Incomplete in densable binary (intentional local product wiring)

`_wd` has description/argumentHint/isEnabled but **no load()** in the 2.1.212 binary — the real session-copy body is registered separately (`tt(M2p,{call:()=>nZ_})` → L2p). Local does **not** ship an empty shell: `commands/fork/index.ts` `load → fork.tsx` is the complete L2p+D$t keepParent path. Do not strip `load` to “match” densable meta.

## P0–P1 pass (same day)

| densable | Local |
|----------|-------|
| `xei(Ajs)` / `Hei()` sticky | `setForkRestrictedLaunchConfig` at main launch; `isForkRestrictedLaunch` reads sticky |
| `rti` / `gXe()` replConfigArgv | `buildReplConfigArgv` + `setReplConfigArgv`; merged into child extraArgs |
| `D6e(leafUuid)` | `recordForkBoundaryLeaf` before flush |
| always `--permission-mode` | always push (default when unset) |
| `memoryToggledOff: _U()` | `!isAutoMemoryEnabled()` when unset |
| `wu(cwd)===null` editsIn | `findGitRoot(childCwd)` → `isGitRepo` |
| dual reg live `CP()` | `isAgentViewOffForFork()` inside `COMMANDS()` |
| gwd always registered when OFF | no FORK_SUBAGENT hard-null of gwd; gate inside call |
| gwd/subtask await agentId tail | `launchInSessionForkAgent` → structured `{name,agentId}` toast `slice(-4)` |
| `settings.worktree.bgIsolation==="none"` | nZ_ reads settings → `bgIsolationNone` into spawn |
| M9e agentColor | `getCurrentSessionAgentColor()` into seed |
