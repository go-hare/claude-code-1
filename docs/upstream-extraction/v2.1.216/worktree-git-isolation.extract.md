# densable 2.1.216 — worktree git isolation (1:1)

> **id:** `worktree-git` · Changelog #8  
> **Status:** **HAVE** (`worktreeGitIsolation` XB scrub + shared-checkout shell gate)  
> SEA offsets ~224041696 (`XB`), ~224853900 (`yxu`/`prr`), ~224859152 (`q9g`), ~224891908 (shell gate)  
> Deep dig: `DEEP-1TO1.md` · dumps: `runtime-XB.txt`, `runtime-Ros.txt`, `runtime-worktree-git-guard.txt`, `worktree-git-isolation.*`

---

## 1. Product intent (changelog)

> Fixed worktree-isolated subagents redirecting git into the shared checkout via `git -C`, `--git-dir`, or `GIT_DIR`/`GIT_WORK_TREE`.

---

## 2. densable binary proof

| Needle | Hit | Offset | Notes |
|--------|-----|--------|-------|
| `redirects git to the shared checkout` | true | 224854049 | wxu deny fragment |
| `GIT_DIR:void 0` | true | 224041696 | XB scrub body |
| `GIT_WORK_TREE` | true | 224041711 | XB + Ros |
| `blocked shell exec` | true | 224891908 | context_lost path |
| `tengu_agent_worktree` | true | 224891991 | analytics event |
| `--git-dir` | true | 224859152 | q9g pin flags |
| `shared checkout` | true | 224853900 | yxu user string |

---

## 3. Cleaned densable schema / strings

### Analytics

- Event: `tengu_agent_worktree_cwd_escape_blocked`
- Reasons: `context_lost` | `worktree_gone` | `shared_checkout` | `command_redirect`

### Log prefixes

```text
[worktree] blocked shell exec after cwd-override loss: agentWorktree=
[worktree] blocked shell exec: cwd "..." is gone and recovery targets the shared checkout; agentWorktree=
[worktree] blocked shell exec outside isolation worktree: cwd=... agentWorktree=
[worktree] blocked shell exec: command redirects git into the shared checkout: cwd=... agentWorktree=
```

### User-facing refuse strings (exact)

1. **context_lost:**  
   `The working-directory isolation context for this agent was lost, so this command would run in the parent session's directory instead of this agent's worktree (${p}). Refusing to run it. Retry the command; if this keeps failing, report that worktree isolation was lost.`

2. **worktree_gone:**  
   `This agent is isolated in the worktree ${p}, but its working directory "${w}" no longer exists and the only recovery target is the parent session's shared checkout. Refusing to run there — the isolation worktree appears to have been removed. Report this instead of retrying.`

3. **shared_checkout (yxu):**  
   `This agent is isolated in the worktree ${t}, but this command's working directory resolved to the shared checkout (${e}). Refusing to run it there — commands from a worktree-isolated agent must run inside its worktree. Re-run the command from ${t}.`

4. **command_redirect (wxu wrapper):**  
   `This agent is isolated in the worktree ${r}, but this command ${f}. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Run the equivalent from ${r} without the redirect.`  
   where `${f}` includes: too complex; `redirects git to the shared checkout via ${flag}`; sets env to shared checkout; cd before git; runtime-computed paths; GIT_CONFIG*/HOME/CDPATH/XDG; xargs/parallel; find -execdir; etc.

### Env / flag schema

| Set | Keys / flags |
|-----|----------------|
| **XB** (host git only) | `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE` |
| **Ros** (static analysis) | XB four + `GIT_OBJECT_DIRECTORY`, `GIT_SHALLOW_FILE` |
| **q9g** | `--git-dir`, `--work-tree` |
| **U9g** | `--namespace`, `--attr-source`, `--shallow-file` |
| **o6g** sensitive `-c` | `core.worktree`, `core.bare`, `include.*`, `includeif.*` |
| Opaque env beyond Ros | `GIT_CONFIG*`, `HOME`, `CDPATH`, `XDG_CONFIG_HOME` |

---

## 4. Cleaned densable runtime

**TWO SEPARATE mechanisms — do not collapse.**

### A) Host git env scrub (`XB`)

```js
function XB(extra = {}) {
  return {
    ...process.env,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_COMMON_DIR: undefined,
    GIT_INDEX_FILE: undefined,
    ...extra,
  };
}
// Call sites: worktree list/create/status/unlock/branch-D/rev-parse…
// NOT used by Y6g agent shell spawn.
```

### B) Shell pre-exec when `agentWorktree` set

```js
const Ros = new Set([
  'GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY','GIT_INDEX_FILE','GIT_SHALLOW_FILE',
]);
const q9g = ['--git-dir', '--work-tree'];
const U9g = new Set(['--namespace','--attr-source','--shallow-file']);
// + j9g/G9g proc/fd reject, W9g cd set, V9g wrappers, z9g/K9g env verbs,
// X9g xargs/parallel, Z9g find -execdir, xos git basename regex…

function prr(resolvedPath, isolationWorktree) {
  // true if path is shared checkout relative to isolation worktree
  // casefold on windows|macos|wsl; uses Cc/rd/Whe/sn (partially UNCERTAIN)
}

function yxu(cwd, agentWorktree) {
  if (prr(cwd, agentWorktree)) return /* shared_checkout string */;
  return null;
}

function wxu(parsed, cwd, isolationWorktree) {
  // bash only; kind!=='simple' → too complex
  // env/chdir/pin/prr checks; redirects git via -C/--git-dir/--work-tree/--bare
}

// shellExecGate:
// if agentWorktree && !RZe() → context_lost
// cwd gone recovery to shared → worktree_gone
// yxu → shared_checkout
// shellType==='bash' ? wxu : null → command_redirect
// spawn Y6g does NOT scrub Ros
```

### Mangled symbols

`XB`, `Ros`, `U9g`, `q9g`, `yxu`, `prr`, `wos`, `LGe`, `wxu`, `vxu`, `Exu`, `OVr`, `bxu`, `Sxu`, `J9g`, `e6g`, `Y6g`, `dM`, `RZe`, `NNn`, `R5e`, `Cc`, `rd`, `Whe`, `sn`, `qgu`, `GZt`, `Sue`, `KQt`/`Axu` (membership UNCERTAIN)

---

## 5. go-hare land status (was gap; now HAVE)

| Path | Change needed |
|------|----------------|
| `src/utils/worktree.ts` | **HAVE** XB scrub on host git |
| `src/utils/worktreeGitIsolation.ts` | **HAVE** Ros/prr/wxu isolation |
| `src/utils/cwd.ts` | Export `hasCwdOverride` ≡ RZe |
| `src/utils/git/gitFilesystem.ts` + `git.ts` | Map Cc/rd/sn for prr with fixtures |
| `src/utils/bash/ast.ts` | Adapter edge for wxu AST fields |
| `packages/.../BashTool/BashTool.tsx` | shellExecGate full |
| `packages/.../PowerShellTool/PowerShellTool.tsx` | cwd gates only, **no** wxu |
| `src/utils/Shell.ts` / `subprocessEnv.ts` | **AUDIT** — do not scrub Ros as substitute |
| AgentTool / runAgent / resumeAgent | Plumb `agentWorktree` + ALS so RZe true |
| `autoModeRepoVisibility.ts` | Keep separate (not #8 hard-block) |

**Missing:** full static guard, analytics, exact refuse copy, PowerShell split, tests.

---

## 6. 1:1 implement steps (ordered)

1. Port `XB` exactly (4 keys) into host worktree git env; wire all `worktree.ts` git call sites; do **not** scrub OBJECT/SHALLOW here.
2. Create `src/utils/worktreeGitIsolation.ts` with densable constants + pure helpers (no simplification).
3. Implement `wxu` 1:1 from densable control flow; adapt AST only at edge.
4. Implement `yxu` + `prr` with densable casefold; fixture-lock Cc/rd/Whe/sn mapping.
5. BashTool gate: context_lost / worktree_gone / shared_checkout / command_redirect + logs + `tengu_agent_worktree_cwd_escape_blocked`.
6. PowerShell: yxu/context_lost/worktree_gone only; **no** wxu.
7. Do **not** scrub Ros into Y6g as substitute for wxu.
8. Plumb `agentWorktree` from AgentTool isolation/resume so RZe true while isolation holds.
9. Tests (section 7).
10. Keep autoModeRepoVisibility separate.

---

## 7. Tests

- Polluted `process.env.GIT_DIR` still correct host worktree ops via XB.
- Agent shell: `git -C <main>`, `git --git-dir=…`, `GIT_DIR=… git`, `cd <main> && git` blocked with exact copy.
- Complex pipelines → too complex.
- Normal git in worktree allowed.
- PowerShell cwd-only.
- ALS loss → context_lost.
- worktree_gone recovery.
- prr casefold fixtures.

Suggested:

- `src/utils/__tests__/worktreeGitEnvScrub.216.test.ts`
- `src/utils/__tests__/worktreeGitIsolation.prr.216.test.ts`
- `src/utils/__tests__/worktreeGitIsolation.wxu.216.test.ts`
- `src/utils/__tests__/worktreeGitIsolation.shellGate.216.test.ts`
- `packages/builtin-tools/src/tools/BashTool/__tests__/worktreeGitIsolation.216.test.ts`
- `packages/builtin-tools/src/tools/PowerShellTool/__tests__/worktreeGitIsolation.cwdOnly.216.test.ts`
- `packages/builtin-tools/src/tools/AgentTool/__tests__/worktreeAgentPlumbing.216.test.ts`

---

## 8. Risks / do-not-simplify

- XB alone does **not** fix agent escapes; densable isolation is static analysis + cwd gate.
- Wrong prr mapping → false positive/negative.
- wxu needs densable-compatible AST; weaker AST silently weakens security.
- Axu/KQt membership UNCERTAIN.
- PowerShell can still redirect via env/flags in densable — do not “improve” without changelog evidence.
- Host XB omits OBJECT/SHALLOW while Ros includes them — never unify sets incorrectly.
- Dual messaging with autoModeRepoVisibility.
