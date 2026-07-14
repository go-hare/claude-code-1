import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import {
  applyDatavizCallout,
  DATAVIZ_CALLOUT_GB_FLAG,
  DATAVIZ_CALLOUT_PLACEHOLDER,
  getDatavizCallout,
} from '../datavizCallout.js'
import {
  DATAVIZ_MENU_DESCRIPTION,
  DATAVIZ_SKILL_DESCRIPTION,
  DATAVIZ_SKILL_NAME,
  SKILL_FILES,
  SKILL_MD,
} from '../datavizContent.js'
import { registerDatavizSkill } from '../dataviz.js'

describe('dataviz content (official 208)', () => {
  test('skill name and description match official product strings', () => {
    expect(DATAVIZ_SKILL_NAME).toBe('dataviz')
    expect(DATAVIZ_MENU_DESCRIPTION).toBe('Chart and dashboard design guidance')
    expect(DATAVIZ_SKILL_DESCRIPTION).toContain(
      'Use this skill whenever you are about to create ANY chart',
    )
    expect(DATAVIZ_SKILL_DESCRIPTION).toContain('references/palette.md')
  })

  test('SKILL_MD has frontmatter and procedure body', () => {
    expect(SKILL_MD.startsWith('---')).toBe(true)
    expect(SKILL_MD).toContain('name: Data Visualization')
    expect(SKILL_MD).toContain('# Data Visualization')
    expect(SKILL_MD).toContain('scripts/validate_palette.js')
  })

  test('SKILL_FILES has all official reference + script paths', () => {
    const keys = Object.keys(SKILL_FILES).sort()
    expect(keys).toEqual(
      [
        'references/anti-patterns.md',
        'references/choosing-a-form.md',
        'references/color-formula.md',
        'references/components.md',
        'references/interaction.md',
        'references/marks-and-anatomy.md',
        'references/palette.md',
        'scripts/validate_palette.js',
        'scripts/validate_palette.py',
      ].sort(),
    )
    expect(SKILL_FILES['scripts/validate_palette.js']).toContain(
      'Validate a categorical chart palette',
    )
    expect(SKILL_FILES['scripts/validate_palette.py']).toContain(
      '#!/usr/bin/env python3',
    )
    expect(SKILL_FILES['references/anti-patterns.md']).toContain(
      'Anti-patterns',
    )
  })
})

describe('registerDatavizSkill', () => {
  test('registers user-invocable dataviz skill with files', async () => {
    clearBundledSkills()
    // registerBundledSkill uses MACRO.VERSION for extract path.
    const g = globalThis as { MACRO?: { VERSION?: string } }
    const prevMacro = g.MACRO
    g.MACRO = { ...(prevMacro ?? {}), VERSION: '0.0.0-test' }
    try {
      registerDatavizSkill()
      const skills = getBundledSkills()
      const skill = skills.find(s => s.name === 'dataviz')
      expect(skill).toBeDefined()
      if (!skill || skill.type !== 'prompt') {
        throw new Error('expected prompt skill')
      }
      expect(skill.userInvocable).toBe(true)
      expect(skill.description).toContain('ANY chart, graph, plot')

      const blocks = await skill.getPromptForCommand('make a bar chart', {
        options: {},
      } as never)
      const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
      expect(text).toContain('# Data Visualization')
      expect(text).toContain('## User Request')
      expect(text).toContain('make a bar chart')
      expect(text).toContain('references/choosing-a-form.md')
    } finally {
      if (prevMacro === undefined) delete g.MACRO
      else g.MACRO = prevMacro
      clearBundledSkills()
    }
  })
})

describe('DAb dataviz callout (tengu_cobalt_plinth_dataviz)', () => {
  test('off by default → empty string', () => {
    expect(getDatavizCallout(() => false)).toBe('')
  })

  test('on → official wording + skill name', () => {
    const text = getDatavizCallout((key, fallback) => {
      expect(key).toBe(DATAVIZ_CALLOUT_GB_FLAG)
      expect(fallback).toBe(false)
      return true
    })
    expect(text).toContain('**When adding charts or diagrams**')
    expect(text).toContain('Load the `dataviz` skill')
    expect(text).toContain('identity to honesty')
  })

  test('applyDatavizCallout replaces placeholder when on', () => {
    const body = `Intro\n\n${DATAVIZ_CALLOUT_PLACEHOLDER}\n\nOutro`
    const out = applyDatavizCallout(body, () => true)
    expect(out).not.toContain(DATAVIZ_CALLOUT_PLACEHOLDER)
    expect(out).toContain('**When adding charts or diagrams**')
    expect(out).toContain('Intro')
    expect(out).toContain('Outro')
  })

  test('applyDatavizCallout clears placeholder when off', () => {
    const body = `Intro\n\n${DATAVIZ_CALLOUT_PLACEHOLDER}\n\nOutro`
    const out = applyDatavizCallout(body, () => false)
    expect(out).not.toContain(DATAVIZ_CALLOUT_PLACEHOLDER)
    expect(out).not.toContain('When adding charts')
    expect(out).toContain('Intro')
  })
})
