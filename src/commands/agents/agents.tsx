import type { LocalCommandResult } from '../../types/command.js';

/**
 * densable 2.1.289 `/agents` — wizard removed; local text stub.
 * Gold `Pcr` posts this copy; host is `Mcr` (`type:"local"`, hidden).
 */
export async function call(): Promise<LocalCommandResult> {
  return {
    type: 'text',
    value: `The /agents wizard has been removed.

Ask Claude to create or update subagents for you (e.g. "create a code-reviewer subagent that ..."),
or edit the files directly:
  • .claude/agents/       (this project)
  • ~/.claude/agents/     (all projects)

Docs: ${'https://code.claude.com/docs/en/sub-agents'}`,
  };
}
