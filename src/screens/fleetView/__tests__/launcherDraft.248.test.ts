import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  fleetComposerDraftForDisk,
  fleetLauncherDraftKey,
  fleetLauncherDraftPath,
  fleetLauncherDraftStorageKey,
  loadFleetLauncherDraft,
  parseFleetComposerDraftFromDisk,
  persistFleetLauncherDraftAsync,
  FLEET_LAUNCHER_DRAFT_TTL_MS,
} from '../launcherDraft.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../../../utils/storageV5/hoverRestPin.js'
import { createLocalFsBackend } from '../../../utils/storageV5/createLocalFsBackend.js'

describe('densable 2.1.248 fleet launcher draft (qd / AIt / BLn)', () => {
  let configHome: string

  beforeEach(() => {
    resetHoverRestPinForTests()
    configHome = mkdtempSync(join(tmpdir(), 'fleet-draft-'))
    mkdirSync(join(configHome, 'jobs'), { recursive: true })
    process.env.CLAUDE_CONFIG_HOME = configHome
  })

  afterEach(() => {
    resetHoverRestPinForTests()
    delete process.env.CLAUDE_CONFIG_HOME
    rmSync(configHome, { recursive: true, force: true })
  })

  test('draftForDisk: bash → !prefix, prompt unchanged', () => {
    expect(fleetComposerDraftForDisk('npm test', 'prompt')).toBe('npm test')
    expect(fleetComposerDraftForDisk('ls', 'bash')).toBe('!ls')
    expect(parseFleetComposerDraftFromDisk('!ls')).toEqual({
      mode: 'bash',
      query: 'ls',
    })
    expect(parseFleetComposerDraftFromDisk('fix bug')).toEqual({
      mode: 'prompt',
      query: 'fix bug',
    })
  })

  test('draftKey is sha256(cwd) first 8 hex (densable c)', () => {
    const cwd = '/tmp/my-repo'
    expect(fleetLauncherDraftKey(cwd)).toBe(
      createHash('sha256').update(cwd).digest('hex').slice(0, 8),
    )
    expect(fleetLauncherDraftStorageKey(fleetLauncherDraftKey(cwd))).toEqual({
      namespace: 'jobsRoot',
      draftKey: fleetLauncherDraftKey(cwd),
    })
  })

  test('BLn/AIt round-trip on disk when hover-rest off', async () => {
    const cwd = '/tmp/fleet-launcher'
    await persistFleetLauncherDraftAsync(cwd, {
      q: fleetComposerDraftForDisk('hello', 'prompt'),
      collapsed: ['blocked', 'done'],
    })
    const loaded = await loadFleetLauncherDraft(cwd)
    expect(loaded).toEqual({ q: 'hello', collapsed: ['blocked', 'done'] })
    expect(fleetLauncherDraftPath(cwd)).toContain(
      `.draft-${fleetLauncherDraftKey(cwd)}`,
    )
  })

  test('BLn drops expired drafts (densable p)', async () => {
    const cwd = '/tmp/expired-draft'
    const path = fleetLauncherDraftPath(cwd)
    writeFileSync(
      path,
      JSON.stringify({
        q: 'stale',
        collapsed: [],
        ts: Date.now() - FLEET_LAUNCHER_DRAFT_TTL_MS - 1,
      }),
    )
    expect(await loadFleetLauncherDraft(cwd)).toBeUndefined()
  })

  test('AIt uses storageV5 jobsRoot draftKey when hover-rest on', async () => {
    pinHoverRest(true)
    const backend = createLocalFsBackend({
      configHome,
      globalConfigFile: join(configHome, 'settings.json'),
    })
    const cwd = '/tmp/v5-draft'
    const ok = await persistFleetLauncherDraftAsync(
      cwd,
      { q: '!git status', collapsed: ['pinned'] },
      backend,
    )
    expect(ok).toBe(true)
    const loaded = await loadFleetLauncherDraft(cwd, backend)
    expect(loaded).toEqual({ q: '!git status', collapsed: ['pinned'] })
  })
})
