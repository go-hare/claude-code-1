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

const FORBIDDEN_FRONTMATTER_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function cloneFrontmatterValue(
  value: unknown,
  seen: Map<object, unknown>,
  omittedKeys: Set<string>,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  if (typeof value !== 'object') {
    return null
  }
  if (seen.has(value)) {
    return seen.get(value) ?? null
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return null
  }
  seen.set(value, undefined)
  if (Array.isArray(value)) {
    const arr = value.map(item =>
      cloneFrontmatterValue(item, seen, omittedKeys),
    )
    seen.set(value, arr)
    return arr
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) {
      if (key !== '__proto__') {
        omittedKeys.add(key)
      }
      continue
    }
    out[key] = cloneFrontmatterValue(value[key], seen, omittedKeys)
  }
  seen.set(value, out)
  return out
}

export type SkillPromptCommandMeta = {
  type?: string
  source?: string
  loadedFrom?: string
  pluginInfo?: {
    pluginManifest?: {
      name?: string
    }
  }
  skillFile?: {
    path?: string
    frontmatterAsWritten?: unknown
    frontmatterProblem?: string
  }
}

function resolveSkillSource(command: SkillPromptCommandMeta): string {
  if (command.type !== 'prompt') {
    return 'plugin'
  }
  if (command.loadedFrom === 'syncedSkills') {
    return 'syncedSkills'
  }
  switch (command.source) {
    case 'builtin':
    case 'bundled':
    case undefined:
      return 'built-in'
    default:
      return command.source
  }
}

function buildSkillOriginFields(command?: SkillPromptCommandMeta): {
  source: string
  pluginName?: string
  path?: string
} {
  const promptCmd = command?.type === 'prompt' ? command : undefined
  const pluginName = promptCmd?.pluginInfo?.pluginManifest?.name
  const filePath = promptCmd?.skillFile?.path
  return {
    source: command === undefined ? 'built-in' : resolveSkillSource(command),
    ...(pluginName !== undefined && { pluginName }),
    ...(filePath !== undefined && { path: filePath }),
  }
}

function buildSkillFrontmatterFields(command?: SkillPromptCommandMeta): {
  frontmatter: Record<string, unknown>
  frontmatterProblem?: string
} {
  const skillFile = command?.type === 'prompt' ? command.skillFile : undefined
  if (skillFile === undefined) {
    return { frontmatter: {} }
  }
  let problem = skillFile.frontmatterProblem
  if (problem === undefined) {
    try {
      const omittedKeys = new Set<string>()
      const cloned = cloneFrontmatterValue(
        skillFile.frontmatterAsWritten,
        new Map(),
        omittedKeys,
      )
      if (isPlainObject(cloned)) {
        if (omittedKeys.size === 0) {
          return { frontmatter: cloned }
        }
        const omittedList = [...omittedKeys]
          .sort()
          .map(k => `a key ${k}`)
          .join(' and ')
        return {
          frontmatter: cloned,
          frontmatterProblem: `left out ${omittedList}`,
        }
      }
      problem = 'is no table'
    } catch (err) {
      problem = `could not be copied (${err instanceof Error ? err.message : String(err)})`
    }
  }
  return { frontmatter: {}, frontmatterProblem: problem }
}

/**
 * densable `KVn(e, n, r)`. No `skill.prompt` hook → copy. Same text → copy.
 * Changed text replaces every text block with one rewritten text block.
 */
export async function applySkillPromptFunctionHook(
  skillName: string,
  blocks: ContentBlockParam[],
  command?: SkillPromptCommandMeta,
): Promise<ContentBlockParam[]> {
  const { hasMatchingFunctionHook, runFunctionHookChain } = await import(
    '../plugins/functionHooksModules.js'
  )
  if (!hasMatchingFunctionHook('skill.prompt', { skill: skillName })) {
    return [...blocks]
  }
  const text = joinPromptText(blocks)
  const payload = {
    skill: skillName,
    text,
    ...buildSkillFrontmatterFields(command),
    ...buildSkillOriginFields(command),
  }
  const result = await runFunctionHookChain(
    'skill.prompt',
    payload,
    async nextEvent => nextEvent,
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

/** Call-site wrap of gold `KVn(e.name, await e.getPromptForCommand(...), e)`. */
export async function getSkillPromptBlocks(
  command: SkillPromptCommandMeta & {
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
  return applySkillPromptFunctionHook(command.name, blocks, command)
}
