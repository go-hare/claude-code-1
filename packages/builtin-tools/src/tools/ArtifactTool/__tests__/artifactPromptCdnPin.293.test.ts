import { describe, expect, test } from 'bun:test'
import { getArtifactToolPrompt } from '../prompt.js'

describe('ArtifactTool prompt #328 CDN version pinning', () => {
  test('instructs Claude to pin library URLs to exact versions at least two weeks old', async () => {
    const prompt = await getArtifactToolPrompt()
    expect(prompt).toContain('Pin every library URL to an exact version')
    expect(prompt).toContain('Choose a version at least two weeks old.')
    expect(prompt).toContain('skip any published in the last two weeks.')
  })
})
