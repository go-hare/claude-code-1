/**
 * densable 2.1.229 #2 — CCR launcher_hooks (gjw/yjw/Pyg) + --settings wire.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LAUNCHER_HOOK_EVENTS,
  LAUNCHER_HOOK_FILENAME_RE,
  LAUNCHER_HOOK_SCRIPT_MAX_BYTES,
  assertHooksDirIsPlainDirectory,
  isCcrLauncherHostSeedPath,
  materializeLauncherHooks,
  summarizeLauncherHookValue,
  validateLauncherHooks,
} from '../launcherHooks.js'
import { buildSessionChildArgs } from '../sessionChild.js'
import { scanRepoCommittedSettings } from '../sessionConfine.js'
import { seedHostConfigIntoSession } from '../sessionSeed.js'
import type { HostConfigSnapshot } from '../hostConfig.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function tmp(): string {
  const d = join(
    tmpdir(),
    `shr-launcher-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.229 #2 launcherHooks constants', () => {
  test('myg / mjw / hjw 1:1 densable', () => {
    expect(LAUNCHER_HOOK_SCRIPT_MAX_BYTES).toBe(131_072)
    expect(LAUNCHER_HOOK_FILENAME_RE.test('stop_gate.sh')).toBe(true)
    expect(LAUNCHER_HOOK_FILENAME_RE.test('x.py')).toBe(true)
    expect(LAUNCHER_HOOK_FILENAME_RE.test('../evil.sh')).toBe(false)
    expect(LAUNCHER_HOOK_FILENAME_RE.test('a.b.sh')).toBe(false)
    expect(LAUNCHER_HOOK_EVENTS.has('Stop')).toBe(true)
    expect(LAUNCHER_HOOK_EVENTS.has('PreToolUse')).toBe(true)
    expect(LAUNCHER_HOOK_EVENTS.has('PostToolUse')).toBe(true)
    expect(LAUNCHER_HOOK_EVENTS.has('Bogus')).toBe(false)
  })

  test('summarizeLauncherHookValue a7i truncates', () => {
    const long = 'x'.repeat(250)
    const s = summarizeLauncherHookValue(long)
    expect(s.includes('…')).toBe(true)
    expect(s.includes('+')).toBe(true)
  })
})

describe('densable 2.1.229 #2 gjw validateLauncherHooks', () => {
  test('rejects non-array', () => {
    expect(validateLauncherHooks({ event: 'Stop' })).toMatch(
      /launcher_hooks: not an array/,
    )
  })

  test('rejects unknown event', () => {
    expect(
      validateLauncherHooks([
        { event: 'Nope', filename: 'a.sh', script: 'echo 1' },
      ]),
    ).toMatch(/unknown event/)
  })

  test('rejects invalid filename', () => {
    expect(
      validateLauncherHooks([
        { event: 'Stop', filename: 'bad name.sh', script: 'echo 1' },
      ]),
    ).toMatch(/invalid filename/)
  })

  test('rejects case-insensitive duplicate filename', () => {
    expect(
      validateLauncherHooks([
        { event: 'Stop', filename: 'Gate.sh', script: 'echo 1' },
        { event: 'SessionEnd', filename: 'gate.sh', script: 'echo 2' },
      ]),
    ).toMatch(/duplicate filename/)
  })

  test('rejects empty / oversized script', () => {
    expect(
      validateLauncherHooks([{ event: 'Stop', filename: 'a.sh', script: '' }]),
    ).toMatch(/script size 0 out of range/)
    const big = 'x'.repeat(LAUNCHER_HOOK_SCRIPT_MAX_BYTES + 1)
    expect(
      validateLauncherHooks([{ event: 'Stop', filename: 'a.sh', script: big }]),
    ).toMatch(/out of range/)
  })

  test('accepts valid entries', () => {
    expect(
      validateLauncherHooks([
        { event: 'Stop', filename: 'stop.sh', script: '#!/bin/sh\necho ok' },
        {
          event: 'PreToolUse',
          filename: 'pre.py',
          script: 'print("hi")',
        },
      ]),
    ).toBeUndefined()
  })
})

describe('densable 2.1.229 #2 yjw materializeLauncherHooks', () => {
  test('writes .ccr-launcher scripts + launcher-settings.json', async () => {
    const cfg = tmp()
    const cleanup: string[] = []
    const logs: string[] = []
    const result = await materializeLauncherHooks(
      cfg,
      [
        {
          event: 'Stop',
          filename: 'stop_gate.sh',
          script: '#!/bin/sh\necho stop\n',
        },
      ],
      cleanup,
      m => logs.push(m),
      m => logs.push(m),
    )
    expect(result?.settingsPath).toBe(join(cfg, 'launcher-settings.json'))
    const scriptPath = join(cfg, 'hooks', '.ccr-launcher', 'stop_gate.sh')
    expect(readFileSync(scriptPath, 'utf8')).toContain('echo stop')
    expect(statSync(scriptPath).mode & 0o777).toBe(0o700)
    const settings = JSON.parse(readFileSync(result!.settingsPath, 'utf8')) as {
      hooks: Record<
        string,
        Array<{ hooks: Array<{ type: string; command: string }> }>
      >
    }
    expect(settings.hooks.Stop?.[0]?.hooks[0]?.type).toBe('command')
    expect(settings.hooks.Stop?.[0]?.hooks[0]?.command).toBe(scriptPath)
    expect(cleanup).toContain(scriptPath)
    expect(cleanup).toContain(result!.settingsPath)
    expect(logs.some(l => l.includes('Wrote 1 launcher hook'))).toBe(true)
  })

  test('validation fail-soft drops without throw', async () => {
    const cfg = tmp()
    const statuses: string[] = []
    const result = await materializeLauncherHooks(
      cfg,
      { not: 'array' },
      [],
      () => {},
      m => statuses.push(m),
    )
    expect(result).toBeUndefined()
    expect(statuses[0]).toMatch(
      /launcher_hooks validation failed — dropping \(CCR deploy regression/,
    )
  })

  test('Pyg: hooks path is file → fail soft', async () => {
    const cfg = tmp()
    writeFileSync(join(cfg, 'hooks'), 'not-a-dir')
    const statuses: string[] = []
    const result = await materializeLauncherHooks(
      cfg,
      [{ event: 'Stop', filename: 'a.sh', script: 'echo 1' }],
      [],
      () => {},
      m => statuses.push(m),
    )
    expect(result).toBeUndefined()
    expect(statuses.some(s => s.includes('not a plain directory'))).toBe(true)
  })
})

describe('densable 2.1.229 #2 sjv --settings wire', () => {
  test('buildSessionChildArgs pushes --settings after --mcp-config', () => {
    const args = buildSessionChildArgs({
      execArgs: [],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionId: 's1',
      debugFile: '/tmp/d.txt',
      mcpConfigPath: '/cfg/mcp-config.json',
      launcherSettingsPath: '/cfg/launcher-settings.json',
    })
    const mcpIdx = args.indexOf('--mcp-config')
    const setIdx = args.indexOf('--settings')
    expect(mcpIdx).toBeGreaterThan(-1)
    expect(setIdx).toBeGreaterThan(mcpIdx)
    expect(args[setIdx + 1]).toBe('/cfg/launcher-settings.json')
  })

  test('server claude_code_args cannot pass settings (blocked _jw)', () => {
    const args = buildSessionChildArgs({
      execArgs: [],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionId: 's1',
      debugFile: '/tmp/d.txt',
      launcherSettingsPath: '/cfg/launcher-settings.json',
      claudeCodeArgs: { settings: '/evil.json', model: 'x' },
      onDebug: () => {},
    })
    expect(args).toContain('--settings')
    expect(args).toContain('/cfg/launcher-settings.json')
    expect(args).not.toContain('/evil.json')
    expect(args).toContain('--model')
  })
})

describe('densable 2.1.229 #2 confine repoDisablesAllHooks bag', () => {
  test('disableAllHooks:true under childCwd sets bag without throw', async () => {
    const root = tmp()
    const claude = join(root, '.claude')
    mkdirSync(claude, { recursive: true })
    writeFileSync(
      join(claude, 'settings.json'),
      JSON.stringify({ disableAllHooks: true }),
    )
    const bag: { repoDisablesAllHooks?: boolean } = {}
    const entries = await scanRepoCommittedSettings(root, [root], bag)
    expect(bag.repoDisablesAllHooks).toBe(true)
    expect(Array.isArray(entries)).toBe(true)
  })

  test('disableAllHooks:false still throws operator-posture', async () => {
    const root = tmp()
    const claude = join(root, '.claude')
    mkdirSync(claude, { recursive: true })
    writeFileSync(
      join(claude, 'settings.json'),
      JSON.stringify({ disableAllHooks: false }),
    )
    await expect(scanRepoCommittedSettings(root, [root])).rejects.toMatchObject(
      { name: 'ConfineRepoSettingsError' },
    )
  })
})

describe('densable 2.1.229 #2 fjw host seed skip .ccr-launcher', () => {
  test('isCcrLauncherHostSeedPath', () => {
    expect(isCcrLauncherHostSeedPath(join('hooks', '.ccr-launcher'))).toBe(true)
    expect(
      isCcrLauncherHostSeedPath(join('hooks', '.ccr-launcher', 'a.sh')),
    ).toBe(true)
    expect(isCcrLauncherHostSeedPath(join('hooks', 'other.sh'))).toBe(false)
  })

  test('seedHostConfigIntoSession skips hooks/.ccr-launcher', async () => {
    const cfg = tmp()
    const snapshot: HostConfigSnapshot = {
      sourceDir: '/host',
      files: new Map([
        [
          join('hooks', '.ccr-launcher', 'evil.sh'),
          { buf: Buffer.from('evil'), mode: 0o700 },
        ],
        ['other.txt', { buf: Buffer.from('ok'), mode: 0o600 }],
      ]),
    }
    await seedHostConfigIntoSession(
      cfg,
      snapshot,
      () => {},
      () => {},
    )
    expect(() =>
      readFileSync(join(cfg, 'hooks', '.ccr-launcher', 'evil.sh')),
    ).toThrow()
    expect(readFileSync(join(cfg, 'other.txt'), 'utf8')).toBe('ok')
  })

  test('assertHooksDirIsPlainDirectory', async () => {
    const cfg = tmp()
    expect(await assertHooksDirIsPlainDirectory(cfg, () => {})).toBe(true)
    writeFileSync(join(cfg, 'hooks'), 'file')
    const statuses: string[] = []
    expect(
      await assertHooksDirIsPlainDirectory(cfg, m => statuses.push(m)),
    ).toBe(false)
    expect(statuses[0]).toMatch(/not a plain directory/)
  })
})
