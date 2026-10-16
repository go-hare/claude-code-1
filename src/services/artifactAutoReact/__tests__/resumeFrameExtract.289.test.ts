/**
 * densable 2.1.289 XXt / Iun transcript extract for N9e resume.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractArtifactFrameSeedFromTranscript,
  extractResumedArtifactFrameSeed,
} from '../resumeFrameExtract.js'

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`

describe('extractResumedArtifactFrameSeed (densable Iun)', () => {
  test('non-local or ineligible seed is gold mNr empty', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Artifact',
              input: { url: URL },
            },
          ],
        },
      },
    ]
    expect(
      extractResumedArtifactFrameSeed(messages, {
        origin: 'remote',
        seedEligible: true,
      }),
    ).toEqual({
      frameUrls: {},
      artifactReadVersions: {},
      artifactRefs: [],
      createdFromType: {},
      pathPins: new Map(),
    })
    expect(
      extractResumedArtifactFrameSeed(messages, {
        origin: 'local',
        seedEligible: false,
      }).frameUrls,
    ).toEqual({})
  })
})

describe('extractArtifactFrameSeedFromTranscript (densable XXt)', () => {
  test('Artifact tool_result url/version rebuilds frame maps and refs', () => {
    const seed = extractArtifactFrameSeedFromTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Artifact',
              input: { action: 'get', url: URL },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1' }],
        },
        toolUseResult: {
          url: URL,
          path: 'demo.html',
          version: 'v3',
          title: 'Demo',
        },
      },
    ])
    expect(seed.artifactReadVersions[SLUG]).toBe('v3')
    expect(seed.artifactRefs).toEqual([{ slug: SLUG }])
    expect(Object.values(seed.frameUrls).some(e => e.url.includes(SLUG))).toBe(
      true,
    )
  })

  test('artifact_delete forgets the slug', () => {
    const seed = extractArtifactFrameSeedFromTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Artifact',
              input: { url: URL },
            },
            {
              type: 'tool_use',
              id: 'tu2',
              name: 'Artifact',
              input: { action: 'delete', url: URL },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1' }],
        },
        toolUseResult: { url: URL, path: 'demo.html', version: 'v1' },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu2' }],
        },
        toolUseResult: { artifact_delete: { url: URL, deleted: true } },
      },
    ])
    expect(seed.artifactReadVersions[SLUG]).toBeUndefined()
    expect(seed.artifactRefs).toEqual([])
    expect(Object.keys(seed.frameUrls)).toEqual([])
  })

  test('meta artifact-attached records a frame url', () => {
    const seed = extractArtifactFrameSeedFromTranscript([
      {
        type: 'user',
        isMeta: true,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          content: `<artifact-attached url="${URL}" title="Pinned" own/>`,
        },
      },
    ])
    expect(seed.frameUrls[`attached:${SLUG}`]?.title).toBe('Pinned')
    expect(seed.artifactRefs).toEqual([{ slug: SLUG }])
  })

  test('url/version without path does not invent opened: or a version', () => {
    const seed = extractArtifactFrameSeedFromTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Artifact',
              input: { url: URL },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1' }],
        },
        toolUseResult: { url: URL, version: 'v3', title: 'Demo' },
      },
    ])
    expect(seed.artifactReadVersions).toEqual({})
    expect(seed.artifactRefs).toEqual([])
    expect(seed.frameUrls).toEqual({})
  })
})
