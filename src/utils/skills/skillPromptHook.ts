/**
 * densable 2.1.289 `KVn` — `skill.prompt` function-hook rewrite of
 * getPromptForCommand blocks. Never export minify KVn.
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ToolUseContext } from '../../Tool.js'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function joinPromptText(blocks: ContentBlockParam[]): string {
  return blocks
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

/**
 * densable `KVn(e, n)`. No `skill.prompt` hook → copy. Same text → copy.
 * Changed text replaces every text block with one rewritten text block.
 */
export async function applySkillPromptFunctionHook(
  skillName: string,
  blocks: ContentBlockParam[],
): Promise<ContentBlockParam[]> {
  const { hasMatchingFunctionHook, runFunctionHookChain } = await import(
    '../plugins/functionHooksModules.js'
  )
  if (!hasMatchingFunctionHook('skill.prompt', { skill: skillName })) {
    return [...blocks]
  }
  const text = joinPromptText(blocks)
  const result = await runFunctionHookChain(
    'skill.prompt',
    { skill: skillName, text },
    async () => ({ skill: skillName, text }),
  )
  const nextText = asRecord(result)?.text
  if (typeof nextText !== 'string' || nextText === text) {
    return [...blocks]
  }
  return [
    { type: 'text', text: nextText },
    ...blocks.filter(block => block.type !== 'text'),
  ]
}

/** Call-site wrap of gold `KVn(e.name, await e.getPromptForCommand(...))`. */
export async function getSkillPromptBlocks(
  command: {
    name: string
    getPromptForCommand(
      args: string,
      context: ToolUseContext,
    ): Promise<ContentBlockParam[]>
  },
  args: string,
  context: ToolUseContext,
): Promise<ContentBlockParam[]> {
  const blocks = await command.getPromptForCommand(args, context)
  return applySkillPromptFunctionHook(command.name, blocks)
}
