import { afterEach, describe, expect, test } from 'bun:test'
import { checkInteractiveUltrareviewWorkspaceTrust } from '../ultrareviewCommand.js'
import { checkUltrareviewWorkspaceTrust } from '../ultrareviewHeadless.js'

describe('review 2.1.314 alignment (#1367, #1439)', () => {
  const origCI = process.env.CI
  const origDisable = process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK

  afterEach(() => {
    if (origCI === undefined) delete process.env.CI
    else process.env.CI = origCI
    if (origDisable === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK
    } else {
      process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK = origDisable
    }
  })

  test('#1367: checkUltrareviewWorkspaceTrust refuses untrusted folder immediately when CI is set even if canPrompt=true', () => {
    process.env.CI = 'true'
    delete process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK
    const res = checkUltrareviewWorkspaceTrust({
      isTrusted: () => false,
      shouldCheck: () => true,
      canPrompt: true,
    })
    expect(res.trusted).toBe(false)
    if (!res.trusted) {
      expect(res.reason).toBe('workspace_not_trusted')
    }
  })

  test('#1439: checkInteractiveUltrareviewWorkspaceTrust rejects untrusted folder before running git', () => {
    const err = checkInteractiveUltrareviewWorkspaceTrust({
      isTrusted: () => false,
      shouldCheck: () => true,
      cwd: '/tmp/untrusted-repo',
    })
    expect(err).not.toBeNull()
    expect(err).toContain(
      'Ultrareview did not start: /tmp/untrusted-repo is not trusted',
    )

    const ok = checkInteractiveUltrareviewWorkspaceTrust({
      isTrusted: () => true,
      shouldCheck: () => true,
      cwd: '/tmp/trusted-repo',
    })
    expect(ok).toBeNull()
  })
})
