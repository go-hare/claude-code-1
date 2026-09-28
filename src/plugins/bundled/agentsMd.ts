import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { USER_CONFIG } from '../../../vendor/claude-code-mods/mods/agents-md/hooks/register.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const AGENTS_MD_PLUGIN_NAME = 'agents-md'
export const AGENTS_MD_PLUGIN_DESCRIPTION =
  'AGENTS.md as project instructions: by default loaded where the project has no CLAUDE.md; by its instructionFiles option, loaded beside CLAUDE.md, left out, or with the project instructions dropped'

export function isAgentsMdPluginAvailable(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_agents_md_mod', true)
}

export function registerAgentsMdBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: AGENTS_MD_PLUGIN_NAME,
    description: AGENTS_MD_PLUGIN_DESCRIPTION,
    defaultEnabled: true,
    isAvailable: isAgentsMdPluginAvailable,
    userConfig: {
      instructionFiles: {
        type: 'string',
        title: USER_CONFIG.instructionFiles.title,
        description: USER_CONFIG.instructionFiles.description,
        required: USER_CONFIG.instructionFiles.required,
        default: USER_CONFIG.instructionFiles.default,
        options: [...USER_CONFIG.instructionFiles.options],
      },
    },
  })
}
