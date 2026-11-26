/**
 * Official dWt / uWt / fae (#1197) — plugin monitors resolution and auto-arming.
 *
 * Resolves `LoadedPlugin.monitors` (loaded from `monitors/monitors.json` or
 * `manifest.monitors`) and arms matching triggers (`always` or
 * `on-skill-invoke:<skill>`) with deduplication by `${pluginName}:${name}`.
 */

import type { AppState } from '../../state/AppStateStore.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'
import type { TaskRegistry } from '../taskRegistry.js'
import type { PluginMonitorConfig } from './schemas.js'

type SessionPluginMonitorsState = {
  skillInvokedListeners: Set<(skillName: string) => void>
  sessionArmedMonitorKeys: Set<string>
}

const sessionPluginMonitorsSlot =
  new RootSessionSlot<SessionPluginMonitorsState>(() => ({
    skillInvokedListeners: new Set(),
    sessionArmedMonitorKeys: new Set(),
  }))

function sessionMonitorsState(): SessionPluginMonitorsState {
  return sessionPluginMonitorsSlot.of(getBootstrapSession())
}

/**
 * Official Gne.of(P).skillInvoked.emit(skillName) — notify plugin monitor
 * listeners when a skill is invoked (via Skill tool or slash command).
 */
export function emitSkillInvoked(skillName: string): void {
  for (const listener of sessionMonitorsState().skillInvokedListeners) {
    try {
      listener(skillName)
    } catch (err) {
      logForDebugging(`skillInvoked listener failed: ${err}`, {
        level: 'error',
      })
    }
  }
}

/**
 * Official Gne.of(P).skillInvoked.subscribe(listener) — subscribe to skill
 * invocations so `on-skill-invoke:<skill>` monitors can be armed.
 */
export function subscribeSkillInvoked(
  listener: (skillName: string) => void,
): () => void {
  const listeners = sessionMonitorsState().skillInvokedListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSessionArmedMonitorKeys(): Set<string> {
  return sessionMonitorsState().sessionArmedMonitorKeys
}

export function resetSessionArmedMonitorKeysForTests(): void {
  sessionMonitorsState().sessionArmedMonitorKeys.clear()
}

export type ResolvedPluginMonitor = {
  name: string
  command: string
  description: string
  when: string
  pluginName: string
  pluginId: string
  pluginRoot: string
}

const USER_CONFIG_REF_RE = /\$\{user_config\.[^}]+\}/

/**
 * Official dWt — resolve a single plugin monitor's command with plugin vars.
 * Rejects `${user_config.*}` references because monitor commands are passed
 * to a shell.
 */
export function resolvePluginMonitor(
  monitor: PluginMonitorConfig,
  plugin: Pick<LoadedPlugin, 'name' | 'source' | 'path'>,
  projectDir?: string,
  pluginDataDir?: string,
): ResolvedPluginMonitor {
  if (USER_CONFIG_REF_RE.test(monitor.command)) {
    throw new Error(
      `Monitor "${monitor.name}" in plugin "${plugin.name}" references \${user_config.*} in its command. The substituted value would be passed to a shell. Monitor commands cannot safely reference \${user_config.*}; have the monitor script read the value from a config file or prompt instead.`,
    )
  }

  let command = monitor.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', plugin.path)
  if (pluginDataDir !== undefined) {
    command = command.replaceAll('${CLAUDE_PLUGIN_DATA}', pluginDataDir)
  }
  if (projectDir !== undefined) {
    command = command.replaceAll('${CLAUDE_PROJECT_DIR}', projectDir)
  }

  return {
    name: monitor.name,
    command,
    description: monitor.description,
    when: monitor.when ?? 'always',
    pluginName: plugin.name,
    pluginId: plugin.source,
    pluginRoot: plugin.path,
  }
}

/**
 * Official uWt — resolve all monitors declared across enabled plugins.
 * Logs and skips individual monitors that fail resolution (e.g. `${user_config.*}`).
 */
export function resolvePluginMonitors(
  plugins: readonly Pick<
    LoadedPlugin,
    'name' | 'source' | 'path' | 'monitors'
  >[],
  projectDir?: string,
  getPluginDataDir?: (pluginId: string) => string | undefined,
): ResolvedPluginMonitor[] {
  const resolved: ResolvedPluginMonitor[] = []
  for (const plugin of plugins) {
    if (!plugin.monitors) continue
    for (const monitor of plugin.monitors) {
      try {
        resolved.push(
          resolvePluginMonitor(
            monitor,
            plugin,
            projectDir,
            getPluginDataDir?.(plugin.source),
          ),
        )
      } catch (err) {
        logForDebugging(
          `plugin ${plugin.name}: failed to resolve monitor "${monitor.name}": ${err}`,
          { level: 'error' },
        )
      }
    }
  }
  return resolved
}

export type ArmMonitorFn = (
  monitor: ResolvedPluginMonitor,
) => Promise<string | undefined>

/**
 * Official fae — arm plugin monitors matching `predicate` (e.g. `m => m.when === 'always'`
 * or `m => m.when === \`on-skill-invoke:${skillName}\``), deduping via `armedKeys`.
 * Deletes the key if arming returns `undefined` or throws so a later trigger can retry.
 */
export async function armPluginMonitors(
  plugins: readonly Pick<
    LoadedPlugin,
    'name' | 'source' | 'path' | 'monitors'
  >[],
  predicate: (monitor: ResolvedPluginMonitor) => boolean,
  arm: ArmMonitorFn,
  armedKeys: Set<string> = new Set(),
  projectDir?: string,
  getPluginDataDir?: (pluginId: string) => string | undefined,
): Promise<string[]> {
  const armedIds: string[] = []
  for (const monitor of resolvePluginMonitors(
    plugins,
    projectDir,
    getPluginDataDir,
  )) {
    if (!predicate(monitor)) continue
    const key = `${monitor.pluginName}:${monitor.name}`
    if (armedKeys.has(key)) continue
    armedKeys.add(key)
    try {
      const taskId = await arm(monitor)
      if (taskId === undefined) {
        armedKeys.delete(key)
      } else {
        armedIds.push(taskId)
      }
    } catch (err) {
      armedKeys.delete(key)
      logForDebugging(`plugin monitor ${key}: failed to arm: ${err}`, {
        level: 'error',
      })
    }
  }
  return armedIds
}

export type PluginMonitorSpawnContext = {
  abortController: AbortController
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
  taskRegistry?: TaskRegistry
}

/**
 * Official mWt (#1197) — spawn a single resolved plugin monitor as a persistent
 * background shell task with `kind: 'monitor'`, piping stdout into a stream pump.
 */
export async function spawnPluginMonitor(
  monitor: ResolvedPluginMonitor,
  ctx: PluginMonitorSpawnContext,
): Promise<string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { exec } = require('../Shell.js') as typeof import('../Shell.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMonitorStreamPump } =
    require('../monitorStreamNotify.js') as typeof import('../monitorStreamNotify.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnShellTask } =
    require('../../tasks/LocalShellTask/LocalShellTask.js') as typeof import('../../tasks/LocalShellTask/LocalShellTask.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { killTask } =
    require('../../tasks/LocalShellTask/killShellTasks.js') as typeof import('../../tasks/LocalShellTask/killShellTasks.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createTaskRegistry } =
    require('../taskRegistry.js') as typeof import('../taskRegistry.js')

  const registry =
    ctx.taskRegistry ?? createTaskRegistry(ctx.getAppState, ctx.setAppState)
  const taskRef: { id?: string } = {}
  const pump = createMonitorStreamPump({
    description: monitor.description,
    taskRef,
    killTask: () => {
      const id = taskRef.id
      if (!id) return false
      killTask(id, registry)
      return true
    },
  })

  const shellCommand = await exec(
    monitor.command,
    ctx.abortController.signal,
    'bash',
    {
      preventCwdChanges: true,
      shouldUseSandbox: false,
      onStdout: pump.onData,
      useToolMemoryCgroup: true,
    },
  )

  if (shellCommand.status === 'completed') {
    const completed = await shellCommand.result
    shellCommand.cleanup()
    pump.dropAndClose()
    if (completed.preSpawnError) {
      throw new Error(completed.preSpawnError)
    }
    return undefined
  }
  if (shellCommand.status === 'killed') {
    await shellCommand.result
    shellCommand.cleanup()
    pump.dropAndClose()
    return undefined
  }

  const handle = await spawnShellTask(
    {
      command: monitor.command,
      description: monitor.description,
      shellCommand,
      toolUseId: undefined,
      agentId: undefined,
      kind: 'monitor',
    },
    {
      abortController: ctx.abortController,
      getAppState: ctx.getAppState,
      setAppState: ctx.setAppState,
    },
  )
  taskRef.id = handle.taskId

  void shellCommand.result.then(async () => {
    try {
      await pump.reportExit(handle)
    } catch {
      // best-effort
    }
  })

  return handle.taskId
}
