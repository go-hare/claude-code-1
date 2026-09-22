/**
 * densable 2.1.248 #43 — local /ultrareview GitHub access precheck.
 * k() mapping · TUn default ON · official se refuse strings · Mo/TUn/Tt gate.
 * Do not mock.module reviewRemote.js (poisons ultrareview.218.test.ts).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { isEssentialTrafficOnly } from '../../../utils/privacyLevel.js'
import {
  formatGithubAccessPrecheckError,
  GITHUB_APP_INSTALLATIONS_NEW_URL,
  isGithubAccessPrecheckEnabled,
  mapLinkedGithubAccessHttpError,
  shouldProbeGithubAccess,
} from '../githubAccessPrecheck.js'
import { isGithubComHost } from '../reviewRemote.js'

const ESSENTIAL = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
const savedEssential = process.env[ESSENTIAL]

const ONBOARDING = 'https://claude.ai/code/onboarding?step=alt-auth'
const INSTALL = GITHUB_APP_INSTALLATIONS_NEW_URL
const WEB_SETUP = 'run /web-setup to reuse your GitHub CLI login'

afterEach(() => {
  if (savedEssential === undefined) delete process.env[ESSENTIAL]
  else process.env[ESSENTIAL] = savedEssential
})

describe('densable k() 401/404 → linked-account verdict', () => {
  test('401 + auth_required + type github → github_not_connected', () => {
    expect(
      mapLinkedGithubAccessHttpError(401, {
        error: {
          details: { error_code: 'auth_required', type: 'github' },
        },
      }),
    ).toBe('github_not_connected')
  })

  test('404 + github_resource_not_found → github_repo_not_found', () => {
    expect(
      mapLinkedGithubAccessHttpError(404, {
        error: { details: { error_code: 'github_resource_not_found' } },
      }),
    ).toBe('github_repo_not_found')
  })

  test('else inconclusive', () => {
    expect(
      mapLinkedGithubAccessHttpError(401, {
        error: { details: { error_code: 'auth_required', type: 'other' } },
      }),
    ).toBe('inconclusive')
    expect(
      mapLinkedGithubAccessHttpError(404, {
        error: { details: { error_code: 'other' } },
      }),
    ).toBe('inconclusive')
    expect(mapLinkedGithubAccessHttpError(401, {})).toBe('inconclusive')
    expect(mapLinkedGithubAccessHttpError(403, {})).toBe('inconclusive')
    expect(mapLinkedGithubAccessHttpError(500, {})).toBe('inconclusive')
    expect(mapLinkedGithubAccessHttpError(undefined, {})).toBe('inconclusive')
  })
})

describe('densable TUn github_access_precheck_enabled', () => {
  test('default ON unless GrowthBook explicitly false', () => {
    expect(isGithubAccessPrecheckEnabled(null)).toBe(true)
    expect(isGithubAccessPrecheckEnabled({})).toBe(true)
    expect(
      isGithubAccessPrecheckEnabled({
        github_access_precheck_enabled: true,
      }),
    ).toBe(true)
    expect(
      isGithubAccessPrecheckEnabled({
        github_access_precheck_enabled: false,
      }),
    ).toBe(false)
  })
})

describe('official se refuse strings 1:1', () => {
  test('github_not_connected with /web-setup hint', () => {
    expect(
      formatGithubAccessPrecheckError({
        verdict: 'github_not_connected',
        owner: 'acme',
        name: 'widgets',
        invocation: '/code-review ultra',
        prArg: '42',
        ghPrViewCode: 0,
        webSetupHint: WEB_SETUP,
        onboardingUrl: ONBOARDING,
      }),
    ).toBe(
      `Ultrareview clones acme/widgets in the cloud with the GitHub account connected to your Claude account, and none is connected (or the connection expired). To fix: ${WEB_SETUP}, or connect an account at ${ONBOARDING} \u2014 then re-run /code-review ultra 42 (allow a minute after connecting).`,
    )
  })

  test('github_not_connected without /web-setup hint', () => {
    expect(
      formatGithubAccessPrecheckError({
        verdict: 'github_not_connected',
        owner: 'acme',
        name: 'widgets',
        invocation: '/code-review ultra',
        prArg: '42',
        ghPrViewCode: 0,
        webSetupHint: '',
        onboardingUrl: ONBOARDING,
      }),
    ).toBe(
      `Ultrareview clones acme/widgets in the cloud with the GitHub account connected to your Claude account, and none is connected (or the connection expired). To fix: connect an account at ${ONBOARDING} \u2014 then re-run /code-review ultra 42 (allow a minute after connecting).`,
    )
  })

  test('github_repo_not_found: x && Y===0 → hint, or install', () => {
    expect(
      formatGithubAccessPrecheckError({
        verdict: 'github_repo_not_found',
        owner: 'acme',
        name: 'widgets',
        invocation: '/code-review ultra',
        prArg: '42',
        ghPrViewCode: 0,
        webSetupHint: WEB_SETUP,
        onboardingUrl: ONBOARDING,
        installAppUrl: INSTALL,
      }),
    ).toBe(
      `Your connected GitHub account can't see acme/widgets \u2014 usually the Claude GitHub app isn't installed on acme or wasn't granted this repo (web-connected accounts need it for private repos), or a different GitHub account is connected. To fix: ${WEB_SETUP}, or install the app at ${INSTALL} \u2014 then re-run /code-review ultra 42.`,
    )
  })

  test('github_repo_not_found: Y!==0 → install, or hint', () => {
    expect(
      formatGithubAccessPrecheckError({
        verdict: 'github_repo_not_found',
        owner: 'acme',
        name: 'widgets',
        invocation: '/code-review ultra',
        prArg: '42',
        ghPrViewCode: 1,
        webSetupHint: WEB_SETUP,
        installAppUrl: INSTALL,
      }),
    ).toBe(
      `Your connected GitHub account can't see acme/widgets \u2014 usually the Claude GitHub app isn't installed on acme or wasn't granted this repo (web-connected accounts need it for private repos), or a different GitHub account is connected. To fix: install the app at ${INSTALL}, or ${WEB_SETUP} \u2014 then re-run /code-review ultra 42.`,
    )
  })
})

describe('probe skipped when TUn false or host not Mo', () => {
  test('skipped when TUn explicitly false', () => {
    delete process.env[ESSENTIAL]
    expect(isEssentialTrafficOnly()).toBe(false)
    expect(
      shouldProbeGithubAccess('github.com', isGithubComHost, {
        github_access_precheck_enabled: false,
      }),
    ).toBe(false)
  })

  test('skipped when host is not github.com (Mo)', () => {
    delete process.env[ESSENTIAL]
    expect(isGithubComHost('ghe.example.com')).toBe(false)
    expect(
      shouldProbeGithubAccess('ghe.example.com', isGithubComHost, {}),
    ).toBe(false)
  })

  test('runs when Mo + TUn default ON + !Tt', () => {
    delete process.env[ESSENTIAL]
    expect(isGithubComHost('github.com')).toBe(true)
    expect(isGithubComHost('www.github.com')).toBe(true)
    expect(shouldProbeGithubAccess('github.com', isGithubComHost, {})).toBe(
      true,
    )
    expect(
      shouldProbeGithubAccess('www.github.com', isGithubComHost, null),
    ).toBe(true)
  })

  test('skipped when Tt essential-traffic', () => {
    process.env[ESSENTIAL] = '1'
    expect(isEssentialTrafficOnly()).toBe(true)
    expect(shouldProbeGithubAccess('github.com', isGithubComHost, {})).toBe(
      false,
    )
  })
})

describe('reviewRemote wires official Promise.all probe (no reviewRemote mock)', () => {
  test('bxt position: parallel gh pr view + refuse before size', () => {
    const src = readFileSync(
      join(import.meta.dir, '../reviewRemote.ts'),
      'utf8',
    )
    expect(src).toContain('Promise.all([')
    expect(src).toContain('shouldProbeGithubAccess(repo.host, isGithubComHost)')
    expect(src).toContain(
      'probeLinkedGithubAccountAccess(repo.owner, repo.name)',
    )
    expect(src).toContain(
      'ultrareview: linked GitHub account access to ${repo.owner}/${repo.name}:',
    )
    expect(src).toContain("HTTP ${accessProbe.httpStatus ?? 'none'}")
    expect(src).toContain("'tengu_review_remote_github_access_probe'")
    expect(src).toContain("'github_not_connected'")
    expect(src).toContain("'github_repo_not_found'")
    const probeIdx = src.indexOf('shouldProbeGithubAccess')
    const sizeIdx = src.indexOf("reason: meta('pr_diff_too_large')")
    const cloudIdx = src.indexOf("launchMode = 'pr'")
    expect(probeIdx).toBeGreaterThan(-1)
    expect(sizeIdx).toBeGreaterThan(probeIdx)
    expect(cloudIdx).toBeGreaterThan(sizeIdx)
  })
})
