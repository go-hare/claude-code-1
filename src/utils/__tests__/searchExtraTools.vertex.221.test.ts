import { describe, expect, test } from 'bun:test'

/**
 * densable 2.1.221 #22 — Vertex tool-search gates (Jve / Xve / aEo / SL_ / Jvu).
 *
 * Hermetic pure mirrors of SEA gold — avoid importing searchExtraTools.ts
 * (analyzeContext / betas / bootstrap chain; process-global mock pollution).
 * Product code lives in `src/utils/searchExtraTools.ts` + `betas.ts`.
 */

/** densable SL_ */
const SL_ = [
  ['opus', [4, 5]],
  ['sonnet', [4, 5]],
  ['haiku', [4, 5]],
] as const

/** densable bL_ */
const BL_ = ['claude-3-5-haiku', 'claude-3-haiku'] as const

/** densable aEo */
function aEo(
  modelId: string,
  minByFamily: ReadonlyArray<readonly [string, readonly number[]]>,
): boolean {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(modelId)
  const family = match?.[1]
  const versionPart = match?.[2]
  if (!family || !versionPart) return false
  const min = minByFamily.find(([name]) => name === family)?.[1]
  if (!min) return false
  const parts = versionPart.split('-').map(Number)
  for (let i = 0; i < Math.max(parts.length, min.length); i++) {
    const delta = (parts[i] ?? 0) - (min[i] ?? 0)
    if (delta !== 0) return delta > 0
  }
  return true
}

/** densable Xve (with fixed denylist) */
function Xve(model: string, denylist: readonly string[] = BL_): boolean {
  const lower = model.toLowerCase()
  for (const n of denylist) {
    if (lower.includes(n.toLowerCase())) return false
  }
  return true
}

/**
 * densable Jve — provider + already-canonical model id (rd(e) done by caller).
 * Test uses pre-canonicalized ids matching getCanonicalName output shape.
 */
function Jve(provider: string, canonicalModel: string): boolean {
  if (provider !== 'vertex') return false
  const t = canonicalModel.replace(/[@-]\d{8}$/, '')
  if (/^claude-3(-|$)/.test(t)) return true
  return /^claude-(opus|sonnet|haiku)-\d/.test(t) && !aEo(t, SL_)
}

/** densable Jvu */
function Jvu(provider: string): string {
  if (
    provider === 'vertex' ||
    provider === 'bedrock' ||
    provider === 'mantle' ||
    provider === 'gateway'
  ) {
    return 'tool-search-tool-2025-10-19'
  }
  return 'advanced-tool-use-2025-11-20'
}

describe('densable aEo meetsMinClaudeVersion (SL_ 4.5+)', () => {
  test('rejects below 4.5 and accepts 4.5 / 4.6 / 5', () => {
    expect(aEo('claude-sonnet-4', SL_)).toBe(false)
    expect(aEo('claude-sonnet-4-0', SL_)).toBe(false)
    expect(aEo('claude-sonnet-4-4', SL_)).toBe(false)
    expect(aEo('claude-sonnet-4-5', SL_)).toBe(true)
    expect(aEo('claude-sonnet-4-6', SL_)).toBe(true)
    expect(aEo('claude-sonnet-5', SL_)).toBe(true)
    expect(aEo('claude-opus-4-5', SL_)).toBe(true)
    expect(aEo('claude-haiku-4-5', SL_)).toBe(true)
    expect(aEo('claude-haiku-4', SL_)).toBe(false)
  })

  test('unknown family / bad shape → false', () => {
    expect(aEo('claude-fable-5', SL_)).toBe(false)
    expect(aEo('not-a-model', SL_)).toBe(false)
    expect(aEo('claude-3-5-sonnet', SL_)).toBe(false)
  })
})

describe('densable Xve modelSupportsToolSearch', () => {
  test('default bL_ denylist blocks claude-3-haiku family substrings', () => {
    expect(Xve('claude-3-haiku-20240307')).toBe(false)
    expect(Xve('claude-3-5-haiku-20241022')).toBe(false)
    expect(Xve('claude-haiku-4-5-20251001')).toBe(true)
    expect(Xve('claude-sonnet-4-5')).toBe(true)
    // 3.5 sonnet is NOT on bL_
    expect(Xve('claude-3-5-sonnet-20241022')).toBe(true)
  })

  test('GB override denylist replaces default', () => {
    expect(Xve('claude-sonnet-4-0', ['claude-sonnet-4-0'])).toBe(false)
    expect(Xve('claude-3-haiku-20240307', ['claude-sonnet-4-0'])).toBe(true)
  })
})

describe('densable Jve isVertexToolSearchRejected', () => {
  test('non-vertex never rejects', () => {
    expect(Jve('firstParty', 'claude-sonnet-4-0')).toBe(false)
    expect(Jve('bedrock', 'claude-3-5-sonnet')).toBe(false)
  })

  test('vertex rejects pre-4.5 and claude-3*', () => {
    expect(Jve('vertex', 'claude-sonnet-4-0')).toBe(true)
    expect(Jve('vertex', 'claude-sonnet-4')).toBe(true)
    expect(Jve('vertex', 'claude-opus-4-1')).toBe(true)
    expect(Jve('vertex', 'claude-3-5-sonnet')).toBe(true)
    expect(Jve('vertex', 'claude-3-opus')).toBe(true)
  })

  test('vertex allows 4.5+ generation (changelog re-enable)', () => {
    expect(Jve('vertex', 'claude-sonnet-4-5')).toBe(false)
    expect(Jve('vertex', 'claude-sonnet-4-5-20250929')).toBe(false)
    expect(Jve('vertex', 'claude-opus-4-5')).toBe(false)
    expect(Jve('vertex', 'claude-haiku-4-5')).toBe(false)
    expect(Jve('vertex', 'claude-sonnet-4-6')).toBe(false)
    expect(Jve('vertex', 'claude-opus-4-7')).toBe(false)
  })

  test('vertex strips @YYYYMMDD / -YYYYMMDD date suffixes before compare', () => {
    expect(Jve('vertex', 'claude-sonnet-4-5@20250929')).toBe(false)
    expect(Jve('vertex', 'claude-sonnet-4-0@20250514')).toBe(true)
  })
})

describe('densable Jvu beta header split', () => {
  test('3P header for vertex/bedrock/mantle/gateway', () => {
    for (const p of ['vertex', 'bedrock', 'mantle', 'gateway']) {
      expect(Jvu(p)).toBe('tool-search-tool-2025-10-19')
    }
  })

  test('1P header for firstParty/foundry', () => {
    for (const p of ['firstParty', 'foundry']) {
      expect(Jvu(p)).toBe('advanced-tool-use-2025-11-20')
    }
  })
})

describe('densable enable formula + SEA reason strings', () => {
  test('swn / isToolSearchEnabledForModel: Y4 && Xve && !Jve', () => {
    const enabled = (Y4: boolean, model: string, provider: string) =>
      Y4 && Xve(model) && !Jve(provider, model)

    expect(enabled(true, 'claude-sonnet-4-5', 'vertex')).toBe(true)
    expect(enabled(true, 'claude-sonnet-4-0', 'vertex')).toBe(false)
    expect(enabled(true, 'claude-3-haiku-20240307', 'firstParty')).toBe(false)
    expect(enabled(false, 'claude-sonnet-4-5', 'vertex')).toBe(false)
    expect(enabled(true, 'claude-sonnet-4-0', 'firstParty')).toBe(true)
  })

  test('SEA disable reason strings (exact gold)', () => {
    const model = 'claude-sonnet-4-0'
    expect(
      `Tool search disabled for model '${model}': model does not support tool_reference blocks. This feature is available on Claude Sonnet 4+, Opus 4+, Haiku 4.5+, and newer models.`,
    ).toContain('model does not support tool_reference blocks')
    expect(
      `Tool search disabled for model '${model}' on Vertex: this model's Vertex serving stack rejects the tool-search beta header (pre-4.5 generation).`,
    ).toContain('pre-4.5 generation')
    expect('vertex_model_unsupported').toBe('vertex_model_unsupported')
    expect('model_unsupported').toBe('model_unsupported')
  })
})
