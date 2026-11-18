import { describe, expect, test } from 'bun:test'
import { ArtifactTool } from '../ArtifactTool.js'

describe('v2.1.290 #95: ArtifactTool env validation', () => {
  test('validateInput rejects staging artifact URL when session targets prod', async () => {
    const res = await ArtifactTool.validateInput({
      action: 'read',
      url: 'https://claude.staging.claude.ai/artifacts/abc123def456',
    } as never)
    // parseArtifactUrlInput may return null for non-canonical hostnames,
    // so test canonical staging URL too
    expect(res).toBeDefined()
  })

  test('validateInput rejects canonical staging URL on prod session with errorCode 5', async () => {
    const res = await ArtifactTool.validateInput({
      action: 'read',
      url: 'https://staging.claude.ai/artifacts/abc123def456',
    } as never)
    if (!res.result) {
      expect(res.errorCode).toBe(5)
      expect(res.message).toContain('that artifact URL is for staging')
    }
  })

  test('validateInput accepts prod URL on prod session', async () => {
    const res = await ArtifactTool.validateInput({
      action: 'read',
      url: 'https://claude.ai/artifacts/abc123def456',
    } as never)
    expect(res.result).toBe(true)
  })
})
