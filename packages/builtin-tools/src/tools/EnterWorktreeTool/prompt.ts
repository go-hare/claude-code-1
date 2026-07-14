export function getEnterWorktreeToolPrompt(): string {
  return `Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it, or enters an existing worktree via \`path\`.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree", "enter that worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json
- Creating a new worktree is blocked while already in a worktree session (pass \`path\` to switch into another existing one, or ExitWorktree first)

## Behavior

- In a git repository: creates a new git worktree inside \`.claude/worktrees/\` with a new branch based on HEAD
- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation
- With \`path\`: enters an existing worktree directory (managed Claude worktrees under \`.claude/worktrees/\` auto-allow; other paths require user confirmation because they relocate the permission root)
- Switches the session's working directory to the worktree
- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it

## Parameters

- \`name\` (optional): A name for a new worktree. If neither \`name\` nor \`path\` is provided, a random name is generated.
- \`path\` (optional): Path to an existing worktree to enter instead of creating one — of the current repository, or (on first entry from the launch directory) of a repository nested inside it. Mutually exclusive with \`name\`.
`
}
