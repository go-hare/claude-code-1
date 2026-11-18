import { describe, expect, test } from 'bun:test'
import {
  ARTIFACT_PUBLISH_EDITS_MAX,
  inputSchema,
} from '../artifactInputSchemas.js'
import { getArtifactToolPrompt } from '../prompt.js'

describe('ArtifactTool inline edits on publish #854', () => {
  test('ARTIFACT_PUBLISH_EDITS_MAX matches gold Qxo = 64', () => {
    expect(ARTIFACT_PUBLISH_EDITS_MAX).toBe(64)
  })

  test('inputSchema accepts valid inline edits on publish and rejects empty or >64 edits', () => {
    const schema = inputSchema()
    expect('edits' in schema.shape).toBe(true)

    const ok = schema.safeParse({
      file_path: '/tmp/page.html',
      edits: [{ old_str: '<h1>Old</h1>', new_str: '<h1>New</h1>' }],
    })
    expect(ok.success).toBe(true)

    const empty = schema.safeParse({
      file_path: '/tmp/page.html',
      edits: [],
    })
    expect(empty.success).toBe(false)

    const tooMany = schema.safeParse({
      file_path: '/tmp/page.html',
      edits: Array.from({ length: 65 }, (_, i) => ({
        old_str: `a${i}`,
        new_str: `b${i}`,
      })),
    })
    expect(tooMany.success).toBe(false)
  })

  test('getArtifactToolPrompt documents inline edits on publish (gold Tia)', async () => {
    const prompt = await getArtifactToolPrompt()
    expect(prompt).toContain('`edits` on the publish call itself')
    expect(prompt).toContain('old_str/new_str')
  })
})
