import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { probeNativeFileWatching } from '../fsWatchProbe.js'

// Business modules and hooks stay real in the fixture. Each subprocess owns
// its config roots and OS policy I/O mock; Bun's global module mocks cannot
// leak into the existing settings/permissions suites.
async function runScenario(scenario: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'settings-watch-289-'))
  try {
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, 'changeDetector.289.fixture.ts'),
        scenario,
      ],
      {
        cwd: join(import.meta.dir, '../../../..'),
        env: {
          ...process.env,
          WATCH_TEST_PROJECT: cwd,
          CLAUDE_CONFIG_DIR: join(root, 'user'),
          CLAUDE_CODE_MANAGED_SETTINGS_PATH: join(root, 'managed'),
          CLAUDE_CODE_REMOTE: '',
          CLAUDE_CODE_USE_COWORK_PLUGINS: '',
          CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '',
          CLAUDE_CODE_HOST_AUTH_ENV_VAR: '',
          USER_TYPE: 'ant',
          DISABLE_TELEMETRY: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toContain('"success":true')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('settings watcher 2.1.289 real filesystem and live consumers', () => {
  test(
    'discovers first project/local files in an existing empty directory',
    () => runScenario('first'),
    15000,
  )
  test(
    'rehomes when a missing settings directory appears and catches up its first write',
    () => runScenario('missing'),
    15000,
  )
  test(
    'applies edits, atomic saves, recreation and rename-away to state, permissions and hooks',
    () => runScenario('existing'),
    15000,
  )
  test(
    'maps symlink target edits, atomic replacements and deletes to the canonical source',
    () => runScenario('symlink'),
    15000,
  )
  test(
    'applies managed base and drop-in events, including a newly appearing drop-in directory',
    () => runScenario('managed'),
    20000,
  )
  test(
    'catches the first drop-in saved between target enumeration and watcher ready',
    () => runScenario('managed-ready-race'),
    20000,
  )
  test(
    'discovers a recreated drop-in directory when its native parent event is missed',
    () => runScenario('managed-directory-event-loss'),
    20000,
  )
  for (const code of ['EMFILE', 'ENFILE', 'ENOSPC']) {
    test(
      `falls back after ${code} and catches up a save missed before polling ready`,
      () => runScenario(`fallback-${code}`),
      15000,
    )
  }
  test(
    'detects silent native delivery and catches up after switching to polling',
    () => runScenario('silent'),
    15000,
  )
  test(
    'refreshes MDM/HKCU caches, only emits differences and stops polling on dispose',
    () => runScenario('mdm'),
    15000,
  )
})

describe('native fs.watch delivery probe', () => {
  test('proves event delivery using only a temporary private file', async () => {
    expect(
      await probeNativeFileWatching({ rewriteEveryMs: 10, budgetMs: 500 }),
    ).toBe('delivers')
  })
  test('recognizes resource refusal and removes the temporary probe directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'settings-probe-289-'))
    try {
      const verdict = await probeNativeFileWatching({
        directory,
        watch: (() => {
          throw Object.assign(new Error('refused'), { code: 'ENOSPC' })
        }) as typeof import('fs').watch,
      })
      expect(verdict).toBe('refused')
      expect(await Array.fromAsync(new Bun.Glob('*').scan(directory))).toEqual(
        [],
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
