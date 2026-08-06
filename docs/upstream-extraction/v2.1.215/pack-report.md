# densable 2.1.215 pack report

> Pack only — **do not implement from this note alone**. Extract densable first for each work item (already done below for the single 215 product change).  
> Pack date: **2026-08-06**  
> Local product baseline: `@go-hare/claude-code` **2.7.30** / git `fbe81e77` (densable **2.1.214** 47/47 HAVE closeout)  
> Alignment target moves: densable **2.1.214 → 2.1.215**

## 0. Artifacts

| Item | Path / note |
|------|-------------|
| Main npm shell (thin wrapper) | `npm pack @anthropic-ai/claude-code@2.1.215` → ~22KB, install wrapper only |
| Platform densable binary (this pack) | `npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.215` |
| Extracted SEA | `/tmp/official-215/plat/package/claude` (**247 124 336** bytes); version string **2.1.215** HIT |
| Temp pack dir | `/tmp/official-215/` (`main/package` wrapper + `plat/package` binary) |
| Upstream CHANGELOG full | `docs/upstream-extraction/v2.1.212/CHANGELOG.upstream.md` (shared; through ≥2.1.222) |
| Slice 2.1.215 | `changelog-2.1.215.md` |
| Binary extracts | `code-review.reg.raw.txt`, `verify.reg.raw.txt`, `simplify.reg.raw.txt`, `skill-name-consts.raw.txt`, `ultrareview-user-triggered.raw.txt`, `disable-model-invocation.docs.raw.txt`, `verify.description.raw.txt` |
| Narrative extract | `no-auto-verify-code-review.extract.md` |
| Official checklist | `official-215-checklist.md` |

Notes:

- Main package `@anthropic-ai/claude-code@2.1.215` is install-wrapper only (`cli-wrapper.cjs` / `install.cjs` / stub `bin/claude.exe`).
- Real densable is the platform package native binary (Node SEA). This pack used **darwin-arm64@2.1.215** (host machine). Prior 212/214 packs preferred win32-x64; behavior for this item is string/registration-level and should match across SEA platforms.
- **2.1.213** remains a near-empty bump in the official line (no independent CLI product changelog); skip as before.
- **2.1.216+** is a large reliability pack — **out of 215 scope**. See CHANGELOG headers after 215; do not pull 216 into this pack.

---

## 1. CHANGELOG headline (2.1.215 only)

Source: upstream `CHANGELOG.md` section `## 2.1.215` (also `changelog-2.1.215.md`).

### Entire official surface (1 bullet)

1. **Claude no longer runs the `/verify` and `/code-review` skills on its own**
   - User must invoke with **`/verify`** or **`/code-review`** when desired.
   - Product intent: stop model-driven auto-launch of expensive review/verify workflows (token / “self-start skill” policy), same family as later **`/deep-research` manual-only** (2.1.218) and existing **ultrareview user-triggered** copy.

### Adjacent (not 215)

| Ver | Why mentioned |
|-----|----------------|
| **2.1.214** | Previous full closeout baseline (security valves, EndConversation, PS/Bash, bg daemon, OTel…). **Already HAVE.** |
| **2.1.216** | Next large pack (sandbox.filesystem.disabled, long-session normalize cost, auto-mode 401, worktree git isolation, …). **Do not mix into 215.** |
| **2.1.218** | `/deep-research` “starts only when invoked manually” — same *pattern* as 215; separate pack. |

---

## 2. Binary densable confirmation (2.1.215 `claude` SEA)

| Needle | Result |
|--------|--------|
| `2.1.215` version string | **HIT** (many) |
| Skill name consts `Oye="code-review"`, `Mne="verify"`, `uzr="simplify"` | **HIT** (`skill-name-consts.raw.txt`) |
| `/code-review` registration via `Hu({name:Oye, … disableModelInvocation:!0 …})` | **HIT** (`code-review.reg.raw.txt`) |
| `/verify` registration via `Hu({name:Mne, … disableModelInvocation:!0 …})` | **HIT** (`verify.reg.raw.txt`) |
| `/simplify` registration `Hu({name:uzr, … userInvocable:!0 …})` **without** `disableModelInvocation:!0` | **HIT** (`simplify.reg.raw.txt`) — intentional: simplify remains model-callable cleanup path |
| `userInvocable:!0` on both verify + code-review | **HIT** (slash still works for humans) |
| Changelog prose “no longer runs the `/verify`…” as runtime string | **MISS** (release note only; behavior is the flag) |
| `tengu_hive_evidence` / `independent adversarial verification` / `VERIFICATION_AGENT` | **MISS** in this SEA (ant-only / DCE / not 215 surface) |
| `disable-model-invocation: true` skill authoring docs | **HIT** (frontmatter semantics for project skills) |
| ultrareview “user-triggered and billed; you cannot launch it yourself” | **HIT** (related policy, already present for ultra path) |

### Densable registration (cleaned)

**`/code-review`** (const `Oye`):

```js
Hu({
  name: Oye, // "code-review"
  menuDescription: "Review the current diff for bugs and cleanups",
  subcommands: { ultra: "ultrareview" },
  description: CeS,
  argumentHint: AeS,
  userInvocable: !0,
  disableModelInvocation: !0,
  getEffort(e, t) { /* … */ },
  getPromptForCommand: weS,
})
```

**`/verify`** (const `Mne`):

```js
Hu({
  name: Mne, // "verify"
  description: nnS, // "Verify that a code change actually does what it's supposed to…"
  userInvocable: !0,
  disableModelInvocation: !0,
  files: () => BPf().then(e => e.SKILL_FILES),
  async getPromptForCommand(e) { /* SKILL_MD body + optional User Request */ },
})
```

**`/simplify`** (const `uzr`) — control / counter-example:

```js
Hu({
  name: uzr, // "simplify"
  menuDescription: "Clean up the changed code without changing behavior",
  description: "Review the changed code for reuse… use /code-review for that.",
  argumentHint: "[<target>]",
  userInvocable: !0,
  // NO disableModelInvocation — model may still invoke simplify
  async getPromptForCommand(e, t) { /* … */ },
})
```

**Mechanism:** `disableModelInvocation: true` keeps the skill/command **user-slash-invocable** but **hides it from the Skill tool’s model-invocable list** (and blocks coordinator/worker Skill paths that require model invocation). Matches frontmatter docs: *“add `disable-model-invocation: true` so only the user can trigger it”*.

---

## 3. Gap matrix vs go-hare (pack day 2026-08-06)

Legend: **GAP** · **PARTIAL** · **HAVE** · **N/A** · **AUDIT**

| # | densable 215 item | Status | Local entry points / notes |
|---|-------------------|--------|----------------------------|
| 1 | `/code-review` not model-auto-invokable (`disableModelInvocation: true`) | **HAVE** | 2026-08-06: `src/commands/codeReview.ts` `codeReview.disableModelInvocation = true` (simplify untouched). |
| 2 | `/verify` not model-auto-invokable | **HAVE** | 2026-08-06: `src/skills/bundled/verify.ts` `disableModelInvocation: true`; still ant-gated for registration. |
| 3 | `/simplify` remains model-invocable (no disable flag) | **HAVE** (match densable) | Local simplify command/skill does not set disable either — correct; **do not** set disable on simplify as part of 215. |
| 4 | Manual `/verify` / `/code-review` still work | **HAVE** | Commands/skills registered; only model path must be closed. |
| 5 | Separate ant `VERIFICATION_AGENT` system-prompt contract (`tengu_hive_evidence`) | **N/A / out of 215** | Local `prompts.ts` still has gated “spawn verification agent” text when feature + GB + !poor. Official 215 bullet names **skills** `/verify` and `/code-review`, not the ant verification *agent*. Do not conflate unless product asks. |
| 6 | Ultrareview “cannot launch yourself” prompt | **AUDIT/LOW** | densable has explicit user-triggered copy; local ultrareview paths partially aligned in 212 — not the 215 changelog bullet. |

---

## 4. Suggested alignment phases (when implementing)

**Phase A — 1:1 flags (whole 215 product surface)**  
1. `codeReview` command: set `disableModelInvocation: true` (keep `userInvocable: true`).  
2. `registerVerifySkill` / verify bundled skill: set `disableModelInvocation: true` (keep `userInvocable: true`).  
3. Confirm Skill tool listing / processSlashCommand / coordinator paths honor the existing field (already used by doctor/batch/debug/etc. in-tree — **reuse**, do not invent a second gate).  
4. Tests: skill index / command listing shows user-invocable-only; model Skill tool cannot select `verify` / `code-review`.  
5. Update `official-215-checklist.md` → HAVE.

**Out of default 215 pack unless asked**

- 2.1.216+ bugfarm / sandbox.filesystem.disabled  
- Turning off ant `VERIFICATION_AGENT` prompt  
- Enabling external `/verify` for non-ant (densable product availability may differ; only the disable flag is proven 215 scope)  
- UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS expansion  

---

## 5. Implementation checklist (for implementer)

- [x] Read `no-auto-verify-code-review.extract.md` + raw regs  
- [x] Patch `src/commands/codeReview.ts` (`codeReview` only; leave `simplify` alone unless densable later changes)  
- [x] Patch `src/skills/bundled/verify.ts`  
- [x] Grep for any second registration of `code-review` / `verify` that still model-lists  
- [x] Targeted tests: `verify.disableModelInvocation.215.test.ts` (2 pass)  
- [x] `tsc --noEmit` clean for this change; `biome check` clean on touched files  
- [~] Full `bun run precheck`: suite still has **pre-existing** ~67 fails (spawnMultiAgent/observerFrontmatter/etc.), **not** introduced by 215  
- [x] Flip checklist #1–#2 to **HAVE**  

---

## 6. Risk / product notes

- **Small, surgical change.** No new tools, no daemon, no permission analyzer.  
- Primary risk is **regression**: accidentally setting `disableModelInvocation` on `/simplify` or `/review` (PR review) without densable proof.  
- Secondary risk: local `/verify` is ant-only — flag alignment still matters for ant + for any future ungating.  
- ultracode / harness “verification agent” instructions in *this* product’s system prompt are a **different surface** from densable 215 skills.
