# densable 2.1.212 — #8 worktree create no-follow symlink

Changelog:

> Fixed worktree creation following a repository-committed symlink at `.claude/worktrees` (could write the checkout outside the repo)

## densable `xqi(e, t)` (pre-create)

```js
async function xqi(e, t) {
  // e = repoRoot, t = worktreePath
  let r = [wc.join(e, '.claude'), QGe(e), t] // QGe = join(repo, '.claude', 'worktrees')
  for (let n of r) {
    let o
    try {
      o = await Tl.lstat(n)
    } catch (i) {
      if (ar(i)) continue // ENOENT ok
      me('git_worktree_create', 'git_worktree_create_lstat_failed')
      throw new tA(
        `Cannot create worktree: failed to lstat ${n}: ${ue(i)}`,
      )
    }
    if (o.isSymbolicLink()) {
      me('git_worktree_create', 'git_worktree_create_symlink_rejected')
      throw new tA(
        `Cannot create worktree: ${n} is a symlink. A repository-committed symlink at .claude, .claude/worktrees, or .claude/worktrees/<name> could redirect worktree creation outside the repository. Remove the symlink and retry.`,
      )
    }
  }
}
```

## densable post-`git worktree add` containment

Telemetry reasons (binary strings):

| reason | user message |
|--------|----------------|
| `git_worktree_create_containment_failed` | `Cannot create worktree: <path> resolved to <real>, which is not the expected worktree location <expected>` |
| `git_worktree_create_realpath_failed` | `Cannot create worktree: failed to verify containment of <path>. The path no longer resolves, so the checkout may have been written outside the repository — check ~/.claude/skills and other sensitive locations for unexpected content.` |

Also nearby create reasons (already partial local / not this item):  
`git_worktree_create_add_failed`, `…_revparse_failed`, `…_pr_fetch_failed`, `…_sparse_*`, `…_not_git_repo`, `…_path_missing`.

## Local alignment

| densable | local |
|----------|-------|
| `xqi` lstat chain | `assertWorktreeCreatePathsNotSymlinked` in `src/utils/worktree.ts` |
| call before mkdir / worktree add | `getOrCreateWorktree` (covers session, agent, tmux CLI paths) |
| post-add realpath containment | `assertWorktreeCreateContainment` after successful `git worktree add` |
| `me("git_worktree_create", reason)` | `logEvent(reason, {})` with densable reason string names |

## Out of scope for #8 (do not invent)

- densable `PXn` / post-create `symlinkDirectories` escape via committed symlink on destination names — separate surface
- Hook-based WorktreeCreate (user VCS backend) — densable git path only
