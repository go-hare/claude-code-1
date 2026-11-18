import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { shouldIgnoreSkillWatchPath } from '../skillChangeDetector.js'

const fileStats = {
  isFile: () => true,
  isDirectory: () => false,
  isSymbolicLink: () => false,
}

const dirStats = {
  isFile: () => false,
  isDirectory: () => true,
  isSymbolicLink: () => false,
}

describe('#1415 skillChangeDetector chokidar ignored predicate', () => {
  const userSkillsDir = join('/tmp', 'claude-home', 'skills')

  test('ignores files inside userSkillsDir/.trash', () => {
    expect(
      shouldIgnoreSkillWatchPath(
        join(userSkillsDir, '.trash', 'old-skill', 'SKILL.md'),
        fileStats,
        userSkillsDir,
      ),
    ).toBe(true)
    expect(
      shouldIgnoreSkillWatchPath(
        join(userSkillsDir, '.trash'),
        dirStats,
        userSkillsDir,
      ),
    ).toBe(true)
  })

  test('ignores .git paths and non-.md files, allows normal SKILL.md', () => {
    expect(
      shouldIgnoreSkillWatchPath(
        join(userSkillsDir, 'my-skill', '.git', 'HEAD'),
        fileStats,
        userSkillsDir,
      ),
    ).toBe(true)
    expect(
      shouldIgnoreSkillWatchPath(
        join(userSkillsDir, 'my-skill', 'notes.txt'),
        fileStats,
        userSkillsDir,
      ),
    ).toBe(true)
    expect(
      shouldIgnoreSkillWatchPath(
        join(userSkillsDir, 'my-skill', 'SKILL.md'),
        fileStats,
        userSkillsDir,
      ),
    ).toBe(false)
  })
})
