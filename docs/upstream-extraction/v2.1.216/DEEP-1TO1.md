# densable 2.1.216 — Deep 1:1 dig

> Pack date: **2026-08-06**  
> SEA: `/tmp/official-216/plat/package/claude` (249 225 584 B, **2.1.216**, `7fead72f…`)  
> Rule: **extract densable → 1:1 port**. No simplified substitutes. Prefer GAP/PARTIAL over false HAVE.  
> Companion: `pack-report.md`, `official-216-checklist.md`, per-item `*.extract.md`.

---

## 0. What “1:1” means here

| Layer | densable source of truth | Port rule |
|-------|--------------------------|-----------|
| Settings schema | Zod field + **full describe string** | Same key path, same platform caveats, same managed vs project precedence |
| Runtime gate | Minified functions recovered from SEA | Same early-return shapes, env scrub keys, refuse strings |
| CLI flags / copy | Help strings + error templates | Same flag names + same user-visible wording |
| Security deny | Guard return strings | Same reason phrases where product-facing |
| Telemetry | `tengu_*` / field names | Prefer densable event names when landing |

If SEA body is unrecoverable, mark **UNCERTAIN** and extract more before coding.

---

## 1. Counts (this dig)

| Metric | Value |
|--------|------:|
| Deep items with full extract | **8** |
| Status **GAP** | **0** deep-table items (worktree-git/normalize/daemon-stop/rewind/claude-write/askuser all landed or tracked in checklist) |
| Status **PARTIAL** | **0** |
| Status **HAVE** (deep) | normalize, auto-mode-401, resume-agent-identity (#7), bg-startup-cancel (#15), mcp-reauth (#19) + isolation batch |
| densable needles hit (aggregate) | **40+** HIT across 8 items |
| Primary local touch surfaces | sandbox adapter/types, worktree + BashTool, messages.ts LN, daemon stop, fileHistory, sideQuery/yoloClassifier, cron/workflow writes, AskUserQuestionTool |

---

## 2. Implement order (ruthless)

Security / isolation first; long-session correctness next; copy last.

| Order | id | Changelog # | Item | Status | Extract |
|------:|----|------------:|------|--------|---------|
| 1 | `fs-disabled` | 1 | `sandbox.filesystem.disabled` | **HAVE** (dual facade + Bou + uCg) | `sandbox-filesystem-disabled.extract.md` |
| 2 | `worktree-git` | 8 | Worktree git escape (`XB` + `wxu` + cwd gate) | **HAVE** | `worktree-git-isolation.extract.md` |
| 3 | `daemon-stop-any` | 11 | `daemon stop --any` + holder verification | **HAVE** | `daemon-stop-any.extract.md` |
| 4 | `rewind-symlink` | 36/40 | `/rewind` refuse symlink/hardlink + skip report | **HAVE** | `rewind-symlink-hardlink.extract.md` |
| 5 | `claude-symlink-write` | 18 | Workflow/cron writes not follow `.claude` symlink | **HAVE** | `claude-symlink-write.extract.md` |
| 6 | `normalize` | 2 | Long-session normalize quadratic (LN Map+cursor) | **HAVE** | `normalize-quadratic.extract.md` |
| 7 | `auto-mode-401` | 3 | Auto-mode classifier vs OAuth 401 | **HAVE** | `auto-mode-401.extract.md` |
| 8 | `askuser-neutral` | 4 | AskUser free-text neutral wording | **HAVE** | `askuser-free-text.extract.md` |
| — | `resume-agent-identity` | 7 | Resumed bg agent prompt+tools identity | **HAVE** | `resume-agent-identity.extract.md` |
| — | `bg-startup-cancel` | 15 | High-priority interrupt during bg spawn startup | **HAVE** | `bg-startup-cancel.extract.md` |
| — | `mcp-reauth` | 19 | MCP re-auth order + needs-reauth toast | **HAVE** | `mcp-reauth.extract.md` |
| — | `windows-network-path-ro` | 20 | Windows RO UNC/network path prompt (`sI` path mode) | **HAVE** | `windows-network-path-ro.extract.md` |
| — | `worktree-foreign-repo` | 9 | Worktree resume foreign leftover refuse | **HAVE** | `worktree-foreign-repo.extract.md` |
| — | `list-negation-redirect` | 13 | Bash `&&`/negation redirects (`uxg`/`$uu`) | **HAVE** | `list-negation-redirect.extract.md` |
| — | `non-ascii-word-boundary` | 21 | Bash non-ASCII word (`guu`) | **HAVE** | `non-ascii-word-boundary.extract.md` |
| — | `ps-invisible-control-chars` | 22 | PS/Bash schema `XAu`/`r0e`/`Wjg` | **HAVE** | `ps-invisible-control-chars.extract.md` |
| — | `ps-git-gh-args` | 31 | PS `git`/`gh` RO (`I5g`/`oDu`/`XIu`) | **HAVE** | `ps-git-gh-args.extract.md` |

Do **not** start P2 fullscreen / skill-menu polish before these P0/P1 items.

---

## 3. Deep findings (executive)

### 3.1 `fs-disabled` — HAVE

- Schema `disabled` + managed pin + unrestricted Gvg/Wvg + **dual facade** (OUTER getFs* raw lists vs convert/wrap unrestricted).
- Bou `override.filesystem` disabled gate; `getLinuxGlobPatternWarnings` → `[]` when disabled.
- credentials schema first-class (QTi/ZTi/oeh) + `mergeSandboxCredentialsForRuntime` pass-through; sandbox-runtime **^0.0.70** package Anu/vnu/Vzi mask (no host invent). Native `filesystem.disabled`.
- See `sandbox-filesystem-disabled.extract.md`.

### 3.2 `worktree-git` — HAVE

- **Two** densable mechanisms (do not collapse):
  - **A)** `XB` host git env scrub (4 keys only).
  - **B)** Shell pre-exec: ALS cwd gate + bash-only static `wxu` (not Y6g Ros scrub).
- Analytics: `tengu_agent_worktree_cwd_escape_blocked` reasons `context_lost|worktree_gone|shared_checkout|command_redirect`.
- Local: `src/utils/worktreeGitIsolation.ts`.
- See `worktree-git-isolation.extract.md`.

### 3.3 `normalize` — HAVE

- densable **2.1.216 LN** Map+cursor assistant merge in `normalizeMessagesForAPI` (local has pre/post counts + checkpoints).
- Segment transparency: `api_system` + tool_result users transparent; clear on ordinary non-assistant.
- tests: `normalizeMessagesForAPI.quadratic.216.test.ts`.
- See `normalize-quadratic.extract.md`.

### 3.4 `daemon-stop-any` — HAVE

- Never SIGTERM without `DSr` (`procStart`) + cmdline/procStart identity; UTe loose lock.
- Client **wUs/AUs** (`clientBgReap.ts`): control → `supervisorKilledAll` + fallback `wUs`; `--keep-workers` skip; kept note; Math.max reaped.
- See `daemon-stop-any.extract.md`. tests: `daemonStop.216` / `daemonStopReap.216` / `readDaemonLockLoose.216`.

### 3.5 `rewind-symlink` — HAVE

- Pre-touch `Q3g` + restore `Z3g` (`O_NOFOLLOW`) + `skippedLinks` return/telemetry/SDK/CLI.
- dryRun omits `skippedLinks` and does not run Q3g.
- **TYn** residual closed: MessageSelector `onRestoreCode` → `{skippedLinks}` + densable Ge copy; CLI stderr Warning with TYn.
- See `rewind-symlink-hardlink.extract.md`.

### 3.6 `auto-mode-401` — HAVE (2026-08-06)

- `sideQuery` recover+single-retry + `tengu_oauth_401_sidequery_recovered` + T9r clear.
- Classifier `errorKind`/`httpStatus`; `Mhd` excludes `/^http_401/` demotion; fail-closed main path vs handoff CYu allow-with-warning.
- f6d empty — no invented user-facing `"HTTP 401"`.
- See `auto-mode-401.extract.md`.

### 3.6b `resume-agent-identity` (#7) — HAVE (2026-08-06; in-memory mirror 2026-08-07)

- Spawn sidecar: `isFork` when fork+built-in, `agentType`/`model`/`spawnMode`/`worktree*`/`cwd`/`parentAgentId`/`toolUseId`/…
- H4d `$Ns` merge: `isObserver`/`observerStopped`/`observerTaskId`/`armingPermissionMode` survive full rewrite.
- Aye: `isFork===true` short-circuit → FORK_AGENT + exact tools; type lookup; else GENERAL_PURPOSE; model pin non-observer.
- See `resume-agent-identity.extract.md`. Disk-missing warm path: densable `g.getTranscript(e)?.messages` → local `tasks[agentId].messages` + densable log copy; cold path still requires disk.
- densable `me`/`Ce` taxonomy: `tengu_feature_bad` (`subagent_resume_transcript_missing` / `subagent_resume_fork_prompt_missing`) + `tengu_feature_ok` on alreadyCompleted/normal return.

### 3.6c `bg-startup-cancel` (#15) — HAVE (2026-08-06)

- densable `L(Me)` + post-setup gate: if aborted and `!(G && q_(reason)==="interrupt")` throw; else continue.
- `L(G&&!B)` — only **local async** gets interrupt immunity (remote isolation still fails on parent abort).
- Flt async register without `parentAbortController` (independent abort); high-priority REPL `abort('interrupt')` must not cancel mid-startup.
- Local: `assertCanSpawnSubagent({allowInterrupt})`, `isInterruptAbortReason`, AgentTool pre-register gate + worktree cleanup.
- **Not** `CLAUDE_BG_STARTUP_WEDGE_MS` (job dialog wedge false lead).
- See `bg-startup-cancel.extract.md`.

### 3.6d `mcp-reauth` (#19) — HAVE (2026-08-06)

- UI: `QLu` snapshot → `ebe` OAuth (no pre-`wat`) → reconnect `connected` → `eMu` revoke replaced only.
- Refresh permanent clear (`invalid_grant` / DCR client) → `t7r.emit` → per-server toast `mcp-needs-reauth-${name}` + densable copy.
- Toast silent skip densable `oKn || XAA`: `n5e` Authorization, `DYt`/`prg` WeakSet identity, design MCP+Claude, XAA — **not** truthy `headersHelper` string (`nKn` is separate).
- CLI `mcp login` still `wat` before OAuth — densable SEA gold; keep 1:1.
- See `mcp-reauth.extract.md`.

### 3.6e `windows-network-path-ro` (#20) — HAVE (2026-08-06)

- densable `sI(e,t=!1)` path mode: bare `//`/`\\`, short-flag strip, single-separator mixed UNC with `(?<![:\w])`.
- densable `Rjr`: `sI(o,!0)` + `%` windows-only + backtick expansion gate.
- RO Bash/PS call path-mode so network paths never auto-allow.
- See `windows-network-path-ro.extract.md`. Residual: densable `Ajr` `..` segment gate is separate (not #20 product line).

### 3.6f `worktree-foreign-repo` (#9) — HAVE (2026-08-06)

- densable `DXi` resume: `OGr` gitdir + `stat(dirname(gitdir))` vs `stat(repoGitDir/worktrees)` by **dev/ino** (or expected enoent).
- Telemetry `git_worktree_resume_foreign_repo` + densable error copy.
- Local: `readWorktreeGitDir` + `assertWorktreeNotForeignRepo` on `existingHead` resume.
- See `worktree-foreign-repo.extract.md`. Residual: densable `TLg` clean-refresh / `ELg` orphan self-heal out of #9 scope; `logEvent` single-name vs densable `me(create, resume_foreign)`.

### 3.7 `claude-symlink-write` — HAVE

- Shared `YNn` dir-chain `O_NOFOLLOW` + `M6` writeFileAndFlush; `nWr` cron + `L1a` workflow save.
- VEt skip only for real config-dir identity (not `endsWith('.claude')`).
- Local: `src/utils/symlinkWriteGuard.ts` + `cronTasks` nWr + `saveDynamicWorkflow` L1a; workflow-engine `persistInline` local YNn subset.
- See `claude-symlink-write.extract.md`.

### 3.8 `askuser-neutral` — HAVE

- Structural purity branch (not NLP on “wait/explain”): pure MC → continue template; free-text/notes/response → neutral careful-read template.
- Local: `AskUserQuestionTool` mapToolResult + tests `mapToolResult.216`.
- See `askuser-free-text.extract.md`.

---

## 4. File index

| Path | Role |
|------|------|
| `DEEP-1TO1.md` | This master index |
| `sandbox-filesystem-disabled.extract.md` | Item 1 |
| `worktree-git-isolation.extract.md` | Item 8 |
| `normalize-quadratic.extract.md` | Item 2 |
| `daemon-stop-any.extract.md` | Item 11 |
| `rewind-symlink-hardlink.extract.md` | Item 36/40 |
| `auto-mode-401.extract.md` | Item 3 |
| `claude-symlink-write.extract.md` | Item 18 |
| `askuser-free-text.extract.md` | Item 4 |
| `resume-agent-identity.extract.md` | Item 7 |
| `bg-startup-cancel.extract.md` | Item 15 |
| `mcp-reauth.extract.md` | Item 19 |
| `runtime-*.txt` / `*.raw.txt` / `*.clean.txt` | Binary dumps (supporting) |
| `pack-report.md` | Pack narrative + Deep dig pointer |

---

## 5. Global risks (all items)

1. **Collapsing dual paths** (FS facade, XB vs wxu, handoff vs main deny, pure vs free-text AskUser) breaks 1:1.
2. **Windows inverted FS semantics** (disabled must not mean allowOnly `['/']` on native Windows).
3. **Stale docs** claiming schema/telemetry absence when local already partial — re-audit tree before coding.
4. **UNCERTAIN** markers in extracts: do not invent membership (Axu/KQt, FQt sources, f6d body). wUs client reap is landed.
5. After each port: `bun run precheck` (typecheck + lint fix + test).

---

## 6. Definition of done (per item)

- densable strings/flags/schemas match extract  
- Local gap closed with file:line evidence  
- `*.216.test.ts` green for listed cases  
- Checklist + this table status flipped only after precheck  
- No “simpler” substitute that weakens security or changes wire content  

### telemetry-user-abort (#29)
- densable `rx_`: `other` + `h8t` (`tool permission request aborted`) → OTel `user_abort`.
- Failures (`e2n`/`ZFn`/`QFn`) stay `config` — never wrap as `permissionPromptTool` (would become `user_reject`).
- structuredIO catch: ZodError / ControlStreamClosedError (jS) / AbortError+parentAborted / else.
- print MCP permission-prompt-tool: abort → g8t; schema-invalid safeParse → iNr.

### skill-menu-refresh (#27)
- densable `XoS` skill watcher: watch skills/commands/**agents**; `.md`-only files; always `usePolling`; idle poll 30s after 60s idle; wake path `bGa`.
- Fingerprint `JoS` (name→contentHash); ConfigChange gate; `xLt`+memo clear before re-scan; selective `oNs` forget sent skills.
- UI `mOf`: watcher → full `$2` + optional agents `lU`; GrowthBook → memo-only `wZ`.
- stream-json `aa`: `{type:system,subtype:commands_changed,commands:DVe(...)}`.
- Local: `skillChangeDetector.ts`, `useSkillsChange.ts`, `print.ts`, `coreSchemas.ts`, `contentHash` on prompt commands.
- Extract: `skill-menu-refresh.extract.md`. Tests: `skillMenuRefresh.216.test.ts`.

### plugin-skill-prefix (#28)
- densable `uzr`: `I=e.slice(0,lastIndexOf(":")+1)`, `D=x?\`${I}${x}\`:e`, `aliases=x&&!x.includes(":")?[x]`.
- `userFacingName(){return D}` — never bare frontmatter name alone.
- Local: `loadPluginCommands.ts` createPluginCommand. Extract: `plugin-skill-prefix.extract.md`. Tests: `pluginSkillPrefix.216.test.ts`.
