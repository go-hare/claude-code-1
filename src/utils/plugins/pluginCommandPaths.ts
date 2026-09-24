/**
 * densable 2.1.251 #7 `VHt` — marketplace and manifest command sources that
 * resolve outside the plugin directory are `path-traversal` / `commands`.
 */

import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'
import { stat } from 'fs/promises'
import type { PluginError } from '../../types/plugin.js'
import type { CommandMetadata } from './schemas.js'
import { logForDebugging } from '../debug.js'

type CommandRecord = {
  commandsPaths?: string[]
  commandsMetadata?: Record<string, CommandMetadata>
}

export type PluginCommandOrigin = 'manifest' | 'marketplace'

function isInsidePlugin(pluginRoot: string, candidate: string): boolean {
  const rel = relative(pluginRoot, candidate)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return false
  }
  return true
}

/**
 * Resolve `source` against the plugin root. Null when the lexical path or
 * an existing symlink target leaves the plugin directory.
 */
export function resolveCommandPathWithinPlugin(
  pluginPath: string,
  source: string,
): string | null {
  const root = resolve(pluginPath)
  let full: string
  try {
    full = resolve(root, source)
  } catch {
    return null
  }
  if (!isInsidePlugin(root, full)) return null
  try {
    const real = realpathSync(full)
    if (!isInsidePlugin(root, real)) return null
  } catch {
    // Not on disk yet — lexical containment is the traversal check.
  }
  return full
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

export type ApplyPluginCommandSourcesOpts = {
  pluginPath: string
  pluginName: string
  errorSource: string
  mode: 'replace' | 'append'
  origin: PluginCommandOrigin
  resolvePath: (pluginPath: string, source: string) => string | null
  /** densable `registerInlineContent` / `O` — truthy enables the content kind. */
  registerInlineContent?: unknown
  errors: PluginError[]
}

type CommandSpec = {
  source?: unknown
  content?: unknown
}

/**
 * densable `VHt`.
 */
export async function applyPluginCommandSources(
  plugin: CommandRecord,
  commands: unknown,
  opts: ApplyPluginCommandSourcesOpts,
): Promise<void> {
  const {
    pluginPath,
    pluginName,
    errorSource,
    mode,
    origin,
    resolvePath,
    registerInlineContent,
    errors,
  } = opts
  const escapesLabel =
    origin === 'manifest'
      ? 'specified in manifest but'
      : 'from marketplace entry'
  const originLabel = origin === 'manifest' ? 'manifest' : 'marketplace entry'
  const first = Object.values(commands as object)[0]
  if (
    typeof commands === 'object' &&
    !Array.isArray(commands) &&
    first &&
    typeof first === 'object' &&
    ('source' in first || 'content' in first)
  ) {
    const metadata: Record<string, CommandMetadata> =
      mode === 'append' ? { ...(plugin.commandsMetadata ?? {}) } : {}
    let kept = 0
    const paths: string[] = []
    const checks = await Promise.all(
      Object.entries(commands as Record<string, unknown>).map(
        async ([commandName, raw]) => {
          if (!raw || typeof raw !== 'object') {
            return { commandName, metadata: raw, kind: 'skip' as const }
          }
          const spec = raw as CommandSpec
          if (spec.source) {
            const fullPath = resolvePath(pluginPath, spec.source as string)
            return {
              commandName,
              metadata: raw as CommandMetadata,
              kind: 'source' as const,
              fullPath,
              exists: fullPath !== null && (await pathExists(fullPath)),
            }
          }
          if (spec.content && registerInlineContent) {
            return {
              commandName,
              metadata: raw as CommandMetadata,
              kind: 'content' as const,
            }
          }
          return { commandName, metadata: raw, kind: 'skip' as const }
        },
      ),
    )
    for (const check of checks) {
      if (check.kind === 'skip') continue
      if (check.kind === 'content') {
        metadata[check.commandName] = check.metadata
        kept++
        continue
      }
      if (check.fullPath === null) {
        logForDebugging(
          `Command ${check.commandName} source ${check.metadata.source} ${escapesLabel} escapes plugin directory for ${pluginName}`,
          { level: 'error' },
        )
        errors.push({
          type: 'path-traversal',
          source: errorSource,
          plugin: pluginName,
          path: check.metadata.source ?? '',
          component: 'commands',
        })
      } else if (check.exists) {
        paths.push(check.fullPath)
        metadata[check.commandName] = check.metadata
        kept++
      } else {
        logForDebugging(
          `Command ${check.commandName} path ${check.metadata.source} ${escapesLabel} not found at ${check.fullPath} for ${pluginName}`,
          { level: 'error' },
        )
        errors.push({
          type: 'path-not-found',
          source: errorSource,
          plugin: pluginName,
          path: check.fullPath,
          component: 'commands',
        })
      }
    }
    if (paths.length > 0) {
      plugin.commandsPaths =
        mode === 'append' ? [...(plugin.commandsPaths ?? []), ...paths] : paths
    }
    if (kept > 0) plugin.commandsMetadata = metadata
    return
  }

  const list = Array.isArray(commands) ? commands : [commands]
  const checks = await Promise.all(
    list.map(async cmdPath => {
      if (typeof cmdPath !== 'string') {
        return { cmdPath, kind: 'invalid' as const }
      }
      const fullPath = resolvePath(pluginPath, cmdPath)
      return {
        cmdPath,
        kind: 'path' as const,
        fullPath,
        exists: fullPath !== null && (await pathExists(fullPath)),
      }
    }),
  )
  const paths: string[] = []
  for (const check of checks) {
    if (check.kind === 'invalid') {
      logForDebugging(
        `Unexpected command format in ${originLabel} for ${pluginName}`,
        { level: 'error' },
      )
      continue
    }
    if (check.fullPath === null) {
      logForDebugging(
        `Command path ${check.cmdPath} ${escapesLabel} escapes plugin directory for ${pluginName}`,
        { level: 'error' },
      )
      errors.push({
        type: 'path-traversal',
        source: errorSource,
        plugin: pluginName,
        path: check.cmdPath,
        component: 'commands',
      })
      continue
    }
    if (check.exists) {
      paths.push(check.fullPath)
    } else {
      logForDebugging(
        `Command path ${check.cmdPath} ${escapesLabel} not found at ${check.fullPath} for ${pluginName}`,
        { level: 'error' },
      )
      errors.push({
        type: 'path-not-found',
        source: errorSource,
        plugin: pluginName,
        path: check.fullPath,
        component: 'commands',
      })
    }
  }
  if (paths.length > 0) {
    plugin.commandsPaths =
      mode === 'append' ? [...(plugin.commandsPaths ?? []), ...paths] : paths
  }
}
