/**
 * /reload-skills — Re-scan skill directories without restarting the session.
 */

import type { Command, LocalCommandResult } from '../types/command.js'

const reloadSkills = {
  type: 'local',
  name: 'reload-skills',
  description: 'Re-scan skill directories without restarting the session',
  immediate: true,
  supportsNonInteractive: false,
  load: () =>
    Promise.resolve({
      async call(): Promise<LocalCommandResult> {
        try {
          const { getSkillDirCommands } = await import(
            '../skills/loadSkillsDir.js'
          )
          // Clear cached skills and reload
          getSkillDirCommands.cache?.clear?.()
          const cwd = (await import('../bootstrap/state.js')).getOriginalCwd()
          await getSkillDirCommands(cwd)
          return {
            type: 'text',
            value: 'Skills reloaded successfully.',
          }
        } catch (e) {
          return {
            type: 'text',
            value: `Failed to reload skills: ${(e as Error).message}`,
          }
        }
      },
    }),
} satisfies Command

export default reloadSkills
