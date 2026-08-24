/**
 * densable 2.1.218 trust-dialog copy (SEA extract).
 *
 * Surfaces:
 * - Accessing workspace (startup TrustDialog) — densable has NO repo-root sentence
 * - Moving to a new directory (CdTrustPrompt /cd) — densable HAS full repo-root sentence
 * - Spawn/remote short form — densable "It's part of the repository at …"
 *
 * Local go-hare: startup TrustDialog uses Accessing body 1:1 and optionally shows
 * the CdTrustPrompt repo-root sentence when cwd is a worktree/subdir of a git root
 * (changelog #28 "dialogs" plural / name the repository root). There is no /cd
 * CdTrustPrompt port yet — SPAWN/CD helpers are exported for future wiring.
 */

/** densable Accessing workspace title */
export const ACCESSING_WORKSPACE_TITLE = 'Accessing workspace:'

/**
 * densable Accessing body line 1 (Quick safety check…).
 * SEA splits around the apostrophe in "what's".
 */
export const ACCESSING_QUICK_SAFETY_CHECK =
  "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first."

/**
 * densable Accessing body line 2 (capability).
 * SEA: "Claude Code" + "'" + "ll be able to read, edit, and execute files here."
 */
export const ACCESSING_CAPABILITY =
  "Claude Code'll be able to read, edit, and execute files here."

export const ACCESSING_CONFIRM_LABEL = 'Yes, I trust this folder'
export const ACCESSING_CANCEL_LABEL = 'No, exit'

/**
 * densable 2.1.238 SEA TrustDialog headersHelper disclosure (repoHelperSources).
 */
export const ACCESSING_HEADERS_HELPER_PREFIX =
  'This folder runs commands to mint HTTP headers (headersHelper), declared in '
export const ACCESSING_HEADERS_HELPER_TRUST_NOTE =
  'These will apply without asking. Only proceed if you trust this configuration.'

/** densable CdTrustPrompt (Moving to a new directory) repo-root sentence parts */
export const CD_TRUST_REPO_PREFIX =
  'This directory is part of the repository at'
export const CD_TRUST_REPO_SUFFIX =
  '. Trusting it trusts that whole repository, including its other worktrees and subdirectories.'

/**
 * densable spawn/remote short form when directory is under a trust root.
 * Template uses em dash (U+2014) as in densable `\u2014`.
 *
 * densable RC multi-env "Add server" trust dialog composes:
 *   `${dir} hasn't been trusted yet.${formatSpawnRepoTrustNote?} Trusting allows Claude…`
 * with title "Trust this directory?" / confirm "Yes, trust and add server".
 * That UI is densable daemon_rc_add multi-env product — go-hare has no
 * Add-server surface (standalone `claude rc` uses checkHasTrustDialogAccepted
 * fail-fast). Helper kept for #28 short form + future multi-env if shipped.
 */
export function formatSpawnRepoTrustNote(trustRoot: string): string {
  return ` It's part of the repository at ${trustRoot} \u2014 trusting it trusts that whole repository.`
}

/** densable multi-env Add-server trust dialog strings (SEA 2.1.218). */
export const RC_ADD_SERVER_TRUST_TITLE = 'Trust this directory?'
export const RC_ADD_SERVER_TRUST_CONFIRM = 'Yes, trust and add server'
export const RC_ADD_SERVER_TRUST_CANCEL = 'No, go back'
export const RC_ADD_SERVER_TRUST_CAPABILITY =
  ' Trusting allows Claude to read and execute files there.'
export const RC_ADD_SERVER_NOT_TRUSTED_YET = " hasn't been trusted yet."

/**
 * densable Add-server trust body (pre-Omt).
 * `repoNote` = formatSpawnRepoTrustNote(canonicalRoot) or '' when no distinct root.
 */
export function formatRcAddServerTrustBody(
  dir: string,
  repoNote: string = '',
): string {
  return `${dir}${RC_ADD_SERVER_NOT_TRUSTED_YET}${repoNote}${RC_ADD_SERVER_TRUST_CAPABILITY}`
}

/**
 * densable CdTrustPrompt full sentence as plain text (tests / non-JSX).
 * JSX surfaces bold the root segment between prefix and suffix.
 */
export function formatCdRepoTrustNote(trustRoot: string): string {
  return `${CD_TRUST_REPO_PREFIX} ${trustRoot}${CD_TRUST_REPO_SUFFIX}`
}

/**
 * Resolve whether to show a repository-root grant note for a workspace path.
 * Prefer canonical main-repo root (worktrees share project identity).
 *
 * densable 2.1.234 #23: callers must pass uncached probes
 * (`findCanonicalGitRootUncached` / `findGitRootUncached` ≈ I8e / rHo).
 * Injected cached `findGitRoot` / `findCanonicalGitRoot` (Yc / bd) can omit
 * the note when the directory was first seen before `.git` existed.
 */
export function resolveTrustRootNote(
  cwdPath: string,
  findCanonicalGitRoot: (path: string) => string | null,
  findGitRoot: (path: string) => string | null,
): { trustRoot: string; showRepoRootNote: boolean } {
  const gitRoot = findCanonicalGitRoot(cwdPath) ?? findGitRoot(cwdPath)
  const trustRoot = gitRoot ?? cwdPath
  const showRepoRootNote = gitRoot != null && gitRoot !== cwdPath
  return { trustRoot, showRepoRootNote }
}
