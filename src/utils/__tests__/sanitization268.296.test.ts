import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearNamesNotShownForTests,
  getNamesNotShown,
  isSafeBasicName,
  isShownNameSafe,
  isValidAgentName,
  isValidSkillName,
  MAX_SHOWN_NAME_LENGTH,
  recordNameNotShown,
  SHOWN_NAME_RULE_MESSAGE,
} from '../sanitization.js'
import {
  getSkillDirCommands,
  clearSkillCaches,
} from '../../skills/loadSkillsDir.js'

describe('#268: 256-char agent/skill shown-name validation', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    clearNamesNotShownForTests()
    clearSkillCaches()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('isSafeBasicName enforces 1..256 length and rejects control chars and angle brackets', () => {
    expect(MAX_SHOWN_NAME_LENGTH).toBe(256)
    expect(isSafeBasicName('')).toBe(false)
    expect(isSafeBasicName('a'.repeat(256))).toBe(true)
    expect(isSafeBasicName('a'.repeat(257))).toBe(false)
    expect(isSafeBasicName('bad<name')).toBe(false)
    expect(isSafeBasicName('bad>name')).toBe(false)
    expect(isSafeBasicName('bad\nname')).toBe(false)
    expect(isSafeBasicName('bad\x00name')).toBe(false)
  })

  test('isShownNameSafe rejects invisible, direction-changing, edge/double spaces, and zalgo combining marks', () => {
    expect(isShownNameSafe('my-skill')).toBe(true)
    expect(isShownNameSafe('ns:my-skill')).toBe(true)
    expect(isShownNameSafe(' leading')).toBe(false)
    expect(isShownNameSafe('trailing ')).toBe(false)
    expect(isShownNameSafe('double  space')).toBe(false)
    expect(isShownNameSafe('zero\u200Bwidth')).toBe(false)
    expect(isShownNameSafe('bidi\u202Eoverride')).toBe(false)
    expect(isShownNameSafe('braille\u2800blank')).toBe(false)
    expect(isShownNameSafe('zalgo' + '\u0301'.repeat(9))).toBe(false)
  })

  test('isValidSkillName also rejects colon-space edges and leading/trailing colons', () => {
    expect(isValidAgentName('ns: agent')).toBe(true)
    expect(isValidSkillName('ns: agent')).toBe(false)
    expect(isValidSkillName('ns :agent')).toBe(false)
    expect(isValidSkillName(':agent')).toBe(false)
    expect(isValidSkillName('agent:')).toBe(false)
    expect(isValidSkillName('ns:agent')).toBe(true)
  })

  test('recordNameNotShown deduplicates, caps at 100, and escapes non-ASCII Z spaces', () => {
    expect(SHOWN_NAME_RULE_MESSAGE).toBe(
      'a name may not hold hidden, direction-changing or blank-like characters, < or >, or be over 256 characters',
    )
    recordNameNotShown('bad\u00A0skill', 'is not offered')
    recordNameNotShown('bad\u00A0skill', 'is not offered')
    expect(getNamesNotShown().size).toBe(1)
    expect([...getNamesNotShown()][0]).toBe('bad\\u{A0}skill is not offered')

    for (let i = 0; i < 120; i++) {
      recordNameNotShown(`bad-${i}`, 'is not offered')
    }
    expect(getNamesNotShown().size).toBe(100)
  })

  test('loadSkillsDir skips skills whose directory name violates isValidSkillName and records them', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'skills-268-'))
    tempDirs.push(projectDir)
    const skillsRoot = join(projectDir, '.claude', 'skills')
    const validDir = join(skillsRoot, 'valid-skill')
    const invalidName = 'bad\u200Bskill'
    const invalidDir = join(skillsRoot, invalidName)
    mkdirSync(validDir, { recursive: true })
    mkdirSync(invalidDir, { recursive: true })
    writeFileSync(
      join(validDir, 'SKILL.md'),
      '---\ndescription: valid\n---\nHello\n',
    )
    writeFileSync(
      join(invalidDir, 'SKILL.md'),
      '---\ndescription: invalid\n---\nHello\n',
    )

    const loaded = await getSkillDirCommands(projectDir)
    const names = loaded.map(c => c.name)
    expect(names).toContain('valid-skill')
    expect(names).not.toContain(invalidName)
    expect(getNamesNotShown().size).toBe(1)
  })
})
