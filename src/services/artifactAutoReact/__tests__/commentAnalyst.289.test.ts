/**
 * densable 2.1.289 Ur @194396238 — comment-thread-analyst spawn always sets Xo.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ARTIFACT_TOOL_NAME } from '@claude-code/builtin-tools/tools/ArtifactTool/prompt.js'
import { commentAnalystCanUseTool } from '../commentAnalyst.js'

const SRC = readFileSync(join(import.meta.dir, '../commentAnalyst.ts'), 'utf8')
const EDIT = readFileSync(join(import.meta.dir, '../edit.ts'), 'utf8')

describe('densable 2.1.289 Ur comment-thread-analyst spawn', () => {
  test('always sets delegatedObservation: true (gold Xo @194396736)', () => {
    expect(SRC).toContain('delegatedObservation: true')
    expect(SRC).toContain("querySource: 'artifact_comment_analyst'")
    expect(SRC).toContain('comment-thread-analyst')
    expect(SRC).not.toContain(
      'isDelegatedObservation(getAgentContext()) ? { delegatedObservation',
    )
  })

  test('rs scoped canUseTool allows only comments + read_page_data on the slug', async () => {
    const slug = '11111111-1111-1111-1111-111111111111'
    const threadId = 'thr_1'
    const canUse = commentAnalystCanUseTool(slug, threadId)
    const tool = { name: ARTIFACT_TOOL_NAME } as never
    const allow = await canUse(
      tool,
      {
        action: 'comments',
        url: `https://claude.ai/code/artifact/${slug}`,
        thread_id: threadId,
      },
      {} as never,
      {} as never,
      'tu-1',
    )
    expect(allow.behavior).toBe('allow')

    const otherThread = await canUse(
      tool,
      {
        action: 'comments',
        url: `https://claude.ai/code/artifact/${slug}`,
        thread_id: 'other',
      },
      {} as never,
      {} as never,
      'tu-1',
    )
    expect(otherThread.behavior).toBe('deny')

    const write = await canUse(
      tool,
      {
        action: 'reply',
        url: `https://claude.ai/code/artifact/${slug}`,
        thread_id: threadId,
      },
      {} as never,
      {} as never,
      'tu-1',
    )
    expect(write.behavior).toBe('deny')
  })

  test('defaultAttemptEdit wires Ur behind Fr() responder dispatch', () => {
    expect(EDIT).toContain('isCommentResponderDispatchEnabled')
    expect(EDIT).toContain('spawnCommentThreadAnalyst')
    expect(EDIT).toContain('analystBrief')
  })
})
