/**
 * densable 2.1.289 Jve — `R().pluginHookRunner`.
 *
 * Gold TVt remaps hook tool_name via `Jve()?.ownTool`. No runner → TVt
 * returns undefined (no-op). Do not invent ownTool mapping.
 */
import type { Tool } from '../../Tool.js'
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'

export type PluginHookRunner = {
  ownTool?: (toolName: string) => Tool | undefined
  holds?: (pluginId: string) => boolean
}

const sessionPluginHookRunnerSlot = new RootSessionSlot<{
  pluginHookRunner: PluginHookRunner | undefined
}>(() => ({
  pluginHookRunner: undefined,
}))

/** densable Jve */
export function getPluginHookRunner(): PluginHookRunner | undefined {
  return sessionPluginHookRunnerSlot.of(getBootstrapSession()).pluginHookRunner
}

export function setPluginHookRunner(
  runner: PluginHookRunner | undefined,
): void {
  sessionPluginHookRunnerSlot.of(getBootstrapSession()).pluginHookRunner =
    runner
}
