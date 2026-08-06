# extract: 2.1.215 — no auto `/verify` / `/code-review`

> densable: `@anthropic-ai/claude-code-darwin-arm64@2.1.215`  
> binary: `/tmp/official-215/plat/package/claude` (247 124 336 bytes)  
> date: 2026-08-06  
> official note: *Claude no longer runs the `/verify` and `/code-review` skills on its own; invoke them with `/verify` or `/code-review` when you want them*

## Mechanism (proven)

Not a new tool. Not a feature flag. **Command/skill registration flags:**

| Field | Value | Effect |
|-------|-------|--------|
| `userInvocable` | `true` (`!0`) | User can still type `/verify`, `/code-review` |
| `disableModelInvocation` | `true` (`!0`) | Model **cannot** invoke via Skill tool / model skill index |

Authoring docs in the same binary:

> Both the user (`/<skill-name>`) and Claude can invoke skills by default. For workflows with side effects … add `disable-model-invocation: true` so only the user can trigger it …

Runtime field name in densable / go-hare: **`disableModelInvocation`**.  
Frontmatter name: **`disable-model-invocation`**.

## Registration snippets (from SEA strings)

### code-review (`Oye`)

Source file in pack: `code-review.reg.raw.txt`

```
Hu({
  name: Oye, // "code-review"
  menuDescription: "Review the current diff for bugs and cleanups",
  subcommands: { ultra: "ultrareview" },
  description: CeS,
  argumentHint: AeS,
  userInvocable: !0,
  disableModelInvocation: !0,
  getEffort(...),
  getPromptForCommand: weS,
})
```

### verify (`Mne`)

Source: `verify.reg.raw.txt` + `verify.description.raw.txt`

```
// description const
nnS = "Verify that a code change actually does what it's supposed to by exercising it end-to-end and observing behavior — drive the affected flow, not just tests or typecheck. …"

Hu({
  name: Mne, // "verify"
  description: nnS,
  userInvocable: !0,
  disableModelInvocation: !0,
  files: () => BPf().then(e => e.SKILL_FILES),
  async getPromptForCommand(e) { /* SKILL_MD + optional ## User Request */ },
})
```

### simplify (`uzr`) — must remain model-invocable

Source: `simplify.reg.raw.txt`

```
Hu({
  name: uzr, // "simplify"
  menuDescription: "Clean up the changed code without changing behavior",
  description: "… Quality only — it does not hunt for bugs; use /code-review for that.",
  argumentHint: "[<target>]",
  userInvocable: !0,
  // NO disableModelInvocation
  async getPromptForCommand(e, t) { … },
})
```

## Name constants

From `skill-name-consts.raw.txt`:

```
Oye = "code-review"
Mne = "verify"
uzr = "simplify"
```

## Related (not the 215 bullet, but same policy family)

- ultrareview / `/code-review ultra`: copy says *user-triggered and billed; you cannot launch it yourself* (`ultrareview-user-triggered.raw.txt`).
- Later changelog **2.1.218**: `/deep-research` manual-only — same *pattern*, separate extract.

## go-hare 1:1 landing map

| densable | local file | change |
|----------|------------|--------|
| `Hu({name:Oye, disableModelInvocation:!0})` | `src/commands/codeReview.ts` → `codeReview` object | add `disableModelInvocation: true` |
| `Hu({name:Mne, disableModelInvocation:!0})` | `src/skills/bundled/verify.ts` → `registerBundledSkill({…})` | add `disableModelInvocation: true` |
| Field type | `src/types/command.ts` | already has `disableModelInvocation?: boolean` |
| Honor path | Skill tool listing / `loadSkillsDir` / `commands.ts` / skill search | already consume field for other skills (doctor, batch, debug, ultracode, …) — verify, don’t reimplement |

## Explicit non-goals

- Do **not** set `disableModelInvocation` on `simplify` (command or skill).  
- Do **not** treat ant `VERIFICATION_AGENT` prompt as this extract.  
- Do **not** invent a new env var or feature flag for 215.  
- Do **not** pull 216+ items into this extract.

## Verification after implement

1. Model-facing skill list / Skill tool: **no** `verify`, **no** `code-review` (or listed as user-invocable-only / hidden from model).  
2. User slash menu: both still present and runnable.  
3. `simplify` still model-listed.  
4. `bun run precheck`.
