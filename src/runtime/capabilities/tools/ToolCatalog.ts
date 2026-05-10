import type { Tool, Tools } from '../../../Tool.js'
import { getAllBaseTools as getLegacyAllBaseTools } from '../../../tools.js'
import {
  type RuntimeToolDescriptor,
  type RuntimeToolSafety,
  type RuntimeToolSource,
} from '../../contracts/tool.js'

export type RuntimeToolCatalogOptions = {
  source?: RuntimeToolSource
  describeTool?: (tool: Tool) => string
}

export function getAllBaseTools(): Tools {
  return getLegacyAllBaseTools()
}

export function getRuntimeToolDescriptors(
  tools: Tools = getAllBaseTools(),
  options: RuntimeToolCatalogOptions = {},
): readonly RuntimeToolDescriptor[] {
  return tools.map(tool => createRuntimeToolDescriptor(tool, options))
}

export function createRuntimeToolCatalog(
  tools: Tools = getAllBaseTools(),
  options: RuntimeToolCatalogOptions = {},
) {
  const descriptors = getRuntimeToolDescriptors(tools, options)
  const byName = new Map<string, RuntimeToolDescriptor>()

  for (const descriptor of descriptors) {
    byName.set(descriptor.name, descriptor)
    for (const alias of descriptor.aliases ?? []) {
      byName.set(alias, descriptor)
    }
  }

  return {
    list: () => descriptors,
    find: (name: string) => byName.get(name),
  }
}

function createRuntimeToolDescriptor(
  tool: Tool,
  options: RuntimeToolCatalogOptions,
): RuntimeToolDescriptor {
  return {
    name: tool.name,
    description: options.describeTool?.(tool) ?? tool.searchHint ?? tool.name,
    source: tool.mcpInfo ? 'mcp' : (options.source ?? 'builtin'),
    aliases: tool.aliases,
    inputSchema: tool.inputJSONSchema,
    outputSchema: undefined,
    safety: inferToolSafety(tool),
    isConcurrencySafe: safeBooleanCall(() => tool.isConcurrencySafe({})),
    isDeferred: false,
    isMcp: Boolean(tool.mcpInfo),
    isOpenWorld: false,
    requiresUserInteraction: false,
  }
}

function inferToolSafety(tool: Tool): RuntimeToolSafety {
  if (safeBooleanCall(() => tool.isDestructive?.({}) ?? false)) {
    return 'destructive'
  }
  if (safeBooleanCall(() => tool.isReadOnly({}))) {
    return 'read'
  }
  return 'write'
}

function safeBooleanCall(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return false
  }
}
