import { join } from 'path'
import { getPinnedFeatureValue } from '../../services/analytics/growthbook.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { USER_CONFIG } from '../../../vendor/claude-code-mods/mods/agents-md/hooks/register.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const AGENTS_MD_PLUGIN_NAME = 'cc-plugin-agents-md'
export const AGENTS_MD_PLUGIN_DESCRIPTION =
  'AGENTS.md as project instructions: by default loaded where the project has no CLAUDE.md; by its instructionFiles option, loaded beside CLAUDE.md, left out, or with the project instructions dropped'

export function isAgentsMdPluginAvailable(): boolean {
  return getPinnedFeatureValue('tengu_agents_md_mod', true)
}

export function registerAgentsMdBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: AGENTS_MD_PLUGIN_NAME,
    description: AGENTS_MD_PLUGIN_DESCRIPTION,
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
    hooksModule: leftoverFu(
      join(import.meta.dir, '../../../vendor/claude-code-mods/mods/agents-md'),
      {
        register: (...args: unknown[]) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/agents-md/hooks/register.ts') as {
              register?: (...inner: unknown[]) => unknown
            }
          return mod.register?.(...args)
        },
      },
      () => ({
        scan: {
          hooks: [
            'session.start',
            'prompt.context',
            'command.run',
            'session.compact',
            'prompt.submit',
            'turn.start',
            'turn.complete',
            'agent.spawn',
            'tool.call',
            'prompt.mention',
          ],
          calls: [
            'env.get',
            'fs.ancestors',
            'session.cwd',
            'session.id',
            'session.root',
            'store.get',
            'store.set',
            'telemetry.log',
            'telemetry.mark',
            'ui.log',
          ],
          env: {
            reads: [
              'CLAUDE_CODE_AGENTS_MD_ROWS_EVERY_PROCESS',
              'CLAUDE_CODE_DISABLE_ATTACHMENTS',
              'CLAUDE_CODE_SIMPLE',
              'HOME',
              'USERPROFILE',
            ],
            writes: [],
          },
        },
        files: {},
      }),
    ),
  })
}
