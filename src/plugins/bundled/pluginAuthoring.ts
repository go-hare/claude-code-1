/**
 * densable 2.1.289 `cc-plugin-plugin-authoring` — yfe + uS({skills:[f]}).
 * Skill BODY stays goldOfficialMissingSkills; this is the /plugin listing.
 */
import { leftoverHooksModulesOn } from '../../utils/plugins/pluginDevMods.js'
import { createPluginAuthoringSkill } from '../../skills/bundled/goldOfficialMissingSkills.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const PLUGIN_AUTHORING_PLUGIN_NAME = 'cc-plugin-plugin-authoring'
export const PLUGIN_AUTHORING_PLUGIN_DESCRIPTION =
  'Plugin authoring: Claude knows how a plugin of function hooks is written, typed and debugged against this build'

export function isPluginAuthoringPluginAvailable(): boolean {
  return leftoverHooksModulesOn()
}

export function registerPluginAuthoringBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: PLUGIN_AUTHORING_PLUGIN_NAME,
    description: PLUGIN_AUTHORING_PLUGIN_DESCRIPTION,
    // gold uS omits defaultEnabled → PZ ?? true
    isAvailable: isPluginAuthoringPluginAvailable,
    skills: [createPluginAuthoringSkill()],
  })
}
