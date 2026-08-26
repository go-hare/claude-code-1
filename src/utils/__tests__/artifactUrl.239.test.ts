/**
 * densable 2.1.239 leftover — official El / Mht / Gp / RJr / _pr fail.
 */
import { describe, expect, test } from 'bun:test'
import {
  artifactViewerUrlFor,
  canonicalizeArtifactUrlInput,
  isArtifactToolRegistered,
  isWebFetchArtifactExceptionEnabled,
  OFFICIAL_ARTIFACT_TOOL_NAME,
  parseArtifactUrl,
  tryArtifactWebFetchFail,
} from '../artifactUrl.js'

describe('densable 2.1.239 artifact URL leftover', () => {
  test('El prod / staging / frame / miss', () => {
    expect(
      parseArtifactUrl(
        'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ),
    ).toEqual({
      slug: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      env: 'prod',
    })
    expect(
      parseArtifactUrl(
        'https://preview.claude-ai.staging.ant.dev/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ),
    ).toEqual({
      slug: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      env: 'staging',
    })
    expect(
      parseArtifactUrl(
        'https://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.frame.claudeusercontent.com/',
      ),
    ).toEqual({
      slug: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      env: 'prod',
    })
    expect(parseArtifactUrl('https://example.com/page')).toBeNull()
  })

  test('Mht upgrades http and strips trailing-dot host', () => {
    expect(
      canonicalizeArtifactUrlInput(
        'http://claude.ai./code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ),
    ).toBe(
      'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
  })

  test('Gp prod viewer', () => {
    expect(
      artifactViewerUrlFor({
        slug: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        env: 'prod',
      }),
    ).toBe(
      'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
  })

  test('RJr is false without official Artifact + cobalt', async () => {
    expect(OFFICIAL_ARTIFACT_TOOL_NAME).toBe('Artifact')
    expect(isArtifactToolRegistered()).toBe(false)
    expect(
      await isWebFetchArtifactExceptionEnabled([{ name: 'artifact' }]),
    ).toBe(false)
    expect(
      await isWebFetchArtifactExceptionEnabled([{ name: 'Artifact' }]),
    ).toBe(false)
  })

  test('_pr fail is dead while ASe is false', async () => {
    expect(
      await tryArtifactWebFetchFail(
        'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        [{ name: 'WebFetch' }],
        true,
        Date.now(),
        false,
      ),
    ).toBeNull()
  })
})
