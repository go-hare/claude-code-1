import { useEffect } from 'react'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from 'src/state/AppState.js'
import { getProjectRoot } from 'src/bootstrap/state.js'
import {
  armPluginMonitors,
  getSessionArmedMonitorKeys,
  spawnPluginMonitor,
  subscribeSkillInvoked,
} from 'src/utils/plugins/pluginMonitors.js'

/**
 * Official gae({ enabled }) (#1197) — arm plugin monitors on session start /
 * plugin reload (`when === 'always'`) and on skill invocation
 * (`when === 'on-skill-invoke:<skill>'`).
 */
export function usePluginMonitors({ enabled }: { enabled: boolean }): void {
  const store = useAppStateStore()
  const setAppState = useSetAppState()
  const enabledPlugins = useAppState(s => s.plugins.enabled)

  useEffect(() => {
    if (!enabled) return

    const armedKeys = getSessionArmedMonitorKeys()
    const projectDir = (() => {
      try {
        return getProjectRoot()
      } catch {
        return undefined
      }
    })()

    const armFor = (
      plugins: typeof enabledPlugins,
      predicate: Parameters<typeof armPluginMonitors>[1],
    ) => {
      const abortController = new AbortController()
      void armPluginMonitors(
        plugins,
        predicate,
        monitor =>
          spawnPluginMonitor(monitor, {
            abortController,
            getAppState: () => store.getState(),
            setAppState,
          }),
        armedKeys,
        projectDir,
      )
    }

    armFor(enabledPlugins, m => m.when === 'always')

    return subscribeSkillInvoked(skillName => {
      armFor(
        store.getState().plugins.enabled,
        m => m.when === `on-skill-invoke:${skillName}`,
      )
    })
  }, [enabled, enabledPlugins, store, setAppState])
}
