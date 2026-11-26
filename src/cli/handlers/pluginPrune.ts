/**
 * Official 2.1.331 `claude plugin prune` (alias `autoremove`) handler
 * (`tad` / `hva`).
 *
 * Removes auto-installed plugin dependencies that are no longer needed at the
 * specified scope (user, project, or local).
 */
import { createInterface } from 'node:readline'
import { setUseCoworkPlugins } from '../../bootstrap/state.js'
import {
  uninstallPlugin,
  VALID_INSTALLABLE_SCOPES,
} from '../../services/plugins/pluginCliCommands.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { cliError, cliOk } from '../exit.js'

export type PruneScope = (typeof VALID_INSTALLABLE_SCOPES)[number]

export type OrphanScanResult = {
  autoCount: number
  orphans: string[]
}

/**
 * Inspect installed plugins at `scope` for auto-installed entries (`autoInstalled: true`
 * or `installedAsDependency: true`) that are no longer referenced by any explicit plugin.
 */
export function findOrphanAutoInstalledPlugins(
  installedPlugins: Record<
    string,
    Array<{
      scope?: string
      version?: string
      autoInstalled?: boolean
      installedAsDependency?: boolean
      dependencies?: string[]
    }>
  >,
  scope: PruneScope,
): OrphanScanResult {
  const autoIds: string[] = []
  const referencedDeps = new Set<string>()

  for (const [pluginId, entries] of Object.entries(installedPlugins)) {
    for (const entry of entries ?? []) {
      if ((entry.scope ?? 'user') !== scope) continue
      const isAuto =
        entry.autoInstalled === true || entry.installedAsDependency === true
      if (isAuto) {
        autoIds.push(pluginId)
      } else {
        for (const dep of entry.dependencies ?? []) {
          referencedDeps.add(dep)
        }
      }
    }
  }

  const orphans = autoIds.filter(id => !referencedDeps.has(id))
  return { autoCount: autoIds.length, orphans }
}

async function confirmRemoval(promptText: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise(resolve => {
    rl.question(`${promptText} [y/N] `, answer => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      resolve(normalized === 'y' || normalized === 'yes')
    })
  })
}

export async function runPluginPrune(
  scope: PruneScope = 'user',
  options: { dryRun?: boolean; yes?: boolean } = {},
): Promise<string> {
  const installed = loadInstalledPluginsV2()
  const rawPlugins = installed.plugins as Record<
    string,
    Array<{
      scope?: string
      version?: string
      autoInstalled?: boolean
      installedAsDependency?: boolean
      dependencies?: string[]
    }>
  >

  const scan = findOrphanAutoInstalledPlugins(rawPlugins, scope)
  if (scan.orphans.length === 0) {
    return scan.autoCount === 0
      ? `Nothing to prune (no auto-installed plugins at ${scope} scope).`
      : `Nothing to prune (${scan.autoCount} auto-installed ${scan.autoCount === 1 ? 'plugin' : 'plugins'} at ${scope} scope, all still needed).`
  }

  const listLines = scan.orphans.map(id => {
    const entry = rawPlugins[id]?.find(e => (e.scope ?? 'user') === scope)
    return `  ${id}${entry?.version ? ` (${entry.version})` : ''}`
  })
  const header = `${scan.orphans.length} auto-installed ${scan.orphans.length === 1 ? 'plugin' : 'plugins'} no longer needed at ${scope} scope:\n${listLines.join('\n')}`

  if (options.dryRun) {
    return `${header}\n(dry run — nothing removed)`
  }

  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const scopeFlag = scope === 'user' ? '' : ` --scope ${scope}`
      return `${header}\nNot a TTY — run \`claude plugin prune${scopeFlag} -y\` to remove.`
    }
    process.stdout.write(`${header}\n`)
    const ok = await confirmRemoval('Remove?')
    if (!ok) return 'Aborted.'
  }

  const removed: string[] = []
  for (const id of scan.orphans) {
    await uninstallPlugin(id, scope, false)
    removed.push(parsePluginIdentifier(id).name)
  }

  return `Removed ${removed.length} auto-installed ${removed.length === 1 ? 'plugin' : 'plugins'}: ${removed.join(', ')}`
}

export async function pluginPruneHandler(options: {
  scope?: string
  dryRun?: boolean
  yes?: boolean
  cowork?: boolean
}): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  const scope = (options.scope ?? 'user') as PruneScope
  if (options.cowork && scope !== 'user') {
    return cliError('--cowork can only be used with user scope')
  }
  if (!VALID_INSTALLABLE_SCOPES.includes(scope)) {
    return cliError(
      `Invalid scope: ${scope}. Must be one of: ${VALID_INSTALLABLE_SCOPES.join(', ')}.`,
    )
  }
  const message = await runPluginPrune(scope, {
    dryRun: options.dryRun,
    yes: options.yes,
  })
  return cliOk(message)
}
