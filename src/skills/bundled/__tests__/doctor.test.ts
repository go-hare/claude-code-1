import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import { registerDoctorSkill } from '../doctor.js'
import {
  DOCTOR_SKILL_ALIASES,
  DOCTOR_SKILL_DESCRIPTION,
  DOCTOR_SKILL_NAME,
  DOCTOR_SKILL_PROGRESS_MESSAGE,
  DOCTOR_SKILL_PROMPT,
} from '../doctorContent.js'

beforeEach(() => {
  clearBundledSkills()
  delete process.env.DISABLE_DOCTOR_COMMAND
})

afterEach(() => {
  clearBundledSkills()
  delete process.env.DISABLE_DOCTOR_COMMAND
})

describe('registerDoctorSkill (official Xlf)', () => {
  test('registers doctor with checkup alias and disableModelInvocation', () => {
    registerDoctorSkill()
    const skills = getBundledSkills()
    const doctor = skills.find(s => s.name === DOCTOR_SKILL_NAME)
    expect(doctor).toBeDefined()
    expect(doctor?.aliases).toEqual([...DOCTOR_SKILL_ALIASES])
    expect(doctor?.disableModelInvocation).toBe(true)
    expect(doctor?.userInvocable).toBe(true)
    expect(doctor?.type).toBe('prompt')
    if (doctor?.type === 'prompt') {
      expect(doctor.progressMessage).toBe(DOCTOR_SKILL_PROGRESS_MESSAGE)
    }
    expect(doctor?.description).toBe(DOCTOR_SKILL_DESCRIPTION)
  })

  test('isEnabled respects DISABLE_DOCTOR_COMMAND', () => {
    registerDoctorSkill()
    const doctor = getBundledSkills().find(s => s.name === DOCTOR_SKILL_NAME)
    expect(doctor?.isEnabled?.() ?? true).toBe(true)
    process.env.DISABLE_DOCTOR_COMMAND = '1'
    expect(doctor?.isEnabled?.() ?? true).toBe(false)
  })

  test('prompt includes CLAUDE.md trim/migrate checks (3–4)', async () => {
    expect(DOCTOR_SKILL_PROMPT).toContain('# Claude Code Doctor')
    expect(DOCTOR_SKILL_PROMPT).toContain(
      '## Check 3 — trim derivable content from checked-in CLAUDE.md files',
    )
    expect(DOCTOR_SKILL_PROMPT).toMatch(/Check 4/)
    registerDoctorSkill()
    const doctor = getBundledSkills().find(s => s.name === DOCTOR_SKILL_NAME)
    expect(doctor?.type).toBe('prompt')
    if (doctor?.type !== 'prompt') return
    const blocks = await doctor.getPromptForCommand('', {} as never)
    const text = blocks.map(b => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Claude Code Doctor')
    expect(text).toContain('Check 3')
  })

  test('appends additional user instructions', async () => {
    registerDoctorSkill()
    const doctor = getBundledSkills().find(s => s.name === DOCTOR_SKILL_NAME)
    if (doctor?.type !== 'prompt') throw new Error('expected prompt skill')
    const blocks = await doctor.getPromptForCommand(
      'only check CLAUDE.md',
      {} as never,
    )
    const text = blocks.map(b => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('## Additional instructions from the user')
    expect(text).toContain('only check CLAUDE.md')
  })
})
