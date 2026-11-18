import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkUltrareviewWorkspaceTrust,
  shouldRunUltrareviewTrustCheck,
  validateTrustWorkspaceFlag,
} from '../ultrareviewHeadless.js'

const origDisable = process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK

afterEach(() => {
  if (origDisable === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK
  } else {
    process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK = origDisable
  }
})

describe('#1170 claude ultrareview --trust-workspace', () => {
  test('validateTrustWorkspaceFlag rejects value following --trust-workspace', () => {
    const err = validateTrustWorkspaceFlag(
      ['node', 'claude', 'ultrareview', '--trust-workspace', '123'],
      true,
      false,
    )
    expect(err).toContain('`--trust-workspace` takes no value')
    expect(err).toContain('"123"')
    expect(err).toContain('a PR number or base branch goes before it')

    expect(
      validateTrustWorkspaceFlag(
        ['node', 'claude', 'ultrareview', '123', '--trust-workspace'],
        true,
        false,
      ),
    ).toBeNull()
  })

  test('checkUltrareviewWorkspaceTrust allows when --trust-workspace is passed or already trusted', () => {
    expect(
      checkUltrareviewWorkspaceTrust({
        trustWorkspace: true,
        argv: ['node', 'claude', 'ultrareview', '--trust-workspace'],
        isTrusted: () => false,
        canPrompt: false,
      }),
    ).toEqual({ trusted: true })

    expect(
      checkUltrareviewWorkspaceTrust({
        trustWorkspace: false,
        isTrusted: () => true,
        canPrompt: false,
      }),
    ).toEqual({ trusted: true })
  })

  test('shouldRunUltrareviewTrustCheck returns false when CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK=1', () => {
    process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK = '1'
    expect(shouldRunUltrareviewTrustCheck()).toBe(false)
  })
})
