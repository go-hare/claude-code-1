# densable 2.1.216 pack report

> Pack only — **do not implement from this note alone**. Extract densable first for each work item (see `*.extract.md` / `*.clean.txt`).  
> Pack date: **2026-08-06**  
> Local product baseline: `@go-hare/claude-code` **2.7.30** / git `1eb81339` (densable **2.1.215** landed: `/verify`+`/code-review` `disableModelInvocation`)  
> Alignment target: densable **2.1.215 → 2.1.216** (official reliability pack, **40** changelog bullets)

## 0. Artifacts

| Item | Path / note |
|------|-------------|
| Main npm shell | `npm pack @anthropic-ai/claude-code@2.1.216` (thin wrapper) |
| Platform densable binary (this pack) | `npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.216` |
| Extracted SEA | `/tmp/official-216/plat/package/claude` (**249 225 584** bytes); version **2.1.216** HIT; `BUILD_TIME=2026-07-20T18:32:09Z`, `GIT_SHA=7fead72f…` |
| Temp pack dir | `/tmp/official-216/` |
| Upstream CHANGELOG slice | `changelog-2.1.216.md` |
| Official checklist | `official-216-checklist.md` |
| Key extracts | `sandbox-filesystem*.txt`, `sandbox-filesystem-disabled.*`, `worktree-git-*.txt`, `normalize-quadratic.*`, `daemon-stop-any.*`, `prometheus-unit.*`, `telemetry-user-abort.*`, `askuser-free-text.*`, `rewind-symlink.*`, `needs-input-bg.*`, `fork-confirmation.*`, `chrome-403.*`, `auto-mode-401.*`, `skill-menu-refresh.*`, `ultrareview-size.*`, `context-compact.*` |
| Narrative extract | `sandbox-filesystem-disabled.extract.md` |
| **Deep 1:1 dig (2026-08-06)** | **`DEEP-1TO1.md`** + runtime dumps `runtime-*.txt` + per-item extracts (`daemon-stop-any`, `rewind-symlink-hardlink`, `normalize-quadratic`, `auto-mode-401`, `askuser-free-text`, `claude-symlink-write`, worktree/FS extracts) |
| Deep dig refresh | Comprehensive 1:1 extracts + Batch D closeout — see **`DEEP-1TO1.md`** / **`official-216-checklist.md`** (38 HAVE / 0 GAP / 0 PARTIAL / 1 N/A) |

Notes:

- Main `@anthropic-ai/claude-code@2.1.216` is install-wrapper only; real densable is the platform SEA.
- **2.1.215** is closed (single skill-invocation policy). **Do not re-open** in this pack.
- This pack is a **bugfarm / reliability** release (isolation + long-session + bg/daemon + UI polish). Prefer **batches by risk**, not by changelog order alone.
- Platform binaries under `packages/@go-hare/claude-code-*` are intentionally **not** commit targets for pack docs.

---

## 1. CHANGELOG surface (2.1.216 only)

Source: upstream section `## 2.1.216` / `changelog-2.1.216.md` — **40 bullets**.

### Themes (for batching)

| Theme | Bullet #s (1-based in changelog file) | Risk |
|-------|----------------------------------------|------|
| **Isolation / security** | 1 sandbox FS disabled; 8–10 worktree; 11 daemon `--any`; 18 `.claude` symlink writes; 20 Windows network paths; 40 `/rewind` symlink+hardlink | **P0** |
| **Long-session / auth correctness** | 2 normalize quadratic; 3 auto-mode 401; 5 web re-ask idle; 7 resume agent identity; 12 Esc-Esc rewind; 15 bg subagent startup cancel; 19 MCP re-auth; 44 cloud mid-turn restart | **P0/P1** |
| **Permissions / parsing** | 13 Bash `&&`+redirects; 21 non-ASCII Bash; 22 PS invisible Unicode; 33 telemetry reject vs abort; 35 PS `git`/`gh` args | **P1** |
| **UI / slash / product copy** | 4 AskUser free-text; 6 @-mention/hooks/vim/statusline/resume; 14 Ctrl+X delete; 16 GUI editor mouse; 23–25 fullscreen; 27–28 skill menu/prefix; 34 `/fork` confirm; 36–39 ultrareview/code-review/spend/context; 41 bg needs-input; 42 dataviz; 43 VSCode RTL | **P1/P2** |
| **Observability** | 26 Prometheus `# UNIT` | **P2** |

Full bullet text lives in `changelog-2.1.216.md` (do not paraphrase product strings when landing copy).

---

## 2. Binary densable confirmation (2.1.216 `claude` SEA)

| Needle / claim | Result |
|----------------|--------|
| `2.1.216` version string | **HIT** (many) |
| Nested **`filesystem.disabled`** + long “skip filesystem isolation… network egress” describe | **HIT** (schema + runtime) |
| Literal token `sandbox.filesystem.disabled` as one string | **MISS** (nested field; public dotted key still product name) |
| Runtime `Gvg`/`Wvg`/`Hou`/`Bou` FS-off branches (`allowOnly:["/"]`, empty `denyOnly`) | **HIT** (`sandbox-filesystem-disabled.runtime.clean.txt`) |
| Worktree git isolation: `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR`/`GIT_INDEX_FILE` scrub (`XB`), block `--git-dir`/`--work-tree`, “redirects git to the shared checkout”, `[worktree] blocked shell exec` | **HIT** |
| `preNormalizedMessageCount` / `postNormalizedMessageCount` / `query_message_normalization_{start,end}` | **HIT** (telemetry already local; algorithm recovered as LN Map+cursor — see `normalize-quadratic.extract.md` / `DEEP-1TO1.md`) |
| `claude daemon stop --any` + “also stop a transient (non-service) daemon” | **HIT** |
| Prometheus `` `# UNIT ${r} ${Dko(...)}` `` gated on unit | **HIT** |
| `user_abort` / “pending loop wakeup(s) on user abort” | **HIT** |
| AskUserQuestion free-text box + answer result wording | **HIT** (densable: “Your questions have been answered… You can now continue with these answers in mind.” — free-text neutrality is behavioral, not a single flag string) |
| OAuth 401 recovery symbols (`oauth_401_no_refresh_token_*`, `tengu_oauth_401_recovered_from_rotation`) | **HIT** |
| Chrome scope disable copy (`user:profile` / `user:office` / `user:ccr_inference`) | **HIT** |
| Background “needs input” | **HIT** |
| `/fork` “shares your checkout” exact phrase | **MISS** (reconstruct from attach/fork UX; “shared checkout” appears for worktree guard) |
| `/rewind` hardlink skip user copy | **THIN** (FileHistory rewind telemetry strong; hardlink product string thin) |

### High-value cleaned densable snippets

**FS disable (see also extract md):**

```js
if (!hl || hl.filesystem.disabled) return { denyOnly: [], allowWithinDeny: [] }
if (hl.filesystem.disabled) return { allowOnly: ['/'], denyWithinAllow: [] }
```

**Worktree env scrub:**

```js
function XB(e) {
  return {
    ...process.env,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_COMMON_DIR: undefined,
    GIT_INDEX_FILE: undefined,
    ...e,
  }
}
// Ros = Set(["GIT_DIR","GIT_WORK_TREE","GIT_COMMON_DIR","GIT_OBJECT_DIRECTORY","GIT_INDEX_FILE","GIT_SHALLOW_FILE"])
```

**Prometheus UNIT emission (invalid `# UNIT` fix lives here / upstream serializer):**

```js
i = unit ? `# UNIT ${name} ${Dko(unit)}` : ''
// + `# TYPE` + datapoint serialize
```

---

## 3. Gap matrix vs go-hare (pack day 2026-08-06)

Legend: **GAP** · **PARTIAL** · **HAVE** · **N/A** · **AUDIT** · **LOW**

Numbering follows `changelog-2.1.216.md` order (1…40).

| # | densable 216 item | Status | Local entry points / notes | Pri |
|---|-------------------|--------|----------------------------|-----|
| 1 | `sandbox.filesystem.disabled` skip FS isolation, keep network | **HAVE** | schema `disabled` + dual facade (OUTER getFs* raw / convert·wrap unrestricted) + Bou override + uCg `[]`. Extract: `sandbox-filesystem-disabled.extract.md`. tests: `sandbox.filesystem.disabled.216` | P0 |
| 2 | Long-session `normalizeMessages` quadratic cost | **HAVE** | densable LN Map+cursor in `normalizeMessagesForAPI`; pre/post counts + checkpoints. Extract: `normalize-quadratic.extract.md`. tests: `normalizeMessagesForAPI.quadratic.216` | P0 |
| 3 | Auto mode “HTTP 401” after OAuth expire/rotate mid-session | **HAVE** | sideQuery recover+retry + classifier errorKind/Mhd/CYu. Extract: `auto-mode-401.extract.md` | P0 |
| 4 | AskUserQuestion free-text neutral wording (not force continue) | **HAVE** | structural pure MC vs free-text/notes/response. Extract: `askuser-free-text.extract.md`. tests: `mapToolResult.216` | P1 |
| 5 | Claude Code **on the web** re-ask / drop answer after idle | **HAVE** | densable `l1S` reinit → success + `inl` + pending_* + `tengu_reinit_pending_redelivery`. extract: `web-idle-reinit.extract.md`. tests: `sdkReinitRedelivery.216` | P2 |
| 6 | @-mentions empty after hooks; vim `c`/paste; statusline twice on resume; resume-picker hang | **HAVE** | Four needles: H1e contentNotInModelContext; vim Poa/Hmn; statusline skip-first; resume IQf. extract: `ui-umbrella-6.extract.md` | P1 |
| 7 | Resumed bg agent sessions revert to default agent (prompt + tool restrictions) | **HAVE** | Sidecar identity (`isFork`/agentType/model/spawnMode/worktree*/cwd) + H4d `$Ns` merge + Aye j/B/G selection + disk-missing → `task.messages` mirror. Extract: `resume-agent-identity.extract.md`. tests: `resumeAgentIdentity.216.test.ts` | P0 |
| 8 | Worktree subagents redirect git via `git -C` / `--git-dir` / `GIT_DIR`/`GIT_WORK_TREE` | **HAVE** | `worktreeGitIsolation` XB scrub + shared-checkout shell gate. Extract: `worktree-git-isolation.extract.md` | P0 |
| 9 | Worktree sessions land in another project’s leftover worktree | **HAVE** | densable DXi foreign-repo: resume `gitdir` parent dev/ino vs `<repoGitDir>/worktrees`; `assertWorktreeNotForeignRepo` + `git_worktree_resume_foreign_repo`. Extract: `worktree-foreign-repo.extract.md`. tests: `worktreeForeignRepo.216.test.ts` | P1 |
| 10 | Bg sessions whose worktree has **no git** undeletable | **HAVE** | `deleteJob.ts` gitError left_in_place / force path; densable C2e parity | P1 |
| 11 | `claude daemon stop --any` kills unrelated via stale legacy lock | **HAVE** | UTe/DSr + `--any` + client wUs/AUs `clientBgReap`. Extract: `daemon-stop-any.extract.md`. tests: `daemonStop*.216` | P0 |
| 12 | Esc-Esc idle prompt not opening rewind picker with bg tasks | **HAVE** | densable Opu/x4: cancel isActive ignores task-notification; Esc-Esc → rewind. extract: `esc-esc-rewind.extract.md`. tests: `escEscRewind.216.test.ts` | P1 |
| 13 | Bash permission compound `&&` + redirects / negations | **HAVE** | densable `uxg`/`$uu` in `ast.ts`; tests `listNegationRedirect.216`. Extract: `list-negation-redirect.extract.md` | P1 |
| 14 | Ctrl+X×2 agent list delete; deleted reappear when worker dead | **HAVE** | densable wL/yte tombstone + justKilled arm + force C2e. extract: `agent-list-ctrlx-delete.extract.md`. tests: `agentViewDelete.216.test.ts` | P1 |
| 15 | Bg subagents cancelled by high-priority message during startup window | **HAVE** | densable L(G&&!B)+post-setup gate: async local ignores reason `"interrupt"`; independent Flt abort. Extract: `bg-startup-cancel.extract.md`. tests: `bgStartupCancel.216.test.ts` | P1 |
| 16 | Mouse/focus garbage while GUI editor open; `/memory` no wait for close | **HAVE** | densable prepare/restoreTerminalForHandoff + Wut GUI handoff + `/memory` jCo no-wait. extract: `gui-editor-mouse.extract.md`. tests: `guiEditorHandoff.216.test.ts` | P2 |
| 17 | Claude-in-Chrome 403-loop reconnect missing OAuth scope | **HAVE** | densable JKn/yhn enable-time scope gate; extract `chrome-403.extract.md`; tests `oauthValidateScope.216` + `shouldEnableClaudeInChrome` | P1 |
| 18 | Workflow / scheduled-task writes follow `.claude` symlink outside project | **HAVE** | YNn/M6/nWr/L1a `symlinkWriteGuard` + cron + `saveDynamicWorkflow` + persistInline local YNn. Extract: `claude-symlink-write.extract.md`. tests: `symlinkWriteGuard.216` | P0 |
| 19 | MCP re-auth revokes working creds before new sign-in; bg needs-auth unusable command | **HAVE** | QLu→ebe→eMu UI; t7r permanent refresh clear → `mcp-needs-reauth-${name}`; bg `BG_NO_TERMINAL_MCP_AUTH_MSG`; CLI wat residual densable-parity. Extract: `mcp-reauth.extract.md`. tests: `mcpReauth.216.test.ts` | P1 |
| 20 | Windows read-only commands on network paths no prompt | **HAVE** | densable `sI(e,forPath)` path-mode + Rjr; RO Bash/PS path-mode; `%` windows-only + backtick. Extract: `windows-network-path-ro.extract.md`. tests: `uncNetworkPath.216.test.ts` | P0 |
| 21 | Bash non-ASCII word boundaries | **HAVE** | densable `guu` `isWordChar >= \\x80`; tests `nonAsciiWordBoundary.216`. Extract: `non-ascii-word-boundary.extract.md` | P1 |
| 22 | PowerShell invisible Unicode permission validation | **HAVE** | densable `XAu`/`r0e`/`Wjg` on PS+Bash schema; `controlChars.ts`. Extract: `ps-invisible-control-chars.extract.md` | P1 |
| 23 | Fullscreen dialogs stretch past panel edge | **HAVE** | Dialog/Pane/Tabs/FullscreenLayout minWidth:0 + modal columns; Config labelWidth. extract: `fullscreen-ui-23-25.extract.md` | P2 |
| 24 | `/config` fullscreen keyboard-hint footer clip | **HAVE** | densable sda footer measure + flexShrink:0 + maxVisible. tests: `fullscreenUi.216` | P2 |
| 25 | Transcript Ctrl+O footer wrap &lt;104 cols | **HAVE** | densable CZa stringWidth gate (no hard-coded 104). tests: `fullscreenUi.216` | P2 |
| 26 | Prometheus `OTEL_METRICS_EXPORTER=prometheus` invalid `# UNIT` | **HAVE** | densable unit gate = OTEL 0.215; pure `prometheusUnitLine`; extract `prometheus-unit.extract.md`; tests `prometheusUnitLine.216` | P2 |
| 27 | Skills/commands changed mid-session not in slash menu until restart | **HAVE** | densable XoS: agents dirs + .md filter + idle poll + JoS fingerprint + stream-json `commands_changed` + mOf agents. Extract: `skill-menu-refresh.extract.md`. tests: `skillMenuRefresh.216.test.ts` | P1 |
| 28 | Plugin skills `name` frontmatter lose plugin prefix in autocomplete | **HAVE** | densable uzr `D=\`${I}\${x}\`` + aliases. Extract: `plugin-skill-prefix.extract.md`. tests: `pluginSkillPrefix.216.test.ts` | P1 |
| 29 | Telemetry: failed permission-prompt ≠ user rejection; interrupt → user abort | **HAVE** | densable `rx_`: other+h8t→user_abort; fail/stream/schema→config (not user_reject). Extract: `telemetry-user-abort.extract.md`. tests: `telemetryUserAbort.216.test.ts` | P1 |
| 30 | `/fork` one-line confirm: name + attach id + shared checkout note | **HAVE** | densable rBo; extract `fork-oneline.extract.md`; tests `spawnBackgroundSessionFork` | P2 |
| 31 | PowerShell `git`/`gh` argument validation improved | **HAVE** | densable `I5g`/`oDu`/`XIu`; `isGitSafe`/`isGhSafe`. Extract: `ps-git-gh-args.extract.md`. tests: `gitGhArgs.216` | P1 |
| 32 | `/ultrareview` diff-too-large shows limits, size, largest files | **HAVE** | densable DHp + limits; extract `ultrareview-size.extract.md`; tests `reviewRemote.normalize.test.ts` | P2 |
| 33 | `/code-review ultra` empty-diff names base ref + suggest explicit base | **HAVE** | merge-base empty_diff copy 1:1; extract `ultrareview-size.extract.md`; tests `reviewRemote.normalize.test.ts` | P2 |
| 34 | spend limit reject shows server reason | **HAVE** | densable Per+HWr; extract `spend-limit-reason.extract.md`; tests `spendLimitReason.216` | P2 |
| 35 | `/context` warning when over window; failed `/compact` as error | **HAVE** | densable Ftn + stderr isError; extract `context-over-limit.extract.md`; tests `contextOverLimit.216.test.ts` | P1 |
| 36 | `/rewind` no restore/delete via symlink/hardlink; report skipped count | **HAVE** | Q3g+Z3g O_NOFOLLOW + realParentDir + skippedLinks SDK/CLI + **TYn** MessageSelector/CLI Warning. tests: `fileHistory.rewindSafe.216` | P0 |
| 37 | Bg: `/mcp` + `/install-github-app` park “needs input” when no client | **HAVE** | densable CUt/zpd/gQp sof/CRb; `bgCommandNeedsPark` + attacherCaps subscribe; MCP reconnect needs-auth. extract: `needs-input-bg.extract.md`. tests: `bgCommandNeedsPark.216.test.ts` | P1 |
| 38 | Dataviz skill palette reorder + four-series direct-label guidance | **HAVE** | densable palette blue→orange→… + ladder@4 yellow/orange + all-pairs cap 3. extract: `dataviz-palette.extract.md`. tests: `dataviz.216.test.ts` | P2 |
| 39 | **[VSCode]** RTL mixed text order | **N/A** | No first-party VS Code extension product in this repo as CLI surface | SKIP |
| 40 | Cloud sessions drop in-flight message on container restart mid-turn | **HAVE** | densable Szu max-age + BJr telemetry; detect/transform/print auto-resume. CCR chrome N/A. extract: `interrupted-turn-cloud.extract.md`. tests: `interruptedTurnStale.216` | P2 |

### Counts (live — see also `official-216-checklist.md`; pack-day snapshot was near-zero HAVE)

| Status | count | Notes |
|--------|------:|--------|
| **HAVE** | **38** | +#5 SDK reinit success redelivery (web idle) |
| **GAP** | **0** | — |
| **PARTIAL** | **0** | — |
| **AUDIT** | **0** | — |
| **N/A** | **1** | #39 VSCode RTL only |
| **Total** | **40** | |

> Prefer GAP over false HAVE. Flip status only after densable extract + tests.

---

## 4. Suggested alignment phases (when implementing)

### Phase A — P0 isolation / data integrity (extract-first)

1. **`sandbox.filesystem.disabled`** — schema + adapter + tests (`sandbox-filesystem-disabled.extract.md`).  
2. **Worktree git redirect guard** — port densable `XB`/`Ros` env scrub + flag/command deny for worktree agents; strings from densable.  
3. **`/rewind` symlink + hardlink skip + skipped count**.  
4. **Workflow / scheduled-task write** must not follow project `.claude` symlink (extend 212 guard to write path).  
5. **Windows network path** permission prompt for read-only commands.  
6. **`daemon stop --any`** stale legacy lock safety (add flag + PID verification per densable).

### Phase B — P0/P1 session correctness

1. **normalizeMessages** linearization + densable telemetry names if product wants parity.  
2. **Auto-mode 401** vs classifier deny (token refresh before deny).  
3. **Resume restores agent prompt + tool restrictions**.  
4. **Bg subagent startup cancel** immunity window — **HAVE** (`bg-startup-cancel.extract.md`).  
5. **MCP re-auth** order + needs-reauth toast — **HAVE** (`mcp-reauth.extract.md`).

### Phase C — P1 permissions / telemetry / slash

1. Bash compound+redirect perms; non-ASCII Bash; PS invisible Unicode; PS git/gh.  
2. Telemetry user_abort vs rejection (failed prompt ≠ reject).  
3. Skill/command live slash refresh; plugin name prefix autocomplete.  
4. AskUser free-text neutral wording.  
5. `/context` + failed `/compact` display; Ctrl+X delete race; Esc-Esc rewind.

### Phase D — P2 polish / N/A skip

1. Fullscreen dialog/footer/transcript wrap.  
2. Prometheus `# UNIT` (dep or filter).  
3. `/fork` one-liner; ultrareview/code-review ultra copy; spend reason; dataviz.  
4. Chrome 403 scope reconnect.  
5. **Skip default:** VSCode RTL; pure cloud container restart unless bridge owns it.

### Out of default 216 pack unless asked

- Re-opening 215 skill disable flags  
- UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS expansion  
- Turning off ant verification agent prompts  
- Committing multi-hundred-MB platform binaries  

---

## 5. Implementation checklist (for implementer)

- [x] Pack changelog slice + npm pack densable 2.1.216  
- [x] Binary version + key needles  
- [x] Clean extracts for P0 themes  
- [x] Gap matrix + checklist  
- [ ] Per-item densable extract before each code PR (especially #2 normalize body, #3 classifier, #8 shell guard)  
- [ ] Phase A code + tests  
- [ ] Phase B…  
- [ ] Flip checklist rows to HAVE only with tests  
- [ ] `bun run precheck` on touched surfaces (suite may still have pre-existing fails elsewhere)  
- [ ] Version bump only when product asks for 216 closeout  

---

## 6. Risk / product notes

- **Largest product feature in 216:** `sandbox.filesystem.disabled` — egress-only sandbox for enterprise; wrong implementation **weakens** FS containment. Managed-settings precedence is part of densable describe — **do not skip**.  
- **Worktree git scrub** is security-adjacent (escape to shared checkout). Prefer densable deny strings 1:1.  
- **Normalize quadratic** is user-visible multi-second stall; needs correctness tests (message UUID stability) not just “faster”.  
- **Telemetry** mislabels affect dashboards — keep `user_abort` distinct from `user_reject`.  
- Many UI bullets are **dense but low risk**; do not block P0 on fullscreen footer polish.  
- Local precheck residual failures (spawnMultiAgent / observerFrontmatter, etc.) are **pre-existing** — do not blame 216 pack docs.

---

## 7. Neighbor versions

| Ver | Relation |
|-----|----------|
| **2.1.214** | Prior full closeout (security valves, EndConversation, PS/Bash, bg daemon) — HAVE in product 2.7.30 |
| **2.1.215** | `/verify`+`/code-review` model-disable — landed `1eb81339` |
| **2.1.216** | **This pack** — 40-bullet reliability |
| **2.1.217+** | Out of scope; do not mix |
