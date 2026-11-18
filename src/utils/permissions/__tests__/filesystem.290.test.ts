import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkReadableInternalPath,
  isBgJobTmpPath,
  isClaudeSettingsPath,
} from '../filesystem.js'

describe('filesystem permissions (#51, #125)', () => {
  const prevSessionKind = process.env.CLAUDE_CODE_SESSION_KIND
  const prevJobDir = process.env.CLAUDE_JOB_DIR
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'fs-perm-290-'))
  })

  afterEach(() => {
    if (prevSessionKind === undefined)
      delete process.env.CLAUDE_CODE_SESSION_KIND
    else process.env.CLAUDE_CODE_SESSION_KIND = prevSessionKind
    if (prevJobDir === undefined) delete process.env.CLAUDE_JOB_DIR
    else process.env.CLAUDE_JOB_DIR = prevJobDir
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('#51 allows reading jobs/<id>/tmp/ subtree in bg session', () => {
    const configDir = join(tempRoot, 'cfg')
    const jobDir = join(configDir, 'jobs', 'job-123')
    const jobTmp = join(jobDir, 'tmp')
    mkdirSync(jobTmp, { recursive: true })
    const imgFile = join(jobTmp, 'paste.png')
    writeFileSync(imgFile, 'png')

    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_JOB_DIR = jobDir
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'

    expect(isBgJobTmpPath(imgFile)).toBe(true)
    const decision = checkReadableInternalPath(imgFile, { file_path: imgFile })
    expect(decision.behavior).toBe('allow')
    expect(
      (decision.decisionReason as { reason?: string } | undefined)?.reason,
    ).toBe('Job tmp/ subtree for current bg session is allowed for reading')
  })

  test('#51 denies jobs/<id>/tmp/ outside bg session or with dangerous segments or hijacked jobDir', () => {
    const configDir = join(tempRoot, 'cfg')
    const jobDir = join(configDir, 'jobs', 'job-123')
    mkdirSync(join(jobDir, 'tmp', '.git'), { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_JOB_DIR = jobDir

    // Non-bg session
    process.env.CLAUDE_CODE_SESSION_KIND = 'interactive'
    expect(isBgJobTmpPath(join(jobDir, 'tmp', 'a.png'))).toBe(false)

    // Dangerous segment inside tmp/
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isBgJobTmpPath(join(jobDir, 'tmp', '.git', 'config'))).toBe(false)
    expect(isBgJobTmpPath(join(jobDir, 'tmp', '.bashrc'))).toBe(false)

    // Non-tmp file under jobDir
    expect(isBgJobTmpPath(join(jobDir, 'secret.txt'))).toBe(false)

    // Hijacked CLAUDE_JOB_DIR outside jobs/
    process.env.CLAUDE_JOB_DIR = join(tempRoot, 'elsewhere')
    expect(isBgJobTmpPath(join(tempRoot, 'elsewhere', 'tmp', 'a.png'))).toBe(
      false,
    )
  })

  if (process.platform !== 'win32') {
    test('#125 isClaudeSettingsPath resolves symlinks to settings files', () => {
      const claudeDir = join(tempRoot, 'proj', '.claude')
      mkdirSync(claudeDir, { recursive: true })
      const settingsFile = join(claudeDir, 'settings.json')
      writeFileSync(settingsFile, '{}')
      const linkPath = join(tempRoot, 'alias.json')
      symlinkSync(settingsFile, linkPath)

      expect(isClaudeSettingsPath(settingsFile)).toBe(true)
      expect(isClaudeSettingsPath(linkPath)).toBe(true)
      expect(isClaudeSettingsPath(join(tempRoot, 'regular.json'))).toBe(false)
    })
  }
})
