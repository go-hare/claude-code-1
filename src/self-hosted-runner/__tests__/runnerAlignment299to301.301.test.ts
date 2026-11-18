import { describe, expect, test } from 'bun:test'
import {
  FetchRefNotFoundError,
  SourceRefNotFoundError,
  isPermanentFetchRefError,
  sanitizePermanentRefWording,
} from '../gitPrepare.js'
import { buildSessionChildEnv } from '../sessionChild.js'

describe('self-hosted-runner #658 & #879 alignment', () => {
  test('#658: buildSessionChildEnv sets CLAUDE_CODE_REMOTE_MCP_CONFIG when mcpConfigPath is given', () => {
    const withMcp = buildSessionChildEnv({
      sessionId: 'cse_123',
      sessionToken: 'tok',
      workerEpoch: 1,
      configDir: '/tmp/cfg',
      stageFileRoot: '/tmp/stage',
      apiBaseUrl: 'https://api.example.com',
      inferenceAccessToken: 'inf',
      mcpConfigPath: '/tmp/cfg/remote-mcp.json',
    })
    expect(withMcp.CLAUDE_CODE_REMOTE_MCP_CONFIG).toBe(
      '/tmp/cfg/remote-mcp.json',
    )

    const withoutMcp = buildSessionChildEnv({
      sessionId: 'cse_123',
      sessionToken: 'tok',
      workerEpoch: 1,
      configDir: '/tmp/cfg',
      stageFileRoot: '/tmp/stage',
      apiBaseUrl: 'https://api.example.com',
      inferenceAccessToken: 'inf',
    })
    expect(withoutMcp.CLAUDE_CODE_REMOTE_MCP_CONFIG).toBeUndefined()
  })

  test('#879: sanitizePermanentRefWording rewrites unrelated missing-ref wording', () => {
    const raw =
      "hook failed: stderr was fatal: couldn't find remote ref refs/heads/feat"
    const sanitized = sanitizePermanentRefWording(raw)
    expect(sanitized).not.toContain("couldn't find remote ref")
    expect(sanitized).toContain('could not find remote ref')
    expect(isPermanentFetchRefError(sanitized)).toBe(false)

    // Case-insensitive + Turkish İ handling
    expect(
      isPermanentFetchRefError(
        sanitizePermanentRefWording("COULDN'T F\u0130ND REMOTE REF"),
      ),
    ).toBe(false)
  })

  test('#879: FetchRefNotFoundError & SourceRefNotFoundError preserve permanent marker', () => {
    const fetchErr = new FetchRefNotFoundError("couldn't find remote ref main")
    expect(fetchErr.name).toBe('FetchRefNotFoundError')
    expect(isPermanentFetchRefError(fetchErr.message)).toBe(true)

    const srcErr = new SourceRefNotFoundError('org/repo', 'feat/x')
    expect(srcErr.name).toBe('SourceRefNotFoundError')
    expect(srcErr.repo).toBe('org/repo')
    expect(srcErr.ref).toBe('feat/x')
    expect(isPermanentFetchRefError(srcErr.message)).toBe(true)
  })
})
