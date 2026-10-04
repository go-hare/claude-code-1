import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isSkillDoctorEnabled } from '../index.js'
import { emptyCaseFilterText } from '../../../utils/plugins/pluginEval/discoverCases.js'
import { leftoverPolicyLimitsHost } from '../../../cli/leftoverTulip.js'
import {
  listDisusedPlugins,
  listingTokenMap,
  skillDoctorTranscriptScanAllowed,
} from '../scan.js'
import {
  accumulateSkillWeekTokens,
  skillWeekTokenKey,
  WEEK_TOKEN_WINDOW_MS,
} from '../weekTokens.js'

const ROOT = join(import.meta.dir, '../../../..')

const HIPAA =
  'Not shown for HIPAA-regulated organizations: measured by scanning the session transcripts saved on this machine.'

describe('/skill-doctor densable 2.1.283 (q0e / Nae / JP / fqt / DZr / a0e)', () => {
  test('COMMANDS registers both twins next to skills', () => {
    const src = readFileSync(join(ROOT, 'src/commands.ts'), 'utf8')
    expect(src).toContain("from './commands/skill-doctor/index.js'")
    expect(src).toContain('isSkillDoctorEnabled')
    expect(src).toContain('skillDoctor, skillDoctorNonInteractive')
  })

  test('JP gate is tengu_lantern_prism or CLAUDE_CODE_LANTERN_PRISM', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/skill-doctor/index.ts'),
      'utf8',
    )
    expect(src).toContain('tengu_lantern_prism')
    expect(src).toContain('CLAUDE_CODE_LANTERN_PRISM')
    expect(typeof isSkillDoctorEnabled()).toBe('boolean')
  })

  test('jsx twin posts text report, not /plugin stats', () => {
    const jsx = readFileSync(
      join(ROOT, 'src/commands/skill-doctor/skill-doctor-jsx.ts'),
      'utf8',
    )
    expect(jsx).toContain("display: 'system'")
    expect(jsx).not.toContain('showSkillDoctorRedirectMessage')
  })

  test('HIPAA week-token policy key is allow_skill_doctor_transcript_scan', () => {
    expect(skillDoctorTranscriptScanAllowed()).toHaveProperty('allowed')
    const policy = readFileSync(
      join(ROOT, 'src/services/policyLimits/index.ts'),
      'utf8',
    )
    expect(policy).toContain('allow_skill_doctor_transcript_scan')
  })

  test('qbt: org_denied without hipaa taint is catalog copy, not HIPAA copy', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/skill-doctor/scan.ts'),
      'utf8',
    )
    expect(src).toContain('isPolicyLimitsAllowed')
    expect(src).toContain('policyLimitsFeatureCopy')
    expect(src).toContain('${featureLabel} ${verb} unavailable right now.')
    expect(src).toContain(
      "getPolicyDenyKind(SKILL_DOCTOR_TRANSCRIPT_SCAN) === 'org_denied'",
    )
    expect(src).toContain('skillDoctorHasHipaaTaint()')
    expect(src).not.toContain('isPolicyAllowed(')
  })

  test('qbt: leftover Jt allow / leftover deny without Iw org_denied', () => {
    const host = leftoverPolicyLimitsHost()
    const prevCache = host.sessionCache
    const prevTaints = host.complianceTaints
    const prevHinted = host.hintedTaints
    try {
      host.complianceTaints = ['hipaa']
      host.hintedTaints = []
      host.sessionCache = {
        allow_skill_doctor_transcript_scan: { allowed: true },
      }
      expect(skillDoctorTranscriptScanAllowed()).toEqual({ allowed: true })

      host.sessionCache = {
        allow_skill_doctor_transcript_scan: { allowed: false },
      }
      const denied = skillDoctorTranscriptScanAllowed()
      expect(denied.allowed).toBe(false)
      // Iw is not org_denied without policyLimits session cache — catalog copy
      // even with hipaa taint (gold B: HIPAA copy needs Iw==="org_denied").
      expect(denied.reason).toBe(
        'Skill token counts are unavailable right now.',
      )
      expect(denied.reason).not.toBe(HIPAA)
    } finally {
      host.sessionCache = prevCache
      host.complianceTaints = prevTaints
      host.hintedTaints = prevHinted
    }
  })

  test('empty eval-case filter helper stays gold copy', () => {
    expect(emptyCaseFilterText('x', ['t'])).toContain('--case "x"')
  })

  test('gold DZr window is 7d; UP prefers unqualifiedName; Nn folds skill tokens', () => {
    expect(WEEK_TOKEN_WINDOW_MS).toBe(604_800_000)
    expect(skillWeekTokenKey({ name: 'plugin:review' })).toBe('plugin:review')
    expect(
      skillWeekTokenKey({
        type: 'prompt',
        name: 'plugin:review',
        unqualifiedName: 'review',
      }),
    ).toBe('review')
    const map = new Map<string, number>()
    accumulateSkillWeekTokens(map, {
      ts: 1,
      skill: 'review',
      cached: 4,
      cacheCreate: 2,
      uncached: 3,
      output: 6,
    })
    accumulateSkillWeekTokens(map, {
      ts: 1,
      skill: 'review',
      cached: 1,
      cacheCreate: 0,
      uncached: 0,
      output: 0,
    })
    expect(map.get('review')).toBe(16)
  })

  test('a0e extra filters: JO / Ihr / p() / Rhr', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/skill-doctor/scan.ts'),
      'utf8',
    )
    expect(src).toContain('getStrictKnownMarketplaces() !== null')
    expect(src).toContain(
      "getEnabledVia(plugin, managed, seedDirs) !== 'user-install'",
    )
    expect(src).toContain('themesPath')
    expect(src).toContain('workflowsPath')
    expect(src).toContain('monitors')
    expect(src).toContain('hasPendingPluginUsage')
    expect(typeof listDisusedPlugins).toBe('function')
  })

  test('policy deny → weekTokensNote set, no DZr; allowed → map lookup', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/skill-doctor/scan.ts'),
      'utf8',
    )
    expect(src).toContain(HIPAA)
    expect(src).toContain('weekGate.allowed')
    expect(src).toContain('scanSkillWeekTokens(context.storageV5)')
    expect(src).toContain("SkillDoctorStageError('scan_failed'")
    expect(src).toContain('Promise.resolve(new Map<string, number>())')
    expect(src).toContain(
      'weekTokensNote: weekGate.allowed ? null : (weekGate.reason ?? null)',
    )
    expect(src).toContain('weekMap.get(skillWeekTokenKey(cmd)) ??')
    expect(src).toContain('weekMap.get(alias)')
  })

  test('xMn listing uses mergeSkillToolCommands included set then RMn', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/skill-doctor/scan.ts'),
      'utf8',
    )
    expect(src).toContain('mergeSkillToolCommands')
    expect(src).toContain('formatCommandsWithinBudget')
    expect(src).toContain('resolveSkillOverrideMode')
    expect(src).toContain("SkillDoctorStageError('skill_set_failed'")
  })

  test('RMn keys tokens by cmd.name including colonated plugin skills', () => {
    const tokens = listingTokenMap(
      [
        {
          type: 'prompt',
          name: 'plugin:review',
          description: 'review',
          whenToUse: 'use for review',
        } as never,
        {
          type: 'prompt',
          name: 'alpha',
          description: 'a',
        } as never,
      ],
      'claude-sonnet-4-6',
    )
    expect(tokens.has('plugin:review')).toBe(true)
    expect(tokens.get('plugin:review')).toBeGreaterThan(0)
    expect(tokens.has('alpha')).toBe(true)
  })
})
