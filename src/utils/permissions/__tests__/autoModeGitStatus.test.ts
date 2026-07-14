import { describe, expect, test } from 'bun:test'
import {
  isDestructiveGitOrRmCommand,
  isGitUploadCommand,
} from '../autoModeGitStatus.js'

describe('isGitUploadCommand (official RDg / ADg)', () => {
  test('matches git add/stage/commit/push', () => {
    expect(isGitUploadCommand('git add .')).toBe(true)
    expect(isGitUploadCommand('git commit -m x')).toBe(true)
    expect(isGitUploadCommand('git push origin main')).toBe(true)
    expect(isGitUploadCommand('git stage -A')).toBe(true)
  })
  test('ignores other git', () => {
    expect(isGitUploadCommand('git status')).toBe(false)
    expect(isGitUploadCommand('git log')).toBe(false)
  })
})

describe('isDestructiveGitOrRmCommand (portable wDg subset)', () => {
  test('matches destructive patterns', () => {
    expect(isDestructiveGitOrRmCommand('git reset --hard HEAD')).toBe(true)
    expect(isDestructiveGitOrRmCommand('git checkout .')).toBe(true)
    expect(isDestructiveGitOrRmCommand('git restore .')).toBe(true)
    expect(isDestructiveGitOrRmCommand('git clean -fd')).toBe(true)
    expect(isDestructiveGitOrRmCommand('rm -rf /tmp/x')).toBe(true)
  })
  test('ignores safe commands', () => {
    expect(isDestructiveGitOrRmCommand('git status')).toBe(false)
    expect(isDestructiveGitOrRmCommand('ls -la')).toBe(false)
  })
})
