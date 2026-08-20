import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  formatAvailableAgentTypes,
  isGeneralPurposeAvailable,
  normalizeAgentTypeKey,
  SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE,
} from '../generalPurposeAvailability.js'
import { getPrompt } from '../prompt.js'
import type { AgentDefinition } from '../loadAgentsDir.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function agent(agentType: string): Pick<AgentDefinition, 'agentType'> {
  return { agentType }
}

describe('densable 2.1.235 #6 general-purpose omit gate', () => {
  test('AVo constant matches SEA gold string', () => {
    expect(SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE).toBe(
      'subagent_type is required: the general-purpose agent is not available in this session',
    )
  })

  test('QJe-style normalizeAgentTypeKey collapses NFKC/case/White_Space/Pd/_', () => {
    expect(normalizeAgentTypeKey('General-Purpose')).toBe('generalpurpose')
    expect(normalizeAgentTypeKey('general_purpose')).toBe('generalpurpose')
    expect(normalizeAgentTypeKey('general purpose')).toBe('generalpurpose')
    expect(normalizeAgentTypeKey('general—purpose')).toBe('generalpurpose')
  })

  test('Abf: exact general-purpose present and allowed → true', () => {
    expect(
      isGeneralPurposeAvailable(
        [agent('Explore'), agent('general-purpose')],
        undefined,
      ),
    ).toBe(true)
    expect(
      isGeneralPurposeAvailable(
        [agent('general-purpose')],
        ['general-purpose', 'Explore'],
      ),
    ).toBe(true)
  })

  test('Abf: exact general-purpose present but allowlist excludes it → false', () => {
    expect(
      isGeneralPurposeAvailable(
        [agent('Explore'), agent('general-purpose')],
        ['Explore'],
      ),
    ).toBe(false)
  })

  test('Abf: no GP → false; single normalized alias + allowed → true', () => {
    expect(isGeneralPurposeAvailable([agent('Explore'), agent('Plan')])).toBe(
      false,
    )
    expect(
      isGeneralPurposeAvailable(
        [agent('General_Purpose')],
        ['General_Purpose'],
      ),
    ).toBe(true)
    expect(
      isGeneralPurposeAvailable(
        [agent('General_Purpose'), agent('general—purpose')],
        undefined,
      ),
    ).toBe(false)
  })

  test('FTi joins or none', () => {
    expect(formatAvailableAgentTypes(['Explore', 'Plan'])).toBe('Explore, Plan')
    expect(formatAvailableAgentTypes([])).toBe('none')
  })

  test('AgentTool.call throws AVo before defaulting to general-purpose', () => {
    const src = readFileSync(join(__dirname, '..', 'AgentTool.tsx'), 'utf8')
    expect(src).toContain('isGeneralPurposeAvailable')
    expect(src).toContain('SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE')
    expect(src).toContain('tengu_subagent_type_miss')
    expect(src).toContain("logEvent('tengu_feature_bad'")
    expect(src).toContain('subagent_launch')
    expect(src).toContain('subagent_type_missing')
    expect(src).toContain('requestedNormalized')
    expect(src).toContain('OMITTED')
    // Must gate before effectiveType default, not after not-found.
    const omitGateIdx = src.indexOf(
      'if (subagent_type === undefined && !forkPathWouldBeTaken)',
    )
    // biome may collapse the assignment to one line — accept either layout
    const effectiveIdx = Math.max(
      src.indexOf('const effectiveType =\n      subagent_type ??'),
      src.indexOf('const effectiveType = subagent_type ??'),
    )
    expect(omitGateIdx).toBeGreaterThan(-1)
    expect(effectiveIdx).toBeGreaterThan(omitGateIdx)
  })

  test('prompt copy: GP available keeps omit-defaults wording', async () => {
    // isCoordinator=true returns the shared core before auth-gated notes.
    const text = await getPrompt(
      [
        {
          agentType: 'Explore',
          whenToUse: 'explore',
          tools: ['*'],
          source: 'built-in',
          baseDir: 'built-in',
          getSystemPrompt: () => '',
        } as AgentDefinition,
      ],
      true,
      undefined,
      { forkAvailable: false, generalPurposeAvailable: true },
    )
    expect(text).toContain('If omitted, the general-purpose agent is used.')
    expect(text).not.toContain(SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE)
  })

  test('prompt copy: GP unavailable uses AVo + choose listed (no fork phrase)', async () => {
    const text = await getPrompt(
      [
        {
          agentType: 'Explore',
          whenToUse: 'explore',
          tools: ['*'],
          source: 'built-in',
          baseDir: 'built-in',
          getSystemPrompt: () => '',
        } as AgentDefinition,
      ],
      true,
      undefined,
      { forkAvailable: false, generalPurposeAvailable: false },
    )
    expect(text).toContain(
      `${SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE}, so choose one of the listed agent types.`,
    )
    expect(text).not.toContain('If omitted, the general-purpose agent is used.')
    expect(text).not.toContain('`"fork"` or')
  })

  test('prompt copy: GP unavailable + fork available includes fork phrase', async () => {
    const text = await getPrompt(
      [
        {
          agentType: 'Explore',
          whenToUse: 'explore',
          tools: ['*'],
          source: 'built-in',
          baseDir: 'built-in',
          getSystemPrompt: () => '',
        } as AgentDefinition,
      ],
      true,
      undefined,
      { forkAvailable: true, generalPurposeAvailable: false },
    )
    expect(text).toContain(
      `${SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE}, so choose \`"fork"\` or one of the listed agent types.`,
    )
    expect(text).not.toContain('If omitted, the general-purpose agent is used.')
  })
})
