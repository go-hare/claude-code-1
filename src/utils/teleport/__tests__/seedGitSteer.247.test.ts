/**
 * densable 2.1.247 — `_583` `pXo`/`fXo` settings-env steer.
 * TCt `S=b&&h?pXo(h):null` then `failReason:"refused"`.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  formatSeedSteerRefuse,
  refuseSeedSteerEnv,
  SEED_STEER_HOME_KEYS,
  SEED_STEER_KEYS,
} from '../seedGitSteer.js'

describe('densable pXo/fXo seed steer', () => {
  test('fXo refuse copy — unreadable / names / moved', () => {
    expect(formatSeedSteerRefuse({ kind: 'unreadable' })).toContain(
      'could not be parsed, so what it sets cannot be checked',
    )
    expect(
      formatSeedSteerRefuse({ kind: 'names', name: 'CLAUDE_CONFIG_DIR' }),
    ).toContain('which decides where your own settings are found')
    expect(formatSeedSteerRefuse({ kind: 'names', name: 'PATH' })).toContain(
      "the upload's own git runs would have to trust what it names",
    )
    expect(
      formatSeedSteerRefuse({ kind: 'moved', name: 'CLAUDE_CONFIG_DIR' }),
    ).toContain('was changed by a settings file after Claude Code started')
    expect(formatSeedSteerRefuse({ kind: 'moved', name: 'PATH' })).toContain(
      'that no longer names it',
    )
  })

  test('W4n/bCt key lists', () => {
    expect(SEED_STEER_HOME_KEYS).toContain('CLAUDE_CONFIG_DIR')
    expect(SEED_STEER_HOME_KEYS).toContain('CLAUDE_CODE_USE_COWORK_PLUGINS')
    expect(SEED_STEER_KEYS).toContain('PATH')
    expect(SEED_STEER_KEYS).toContain('GIT_EXEC_PATH')
    expect(SEED_STEER_KEYS[0]).toBe('CLAUDE_CONFIG_DIR')
  })

  test('G4n: workTree settings.json that is not a file is unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-pxo-'))
    await mkdir(join(root, '.claude', 'settings.json'), { recursive: true })
    expect(refuseSeedSteerEnv({ workTree: root })).toEqual({
      kind: 'unreadable',
    })
  })

  test('G4n: workTree settings.json with invalid JSON is unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-pxo-bad-'))
    await mkdir(join(root, '.claude'), { recursive: true })
    await writeFile(join(root, '.claude', 'settings.json'), '{not-json')
    expect(refuseSeedSteerEnv({ workTree: root })).toEqual({
      kind: 'unreadable',
    })
  })

  test('pXo: clean workTree is not steered (V4n j() unset)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-pxo-ok-'))
    expect(refuseSeedSteerEnv({ workTree: root })).toBeNull()
  })

  test('gitBundle host wires pXo before X4n', async () => {
    const src = await Bun.file(
      new URL('../gitBundle.ts', import.meta.url),
    ).text()
    expect(src).toContain('refuseSeedSteerEnv')
    expect(src).toContain('formatSeedSteerRefuse')
    expect(src.lastIndexOf('refuseSeedSteerEnv(seedLayout)')).toBeLessThan(
      src.lastIndexOf('makeSeedAdminDir('),
    )
    expect(src).toContain("failReason: 'refused'")
    expect(src).toContain('admin_dir_failed')
  })
})
