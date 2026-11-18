/**
 * /reload-skills — Re-scan skill directories without restarting the session.
 */

import type { Command, LocalCommandResult } from '../types/command.js'

function formatReloadDiff(added: number, removed: number): string {
  const parts = [
    ...(added > 0 ? [`${added} added`] : []),
    ...(removed > 0 ? [`${removed} removed`] : []),
  ]
  return parts.length > 0 ? parts.join(', ') : 'none added or removed'
}

const reloadSkills = {
  type: 'local',
  name: 'reload-skills',
  description: 'Pick up skills added or changed on disk during this session',
  immediate: true,
  supportsNonInteractive: false,
  load: () =>
    Promise.resolve({
      async call(): Promise<LocalCommandResult> {
        try {
          const { getSkillDirCommands } = await import(
            '../skills/loadSkillsDir.js'
          )
          const { clearCommandsCache } = await import('../commands.js')
          const cwd = (await import('../bootstrap/state.js')).getOriginalCwd()
          const before = await getSkillDirCommands(cwd)
          const beforeNames = new Set(before.map(s => s.name))
          // Clear cached skills and reload without resetSentSkillNames() so only
          // new or changed skills are sent on the next turn (2.1.304 #1016).
          clearCommandsCache()
          getSkillDirCommands.cache?.clear?.()
          const after = await getSkillDirCommands(cwd)
          const afterNames = new Set(after.map(s => s.name))
          const added = after.filter(s => !beforeNames.has(s.name)).length
          const removed = before.filter(s => !afterNames.has(s.name)).length
          const diff = formatReloadDiff(added, removed)
          return {
            type: 'text',
            value: `Reloaded skills: ${after.length} ${after.length === 1 ? 'skill' : 'skills'} available (${diff}).`,
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
