/**
 * densable 2.1.228 #12 — synced skill harden core (Vyn/ULo/xTt/$vr).
 */
import { describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import {
  applySyncedSkillShadowFilter,
  buildOwnedCommandNameSet,
  CLAUDE_AI_SYNC_LABEL,
  emptyHardenedSkillCapabilities,
  isSyncedSkillNameBlocked,
  isSyncedSkillRemoteHostEnv,
  normalizeCommandNameKey,
  sanitizeSyncedSkillDescription,
  shouldHardenSkillBody,
} from '../syncedSkillsHarden.js'

function cmd(
  partial: Pick<Command, 'name'> &
    Partial<Pick<Command, 'aliases' | 'loadedFrom' | 'userFacingName'>>,
): Command {
  return {
    type: 'local',
    name: partial.name,
    description: 'test',
    supportsNonInteractive: true,
    load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
    loadedFrom: partial.loadedFrom,
    aliases: partial.aliases,
    ...(partial.userFacingName
      ? { userFacingName: partial.userFacingName }
      : {}),
  } as Command
}

describe('densable 2.1.228 #12 normalizeCommandNameKey (efe)', () => {
  test('case-folds and strips ignorable separators', () => {
    expect(normalizeCommandNameKey('My-Skill')).toBe(
      normalizeCommandNameKey('my-skill'),
    )
    expect(normalizeCommandNameKey('a​b')).toBe(normalizeCommandNameKey('ab'))
  })
})

describe('densable 2.1.228 #12 shadow filter (Vyn/ULo/XBs)', () => {
  test('drops synced skill that collides with local name', () => {
    const local = cmd({ name: 'deploy', loadedFrom: 'skills' })
    const synced = cmd({ name: 'deploy', loadedFrom: 'syncedSkills' })
    const out = applySyncedSkillShadowFilter([local, synced])
    expect(out.map(c => c.loadedFrom)).toEqual(['skills'])
  })

  test('drops synced skill that collides case-insensitively', () => {
    const local = cmd({ name: 'Review', loadedFrom: 'plugin' })
    const synced = cmd({ name: 'review', loadedFrom: 'syncedSkills' })
    const out = applySyncedSkillShadowFilter([local, synced])
    expect(out).toHaveLength(1)
    expect(out[0]!.loadedFrom).toBe('plugin')
  })

  test('drops synced skill with colon or mcp__ name', () => {
    const owned = buildOwnedCommandNameSet([])
    expect(isSyncedSkillNameBlocked(cmd({ name: 'foo:bar' }), owned)).toBe(true)
    expect(
      isSyncedSkillNameBlocked(cmd({ name: 'mcp__server__tool' }), owned),
    ).toBe(true)
  })

  test('keeps non-colliding synced skill and claims its name', () => {
    const local = cmd({ name: 'local-only', loadedFrom: 'skills' })
    const first = cmd({ name: 'cloud-a', loadedFrom: 'syncedSkills' })
    const second = cmd({ name: 'cloud-a', loadedFrom: 'syncedSkills' })
    const out = applySyncedSkillShadowFilter([local, first, second])
    expect(out.map(c => c.name)).toEqual(['local-only', 'cloud-a'])
  })

  test('no-op when no syncedSkills present', () => {
    const list = [
      cmd({ name: 'a', loadedFrom: 'skills' }),
      cmd({ name: 'b', loadedFrom: 'plugin' }),
    ]
    expect(applySyncedSkillShadowFilter(list)).toBe(list)
  })
})

describe('densable 2.1.228 #12 xTt / o__ harden body', () => {
  test('syncedSkills hardened on local machine, not REMOTE/COWORK', () => {
    expect(shouldHardenSkillBody('syncedSkills', {})).toBe(true)
    expect(
      shouldHardenSkillBody('syncedSkills', { CLAUDE_CODE_REMOTE: '1' }),
    ).toBe(false)
    expect(
      shouldHardenSkillBody('syncedSkills', { CLAUDE_CODE_IS_COWORK: '1' }),
    ).toBe(false)
  })

  test('mcp always hardened; local skills never', () => {
    expect(shouldHardenSkillBody('mcp', {})).toBe(true)
    expect(shouldHardenSkillBody('skills', {})).toBe(false)
    expect(shouldHardenSkillBody('plugin', {})).toBe(false)
  })

  test('isSyncedSkillRemoteHostEnv reads densable o__ env', () => {
    expect(isSyncedSkillRemoteHostEnv({})).toBe(false)
    expect(isSyncedSkillRemoteHostEnv({ CLAUDE_CODE_REMOTE: 'true' })).toBe(
      true,
    )
  })
})

describe('densable 2.1.228 #12 $vr description label', () => {
  test('prefixes claude.ai sync label', () => {
    expect(sanitizeSyncedSkillDescription('Does things')).toBe(
      `[${CLAUDE_AI_SYNC_LABEL}] Does things`,
    )
  })

  test('empty becomes label only; already labeled not double-prefixed', () => {
    expect(sanitizeSyncedSkillDescription('   ')).toBe(
      `[${CLAUDE_AI_SYNC_LABEL}]`,
    )
    const labeled = `[${CLAUDE_AI_SYNC_LABEL}] already`
    expect(sanitizeSyncedSkillDescription(labeled)).toBe(labeled)
  })

  test('escapes angle brackets and strips controls', () => {
    expect(sanitizeSyncedSkillDescription('use <script>')).toContain('&lt;')
    expect(sanitizeSyncedSkillDescription('use <script>')).not.toContain(
      '<script>',
    )
  })
})

describe('densable 2.1.228 #12 bDo capability wipe', () => {
  test('returns empty capability frontmatter', () => {
    const c = emptyHardenedSkillCapabilities()
    expect(c.allowedTools).toEqual([])
    expect(c.disallowedTools).toEqual([])
    expect(c.hooks).toBeUndefined()
    expect(c.model).toBeUndefined()
    expect(c.paths).toBeUndefined()
  })
})
