import { describe, expect, test } from 'bun:test'
import {
  buildOchreFinchTypesSection,
  isOchreFinchTypesEnabled,
  MEMORY_TYPES,
  MEMORY_TYPES_SKILL_NAME,
  OCHRE_FINCH_TYPE_BLURBS,
  selectTypesOfMemorySection,
  TYPES_SECTION_INDIVIDUAL,
} from '../memoryTypes.js'

describe('ochre_finch densable J1i/gBh/nFr', () => {
  test('gate injectable', () => {
    expect(isOchreFinchTypesEnabled(false)).toBe(false)
    expect(isOchreFinchTypesEnabled(true)).toBe(true)
  })

  test('compact section has all four types + skill', () => {
    const lines = buildOchreFinchTypesSection()
    expect(lines[0]).toBe('## Types of memory')
    for (const t of MEMORY_TYPES) {
      expect(lines.join('\n')).toContain(`**${t}**`)
      expect(lines.join('\n')).toContain(OCHRE_FINCH_TYPE_BLURBS[t].slice(0, 20))
    }
    expect(lines.join('\n')).toContain(MEMORY_TYPES_SKILL_NAME)
    expect(lines.join('\n')).not.toContain('<types>')
  })

  test('nFr selects compact vs fallback', () => {
    expect(
      selectTypesOfMemorySection(TYPES_SECTION_INDIVIDUAL, {
        ochreFinch: false,
      }),
    ).toBe(TYPES_SECTION_INDIVIDUAL)
    const compact = selectTypesOfMemorySection(TYPES_SECTION_INDIVIDUAL, {
      ochreFinch: true,
    })
    expect(compact[0]).toBe('## Types of memory')
    expect(compact.join('\n')).toContain('pick the matching `type:`')
  })
})
