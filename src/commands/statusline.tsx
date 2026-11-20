import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js';
import { getStatuslineConfigDirDisplay } from '@claude-code/builtin-tools/tools/AgentTool/built-in/statuslineSetup.js';
import type { Command } from '../commands.js';
import { isSafeModeEnabled, safeModeDisableHint } from '../utils/safeMode.js';

export function getStatuslineAllowedTools(): string[] {
  const configDir = getStatuslineConfigDirDisplay();
  const settingsEdit = `Edit(${configDir}/settings.json)`;
  return configDir === '~/.claude'
    ? [AGENT_TOOL_NAME, 'Read(~/**)', settingsEdit]
    : [AGENT_TOOL_NAME, 'Read(~/**)', `Read(${configDir}/**)`, settingsEdit];
}

const statusline = {
  type: 'prompt',
  description: "Set up Claude Code's status line UI",
  contentLength: 0, // Dynamic content
  aliases: [],
  name: 'statusline',
  progressMessage: 'setting up statusLine',
  get allowedTools(): string[] {
    return getStatuslineAllowedTools();
  },
  source: 'builtin',
  disableNonInteractive: true,
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    if (isSafeModeEnabled()) {
      return [
        {
          type: 'text',
          text: `Tell the user: /statusline is unavailable in safe mode. The setup flow saves the status line to the user settings file, but safe mode only displays the managed (policy) status line, so the result would never render. To set up a status line, ${safeModeDisableHint()}, then run /statusline again.\n\nDo not run the statusline-setup agent and do not edit any settings files. Simply inform the user.`,
        },
      ];
    }
    const prompt = args.trim() || 'Configure my statusLine from my shell PS1 configuration';
    return [
      {
        type: 'text',
        text: `Create an ${AGENT_TOOL_NAME} with subagent_type "statusline-setup" and the prompt "${prompt}"`,
      },
    ];
  },
} satisfies Command;

export default statusline;
