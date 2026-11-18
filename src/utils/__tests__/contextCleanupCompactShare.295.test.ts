import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { getCwd } from '../cwd.js'
import {
  maskSecrets,
  redactKeyValueSecrets,
} from '../../commands/share/index.js'
import { getGitStatus } from '../../context.js'
import {
  getJitteredPollIntervalMs,
  ORCH_POLL_INTERVAL_MAX_MS,
  ORCH_POLL_INTERVAL_MIN_MS,
} from '../../self-hosted-runner/orchestrator.js'
import {
  COMPACT_REPLY_INSTRUCTIONS_TRAILER,
  LEFT_OUT_TOOL_RESULTS_NOTE,
  SUMMARIZATION_REQUEST_NOTE,
} from '../../services/compact/prompt.js'
import { sweepSeedAdminFromCleanup } from '../teleport/seedGitAdmin.js'

describe('v2.1.293-296 context/cleanup/orchestrator/compact/redactor alignment (#288, #332, #377, #434, #501)', () => {
  const origCwd = getCwdState()
  let tempDir: string | undefined

  afterEach(() => {
    setCwdState(origCwd)
    getGitStatus.cache.clear?.()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('#377: getGitStatus memoize cache key uses getCwd() so linked worktrees do not collide', () => {
    const resolver = (
      getGitStatus as unknown as { cache: { has: (k: unknown) => boolean } }
    ).cache
    expect(resolver).toBeDefined()
    setCwdState('/tmp/worktree-a')
    expect(getCwd()).toBe('/tmp/worktree-a')
  })

  test('#332: getJitteredPollIntervalMs produces 4000..6000ms jittered intervals', () => {
    expect(getJitteredPollIntervalMs(5_000, () => 0)).toBe(
      ORCH_POLL_INTERVAL_MIN_MS,
    )
    expect(getJitteredPollIntervalMs(5_000, () => 0.9999)).toBe(
      ORCH_POLL_INTERVAL_MAX_MS,
    )
    const mid = getJitteredPollIntervalMs(5_000, () => 0.5)
    expect(mid).toBeGreaterThanOrEqual(4_000)
    expect(mid).toBeLessThanOrEqual(6_000)
  })

  test('#434: sweepSeedAdminFromCleanup runs safely when seed-admin does not exist', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'seed-admin-cleanup-'))
    const orig = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    try {
      const res = await sweepSeedAdminFromCleanup()
      expect(res.refused).toBe('no')
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = orig
    }
  })

  test('#288: compact prompt constants match SEA I5r/RIn/AIn', () => {
    expect(SUMMARIZATION_REQUEST_NOTE).toContain(
      'This summarization request itself',
    )
    expect(COMPACT_REPLY_INSTRUCTIONS_TRAILER).toContain('For this reply only:')
    expect(LEFT_OUT_TOOL_RESULTS_NOTE).toContain(
      'Some tool results above were left out whole',
    )
  })

  test('#501: redactKeyValueSecrets & maskSecrets redact values after valueless keys and shell-escaped JSON quotes', () => {
    const shellJson = `bash -c 'echo "{\\"aws_secret_access_key\\":\\"MySuperSecretValue12345\\"}"'`
    const redacted = maskSecrets(shellJson)
    expect(redacted).not.toContain('MySuperSecretValue12345')
    expect(redacted).toContain('[REDACTED]')

    // Non-secret sentinel words are preserved
    expect(redactKeyValueSecrets('session_token=null')).toBe(
      'session_token=null',
    )
    expect(redactKeyValueSecrets('secret_key=my_real_secret_abc')).toBe(
      'secret_key=[REDACTED]',
    )
  })
})
