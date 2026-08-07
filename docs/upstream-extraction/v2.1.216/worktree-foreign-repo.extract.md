# densable 2.1.216 — worktree foreign-repo / leftover resume (1:1)

> **id:** `worktree-foreign-repo` · Changelog #9  
> **Status:** **HAVE** (dev/ino gitdir parent check on resume)  
> SEA: `/tmp/official-216/plat/package/claude`  
> Landed: 2026-08-06

---

## 1. Product intent (changelog)

> Fixed worktree sessions landing in another project's leftover worktree when the working directory did not match the selected project

Resume path must refuse a directory that is still a valid git worktree of a **different** repository (same slug leftover under `.claude/worktrees/`).

---

## 2. densable binary proof

| Needle | Hit | Notes |
|--------|-----|-------|
| `git_worktree_resume_foreign_repo` | telemetry | |
| `belongs to a different repository (registered under` | error | |
| `expected under` | error | |
| `Remove that directory or choose a different worktree name` | error | |
| `function DXi` / `OGr` | create/resume | |

### densable resume guard (from `DXi` cleaned)

```js
async function DXi(repoRoot, slug, opts) {
  const worktreePath = Lgu(repoRoot, slug) // .claude/worktrees/<slug>
  const existingHead = await bFn(worktreePath) // readWorktreeHeadSha
  if (existingHead) {
    const gitdir = await OGr(worktreePath) // read .git → gitdir:
    const repoGitDir = await CD(repoRoot) // resolveGitDir
    if (gitdir && repoGitDir) {
      const expected = join(repoGitDir, 'worktrees')
      const [stReg, stExp] = await Promise.all([
        stat(dirname(gitdir)).catch(() => null),
        stat(expected).catch(e => (ENOENT ? 'enoent' : null)),
      ])
      if (
        stReg !== null &&
        stExp !== null &&
        (stExp === 'enoent' || stReg.dev !== stExp.dev || stReg.ino !== stExp.ino)
      ) {
        me('git_worktree_create', 'git_worktree_resume_foreign_repo')
        throw new Error(
          `The worktree directory at ${worktreePath} belongs to a different repository (registered under ${dirname(gitdir)}, expected under ${expected}). Remove that directory or choose a different worktree name.`,
        )
      }
    }
    // … optional refresh / return existed …
  }
  // … create path …
}
```

**Key:** compare **device+inode** of `dirname(gitdir)` vs `<repoGitDir>/worktrees`, not string equality alone (symlink / alternate mount paths).

Related densable orphan self-heal `ELg` uses string `ep(dirname(gitdir))` vs `worktrees` — separate path; not required for #9 product line.

---

## 3. Local port map

| densable | Local |
|----------|--------|
| `OGr` | `readWorktreeGitDir` |
| `CD` | `resolveGitDir` |
| foreign check | `assertWorktreeNotForeignRepo` |
| call site | `getOrCreateWorktree` after `readWorktreeHeadSha` success |
| telemetry | `logEvent('git_worktree_resume_foreign_repo', {})` |

---

## 4. Residuals

1. densable also refreshes clean worktrees to origin (`TLg`) — **out of #9 scope**.  
2. Orphan dir self-heal `ELg` — not required for leftover foreign refuse.  
3. Local `logEvent` single-name form (no densable dual `me(create, resume_foreign)` pair) — event name matches.

---

## 5. Tests

- `src/utils/__tests__/worktreeForeignRepo.216.test.ts`

---

## 6. Definition of done

- [x] resume foreign gitdir → densable error copy  
- [x] same-repo resume still allowed  
- [x] telemetry event name  
- [x] `.216` tests  
