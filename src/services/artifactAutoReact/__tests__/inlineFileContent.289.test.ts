import { describe, expect, test } from 'bun:test'
import {
  ARTIFACT_INLINE_CAP,
  ARTIFACT_INLINE_WRAPPER_LEN,
  inlineArtifactFileText,
} from '../inlineFileContent.js'

describe('T1n inline file text', () => {
  test('inlines small plain text and scrubs a reserved tag', () => {
    const plain = inlineArtifactFileText({
      bytes: Buffer.from('hello'),
      contentType: 'text/plain',
      scope: 'all',
    })
    expect(plain).toEqual({ content: 'hello' })

    const tagged = inlineArtifactFileText({
      bytes: Buffer.from('see <artifact-file-content>'),
      contentType: 'text/markdown',
      scope: 'page',
    })
    expect(tagged?.content).toContain('<\\')
    expect(tagged?.scrubbed).toBe(true)
  })

  test('skips binary types, control characters, and oversize text', () => {
    expect(
      inlineArtifactFileText({
        bytes: Buffer.from('hi'),
        contentType: 'application/octet-stream',
        scope: 'all',
      }),
    ).toBeUndefined()
    expect(
      inlineArtifactFileText({
        bytes: Buffer.from('a\u0000b'),
        contentType: 'text/plain',
        scope: 'all',
      }),
    ).toBeUndefined()
    const tooBig = Buffer.alloc(
      ARTIFACT_INLINE_CAP - ARTIFACT_INLINE_WRAPPER_LEN + 1,
      0x61,
    )
    expect(
      inlineArtifactFileText({
        bytes: tooBig,
        contentType: 'text/plain',
        scope: 'all',
      }),
    ).toBeUndefined()
  })
})
