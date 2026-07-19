import { describe, expect, test } from 'bun:test'
import {
  ACT_DONT_REDERIVE_BODY,
  ANTI_VERBOSITY_DEFAULT_BODY,
  ANTI_VERBOSITY_SIMPLE_BODY,
  AUTONOMY_APPEND_BODY,
  FABLE_IDENTITY_BODY,
  formatEmptyInputRepairMessage,
  getActDontRederiveSection,
  getAntiVerbositySection,
  getAutonomyAppendSection,
  getFableIdentitySection,
  getInvestigateFirstSection,
  getOwnershipFrameSection,
  getPronounsSection,
  getTaskContinuitySection,
  isActDontRederiveEnabled,
  isBasaltCoveEnabled,
  isCobaltThistleEnabled,
  isClaudeFableModel,
  isEmptyPlainObject,
  isFableMitigationsOrMythosModel,
  isInvestigateFirstEnabled,
  isOwnershipFrameEnabled,
  isPewterOwlEnabled,
  isSkillDescReframeEnabled,
  OWNERSHIP_FRAME_BODY,
  getSystemReminderTagSection,
  getToolParamJsonSection,
  getWorktreeEnvNotes,
  JUNIPER_TOOL_SEARCH_REMINDER_EVERY_N_TURNS,
  JUNIPER_TOOL_SEARCH_REMINDER_MAX_NAMES,
  MID_CONVERSATION_SYSTEM_NOTICE,
  PRONOUNS_SECTION,
  resolveAntiVerbosityMode,
  resolveHeronBrookSection,
  resolveInvestigateFirstMode,
  resolveJuniperShoalFlags,
  sampleValueForZodField,
  TASK_CONTINUITY_BODY,
  TOOL_PARAM_JSON_BODY,
  WORKTREE_GIT_STASH_NOTE,
} from '../systemPromptArms.js'

describe('systemPromptArms', () => {
  test('defaults off', () => {
    expect(isActDontRederiveEnabled({})).toBe(false)
    expect(isOwnershipFrameEnabled({})).toBe(false)
    expect(isInvestigateFirstEnabled({})).toBe(false)
    expect(isSkillDescReframeEnabled({})).toBe(false)
    expect(isBasaltCoveEnabled({})).toBe(false)
    expect(isPewterOwlEnabled({})).toBe(false)
    expect(getActDontRederiveSection({})).toBeNull()
    expect(getOwnershipFrameSection({})).toBeNull()
    expect(getInvestigateFirstSection({})).toBeNull()
  })
  test('env on', () => {
    expect(
      isActDontRederiveEnabled({ CLAUDE_CODE_ACT_DONT_REDERIVE: '1' }),
    ).toBe(true)
    expect(isPewterOwlEnabled({ CLAUDE_CODE_PEWTER_OWL_TOOL: 'true' })).toBe(
      true,
    )
    expect(
      getActDontRederiveSection({ CLAUDE_CODE_ACT_DONT_REDERIVE: '1' }),
    ).toBe(ACT_DONT_REDERIVE_BODY)
    expect(getOwnershipFrameSection({ CLAUDE_CODE_OWNERSHIP_FRAME: '1' })).toBe(
      OWNERSHIP_FRAME_BODY,
    )
    expect(
      getInvestigateFirstSection({ CLAUDE_CODE_INVESTIGATE_FIRST: '1' }),
    ).toContain('read-only investigation')
    expect(
      isSkillDescReframeEnabled({ CLAUDE_CODE_SKILL_DESC_REFRAME: '1' }),
    ).toBe(true)
  })
  test('GB inject densable when env unset', () => {
    // Official Arg: env unset → GB tengu_cedar_lantern (default true)
    expect(isActDontRederiveEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(isActDontRederiveEnabled({ env: {}, gbValue: false })).toBe(false)
    expect(isOwnershipFrameEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(
      isActDontRederiveEnabled({
        env: { CLAUDE_CODE_ACT_DONT_REDERIVE: '0' },
        gbValue: true,
      }),
    ).toBe(false)
  })

  test('isBasaltCoveEnabled densable Tlc env OR model map', () => {
    expect(isBasaltCoveEnabled({ CLAUDE_CODE_BASALT_COVE: '1' })).toBe(true)
    expect(
      isBasaltCoveEnabled({
        env: {},
        model: 'claude-opus-4-7',
        basaltCoveModels: { 'claude-opus': true },
      }),
    ).toBe(true)
    expect(
      isBasaltCoveEnabled({
        env: {},
        model: 'claude-haiku-4',
        basaltCoveModels: { 'claude-opus': true },
      }),
    ).toBe(false)
    expect(
      isBasaltCoveEnabled({
        env: {},
        modelMatched: true,
      }),
    ).toBe(true)
  })

  test('isCobaltThistleEnabled densable Slc', () => {
    expect(isCobaltThistleEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(isCobaltThistleEnabled({ env: {}, gbValue: false })).toBe(false)
    expect(
      isCobaltThistleEnabled({
        env: { CLAUDE_CODE_COBALT_THISTLE: '1' },
        gbValue: false,
      }),
    ).toBe(true)
    expect(
      isCobaltThistleEnabled({
        env: { CLAUDE_CODE_COBALT_THISTLE: '0' },
        gbValue: true,
      }),
    ).toBe(false)
  })
})

describe('resolveInvestigateFirstMode (official p5i)', () => {
  test('non-opus-4-7 → off', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-sonnet-4-6',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: '1' },
      }),
    ).toBe('off')
  })
  test('opus-4-7 env additive', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: '1' },
      }),
    ).toBe('additive')
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: 'compact' },
      }),
    ).toBe('compact')
  })
  test('simple system prompt forces off when env unset', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: {},
        simpleSystemPrompt: true,
        slateHarrier: 'additive',
      }),
    ).toBe('off')
  })
  test('slate harrier when env unset and not simple', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: {},
        simpleSystemPrompt: false,
        slateHarrier: 'compact',
      }),
    ).toBe('compact')
  })
  test('getInvestigateFirstSection with model input', () => {
    expect(
      getInvestigateFirstSection({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: 'additive' },
      }),
    ).toContain('read-only investigation')
    expect(
      getInvestigateFirstSection({
        model: 'claude-sonnet-4-6',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: '1' },
      }),
    ).toBeNull()
  })

  test('resolveHeronBrookSection densable ZMy priority', () => {
    expect(resolveHeronBrookSection({})).toBeNull()
    expect(
      resolveHeronBrookSection({ clientDataValue: '  from-client  ' }),
    ).toBe('from-client')
    expect(
      resolveHeronBrookSection({
        clientDataValue: '   ',
        growthBookValue: 'from-gb',
      }),
    ).toBe('from-gb')
    expect(
      resolveHeronBrookSection({
        clientDataValue: 'client-wins',
        growthBookValue: 'gb',
      }),
    ).toBe('client-wins')
    expect(resolveHeronBrookSection({ growthBookValue: '' })).toBeNull()
  })

  test('isFableMitigationsOrMythosModel densable p4e', () => {
    expect(isFableMitigationsOrMythosModel(undefined)).toBe(false)
    expect(isFableMitigationsOrMythosModel('claude-sonnet-4-6')).toBe(false)
    expect(isFableMitigationsOrMythosModel('claude-mythos-5')).toBe(true)
    expect(isFableMitigationsOrMythosModel('claude-fable-5')).toBe(true)
    expect(
      isFableMitigationsOrMythosModel('custom-fable_5_mitigations-x'),
    ).toBe(true)
  })

  test('getAutonomyAppendSection densable eNy', () => {
    expect(getAutonomyAppendSection({ model: 'claude-sonnet-4-6' })).toBeNull()
    expect(
      getAutonomyAppendSection({
        model: 'claude-mythos-5',
        amberSextant: false,
      }),
    ).toBeNull()
    expect(
      getAutonomyAppendSection({
        model: 'claude-mythos-5',
        amberSextant: true,
      }),
    ).toBe(AUTONOMY_APPEND_BODY)
    expect(getAutonomyAppendSection({ model: 'claude-fable-5' })).toContain(
      'operating autonomously',
    )
  })

  test('getPronounsSection densable XMy', () => {
    expect(getPronounsSection()).toBe(PRONOUNS_SECTION)
    expect(getPronounsSection()).toContain('they/them')
  })

  test('getTaskContinuitySection densable KMy gates', () => {
    expect(getTaskContinuitySection()).toBeNull()
    expect(getTaskContinuitySection({ modelGate: false })).toBeNull()
    expect(
      getTaskContinuitySection({ modelGate: true, ownershipFrame: true }),
    ).toBeNull()
    expect(getTaskContinuitySection({ modelGate: true })).toBe(
      TASK_CONTINUITY_BODY,
    )
  })

  test('getFableIdentitySection densable BLr/Cee', () => {
    expect(isClaudeFableModel('claude-fable-5')).toBe(true)
    expect(isClaudeFableModel('claude-sonnet-4-6')).toBe(false)
    expect(getFableIdentitySection({ model: 'claude-sonnet-4-6' })).toBeNull()
    expect(getFableIdentitySection({ model: 'claude-fable-5' })).toBe(
      FABLE_IDENTITY_BODY,
    )
    expect(
      getFableIdentitySection({
        model: 'custom-id',
        isDefaultFableAlias: true,
      }),
    ).toBe(FABLE_IDENTITY_BODY)
  })

  test('getAntiVerbositySection densable VMy modes', () => {
    expect(resolveAntiVerbosityMode({})).toBe('default')
    expect(resolveAntiVerbosityMode({ simpleSystemPrompt: true })).toBe(
      'simple',
    )
    expect(
      resolveAntiVerbosityMode({
        communicatingFamily: true,
        simpleSystemPrompt: true,
      }),
    ).toBe('communicating')
    expect(getAntiVerbositySection({ simpleSystemPrompt: true })).toBe(
      ANTI_VERBOSITY_SIMPLE_BODY,
    )
    expect(getAntiVerbositySection({})).toBe(ANTI_VERBOSITY_DEFAULT_BODY)
    const comm = getAntiVerbositySection({
      communicatingFamily: true,
      finalMessageOnly: true,
    })
    expect(comm).toContain('# Communicating with the user')
    expect(comm).toContain('final text message of your turn')
    const mid = getAntiVerbositySection({
      communicatingFamily: true,
      finalMessageOnly: false,
    })
    expect(mid).toContain('between tool calls')
    expect(mid).not.toContain('final text message of your turn')
  })

  test('getWorktreeEnvNotes densable lxd', () => {
    expect(getWorktreeEnvNotes(false)).toEqual([])
    const notes = getWorktreeEnvNotes(true)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('git worktree')
    expect(notes[1]).toBe(WORKTREE_GIT_STASH_NOTE)
    expect(notes[1]).toContain('git stash push')
  })

  test('getToolParamJsonSection densable JMy', () => {
    expect(getToolParamJsonSection({})).toBeNull()
    expect(getToolParamJsonSection({ toolParamStrictness: true })).toBe(
      TOOL_PARAM_JSON_BODY,
    )
    expect(
      getToolParamJsonSection({
        fableOrMythos: true,
        silentHarbor: true,
      }),
    ).toBe(TOOL_PARAM_JSON_BODY)
    expect(
      getToolParamJsonSection({
        fableOrMythos: true,
        silentHarbor: false,
      }),
    ).toBeNull()
  })

  test('getSystemReminderTagSection densable sxd/oNy', () => {
    expect(getSystemReminderTagSection({ midConversationSystem: true })).toBe(
      MID_CONVERSATION_SYSTEM_NOTICE,
    )
    expect(getSystemReminderTagSection({ mode: 'standard' })).toContain(
      '<system-reminder>',
    )
    expect(getSystemReminderTagSection({ mode: 'harness' })).toContain(
      'injected by the harness',
    )
  })

  test('resolveJuniperShoalFlags densable K2r', () => {
    expect(resolveJuniperShoalFlags(null).toolParamStrictness).toBe(false)
    expect(resolveJuniperShoalFlags([]).toolSearchReminder).toBeNull()
    expect(
      resolveJuniperShoalFlags({ bracken_spool: true }).toolParamStrictness,
    ).toBe(true)
    expect(
      resolveJuniperShoalFlags({ teasel_cove: true }).emptyInputRepair,
    ).toBe(true)
    expect(
      resolveJuniperShoalFlags({ gorse_hollow: true }).toolSearchFetchRule,
    ).toBe(true)
    expect(
      resolveJuniperShoalFlags({ thistle_skein: true }).schemaDescFixes,
    ).toBe(true)
    const remTrue = resolveJuniperShoalFlags({ marsh_lantern: true })
    expect(remTrue.toolSearchReminder).toEqual({
      everyNTurns: JUNIPER_TOOL_SEARCH_REMINDER_EVERY_N_TURNS,
      maxNames: JUNIPER_TOOL_SEARCH_REMINDER_MAX_NAMES,
    })
    const remObj = resolveJuniperShoalFlags({
      marsh_lantern: { stride: 3, span: 7 },
    })
    expect(remObj.toolSearchReminder).toEqual({
      everyNTurns: 3,
      maxNames: 7,
    })
    // invalid stride/span fall back to defaults
    const remBad = resolveJuniperShoalFlags({
      marsh_lantern: { stride: 0, span: -1 },
    })
    expect(remBad.toolSearchReminder).toEqual({
      everyNTurns: JUNIPER_TOOL_SEARCH_REMINDER_EVERY_N_TURNS,
      maxNames: JUNIPER_TOOL_SEARCH_REMINDER_MAX_NAMES,
    })
  })

  test('isEmptyPlainObject densable h1i', () => {
    expect(isEmptyPlainObject({})).toBe(true)
    expect(isEmptyPlainObject({ a: 1 })).toBe(false)
    expect(isEmptyPlainObject([])).toBe(false)
    expect(isEmptyPlainObject(null)).toBe(false)
    expect(isEmptyPlainObject('')).toBe(false)
  })

  test('formatEmptyInputRepairMessage densable IHc', () => {
    // Build a real ZodObject so constructor.name === 'ZodObject'
    // Dynamic import keeps test free of top-level zod cost when skipped.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { z } = require('zod/v4') as typeof import('zod/v4')
    const schema = z.object({
      query: z.string(),
      count: z.number().optional(),
    })
    const msg = formatEmptyInputRepairMessage('SearchExtraTools', schema)
    expect(msg).toContain('empty input object ({})')
    expect(msg).toContain('`query`')
    expect(msg).toContain('Minimal valid call shape')
    expect(msg).toContain('<query>')
    // optional count not required
    expect(msg).not.toContain('`count`')

    // no required fields → null
    expect(
      formatEmptyInputRepairMessage(
        'X',
        z.object({ count: z.number().optional() }),
      ),
    ).toBeNull()

    // non-object schema → null
    expect(formatEmptyInputRepairMessage('X', z.string())).toBeNull()
  })

  test('sampleValueForZodField densable QFh', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { z } = require('zod/v4') as typeof import('zod/v4')
    expect(sampleValueForZodField('x', z.string())).toBe('<x>')
    expect(sampleValueForZodField('n', z.number())).toBe(0)
    expect(sampleValueForZodField('b', z.boolean())).toBe(false)
    expect(sampleValueForZodField('a', z.array(z.string()))).toEqual([])
    expect(sampleValueForZodField('e', z.enum(['one', 'two']))).toBe('one')
    expect(sampleValueForZodField('l', z.literal('hi'))).toBe('hi')
  })
})
