/**
 * densable 2.1.218 #28 — trust dialog copy + repo-root grant note.
 */
import { describe, expect, test } from 'bun:test'
import {
  ACCESSING_CAPABILITY,
  ACCESSING_QUICK_SAFETY_CHECK,
  ACCESSING_WORKSPACE_TITLE,
  CD_TRUST_REPO_PREFIX,
  CD_TRUST_REPO_SUFFIX,
  formatCdRepoTrustNote,
  formatRcAddServerTrustBody,
  formatSpawnRepoTrustNote,
  RC_ADD_SERVER_TRUST_CANCEL,
  RC_ADD_SERVER_TRUST_CONFIRM,
  RC_ADD_SERVER_TRUST_TITLE,
  resolveTrustRootNote,
} from '../trustDialogCopy.js'

describe('densable 2.1.218 #28 trust dialog copy', () => {
  test('Accessing workspace title and body match densable SEA', () => {
    expect(ACCESSING_WORKSPACE_TITLE).toBe('Accessing workspace:')
    expect(ACCESSING_QUICK_SAFETY_CHECK).toContain(
      'Quick safety check: Is this a project you created or one you trust?',
    )
    expect(ACCESSING_QUICK_SAFETY_CHECK).toContain(
      "review what's in this folder first.",
    )
    expect(ACCESSING_CAPABILITY).toBe(
      "Claude Code'll be able to read, edit, and execute files here.",
    )
  })

  test('CdTrustPrompt repo-root sentence matches densable (not old Trust grant covers)', () => {
    const note = formatCdRepoTrustNote('/repo')
    expect(note).toBe(
      'This directory is part of the repository at /repo. Trusting it trusts that whole repository, including its other worktrees and subdirectories.',
    )
    expect(note).not.toContain('Trust grant covers')
    expect(CD_TRUST_REPO_PREFIX).toBe(
      'This directory is part of the repository at',
    )
    expect(CD_TRUST_REPO_SUFFIX).toContain('other worktrees and subdirectories')
  })

  test('spawn short form uses densable em dash', () => {
    expect(formatSpawnRepoTrustNote('/main')).toBe(
      " It's part of the repository at /main \u2014 trusting it trusts that whole repository.",
    )
  })

  test('RC Add-server trust body matches densable SEA composition', () => {
    const withRepo = formatRcAddServerTrustBody(
      '/repo/pkg',
      formatSpawnRepoTrustNote('/repo'),
    )
    expect(withRepo).toBe(
      "/repo/pkg hasn't been trusted yet. It's part of the repository at /repo \u2014 trusting it trusts that whole repository. Trusting allows Claude to read and execute files there.",
    )
    expect(formatRcAddServerTrustBody('/tmp/x')).toBe(
      "/tmp/x hasn't been trusted yet. Trusting allows Claude to read and execute files there.",
    )
    expect(RC_ADD_SERVER_TRUST_TITLE).toBe('Trust this directory?')
    expect(RC_ADD_SERVER_TRUST_CONFIRM).toBe('Yes, trust and add server')
    expect(RC_ADD_SERVER_TRUST_CANCEL).toBe('No, go back')
  })

  test('resolveTrustRootNote shows note only when under a distinct git root', () => {
    const under = resolveTrustRootNote(
      '/repo/packages/app',
      () => '/repo',
      () => '/repo',
    )
    expect(under.showRepoRootNote).toBe(true)
    expect(under.trustRoot).toBe('/repo')

    const atRoot = resolveTrustRootNote(
      '/repo',
      () => '/repo',
      () => '/repo',
    )
    expect(atRoot.showRepoRootNote).toBe(false)
    expect(atRoot.trustRoot).toBe('/repo')

    const noGit = resolveTrustRootNote(
      '/tmp/scratch',
      () => null,
      () => null,
    )
    expect(noGit.showRepoRootNote).toBe(false)
    expect(noGit.trustRoot).toBe('/tmp/scratch')
  })
})
