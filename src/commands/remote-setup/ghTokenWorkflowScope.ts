import { execa } from 'execa'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS as SafeString,
} from '../../services/analytics/index.js'

export type GhTokenWorkflowScope = 'present' | 'missing' | 'unknown'

/** densable 2.1.248 #5 B() first child (colon + docs URL are render siblings). */
export const WEB_SETUP_WORKFLOW_SCOPE_WARNING =
  "Your GitHub CLI token doesn't have the workflow scope. Without it, GitHub rejects pushes that change GitHub Actions workflow files, and pushes to very large repositories can be rejected while GitHub checks for them. You can continue now. To add the scope, run `gh auth refresh -s workflow` and then run /web-setup again"

export const WEB_SETUP_WORKFLOW_SCOPE_DOCS =
  'https://cli.github.com/manual/gh_auth_refresh'

const FEATURE_NAME = 'remote_setup_gh_token_scopes' as SafeString

/** densable 2.1.248 #5 `y(feature, reason)` → tengu_feature_bad. */
function logWorkflowScopeBad(errorCode: string): void {
  logEvent('tengu_feature_bad', {
    feature_name: FEATURE_NAME,
    error_code: errorCode as SafeString,
  })
}

/** densable 2.1.248 #5 `b(feature)` → tengu_feature_ok. */
function logWorkflowScopeOk(): void {
  logEvent('tengu_feature_ok', {
    feature_name: FEATURE_NAME,
  })
}

/**
 * densable 2.1.248 #5 `at` @208679597 sha=0add281a236d12b0 —
 * parse `x-oauth-scopes` from `gh api --include` header block.
 */
export function parseGhApiOauthScopes(stdout: string): string[] | null {
  const headerBlock = stdout.split(/\r?\n\r?\n/, 1)[0] ?? ''
  const match = /^x-oauth-scopes:[ \t]*(.*)$/im.exec(headerBlock)
  if (!match) return null
  const scopes = (match[1] ?? '')
    .split(',')
    .map(scope => scope.trim())
    .filter(scope => scope !== '')
  return scopes.length === 0 ? null : scopes
}

/**
 * densable 2.1.248 #5 `F` @208679058 sha=ee48aec428135bec —
 * `gh api --include user` → present | missing | unknown.
 */
export async function checkGhTokenWorkflowScope(): Promise<GhTokenWorkflowScope> {
  let probe: {
    stdout: string
    exitCode?: number | null
    timedOut?: boolean
  }
  try {
    probe = await execa('gh', ['api', '--include', 'user'], {
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 5000,
      reject: false,
    })
  } catch {
    logWorkflowScopeBad('spawn_failed')
    return 'unknown'
  }
  if (probe.timedOut) {
    logWorkflowScopeBad('timeout')
    return 'unknown'
  }
  if (probe.exitCode !== 0) {
    logWorkflowScopeBad('gh_api_failed')
    return 'unknown'
  }
  const scopes = parseGhApiOauthScopes(probe.stdout)
  if (scopes === null) {
    logWorkflowScopeBad('no_scopes_header')
    return 'unknown'
  }
  logWorkflowScopeOk()
  return scopes.includes('workflow') ? 'present' : 'missing'
}
