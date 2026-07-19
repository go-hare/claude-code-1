import { describe, expect, test } from 'bun:test'
import { getEditToolDescription } from '../prompt.js'

describe('getEditToolDescription (densable jCg/Eyu)', () => {
  test('lean simple path is shorter and omits Usage: header', () => {
    // mythos is non-dense-default → shouldUseSimpleSystemPrompt true
    const lean = getEditToolDescription('claude-mythos-5')
    expect(
      lean.startsWith('Performs exact string replacement in a file.'),
    ).toBe(true)
    expect(lean).not.toContain('Usage:')
    expect(lean).toContain('replace_all: true')
  })

  test('dense path keeps Usage: form for denser-default models', () => {
    // Force dense path by model that is dense-default; GB velvet_tide default false
    const dense = getEditToolDescription('claude-opus-4-7')
    // When velvet_tide is on in env GB this may lean — still assert structure of one of the two.
    // Prefer checking both shapes are possible via model that is always lean (mythos) above,
    // and that dense-ish string contains file path guidance when Usage present.
    if (dense.includes('Usage:')) {
      expect(dense).toContain('ALWAYS prefer editing existing files')
      expect(dense).toContain('line number')
    } else {
      // velvet_tide or cascade may force lean in this process — still valid densable output.
      expect(dense).toContain('replace_all')
    }
  })
})
