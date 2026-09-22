/**
 * densable 2.1.248 #5 — /web-setup workflow scope warning.
 * SEA F() @208679058 sha=ee48aec428135bec
 * SEA at() @208679597 sha=0add281a236d12b0
 * SEA B() @208680749 sha=0e0a881993c11f88
 *
 * install-github-app `Token scopes:` hard-fail is NOT this bullet.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as realExeca from 'execa'
import {
  analyticsMock,
  pushAnalyticsLogEvent,
} from '../../../../tests/mocks/analytics.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const GOLD_WARN =
  "Your GitHub CLI token doesn't have the workflow scope. Without it, GitHub rejects pushes that change GitHub Actions workflow files, and pushes to very large repositories can be rejected while GitHub checks for them. You can continue now. To add the scope, run `gh auth refresh -s workflow` and then run /web-setup again"

const GOLD_DOCS = 'https://cli.github.com/manual/gh_auth_refresh'

type GhApiProbe = {
  stdout: string
  exitCode: number | null
  timedOut?: boolean
}

const execaSnap = snapshotModuleExports(realExeca)
const execaMock = mock(
  async (): Promise<GhApiProbe> => ({
    stdout: '',
    exitCode: 0,
  }),
)

mock.module('execa', () => ({
  ...execaSnap,
  execa: execaMock,
}))

const events: Array<[string, Record<string, unknown>]> = []
let popAnalyticsLogEvent: (() => void) | undefined
mock.module('src/services/analytics/index.js', analyticsMock)

const {
  checkGhTokenWorkflowScope,
  parseGhApiOauthScopes,
  WEB_SETUP_WORKFLOW_SCOPE_DOCS,
  WEB_SETUP_WORKFLOW_SCOPE_WARNING,
} = await import('../ghTokenWorkflowScope.js')

beforeAll(() => {
  popAnalyticsLogEvent = pushAnalyticsLogEvent((name, meta) => {
    events.push([name, meta ?? {}])
  })
})

afterAll(() => {
  popAnalyticsLogEvent?.()
  mock.module('execa', () => ({ ...execaSnap }))
  mock.module('src/services/analytics/index.js', analyticsMock)
})

afterEach(() => {
  events.length = 0
  execaMock.mockReset()
  execaMock.mockImplementation(async () => ({
    stdout: '',
    exitCode: 0,
  }))
})

function includeUserStdout(scopesHeader: string): string {
  return [
    'HTTP/2.0 200 OK',
    scopesHeader,
    'content-type: application/json; charset=utf-8',
    '',
    '{"login":"octocat"}',
  ].join('\n')
}

describe('densable 2.1.248 #5 web-setup workflow scope', () => {
  test('warn copy is gold 1:1 (B first child + docs sibling)', () => {
    expect(WEB_SETUP_WORKFLOW_SCOPE_WARNING).toBe(GOLD_WARN)
    expect(WEB_SETUP_WORKFLOW_SCOPE_DOCS).toBe(GOLD_DOCS)
    expect(`${WEB_SETUP_WORKFLOW_SCOPE_WARNING}: ${GOLD_DOCS}`).toBe(
      `${GOLD_WARN}: ${GOLD_DOCS}`,
    )
  })

  test('at() parses x-oauth-scopes from the header block', () => {
    expect(
      parseGhApiOauthScopes(
        includeUserStdout('X-OAuth-Scopes: repo, workflow, gist'),
      ),
    ).toEqual(['repo', 'workflow', 'gist'])
    expect(
      parseGhApiOauthScopes(includeUserStdout('x-oauth-scopes:\trepo,gist')),
    ).toEqual(['repo', 'gist'])
    expect(
      parseGhApiOauthScopes(
        'HTTP/1.1 200 OK\r\nX-OAuth-Scopes: workflow\r\n\r\n{}',
      ),
    ).toEqual(['workflow'])
  })

  test('at() returns null without a usable scopes header', () => {
    expect(parseGhApiOauthScopes(includeUserStdout(''))).toBeNull()
    expect(
      parseGhApiOauthScopes(includeUserStdout('X-OAuth-Scopes:')),
    ).toBeNull()
    expect(
      parseGhApiOauthScopes(includeUserStdout('X-OAuth-Scopes:   ,  ')),
    ).toBeNull()
    expect(parseGhApiOauthScopes('{"login":"octocat"}')).toBeNull()
    expect(
      parseGhApiOauthScopes('HTTP/2.0 200 OK\n\n{"x-oauth-scopes":"workflow"}'),
    ).toBeNull()
  })

  test('F() present when scopes include workflow', async () => {
    execaMock.mockImplementation(async () => ({
      stdout: includeUserStdout('X-OAuth-Scopes: repo, workflow'),
      exitCode: 0,
    }))
    await expect(checkGhTokenWorkflowScope()).resolves.toBe('present')
    expect(execaMock).toHaveBeenCalledWith('gh', ['api', '--include', 'user'], {
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 5000,
      reject: false,
    })
    expect(events).toEqual([
      ['tengu_feature_ok', { feature_name: 'remote_setup_gh_token_scopes' }],
    ])
  })

  test('F() missing when header omits workflow', async () => {
    execaMock.mockImplementation(async () => ({
      stdout: includeUserStdout('X-OAuth-Scopes: repo, gist'),
      exitCode: 0,
    }))
    await expect(checkGhTokenWorkflowScope()).resolves.toBe('missing')
    expect(events).toEqual([
      ['tengu_feature_ok', { feature_name: 'remote_setup_gh_token_scopes' }],
    ])
  })

  test('F() unknown on spawn / timeout / gh fail / no header', async () => {
    execaMock.mockImplementation(async () => {
      throw new Error('ENOENT')
    })
    await expect(checkGhTokenWorkflowScope()).resolves.toBe('unknown')

    execaMock.mockImplementation(async () => ({
      stdout: '',
      exitCode: 1,
      timedOut: true,
    }))
    await expect(checkGhTokenWorkflowScope()).resolves.toBe('unknown')

    execaMock.mockImplementation(async () => ({
      stdout: 'unauthorized',
      exitCode: 1,
    }))
    await expect(checkGhTokenWorkflowScope()).resolves.toBe('unknown')

    execaMock.mockImplementation(async () => ({
      stdout: includeUserStdout('accept: application/json'),
      exitCode: 0,
    }))
    await expect(checkGhTokenWorkflowScope()).resolves.toBe('unknown')

    expect(events).toEqual([
      [
        'tengu_feature_bad',
        {
          feature_name: 'remote_setup_gh_token_scopes',
          error_code: 'spawn_failed',
        },
      ],
      [
        'tengu_feature_bad',
        {
          feature_name: 'remote_setup_gh_token_scopes',
          error_code: 'timeout',
        },
      ],
      [
        'tengu_feature_bad',
        {
          feature_name: 'remote_setup_gh_token_scopes',
          error_code: 'gh_api_failed',
        },
      ],
      [
        'tengu_feature_bad',
        {
          feature_name: 'remote_setup_gh_token_scopes',
          error_code: 'no_scopes_header',
        },
      ],
    ])
  })

  test('remote-setup renders B() only when missing; not Token scopes leftover', () => {
    const setup = readFileSync(
      join(import.meta.dir, '../remote-setup.tsx'),
      'utf8',
    )
    const helper = readFileSync(
      join(import.meta.dir, '../ghTokenWorkflowScope.ts'),
      'utf8',
    )
    expect(setup).toContain("ghTokenWorkflowScope === 'missing'")
    expect(setup).toContain('color="warning"')
    expect(setup).toContain('WEB_SETUP_WORKFLOW_SCOPE_WARNING')
    expect(setup).toContain('WEB_SETUP_WORKFLOW_SCOPE_DOCS')
    expect(setup).toContain('checkGhTokenWorkflowScope')
    expect(setup).toContain('gh_token_workflow_scope')
    expect(setup).not.toContain('Token scopes:')
    expect(helper).toContain('gh')
    expect(helper).toContain("'api'")
    expect(helper).toContain("'--include'")
    expect(helper).toContain("'user'")
    expect(helper).toContain('/^x-oauth-scopes:[ \\t]*(.*)$/im')
    expect(helper).toContain("? 'present' : 'missing'")
    expect(helper).not.toContain('Token scopes:')
    expect(helper).not.toContain('repo,workflow')
  })
})
