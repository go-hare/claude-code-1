import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  handleRegisterRepoRoot,
  isWithinRegisterRepoRootScope,
} from '../registerRepoRoot.js'

function emptyCtx(
  dirs: Map<string, { path: string; source: 'cliArg' | 'session' }> = new Map(),
): ToolPermissionContext {
  return {
    additionalWorkingDirectories: dirs,
  } as unknown as ToolPermissionContext
}

describe('isWithinRegisterRepoRootScope densable sxm', () => {
  test('denies cwd itself', () => {
    const r = isWithinRegisterRepoRootScope('/repo', '/repo', [], [])
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.reason).toContain('current working directory')
    }
  })

  test('allows strict subdirectory of cwd', () => {
    const r = isWithinRegisterRepoRootScope('/repo/clone', '/repo', [], [])
    expect(r).toEqual({ allowed: true })
  })

  test('allows strict subdirectory of launch --add-dir root', () => {
    const r = isWithinRegisterRepoRootScope(
      '/extra/nested',
      '/repo',
      ['/extra'],
      ['/extra'],
    )
    expect(r).toEqual({ allowed: true })
  })

  test('denies path outside cwd and launch roots', () => {
    const r = isWithinRegisterRepoRootScope(
      '/elsewhere',
      '/repo',
      ['/extra'],
      ['/extra'],
    )
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.reason).toContain('subdirectory')
    }
  })

  test('denies already-registered path', () => {
    const r = isWithinRegisterRepoRootScope(
      '/extra',
      '/repo',
      ['/extra'],
      ['/extra'],
    )
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.reason).toContain('already a registered')
    }
  })
})

describe('handleRegisterRepoRoot densable He', () => {
  let root: string
  let nested: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'reg-repo-root-'))
    nested = join(root, 'nested')
    mkdirSync(nested)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('registers nested dir under cwd', async () => {
    const added: string[] = []
    const bootstrap: string[] = []
    let hooksCalled = false
    const result = await handleRegisterRepoRoot(
      { directory: nested },
      {
        getCwd: () => root,
        getToolPermissionContext: () => emptyCtx(),
        applyAddDirectory: p => {
          added.push(p)
        },
        getBootstrapAdditionalDirs: () => bootstrap,
        setBootstrapAdditionalDirs: dirs => {
          bootstrap.splice(0, bootstrap.length, ...dirs)
        },
        refreshSandbox: () => {},
        clearMemoryFileCaches: () => {},
        clearCommandsCache: () => {},
        logDebug: () => {},
        executeDirectoryAddedHooks: async () => {
          hooksCalled = true
          return { results: [], systemMessages: [] }
        },
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.directory).toBeTruthy()
      expect(added).toContain(result.directory)
      expect(bootstrap).toContain(result.directory)
    }
    // hooks fire async; give microtask a tick
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 10))
    expect(hooksCalled).toBe(true)
  })

  test('rejects outside scope with densable wire message', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'reg-repo-outside-'))
    try {
      const result = await handleRegisterRepoRoot(
        { directory: outside },
        {
          getCwd: () => root,
          getToolPermissionContext: () => emptyCtx(),
          applyAddDirectory: () => {},
          getBootstrapAdditionalDirs: () => [],
          setBootstrapAdditionalDirs: () => {},
          refreshSandbox: () => {},
          clearMemoryFileCaches: () => {},
          clearCommandsCache: () => {},
          logDebug: () => {},
          executeDirectoryAddedHooks: async () => ({
            results: [],
            systemMessages: [],
          }),
        },
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(
          'register_repo_root: directory is outside the allowed registration scope',
        )
      }
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('rejects non-directory', async () => {
    const filePath = join(root, 'file.txt')
    await Bun.write(filePath, 'x')
    const result = await handleRegisterRepoRoot(
      { directory: filePath },
      {
        getCwd: () => root,
        getToolPermissionContext: () => emptyCtx(),
        applyAddDirectory: () => {},
        getBootstrapAdditionalDirs: () => [],
        setBootstrapAdditionalDirs: () => {},
        refreshSandbox: () => {},
        clearMemoryFileCaches: () => {},
        clearCommandsCache: () => {},
        logDebug: () => {},
        executeDirectoryAddedHooks: async () => ({
          results: [],
          systemMessages: [],
        }),
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('register_repo_root: target is not a directory')
    }
  })
})
