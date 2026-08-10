/**
 * densable 2.1.221 #26 — ultrareview detached HEAD / no-branches refuse.
 *
 * Probe is pure logic mirror of reviewRemote no_merge_base branch:
 * emptyTreeEligible && !hasAnyRef → densable copy.
 */
import { describe, expect, test } from 'bun:test'

function resolveNoMergeBaseHint(input: {
  headOk: boolean
  isShallow: boolean
  isNonShallow: boolean
  emptyTreeFallbackEnabled: boolean
  hasAnyRef: boolean
  fetchedFromOrigin: boolean
  branchBaseArg: string
  baseBranch: string
  invocation: string
}): string {
  const emptyTreeEligible =
    input.headOk && input.isNonShallow && input.emptyTreeFallbackEnabled
  if (!input.headOk) {
    return `Your current branch has no commits yet, so there is nothing to review. Commit your changes first, then rerun ${input.invocation}.`
  }
  if (input.isShallow) {
    return input.branchBaseArg
      ? `Your clone is shallow and doesn't contain the point where your branch forked from ${input.baseBranch}. Run \`git fetch --deepen=100 origin ${input.baseBranch}\` (or \`git fetch --unshallow origin\`) and rerun ${input.invocation}.`
      : `Your clone is shallow and doesn't contain the point where your branch forked from ${input.baseBranch}. Run \`git fetch --unshallow origin\` and rerun ${input.invocation}. If your base branch isn't ${input.baseBranch}, pass it explicitly (\`${input.invocation} <branch>\`).`
  }
  if (emptyTreeEligible && !input.hasAnyRef) {
    return `Your checkout has no branches (detached HEAD only), which cloud review can't bundle. Create one first — \`git checkout -b <name>\` — then rerun ${input.invocation}.`
  }
  if (input.fetchedFromOrigin) {
    return input.isNonShallow
      ? `${input.baseBranch} was fetched from origin but shares no history with HEAD. If another branch is your real base, pass it explicitly (\`${input.invocation} <branch>\`).`
      : `${input.baseBranch} was fetched from origin but shares no history with HEAD. Try \`git fetch --unshallow origin\` (or deepen the clone) and rerun.`
  }
  return input.branchBaseArg
    ? `Make sure ${input.baseBranch} exists locally or on origin (try \`git fetch origin ${input.baseBranch}\`).`
    : `Pass the base branch explicitly (e.g. \`${input.invocation} develop\`) or make sure you're in a git repo with a ${input.baseBranch} branch.`
}

describe('ultrareview no_merge_base densable 2.1.221', () => {
  test('detached HEAD only (V&&!K) refuses with no-branches copy', () => {
    const text = resolveNoMergeBaseHint({
      headOk: true,
      isShallow: false,
      isNonShallow: true,
      emptyTreeFallbackEnabled: true,
      hasAnyRef: false,
      fetchedFromOrigin: false,
      branchBaseArg: '',
      baseBranch: 'main',
      invocation: '/ultrareview',
    })
    expect(text).toContain('has no branches (detached HEAD only)')
    expect(text).toContain('git checkout -b <name>')
    expect(text).not.toContain('unshallow')
  })

  test('non-shallow fetchedFromOrigin does not suggest unshallow', () => {
    const text = resolveNoMergeBaseHint({
      headOk: true,
      isShallow: false,
      isNonShallow: true,
      emptyTreeFallbackEnabled: true,
      hasAnyRef: true,
      fetchedFromOrigin: true,
      branchBaseArg: 'main',
      baseBranch: 'main',
      invocation: '/ultrareview',
    })
    expect(text).toContain('If another branch is your real base')
    expect(text).not.toContain('unshallow')
  })

  test('shallow still offers unshallow', () => {
    const text = resolveNoMergeBaseHint({
      headOk: true,
      isShallow: true,
      isNonShallow: false,
      emptyTreeFallbackEnabled: true,
      hasAnyRef: true,
      fetchedFromOrigin: false,
      branchBaseArg: '',
      baseBranch: 'main',
      invocation: '/ultrareview',
    })
    expect(text).toContain('git fetch --unshallow origin')
  })
})
