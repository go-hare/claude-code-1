import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setCwdState, setOriginalCwd } from '../../bootstrap/state.js'
import {
  addSkillDirectories,
  clearDynamicSkills,
  getDynamicSkills,
  refreshMovedDirectorySkills,
  skillMapKey,
} from '../loadSkillsDir.js'

const temps: string[] = []
const suiteCwd = process.cwd()

afterEach(() => {
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  clearDynamicSkills()
})

function writeSkill(dir: string, name: string): void {
  const skillDir = join(dir, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${name} skill`,
      '---',
      '',
      `${name} body`,
    ].join('\n'),
  )
}

describe('densable 2.1.246 iXe.replace', () => {
  test('replace drops vanished skills in the scanned tree only', async () => {
    const treeA = mkdtempSync(join(tmpdir(), 'ixe-a-'))
    const treeB = mkdtempSync(join(tmpdir(), 'ixe-b-'))
    temps.push(treeA, treeB)
    writeSkill(treeA, 'keep-me')
    writeSkill(treeA, 'gone')
    writeSkill(treeB, 'other-tree')

    await addSkillDirectories([treeA, treeB])
    expect(
      getDynamicSkills()
        .map(s => s.name)
        .sort(),
    ).toEqual(['gone', 'keep-me', 'other-tree'])

    unlinkSync(join(treeA, 'gone', 'SKILL.md'))
    writeSkill(treeA, 'new-one')

    await addSkillDirectories([treeA], { replace: true })
    expect(
      getDynamicSkills()
        .map(s => s.name)
        .sort(),
    ).toEqual(['keep-me', 'new-one', 'other-tree'])
  })

  test('add without replace keeps a vanished same-tree skill', async () => {
    const treeA = mkdtempSync(join(tmpdir(), 'ixe-keep-'))
    temps.push(treeA)
    writeSkill(treeA, 'stale')
    await addSkillDirectories([treeA])
    unlinkSync(join(treeA, 'stale', 'SKILL.md'))
    writeSkill(treeA, 'fresh')
    await addSkillDirectories([treeA])
    expect(
      getDynamicSkills()
        .map(s => s.name)
        .sort(),
    ).toEqual(['fresh', 'stale'])
  })

  test('skill watcher scheduleReload calls hZc', async () => {
    const src = await Bun.file('src/utils/skills/skillChangeDetector.ts').text()
    expect(src).toContain('refreshMovedDirectorySkills')
    expect(src).toContain("re-reading the moved directory's skills failed")
  })

  test('Q3e map key is skillRoot NUL name', () => {
    expect(
      skillMapKey({
        type: 'prompt',
        name: 'demo',
        skillRoot: '/tmp/skills',
      } as never),
    ).toBe('/tmp/skills\0demo')
    expect(
      skillMapKey({
        type: 'local',
        name: 'demo',
        skillRoot: '/tmp/skills',
      } as never),
    ).toBe('\0demo')
  })

  test('hZc no-ops when cwd is still the launch root', async () => {
    const treeA = mkdtempSync(join(tmpdir(), 'hzc-root-'))
    temps.push(treeA)
    writeSkill(treeA, 'launch-only')
    await addSkillDirectories([treeA])
    unlinkSync(join(treeA, 'launch-only', 'SKILL.md'))
    setCwdState(suiteCwd)
    setOriginalCwd(suiteCwd)
    await refreshMovedDirectorySkills()
    expect(getDynamicSkills().map(s => s.name)).toEqual(['launch-only'])
  })
})
