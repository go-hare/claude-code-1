// Runs in its own process: OS I/O mocks cannot contaminate other suites.
import { expect, mock, spyOn } from 'bun:test'
import chokidar, { type FSWatcher } from 'chokidar'
import * as fs from 'fs'
import { writeFileSync } from 'fs'
import * as fsPromises from 'fs/promises'
import { mkdir, rename, rm, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { bunBundleMock } from '../../../../tests/mocks/bunBundle.js'
import type { RawReadResult } from '../mdm/rawRead.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('bun:bundle', bunBundleMock)
let rawPolicy: RawReadResult = {
  plistStdouts: [],
  hklmStdout: null,
  hkcuStdout: null,
}
let rawReads = 0
let pendingRawRead: Promise<RawReadResult> | undefined
mock.module('src/utils/settings/mdm/rawRead.ts', () => ({
  fireRawRead: async () => {
    rawReads++
    return pendingRawRead ?? rawPolicy
  },
  getMdmRawReadPromise: () => null,
  startMdmRawRead: () => {},
}))

const root = process.env.CLAUDE_CONFIG_DIR!
const managed = process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH!
const project = process.env.WATCH_TEST_PROJECT!
await mkdir(root, { recursive: true })
await mkdir(managed, { recursive: true })
await writeFile(join(root, '.claude.json'), '{}')
const userFile = join(root, 'settings.json')
const projectDir = join(project, '.claude')
const projectFile = join(projectDir, 'settings.json')
const localFile = join(projectDir, 'settings.local.json')
const managedFile = join(managed, 'managed-settings.json')
const dropDir = join(managed, 'managed-settings.d')
const scenario = process.argv[2]!
const trace: unknown[] = []
let missingDropDirStats = 0
const realStat = fsPromises.stat.bind(fsPromises)
spyOn(fsPromises, 'stat').mockImplementation(((...args) =>
  Reflect.apply(realStat, fsPromises, args).catch((error: unknown) => {
    if (
      String(args[0]) === dropDir &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      missingDropDirStats++
    throw error
  })) as typeof fsPromises.stat)
let dropCreationEvents = false
const realDirectoryWatch = fs.watch.bind(fs)
spyOn(fs, 'watch').mockImplementation(((path, ...args) => {
  trace.push(['native-watch', String(path)])
  const forwarded = args.map(value =>
    dropCreationEvents &&
    String(path) === managed &&
    typeof value === 'function'
      ? () => {}
      : value,
  )
  const w: fs.FSWatcher = Reflect.apply(realDirectoryWatch, fs, [
    path,
    ...forwarded,
  ])
  w.on('change', (event, name) =>
    trace.push(['native-event', String(path), event, name]),
  )
  w.on('close', () => trace.push(['native-close', String(path)]))
  return w
}) as typeof fs.watch)
const debug = await import('../../debug.js')
spyOn(debug, 'logForDebugging').mockImplementation(message => {
  trace.push(['debug', message])
})
const watchers: FSWatcher[] = []
const realWatch = chokidar.watch.bind(chokidar)
let beforeNextWatch: (() => void) | undefined
spyOn(chokidar, 'watch').mockImplementation((...args) => {
  const beforeWatch = beforeNextWatch
  beforeNextWatch = undefined
  beforeWatch?.()
  const w = realWatch(...args)
  if (beforeWatch) {
    // Some chokidar backends still emit add for overlapping watch roots.
    // Suppress that incidental rescue: this case must succeed via ready catch-up.
    const emit = w.emit.bind(w)
    spyOn(w, 'emit').mockImplementation((event, ...values) =>
      (event === 'add' || event === 'change') &&
      values[0] === join(dropDir, '10-audit.json')
        ? false
        : emit(event, ...values),
    )
  }
  watchers.push(w)
  return w
})
const stateModule = await import('../../../bootstrap/state.js')
stateModule.setOriginalCwd(project)
stateModule.setCwdState(project)
stateModule.setSessionTrustAccepted(true)
const detector = await import('../changeDetector.js')
const { resetSettingsCache } = await import('../settingsCache.js')
const { getInitialSettings } = await import('../settings.js')
const { captureHooksConfigSnapshot, getHooksConfigFromSnapshot } = await import(
  '../../hooks/hooksConfigSnapshot.js'
)
const { applySettingsChange } = await import('../applySettingsChange.js')
const { getDefaultAppState } = await import('../../../state/AppStateStore.js')
const { createStore } = await import('../../../state/store.js')
const { onChangeAppState } = await import('../../../state/onChangeAppState.js')
const { getMdmSettings, getHkcuSettings } = await import('../mdm/settings.js')
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(
  check: () => boolean,
  label: string,
  timeout = 5000,
): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      console.error(JSON.stringify({ label, trace }))
      throw new Error(`Timed out: ${label}`)
    }
    await delay(20)
  }
}
const json = (value: unknown) => JSON.stringify(value)
const notifications: string[] = []
let applied = 0
let finishProbe: (() => void) | undefined
await detector.resetForTesting({
  stabilityThreshold: 50,
  pollInterval: 10,
  deletionGrace: 100,
  watchPollInterval: 40,
  mdmPollInterval: scenario === 'mdm' ? 50 : 60_000,
  fsWatchProbe: () =>
    scenario === 'silent'
      ? new Promise(resolve => {
          finishProbe = () => resolve('silent')
        })
      : Promise.resolve('delivers'),
})

// All settings and hooks used here are invented, under this process's temp root.
// The only command hook is a PreToolUse snapshot fixture and is never executed.
const changedSettings = {
  permissions: { deny: ['Bash(audit-command)'] },
  env: { CLAUDE_WATCH_AUDIT_VALUE: 'fresh' },
  hooks: {
    PreToolUse: [
      {
        matcher: 'AuditNeverInvoked',
        hooks: [{ type: 'command' as const, command: 'exit 0' }],
      },
    ],
  },
}
if (
  scenario === 'existing' ||
  scenario.startsWith('fallback') ||
  scenario === 'silent'
) {
  await mkdir(projectDir, { recursive: true })
  await writeFile(userFile, '{}')
}
if (scenario === 'first') await mkdir(projectDir)
if (scenario === 'symlink') {
  const outside = join(project, 'target')
  await mkdir(outside)
  await writeFile(join(outside, 'actual.json'), '{}')
  await symlink(join(outside, 'actual.json'), userFile)
}
if (scenario.startsWith('managed')) await mkdir(dropDir)
resetSettingsCache()
captureHooksConfigSnapshot()
const store = createStore(getDefaultAppState(), onChangeAppState)
detector.subscribe((source, extra) => {
  notifications.push(source)
  applySettingsChange(source, store.setState, extra)
  applied++
})
// A failing listener must not prevent the real consumer or escape to an
// unhandled rejection when a filesystem event is delivered.
detector.subscribe(() => {
  throw new Error('intentional subscriber failure')
})
try {
  await detector.initialize()
  await until(() => watchers.length > 0, 'initial watcher')
  await delay(250)
  if (scenario === 'first' || scenario === 'missing') {
    if (scenario === 'missing') await mkdir(projectDir)
    await writeFile(projectFile, json(changedSettings))
    await until(
      () => notifications.includes('projectSettings'),
      'new project settings',
    )
    expect(store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE).toBe(
      'fresh',
    )
    expect(
      store.getState().toolPermissionContext.alwaysDenyRules.projectSettings,
    ).toContain('Bash(audit-command)')
    expect(getHooksConfigFromSnapshot()?.PreToolUse).toEqual(
      changedSettings.hooks.PreToolUse,
    )
    expect(process.env.CLAUDE_WATCH_AUDIT_VALUE).toBe('fresh')
    await writeFile(
      localFile,
      json({ env: { CLAUDE_WATCH_AUDIT_LOCAL: 'created' } }),
    )
    await until(
      () => notifications.includes('localSettings'),
      'new local settings',
    )
    expect(store.getState().settings.env?.CLAUDE_WATCH_AUDIT_LOCAL).toBe(
      'created',
    )
  } else if (scenario === 'existing') {
    await writeFile(userFile, json(changedSettings))
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'fresh',
      'ordinary edit',
    )
    expect(
      store.getState().toolPermissionContext.alwaysDenyRules.userSettings,
    ).toContain('Bash(audit-command)')
    expect(getHooksConfigFromSnapshot()?.PreToolUse).toEqual(
      changedSettings.hooks.PreToolUse,
    )
    await writeFile(
      userFile + '.tmp',
      json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'atomic' } }),
    )
    await rename(userFile + '.tmp', userFile)
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'atomic',
      'atomic replacement',
    )
    expect(
      store.getState().toolPermissionContext.alwaysDenyRules.userSettings ?? [],
    ).toEqual([])
    expect(getHooksConfigFromSnapshot()?.PreToolUse).toBeUndefined()
    const before = applied
    await rm(userFile)
    await delay(35)
    await writeFile(
      userFile,
      json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'recreated' } }),
    )
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'recreated',
      'delete and recreate',
    )
    expect(applied).toBeGreaterThan(before)
    await rename(userFile, userFile + '.old')
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === undefined,
      'rename away',
    )
  } else if (scenario === 'symlink') {
    const target = join(project, 'target', 'actual.json')
    await writeFile(target, json(changedSettings))
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'fresh',
      'symlink direct edit',
    )
    expect(notifications).toContain('userSettings')
    await writeFile(
      target + '.tmp',
      json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'atomic' } }),
    )
    await rename(target + '.tmp', target)
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'atomic',
      'symlink atomic save',
    )
    await rm(target)
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === undefined,
      'symlink target deletion',
    )
  } else if (scenario.startsWith('managed')) {
    await writeFile(managedFile, json(changedSettings))
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'fresh',
      'managed base creation',
    )
    expect(notifications).toContain('policySettings')
    expect(getHooksConfigFromSnapshot()?.PreToolUse).toEqual(
      changedSettings.hooks.PreToolUse,
    )
    const drop = join(dropDir, '10-audit.json')
    await writeFile(drop, json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'drop' } }))
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'drop',
      'drop-in creation',
    )
    await writeFile(
      drop + '.tmp',
      json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'saved' } }),
    )
    await rename(drop + '.tmp', drop)
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'saved',
      'drop-in atomic save',
    )
    await rm(drop)
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'fresh',
      'drop-in deletion',
    )
    await rm(managedFile)
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === undefined,
      'managed deletion',
    )
    await rm(dropDir, { recursive: true })
    // A successful global probe does not guarantee this parent's creation
    // event will arrive. Exercise that gap without changing real filesystem I/O.
    dropCreationEvents = scenario === 'managed-directory-event-loss'
    const missingStatsBefore = missingDropDirStats
    await detector.rehome()
    if (dropCreationEvents) {
      // Both target discovery and the creation watcher's immediate check must
      // have observed absence before mkdir. Do not race that one-shot rescue.
      await until(
        () => missingDropDirStats >= missingStatsBefore + 2,
        'initial absent-directory check',
      )
    }
    const firstDropIn = json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'new-dir' } })
    if (
      scenario === 'managed-ready-race' ||
      scenario === 'managed-directory-event-loss'
    ) {
      // Deterministically save after getWatchTargets has enumerated the empty
      // directory, but before chokidar can scan it with ignoreInitial enabled.
      beforeNextWatch = () => writeFileSync(drop, firstDropIn)
      await mkdir(dropDir)
      await until(() => beforeNextWatch === undefined, 'replacement watcher')
    } else {
      await mkdir(dropDir)
      await writeFile(drop, firstDropIn)
    }
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'new-dir',
      'new drop-in directory catch-up',
    )
    if (dropCreationEvents)
      expect(watchers.at(-1)!.options.usePolling).toBe(false)
  } else if (scenario.startsWith('fallback') || scenario === 'silent') {
    const original = watchers[0]!
    // Make a save while native delivery is unavailable, before polling ready.
    original.removeAllListeners('change')
    original.removeAllListeners('add')
    await writeFile(userFile, json(changedSettings))
    const code = scenario.slice('fallback-'.length)
    if (scenario === 'silent') finishProbe!()
    else
      original.emit(
        'error',
        Object.assign(new Error('injected native resource failure'), {
          code,
          syscall: 'watch',
        }),
      )
    await until(() => watchers.length > 1, 'polling replacement')
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'fresh',
      'missed native save catch-up',
    )
    expect(watchers.at(-1)!.options.usePolling).toBe(true)
    await writeFile(
      userFile,
      json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'poll' } }),
    )
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'poll',
      'polling change',
    )
    await rm(userFile)
    await delay(100)
    await writeFile(
      userFile,
      json({ env: { CLAUDE_WATCH_AUDIT_VALUE: 'poll-recreated' } }),
    )
    await until(
      () =>
        store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE ===
        'poll-recreated',
      'polling recreation',
    )
  } else if (scenario === 'mdm') {
    rawPolicy = {
      plistStdouts: [
        { stdout: json(changedSettings), label: 'isolated policy' },
      ],
      hklmStdout: null,
      hkcuStdout: null,
    }
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'fresh',
      'MDM refresh and state application',
    )
    expect(getMdmSettings().settings.env?.CLAUDE_WATCH_AUDIT_VALUE).toBe(
      'fresh',
    )
    expect(getHooksConfigFromSnapshot()?.PreToolUse).toEqual(
      changedSettings.hooks.PreToolUse,
    )
    const before = applied
    await delay(180)
    expect(applied).toBe(before)
    rawPolicy = {
      plistStdouts: [],
      hklmStdout: null,
      hkcuStdout:
        '    Settings    REG_SZ    {"env":{"CLAUDE_WATCH_AUDIT_VALUE":"hkcu"}}',
    }
    await until(
      () => getHkcuSettings().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'hkcu',
      'HKCU refresh',
    )
    await until(
      () => store.getState().settings.env?.CLAUDE_WATCH_AUDIT_VALUE === 'hkcu',
      'HKCU consumer',
    )
    let releaseRead!: (value: RawReadResult) => void
    pendingRawRead = new Promise(resolve => {
      releaseRead = resolve
    })
    const readsBefore = rawReads
    await until(() => rawReads > readsBefore, 'MDM read in flight')
    await detector.dispose()
    const count = rawReads
    releaseRead({ plistStdouts: [], hklmStdout: null, hkcuStdout: null })
    await delay(180)
    expect(rawReads).toBe(count)
    expect(getHkcuSettings().settings.env?.CLAUDE_WATCH_AUDIT_VALUE).toBe(
      'hkcu',
    )
  }
  expect(getInitialSettings()).toEqual(store.getState().settings)
  await detector.dispose()
  const count = applied
  await writeFile(userFile, '{}')
  await delay(200)
  expect(applied).toBe(count)
  console.log(json({ scenario, notifications, applied, success: true }))
} finally {
  await detector.dispose()
}
