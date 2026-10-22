/**
 * densable 2.1.289 parseArtifactUrl residuals — n4 / Pa / hWe / Jc.
 * Semantic exports only; invent-ban minify Pa|Jx|n4|hWe|Bt|yW.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  artifactSlugFromUrl,
  canonicalizeArtifactUrlInput,
  parseArtifactUrl,
  parseArtifactUrlAnyCase,
  parseEvalStubArtifactUrl,
} from '../artifactUrl.js'

const SLUG = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const STUB = `eval-stub://artifact/${SLUG}`

describe('densable 2.1.289 artifact URL AnyCase / eval-stub', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR
  })

  test('strict parse rejects mixed-case host/path that AnyCase accepts', () => {
    const mixed = `https://CLAUDE.AI/code/ARTIFACT/${SLUG}`
    expect(parseArtifactUrl(mixed)).toBeNull()
    expect(parseArtifactUrlAnyCase(mixed)).toEqual({
      slug: SLUG,
      env: 'prod',
    })
  })

  test('AnyCase accepts uppercase hex slug after canonicalize+lower', () => {
    const upperSlug = SLUG.toUpperCase()
    const url = `https://claude.ai/code/artifact/${upperSlug}`
    expect(parseArtifactUrl(url)).toBeNull()
    expect(parseArtifactUrlAnyCase(url)).toEqual({
      slug: SLUG,
      env: 'prod',
    })
  })

  test('strict parse accepts /artifact/ and a 22-char short id', () => {
    expect(parseArtifactUrl(`https://claude.ai/artifact/${SLUG}`)).toEqual({
      slug: SLUG,
      env: 'prod',
    })
    expect(
      parseArtifactUrl('https://claude.ai/artifact/N5L7eAvjq89DfJmGvn2Erh'),
    ).toEqual({ slug: SLUG, env: 'prod' })
  })

  test('staging host is not an artifact; frame staging still is', () => {
    expect(
      parseArtifactUrl(`https://claude-ai.staging.ant.dev/artifact/${SLUG}`),
    ).toBeNull()
    expect(
      parseArtifactUrl(`https://${SLUG}.frame.staging.claudeusercontent.com/`),
    ).toEqual({ slug: SLUG, env: 'staging' })
  })

  test('case-insensitive fallback does not decode a short id', () => {
    expect(
      parseArtifactUrlAnyCase(
        'https://claude.ai/ARTIFACT/N5L7eAvjq89DfJmGvn2Erh',
      ),
    ).toBeNull()
    expect(
      parseArtifactUrlAnyCase(
        'https://CLAUDE.AI/artifact/N5L7eAvjq89DfJmGvn2Erh',
      ),
    ).toEqual({ slug: SLUG, env: 'prod' })
  })

  test('AnyCase still upgrades http and strips trailing-dot host', () => {
    expect(
      parseArtifactUrlAnyCase(`http://claude.ai./code/artifact/${SLUG}`),
    ).toEqual({ slug: SLUG, env: 'prod' })
    expect(
      canonicalizeArtifactUrlInput(`http://claude.ai./code/artifact/${SLUG}`),
    ).toBe(`https://claude.ai/code/artifact/${SLUG}`)
  })

  test('parseEvalStubArtifactUrl matches eval-stub uuid only', () => {
    expect(parseEvalStubArtifactUrl(STUB)).toEqual({ slug: SLUG })
    expect(
      parseEvalStubArtifactUrl(`https://claude.ai/code/artifact/${SLUG}`),
    ).toBeNull()
    expect(
      parseEvalStubArtifactUrl('eval-stub://artifact/not-a-uuid'),
    ).toBeNull()
  })

  test('artifactSlugFromUrl uses eval-stub only when Jc env is set', () => {
    expect(artifactSlugFromUrl(`https://claude.ai/code/artifact/${SLUG}`)).toBe(
      SLUG,
    )
    expect(artifactSlugFromUrl(STUB)).toBeNull()
    process.env.CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR = '/tmp/stub-publishes'
    expect(artifactSlugFromUrl(STUB)).toBe(SLUG)
  })

  test('invent-ban: no minify Pa|Jx|n4|hWe|Bt|yW exports', async () => {
    const mod = await import('../artifactUrl.js')
    for (const name of ['Pa', 'Jx', 'n4', 'hWe', 'Bt', 'yW'] as const) {
      expect(Object.hasOwn(mod, name)).toBe(false)
    }
    expect(typeof mod.parseArtifactUrlAnyCase).toBe('function')
    expect(typeof mod.parseEvalStubArtifactUrl).toBe('function')
    expect(typeof mod.artifactSlugFromUrl).toBe('function')
  })
})
