/**
 * densable 2.1.283 Yw/sN memory-store SKILL.md walk @181324781 / @181327164.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  getMemoryStoreSkillCommands,
  getMemoryStoresHost,
  isMemoryStoreSkillFolderName,
  listMemoryStoreSkillFolders,
  loadMemoryStoreSkillCommands,
  MEMORY_STORE_SKILL_NAME_PREFIX,
  readMemoryStoreSkillFile,
  registerMemoryStoreSkills,
  replaceMemoryStoreSkillCommands,
  screenMemoryStorePath,
} from '../memoryStoreSkills.js'

const dirs: string[] = []

afterEach(() => {
  replaceMemoryStoreSkillCommands([])
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe('densable 2.1.283 Yw sN SKILL.md walk', () => {
  test('Mlt rejects empty, dot, and path separators', () => {
    expect(isMemoryStoreSkillFolderName('')).toBe(false)
    expect(isMemoryStoreSkillFolderName('.')).toBe(false)
    expect(isMemoryStoreSkillFolderName('..')).toBe(false)
    expect(isMemoryStoreSkillFolderName('ok-skill')).toBe(true)
    expect(isMemoryStoreSkillFolderName('ok_skill.1')).toBe(true)
  })

  test('sN loads SKILL.md as memories::name, userInvocable false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-skills-'))
    dirs.push(root)
    const skillDir = join(root, 'pack-notes')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\ndescription: Pack notes\n---\nBody\n',
    )
    const skips: string[] = []
    const { commands, truncated } = await loadMemoryStoreSkillCommands(
      root,
      why => skips.push(why),
    )
    expect(truncated).toBe(false)
    expect(skips).toEqual([])
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe(
      `${MEMORY_STORE_SKILL_NAME_PREFIX}pack-notes`,
    )
    expect(commands[0]!.type).toBe('prompt')
    if (commands[0]!.type === 'prompt') {
      expect(commands[0]!.source).toBe('memoryStore')
      expect(commands[0]!.loadedFrom).toBe('memoryStore')
      expect(commands[0]!.userInvocable).toBe(false)
    }
  })

  test('Yw walks team mount skillsDirs into the bag', async () => {
    const mount = mkdtempSync(join(tmpdir(), 'mem-mount-'))
    dirs.push(mount)
    const skills = join(mount, 'skills')
    mkdirSync(join(skills, 'alpha'), { recursive: true })
    writeFileSync(
      join(skills, 'alpha', 'SKILL.md'),
      '---\ndescription: Alpha\n---\nA\n',
    )
    await registerMemoryStoreSkills(
      [{ scope: 'team', mount: 'team-a', skillsDirs: ['skills'] }],
      [{ mountName: 'team-a', mountDir: mount, partitionId: 'p1' }],
    )
    const cmds = getMemoryStoreSkillCommands()
    expect(cmds.map(c => c.name)).toEqual([
      `${MEMORY_STORE_SKILL_NAME_PREFIX}alpha`,
    ])
  })

  test('Yw skips non-team configs', async () => {
    await registerMemoryStoreSkills(
      [{ scope: 'user', mount: 'u', skillsDirs: ['skills'] }],
      [{ mountName: 'u', mountDir: '/tmp', partitionId: 'p1' }],
    )
    expect(getMemoryStoreSkillCommands()).toEqual([])
  })

  test('lhe rejects sibling prefix and ../ escape', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'mem-parent-'))
    dirs.push(parent)
    const mount = join(parent, 'foo')
    const sibling = join(parent, 'foobar')
    mkdirSync(join(mount, 'skills', 'ok'), { recursive: true })
    mkdirSync(join(sibling, 'alpha'), { recursive: true })
    writeFileSync(
      join(mount, 'skills', 'ok', 'SKILL.md'),
      '---\ndescription: Ok\n---\nO\n',
    )
    writeFileSync(
      join(sibling, 'alpha', 'SKILL.md'),
      '---\ndescription: Alpha\n---\nA\n',
    )
    expect(await screenMemoryStorePath(sibling, mount)).toBe('escape')
    expect(
      await screenMemoryStorePath(join(mount, '..', 'foobar'), mount),
    ).toBe('escape')
    expect(await screenMemoryStorePath(join(mount, 'skills'), mount)).toBe('ok')
    await registerMemoryStoreSkills(
      [{ scope: 'team', mount: 'team-a', skillsDirs: [sibling] }],
      [{ mountName: 'team-a', mountDir: mount, partitionId: 'p1' }],
    )
    expect(getMemoryStoreSkillCommands()).toEqual([])
    await registerMemoryStoreSkills(
      [{ scope: 'team', mount: 'team-a', skillsDirs: ['../foobar'] }],
      [{ mountName: 'team-a', mountDir: mount, partitionId: 'p1' }],
    )
    expect(getMemoryStoreSkillCommands()).toEqual([])
  })

  test('eS MemoryStoresHost refreshStoreSkills is a no-op when configs null', () => {
    const host = getMemoryStoresHost()
    host.reset()
    expect(host.storeSkillConfigs).toBeNull()
    host.refreshStoreSkills()
    expect(getMemoryStoreSkillCommands()).toEqual([])
  })

  test('aN/lN fail closed without storageV5', async () => {
    const listed = await listMemoryStoreSkillFolders(undefined, 'p', ['skills'])
    expect(listed.ok).toBe(false)
    const file = await readMemoryStoreSkillFile(undefined, {})
    expect(file.kind).toBe('failed')
  })

  test('aN copies gold viaSymlink onto the folder', async () => {
    const listed = await listMemoryStoreSkillFolders(
      {
        listEntries: async () => ({
          ok: true,
          value: {
            items: [
              {
                kind: 'scope',
                viaSymlink: true,
                scope: { namespace: 'memory', relPath: ['skills', 'alpha'] },
              },
            ],
          },
        }),
      },
      'p',
      ['skills'],
    )
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value).toEqual([{ name: 'alpha', symlink: true }])
    }
  })
})
