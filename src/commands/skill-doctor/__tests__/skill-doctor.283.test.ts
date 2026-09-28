import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isSkillDoctorEnabled } from '../index.js'
import { emptyCaseFilterText } from '../../../utils/plugins/pluginEval/discoverCases.js'
import { skillDoctorTranscriptScanAllowed } from '../scan.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('/skill-doctor densable 2.1.283 (q0e / Nae / JP / fqt)', () => {
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

  test('empty eval-case filter helper stays gold copy', () => {
    expect(emptyCaseFilterText('x', ['t'])).toContain('--case "x"')
  })
})
