import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findVoiceEnabledOverrideMessage } from '../voice.js'

describe('2.1.328 /voice override detection same-file settings check', () => {
  test('does not falsely refuse when projectSettings and userSettings point to the same physical file via symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-settings-test-'))
    try {
      const userFile = join(dir, 'user-settings.json')
      const projectLink = join(dir, 'project-settings.json')
      writeFileSync(userFile, JSON.stringify({ voice: { enabled: true } }))
      symlinkSync(userFile, projectLink)

      const msg = findVoiceEnabledOverrideMessage(
        true,
        () => ['userSettings', 'projectSettings'],
        src =>
          src === 'userSettings' || src === 'projectSettings'
            ? ({ voice: { enabled: true } } as never)
            : null,
        src =>
          src === 'userSettings'
            ? userFile
            : src === 'projectSettings'
              ? projectLink
              : undefined,
      )
      expect(msg).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('does not falsely refuse when userSettings and projectSettings resolve to the same non-existent path', () => {
    const msg = findVoiceEnabledOverrideMessage(
      true,
      () => ['userSettings', 'projectSettings'],
      () => ({ voice: { enabled: true } }) as never,
      src =>
        src === 'userSettings'
          ? '/nonexistent/home/.claude/settings.json'
          : src === 'projectSettings'
            ? '/nonexistent/home/sub/../.claude/settings.json'
            : undefined,
    )
    expect(msg).toBeNull()
  })

  test('still reports project override when projectSettings is a distinct file', () => {
    const msg = findVoiceEnabledOverrideMessage(
      true,
      () => ['userSettings', 'projectSettings'],
      src =>
        src === 'projectSettings'
          ? ({ voice: { enabled: true } } as never)
          : null,
      src =>
        src === 'userSettings'
          ? '/tmp/user-settings.json'
          : src === 'projectSettings'
            ? '/tmp/repo/.claude/settings.json'
            : undefined,
    )
    expect(msg).toContain('.claude/settings.json')
  })

  test('still reports policySettings override even when projectSettings aliases userSettings', () => {
    const msg = findVoiceEnabledOverrideMessage(
      false,
      () => ['userSettings', 'projectSettings', 'policySettings'],
      src =>
        src === 'policySettings'
          ? ({ voice: { enabled: false } } as never)
          : ({ voice: { enabled: true } } as never),
      src =>
        src === 'userSettings' || src === 'projectSettings'
          ? '/same/.claude/settings.json'
          : undefined,
    )
    expect(msg).toContain('enterprise managed settings')
  })
})
