/**
 * densable 2.1.234 #34 — SendMessageTool wires searchTruncated / Gff / wWr / iza.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const toolSrc = readFileSync(
  join(import.meta.dir, '../SendMessageTool.ts'),
  'utf8',
)

describe('densable 2.1.234 #34 SendMessageTool truncated wiring', () => {
  test('bare-name path walks account + cloud lists and ORs truncated', () => {
    expect(toolSrc).toContain('listBridgePeerSessions(accountStatus)')
    expect(toolSrc).toContain('listCloudPeerSessions()')
    expect(toolSrc).toContain(
      'cloudList.truncated === true || accountStatus.truncated === true',
    )
    expect(toolSrc).toContain('searchTruncated,')
  })

  test('success appends Gff; ambiguous/not-found append wWr/iza', () => {
    expect(toolSrc).toContain('appendSearchTruncatedSuccessSuffix')
    expect(toolSrc).toContain('appendSearchTruncatedBody')
    expect(toolSrc).toContain('searchTruncatedDisplayNote')
    expect(toolSrc).toContain("resolved.kind === 'not-found'")
    expect(toolSrc).toContain('leftoverOwnNameMiss')
    expect(toolSrc).toContain('searchTruncated: resolved.searchTruncated')
  })

  test('account bridge rows fed into buildPeerCandidates', () => {
    expect(toolSrc).toContain('accountBridgePeers: accountBridge')
  })
})
