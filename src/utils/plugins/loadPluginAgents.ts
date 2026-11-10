import memoize from 'lodash-es/memoize.js'
import { basename, join } from 'path'
import { isAutoMemoryEnabled } from '../../memdir/paths.js'
import {
  externalBuiltinNamespaceName,
  getBuiltinPluginDefinition,
} from '../../plugins/builtinPlugins.js'
import type { AgentColorName } from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import {
  type AgentMemoryScope,
  loadAgentMemoryPrompt,
} from '@claude-code/builtin-tools/tools/AgentTool/agentMemory.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { EFFORT_LEVELS, parseEffortValue } from '../effort.js'
import {
  coerceDescriptionToString,
  parseFrontmatter,
  parsePositiveIntFromFrontmatter,
} from '../frontmatterParser.js'
import { validateAgentMarkdownName } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { parseAgentFrontmatterCacheTtl } from '../promptCacheTtl.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'
import {
  parseAgentToolsFromFrontmatter,
  parseSlashCommandToolsFromFrontmatter,
} from '../markdownConfigLoader.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'
import {
  loadPluginOptions,
  substitutePluginVariables,
  substituteUserConfigInContent,
} from './pluginOptionsStorage.js'
import type { PluginManifest } from './schemas.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'

const VALID_MEMORY_SCOPES: AgentMemoryScope[] = ['user', 'project', 'local']
/** densable C5r */
const BUILTIN_PLUGIN_AGENTS_DIR = 'agents'
/** densable wIt — 1 MiB plugin-agent file cap */
const PLUGIN_AGENT_MAX_BYTES = 1048576

type BuiltinPluginAgentFile = {
  filePath: string
  namespace: string[]
  text: string
}

/** densable SIt — ALL keys under agents/, not .md-only */
function listBuiltinPluginAgentFiles(
  pluginName: string,
  files: Readonly<Record<string, string>>,
): BuiltinPluginAgentFile[] {
  return Object.entries(files)
    .filter(([relPath]) => relPath.startsWith(`${BUILTIN_PLUGIN_AGENTS_DIR}/`))
    .map(([relPath, text]) => ({
      filePath: `builtin:${pluginName}/${relPath}`,
      namespace: relPath.split('/').slice(1, -1),
      text,
    }))
}

/** densable Kgo */
function builtinPluginAgentsSource(
  pluginName: string,
): { folder: string } | { files: BuiltinPluginAgentFile[] } | undefined {
  const hooks = getBuiltinPluginDefinition(pluginName)?.hooksModule
  if (hooks !== undefined && 'folder' in hooks) {
    return { folder: join(hooks.folder, BUILTIN_PLUGIN_AGENTS_DIR) }
  }
  if (hooks !== undefined && 'files' in hooks) {
    return { files: listBuiltinPluginAgentFiles(pluginName, hooks.files) }
  }
  return undefined
}

/** densable pO — skip non-regular / oversize files */
async function readPluginAgentFileLimited(
  fs: ReturnType<typeof getFsImplementation>,
  filePath: string,
): Promise<string | null> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile() || stats.size > PLUGIN_AGENT_MAX_BYTES) {
    return null
  }
  return fs.readFile(filePath, { encoding: 'utf-8' })
}

/** densable ADe */
async function loadAgentsFromDirectory(
  agentsPath: string,
  pluginName: string,
  sourceName: string,
  pluginPath: string,
  pluginManifest: PluginManifest,
  loadedPaths: Set<string>,
  isRootOptional = false,
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = []
  await walkPluginMarkdown(
    agentsPath,
    async (fullPath, namespace) => {
      const agent = await loadAgentFromFile(
        fullPath,
        pluginName,
        namespace,
        sourceName,
        pluginPath,
        pluginManifest,
        loadedPaths,
      )
      if (agent) agents.push(agent)
    },
    { logLabel: 'agents', isRootOptional },
  )
  return agents
}

function parsePluginAgentMarkdown(params: {
  filePath: string
  content: string
  pluginName: string
  namespace: string[]
  sourceName: string
  pluginPath: string
  pluginManifest: PluginManifest
}): AgentDefinition | null {
  const {
    filePath,
    content,
    pluginName,
    namespace,
    sourceName,
    pluginPath,
    pluginManifest,
  } = params
  const { frontmatter, content: markdownContent } = parseFrontmatter(
    content,
    filePath,
  )

  const baseAgentName =
    (frontmatter.name as string) || basename(filePath).replace(/\.md$/, '')

  // densable 2.1.218: bare agent name (before plugin namespacing) rejects ":" / leading "-"
  if (typeof baseAgentName === 'string') {
    const nameCheck = validateAgentMarkdownName(baseAgentName)
    if (!nameCheck.ok) {
      logForDebugging(
        `Plugin agent file ${filePath} has invalid name '${baseAgentName}': ${nameCheck.error.replace(/^Invalid "name": /, '')}`,
      )
      return null
    }
  }

  // Apply namespace prefixing like we do for commands
  const nameParts = [pluginName, ...namespace, baseAgentName]
  const agentType = nameParts.join(':')

  // Parse agent metadata from frontmatter
  const whenToUse =
    coerceDescriptionToString(frontmatter.description, agentType) ??
    coerceDescriptionToString(frontmatter.when_to_use, agentType) ??
    coerceDescriptionToString(frontmatter['when-to-use'], agentType) ??
    `Agent from ${pluginName} plugin`

  let tools = parseAgentToolsFromFrontmatter(frontmatter.tools)
  const skills = parseSlashCommandToolsFromFrontmatter(frontmatter.skills)
  const color = frontmatter.color as AgentColorName | undefined
  const modelRaw = frontmatter.model
  let model: string | undefined
  if (typeof modelRaw === 'string' && modelRaw.trim().length > 0) {
    const trimmed = modelRaw.trim()
    model = trimmed.toLowerCase() === 'inherit' ? 'inherit' : trimmed
  }
  const backgroundRaw = frontmatter.background
  const background =
    backgroundRaw === 'true' || backgroundRaw === true ? true : undefined
  // densable He: omitClaudeMd === "true" || === true
  const omitClaudeMdRaw = frontmatter.omitClaudeMd
  const omitClaudeMd =
    omitClaudeMdRaw === 'true' || omitClaudeMdRaw === true ? true : undefined
  // Substitute ${CLAUDE_PLUGIN_ROOT} so agents can reference bundled files,
  // and ${user_config.X} (non-sensitive only) so they can embed configured
  // usernames, endpoints, etc. Sensitive refs resolve to a placeholder.
  let systemPrompt = substitutePluginVariables(markdownContent.trim(), {
    path: pluginPath,
    source: sourceName,
  })
  if (pluginManifest.userConfig) {
    systemPrompt = substituteUserConfigInContent(
      systemPrompt,
      loadPluginOptions(sourceName),
      pluginManifest.userConfig,
    )
  }

  // Parse memory scope
  const memoryRaw = frontmatter.memory as string | undefined
  let memory: AgentMemoryScope | undefined
  if (memoryRaw !== undefined) {
    if (VALID_MEMORY_SCOPES.includes(memoryRaw as AgentMemoryScope)) {
      memory = memoryRaw as AgentMemoryScope
    } else {
      logForDebugging(
        `Plugin agent file ${filePath} has invalid memory value '${memoryRaw}'. Valid options: ${VALID_MEMORY_SCOPES.join(', ')}`,
      )
    }
  }

  // Parse isolation mode
  const isolationRaw = frontmatter.isolation as string | undefined
  const isolation =
    isolationRaw === 'worktree' ? ('worktree' as const) : undefined

  // Parse effort (string level or integer)
  const effortRaw = frontmatter.effort
  const effort =
    effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
  if (effortRaw !== undefined && effort === undefined) {
    logForDebugging(
      `Plugin agent file ${filePath} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
    )
  }

  // permissionMode, hooks, and mcpServers are intentionally NOT parsed for
  // plugin agents. Plugins are third-party marketplace code; these fields
  // escalate what the agent can do beyond what the user approved at install
  // time. For this level of control, define the agent in .claude/agents/
  // where the user explicitly wrote the frontmatter. (Note: plugins can
  // still ship hooks and MCP servers at the manifest level — that's the
  // install-time trust boundary. Per-agent declarations would let a single
  // agent file buried in agents/ silently add them.) See PR #22558 review.
  for (const field of ['permissionMode', 'hooks', 'mcpServers'] as const) {
    if (frontmatter[field] !== undefined) {
      logForDebugging(
        `Plugin agent file ${filePath} sets ${field}, which is ignored for plugin agents. Use .claude/agents/ for this level of control.`,
        { level: 'warn' },
      )
    }
  }

  // Parse maxTurns
  const maxTurnsRaw = frontmatter.maxTurns
  const maxTurns = parsePositiveIntFromFrontmatter(maxTurnsRaw)
  if (maxTurnsRaw !== undefined && maxTurns === undefined) {
    logForDebugging(
      `Plugin agent file ${filePath} has invalid maxTurns '${maxTurnsRaw}'. Must be a positive integer.`,
    )
  }

  // densable 2.1.248 #2 mUt — experimental.cacheTtl ("5m" | "1h")
  const cacheTtl = parseAgentFrontmatterCacheTtl(frontmatter)

  // Parse disallowedTools
  const disallowedTools =
    frontmatter.disallowedTools !== undefined
      ? parseAgentToolsFromFrontmatter(frontmatter.disallowedTools)
      : undefined

  // If memory is enabled, inject Write/Edit/Read tools for memory access
  if (isAutoMemoryEnabled() && memory && tools !== undefined) {
    const toolSet = new Set(tools)
    for (const tool of [
      FILE_WRITE_TOOL_NAME,
      FILE_EDIT_TOOL_NAME,
      FILE_READ_TOOL_NAME,
    ]) {
      if (!toolSet.has(tool)) {
        tools = [...tools, tool]
      }
    }
  }

  return {
    agentType,
    whenToUse,
    tools,
    ...(disallowedTools !== undefined ? { disallowedTools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    getSystemPrompt: () => {
      if (isAutoMemoryEnabled() && memory) {
        const memoryPrompt = loadAgentMemoryPrompt(agentType, memory)
        return systemPrompt + '\n\n' + memoryPrompt
      }
      return systemPrompt
    },
    source: 'plugin' as const,
    color,
    model,
    filename: baseAgentName,
    plugin: sourceName,
    ...(background ? { background } : {}),
    ...(omitClaudeMd ? { omitClaudeMd } : {}),
    ...(memory ? { memory } : {}),
    ...(isolation ? { isolation } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(cacheTtl !== undefined ? { cacheTtl } : {}),
  } as AgentDefinition
}

async function loadAgentFromFile(
  filePath: string,
  pluginName: string,
  namespace: string[],
  sourceName: string,
  pluginPath: string,
  pluginManifest: PluginManifest,
  loadedPaths: Set<string>,
): Promise<AgentDefinition | null> {
  const fs = getFsImplementation()
  if (isDuplicatePath(fs, filePath, loadedPaths)) {
    return null
  }
  try {
    // densable EIt / pO(wIt)
    const content = await readPluginAgentFileLimited(fs, filePath)
    if (content === null) {
      logForDebugging(
        `Skipping plugin agent ${filePath}: not a regular file or exceeds ${PLUGIN_AGENT_MAX_BYTES} byte limit`,
        { level: 'warn' },
      )
      return null
    }
    return parsePluginAgentMarkdown({
      filePath,
      content,
      pluginName,
      namespace,
      sourceName,
      pluginPath,
      pluginManifest,
    })
  } catch (error) {
    logForDebugging(`Failed to load agent from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}

async function loadBuiltinPluginAgents(
  plugin: {
    name: string
    source: string
    path: string
    manifest: PluginManifest
  },
  loadedPaths: Set<string>,
): Promise<AgentDefinition[]> {
  const source = builtinPluginAgentsSource(plugin.name)
  if (source === undefined) return []
  const prefixName = externalBuiltinNamespaceName(plugin.name, plugin.source)
  if ('folder' in source) {
    // densable TIt → ADe(..., isRootOptional: true); missing agents/ is OK
    return loadAgentsFromDirectory(
      source.folder,
      prefixName,
      plugin.source,
      plugin.path,
      plugin.manifest,
      loadedPaths,
      true,
    )
  }
  const loaded = await Promise.all(
    source.files.map(async file => {
      try {
        return parsePluginAgentMarkdown({
          filePath: file.filePath,
          content: file.text,
          pluginName: prefixName,
          namespace: file.namespace,
          sourceName: plugin.source,
          pluginPath: plugin.path,
          pluginManifest: plugin.manifest,
        })
      } catch (error) {
        logForDebugging(
          `Failed to load agent from ${file.filePath}: ${error}`,
          { level: 'error' },
        )
        return null
      }
    }),
  )
  return loaded.filter(agent => agent !== null)
}

export const loadPluginAgents = memoize(
  async (): Promise<AgentDefinition[]> => {
    // Only load agents from enabled plugins
    const { enabled, errors } = await loadAllPluginsCacheOnly()

    if (errors.length > 0) {
      logForDebugging(
        `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
      )
    }

    // Process plugins in parallel; each plugin has its own loadedPaths scope
    let loadFailure: string | null = null
    const perPluginAgents = await Promise.all(
      enabled.map(async (plugin): Promise<AgentDefinition[]> => {
        // Track loaded file paths to prevent duplicates within this plugin
        const loadedPaths = new Set<string>()
        const pluginAgents: AgentDefinition[] = []

        // Load agents from default agents directory
        if (plugin.agentsPath) {
          try {
            const agents = await loadAgentsFromDirectory(
              plugin.agentsPath,
              plugin.name,
              plugin.source,
              plugin.path,
              plugin.manifest,
              loadedPaths,
            )
            pluginAgents.push(...agents)

            if (agents.length > 0) {
              logForDebugging(
                `Loaded ${agents.length} agents from plugin ${plugin.name} default directory`,
              )
            }
          } catch (error) {
            loadFailure = 'plugin_load_agents_dir_failed'
            logForDebugging(
              `Failed to load agents from plugin ${plugin.name} default directory: ${error}`,
              { level: 'error' },
            )
          }
        }

        // Load agents from additional paths specified in manifest
        if (plugin.agentsPaths) {
          // Process all agentsPaths in parallel. isDuplicatePath is synchronous
          // (check-and-add), so concurrent access to loadedPaths is safe.
          const pathResults = await Promise.all(
            plugin.agentsPaths.map(
              async (agentPath): Promise<AgentDefinition[]> => {
                try {
                  const fs = getFsImplementation()
                  const stats = await fs.stat(agentPath)

                  if (stats.isDirectory()) {
                    // Load all .md files from directory
                    const agents = await loadAgentsFromDirectory(
                      agentPath,
                      plugin.name,
                      plugin.source,
                      plugin.path,
                      plugin.manifest,
                      loadedPaths,
                    )

                    if (agents.length > 0) {
                      logForDebugging(
                        `Loaded ${agents.length} agents from plugin ${plugin.name} custom path: ${agentPath}`,
                      )
                    }
                    return agents
                  } else if (stats.isFile() && agentPath.endsWith('.md')) {
                    // Load single agent file
                    const agent = await loadAgentFromFile(
                      agentPath,
                      plugin.name,
                      [],
                      plugin.source,
                      plugin.path,
                      plugin.manifest,
                      loadedPaths,
                    )
                    if (agent) {
                      logForDebugging(
                        `Loaded agent from plugin ${plugin.name} custom file: ${agentPath}`,
                      )
                      return [agent]
                    }
                  }
                  return []
                } catch (error) {
                  loadFailure = 'plugin_load_agents_path_failed'
                  logForDebugging(
                    `Failed to load agents from plugin ${plugin.name} custom path ${agentPath}: ${error}`,
                    { level: 'error' },
                  )
                  return []
                }
              },
            ),
          )
          for (const agents of pathResults) {
            pluginAgents.push(...agents)
          }
        }
        if (plugin.isBuiltin) {
          pluginAgents.push(
            ...(await loadBuiltinPluginAgents(plugin, loadedPaths)),
          )
        }
        return pluginAgents
      }),
    )

    const allAgents = perPluginAgents.flat()
    logForDebugging(`Total plugin agents loaded: ${allAgents.length}`)
    // densable `m`/`y` — `tengu_feature_bad` with the failure code, else ok.
    if (loadFailure) {
      logEvent('tengu_feature_bad', {
        feature_name: 'plugin_load_agents',
        error_code: loadFailure,
      })
    } else {
      logEvent('tengu_feature_ok', { feature_name: 'plugin_load_agents' })
    }
    return allAgents
  },
)

export function clearPluginAgentCache(): void {
  loadPluginAgents.cache?.clear?.()
}
