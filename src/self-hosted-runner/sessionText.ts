/**
 * densable session text helpers (TE / shared truncate).
 * Extracted from sessionHandler to avoid import cycles with sessionFailure / scmConnector.
 */

/** densable `TE` — cap error text for logs / failure report */
export function truncateSessionErrorText(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export type SkippedSessionRepository = {
  repo: string
  reason: string
}

/**
 * Official 2.1.328 (#640) — build the prompt note telling Claude which
 * repositories this self-hosted session started without, and why.
 */
export function formatMissingRepositoriesPromptNote(
  skipped: readonly SkippedSessionRepository[],
): string | undefined {
  if (skipped.length === 0) return undefined
  const lines = skipped.map(
    entry => `- ${entry.repo}: ${truncateSessionErrorText(entry.reason, 300)}`,
  )
  const noun =
    skipped.length === 1
      ? 'one of its repositories'
      : 'some of its repositories'
  return `This self-hosted session started without ${noun}:\n${lines.join('\n')}\nDo not assume files from the missing ${skipped.length === 1 ? 'repository are' : 'repositories are'} present; tell the user if their request depends on ${skipped.length === 1 ? 'it' : 'them'}.`
}

/**
 * Official 2.1.328 `Jka` (#661) — prompt guidance for resumed self-hosted
 * runner sessions so Claude checks whether earlier work is still present and
 * reports anything missing.
 */
export const RESUMED_SELF_HOSTED_WORK_CHECK_NOTE =
  "When this session resumed, it may have been on another machine or in a fresh checkout, so files that earlier turns created or changed may be missing, and so may commits that were not pushed and packages that were installed. Before you rely on earlier work, check that it is there by reading its files. For this, run nothing that may ask the user for permission, such as git fetch, git -C or cd with git. A checkout may also be behind what earlier turns pushed. If something that the user would care about is missing, tell them what. If nothing is, don't mention this, and don't commit or push because of it."

/**
 * Combine optional resumed-work-check and missing-repository notes for a
 * self-hosted runner session child's `--append-system-prompt`.
 */
export function buildSelfHostedSessionAppendPrompt(options: {
  isResumed?: boolean
  skippedRepositories?: readonly SkippedSessionRepository[]
}): string | undefined {
  const parts: string[] = []
  if (options.isResumed) {
    parts.push(RESUMED_SELF_HOSTED_WORK_CHECK_NOTE)
  }
  const missingNote = formatMissingRepositoriesPromptNote(
    options.skippedRepositories ?? [],
  )
  if (missingNote) {
    parts.push(missingNote)
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
