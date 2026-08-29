import {
  isClaudeInChromeInstallUpsellEligible,
  resolveClaudeInChromeSkillPrompt,
} from '../../utils/claudeInChrome/installUpsell.js'
import { isClaudeInChromeWiredThisSession } from '../../utils/claudeInChrome/sessionState.js'
import { registerBundledSkill } from '../bundledSkills.js'

/** densable Fby — allowedTools empty; prompt from ejA. */
export function registerClaudeInChromeSkill(): void {
  registerBundledSkill({
    name: 'claude-in-chrome',
    description:
      'Automates your Chrome browser to interact with web pages - clicking elements, filling forms, capturing screenshots, reading console logs, and navigating sites. Opens pages in new tabs within your existing Chrome session. Requires site-level permissions before executing (configured in the extension).',
    whenToUse:
      'When the user wants to interact with web pages, automate browser tasks, capture screenshots, read console logs, or perform any browser-based actions. Always invoke BEFORE attempting to use any mcp__claude-in-chrome__* tools.',
    allowedTools: [],
    userInvocable: true,
    isEnabled: () =>
      isClaudeInChromeWiredThisSession() ||
      isClaudeInChromeInstallUpsellEligible(),
    async getPromptForCommand(args, context) {
      let n = await resolveClaudeInChromeSkillPrompt(context)
      if (args) n += `\n## Task\n${args}`
      return [{ type: 'text', text: n }]
    },
  })
}
