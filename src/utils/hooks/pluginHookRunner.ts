/**
 * densable 2.1.289 Jve — `R().pluginHookRunner`.
 *
 * Gold TVt remaps hook tool_name via `Jve()?.ownTool`. No runner → TVt
 * returns undefined (no-op). Do not invent ownTool mapping.
 */
import type { Tool } from '../../Tool.js'

export type PluginHookRunner = {
  ownTool?: (toolName: string) => Tool | undefined
  holds?: (pluginId: string) => boolean
}

let pluginHookRunner: PluginHookRunner | undefined

/** densable Jve */
export function getPluginHookRunner(): PluginHookRunner | undefined {
  return pluginHookRunner
}

export function setPluginHookRunner(
  runner: PluginHookRunner | undefined,
): void {
  pluginHookRunner = runner
}
