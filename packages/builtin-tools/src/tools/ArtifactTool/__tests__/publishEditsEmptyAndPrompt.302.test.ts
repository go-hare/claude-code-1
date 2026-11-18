import { describe, expect, test } from 'bun:test'
import { coerceArtifactPublishInput } from '../ArtifactTool.js'
import { getArtifactToolPrompt } from '../prompt.js'

describe('ArtifactTool empty edits coerceInput (#906) & multi-view prompt (#1002)', () => {
  test('coerceArtifactPublishInput strips empty edits: [] on publish', () => {
    const res = coerceArtifactPublishInput({
      file_path: '/tmp/app.html',
      edits: [],
    })
    expect(res).not.toBeNull()
    expect(res?.shapeClass).toBe('edits_empty')
    expect('edits' in (res?.input ?? {})).toBe(false)
    expect((res?.input as { file_path?: string }).file_path).toBe(
      '/tmp/app.html',
    )
  })

  test('coerceArtifactPublishInput returns null when edits is non-empty or omitted', () => {
    expect(
      coerceArtifactPublishInput({ file_path: '/tmp/app.html' }),
    ).toBeNull()
    expect(
      coerceArtifactPublishInput({
        file_path: '/tmp/app.html',
        edits: [{ old_str: 'a', new_str: 'b' }],
      }),
    ).toBeNull()
    expect(coerceArtifactPublishInput({ action: 'list' })).toBeNull()
  })

  test('getArtifactToolPrompt documents multi-view hash routing and address bar behavior', async () => {
    const prompt = await getArtifactToolPrompt()
    expect(prompt).toContain(
      'Only where a page has several views worth bookmarking or sending, route on the hash',
    )
    expect(prompt).toContain(
      "The address bar on the artifact's own page and Share's Copy link follow the page's hash",
    )
  })
})
