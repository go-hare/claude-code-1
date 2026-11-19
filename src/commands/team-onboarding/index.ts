import type { Command } from '../../commands.js'
import {
  isShareOnboardingGuideEnabled,
  isTeamOnboardingEnabled,
  SHARE_ONBOARDING_GUIDE_TOOL_NAME,
} from './shareOnboardingGuide.js'

const teamOnboarding = {
  type: 'prompt',
  name: 'team-onboarding',
  description:
    'Help teammates ramp on Claude Code with a guide from your usage',
  allowedTools: [
    'Edit(ONBOARDING.md)',
    'Bash(ls *)',
    SHARE_ONBOARDING_GUIDE_TOOL_NAME,
  ],
  contentLength: 0,
  progressMessage: 'scanning usage data',
  isEnabled: isTeamOnboardingEnabled,
  isHidden: false,
  userFacingName() {
    return 'team-onboarding'
  },
  source: 'builtin',
  disableModelInvocation: true,
  async getPromptForCommand() {
    const sharingSuffix = isShareOnboardingGuideEnabled()
      ? `\n\n**Sharing** — call the ${SHARE_ONBOARDING_GUIDE_TOOL_NAME} tool to upload ONBOARDING.md and return a share link.`
      : ''
    return [
      {
        type: 'text',
        text: `Create or update ONBOARDING.md for your team based on local repository context and usage.${sharingSuffix}`,
      },
    ]
  },
} satisfies Command

export default teamOnboarding
