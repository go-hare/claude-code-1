import { execa } from 'execa'
import { which } from '../which.js'

export type GhAuthStatusResult =
  | { status: 'authenticated'; supportsAuthTokenCommand: boolean }
  | { status: 'not_authenticated' }
  | { status: 'not_installed' }
  | { status: 'unknown'; error: string }

/** @deprecated Use GhAuthStatusResult.status — kept for call-site greps. */
export type GhAuthStatus = GhAuthStatusResult['status']

export type GhAuthProbe = {
  exitCode?: number | null
  stderr: string
  timedOut?: boolean
}

/**
 * densable 2.1.243 `yh` — classify `gh auth token` (stderr piped).
 */
export function classifyGhAuthTokenProbe(
  probe: GhAuthProbe,
):
  | { kind: 'authenticated' }
  | { kind: 'not_authenticated' }
  | { kind: 'timeout' }
  | { kind: 'old_cli' }
  | { kind: 'unknown'; error: string } {
  if (probe.exitCode === 0) return { kind: 'authenticated' }
  if (probe.timedOut) return { kind: 'timeout' }
  if (/not logged in|no oauth token/i.test(probe.stderr)) {
    return { kind: 'not_authenticated' }
  }
  if (
    /unknown command/i.test(probe.stderr) ||
    (Number.isInteger(probe.exitCode) && probe.stderr.trim() === '')
  ) {
    return { kind: 'old_cli' }
  }
  return {
    kind: 'unknown',
    error: probe.stderr.trim() || '`gh auth token` failed to run',
  }
}

/**
 * densable 2.1.243 `yh` fallback — classify `gh auth status`.
 */
export function classifyGhAuthStatusFallback(
  probe: GhAuthProbe,
): GhAuthStatusResult {
  if (probe.exitCode === 0) {
    return { status: 'authenticated', supportsAuthTokenCommand: false }
  }
  if (probe.timedOut) {
    return { status: 'unknown', error: '`gh auth status` timed out' }
  }
  if (/logged in to/i.test(probe.stderr)) {
    return { status: 'authenticated', supportsAuthTokenCommand: false }
  }
  if (/not logged in/i.test(probe.stderr)) {
    return { status: 'not_authenticated' }
  }
  return {
    status: 'unknown',
    error: probe.stderr.trim() || '`gh auth status` failed to run',
  }
}

/**
 * densable 2.1.243 `yh`.
 * `allowNetworkFallbackForOldGh`: old CLI (no `gh auth token`) may use
 * `gh auth status` (network). Telemetry/tips pass false; `/web-setup` passes true.
 */
export async function getGhAuthStatus({
  allowNetworkFallbackForOldGh = false,
}: {
  allowNetworkFallbackForOldGh?: boolean
} = {}): Promise<GhAuthStatusResult> {
  const ghPath = await which('gh')
  if (!ghPath) {
    return { status: 'not_installed' }
  }
  try {
    const tokenProbe = await execa('gh', ['auth', 'token'], {
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 5000,
      reject: false,
    })
    const classified = classifyGhAuthTokenProbe({
      exitCode: tokenProbe.exitCode,
      stderr: tokenProbe.stderr ?? '',
      timedOut: tokenProbe.timedOut,
    })
    if (classified.kind === 'authenticated') {
      return { status: 'authenticated', supportsAuthTokenCommand: true }
    }
    if (classified.kind === 'timeout') {
      return { status: 'unknown', error: '`gh auth token` timed out' }
    }
    if (classified.kind === 'not_authenticated') {
      return { status: 'not_authenticated' }
    }
    if (classified.kind === 'old_cli') {
      if (!allowNetworkFallbackForOldGh) {
        return {
          status: 'unknown',
          error: 'this GitHub CLI version has no `gh auth token`',
        }
      }
      const statusProbe = await execa('gh', ['auth', 'status'], {
        stdout: 'ignore',
        stderr: 'pipe',
        timeout: 5000,
        reject: false,
      })
      return classifyGhAuthStatusFallback({
        exitCode: statusProbe.exitCode,
        stderr: statusProbe.stderr ?? '',
        timedOut: statusProbe.timedOut,
      })
    }
    return { status: 'unknown', error: classified.error }
  } catch {
    return { status: 'not_installed' }
  }
}

/** densable 2.1.243 `/web-setup` `gh_too_old` line. */
export function formatWebSetupGhTooOldMessage(altAuthUrl: string): string {
  return `GitHub CLI is logged in, but this version is too old to share its login (\`gh auth token\` needs GitHub CLI 2.17.0 or newer). Update it via https://cli.github.com/, or connect GitHub on the web: ${altAuthUrl}`
}

/** densable 2.1.243 `/web-setup` `gh_check_failed` line. */
export function formatWebSetupGhCheckFailedMessage(
  error: string,
  altAuthUrl: string,
): string {
  const trimmed = error.replace(/[.\s]+$/, '')
  const suffix = trimmed ? ` (${trimmed})` : ''
  return `Couldn't check GitHub CLI login status${suffix}. Run \`gh auth status\` to check, or connect GitHub on the web: ${altAuthUrl}`
}
