// Parse plugin subcommand arguments into structured commands
export type ParsedCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'install'; marketplace?: string; plugin?: string }
  | { type: 'install-from-source'; plugin: string; marketplaceSource: string }
  | { type: 'usage-error'; message: string }
  | { type: 'manage' }
  | { type: 'uninstall'; plugin?: string }
  | { type: 'enable'; plugin?: string }
  | { type: 'disable'; plugin?: string }
  | { type: 'validate'; path?: string }
  | {
      type: 'marketplace'
      action?: 'add' | 'remove' | 'update' | 'list'
      target?: string
    }

const INSTALL_MARKETPLACE_USAGE =
  'Usage: /plugin install <plugin> --marketplace <source>'

/** densable `o` — slash `/plugin install --marketplace`. */
function parseInstallMarketplaceFlag(
  tokens: string[],
): ParsedCommand | undefined {
  const index = tokens.findIndex(
    token => token === '--marketplace' || token.startsWith('--marketplace='),
  )
  if (index === -1) return undefined
  const flag = tokens[index]
  const inline = flag !== '--marketplace'
  const source = inline ? flag.slice(14) : tokens[index + 1]
  if (!source || source.startsWith('-')) {
    return {
      type: 'usage-error',
      message: `--marketplace needs a marketplace source (owner/repo or a URL). ${INSTALL_MARKETPLACE_USAGE}`,
    }
  }
  const rest = tokens.filter(
    (_token, i) => i !== index && (inline || i !== index + 1),
  )
  const plugin = rest[0]
  if (rest.length !== 1 || !plugin || plugin.startsWith('-')) {
    return {
      type: 'usage-error',
      message: `--marketplace needs exactly one plugin name. ${INSTALL_MARKETPLACE_USAGE}`,
    }
  }
  if (plugin.lastIndexOf('@') > 0) {
    return {
      type: 'usage-error',
      message: `Name the marketplace once: <plugin>@<marketplace>, or ${INSTALL_MARKETPLACE_USAGE.slice(7)}`,
    }
  }
  return { type: 'install-from-source', plugin, marketplaceSource: source }
}

export function formatInstallFromMarketplaceSource(options: {
  plugin: string
  marketplaceSource: string
}): string {
  return `/plugin install ${options.plugin} --marketplace ${options.marketplaceSource}`
}

export function parsePluginArgs(args?: string): ParsedCommand {
  if (!args) {
    return { type: 'menu' }
  }

  const parts = args.trim().split(/\s+/)
  const command = parts[0]?.toLowerCase()

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return { type: 'help' }

    case 'install':
    case 'i': {
      const fromMarketplace = parseInstallMarketplaceFlag(parts.slice(1))
      if (fromMarketplace) return fromMarketplace
      const target = parts[1]
      if (!target) {
        return { type: 'install' }
      }

      // Check if it's in format plugin@marketplace
      const at = target.lastIndexOf('@')
      if (at > 0) {
        return {
          type: 'install',
          plugin: target.slice(0, at),
          marketplace: target.slice(at + 1),
        }
      }

      // Check if the target looks like a marketplace (URL or path)
      const isMarketplace =
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('file://') ||
        target.includes('/') ||
        target.includes('\\')

      if (isMarketplace) {
        // This is a marketplace URL/path, no plugin specified
        return { type: 'install', marketplace: target }
      }

      // Otherwise treat it as a plugin name
      return { type: 'install', plugin: target }
    }

    case 'manage':
      return { type: 'manage' }

    case 'uninstall':
      return { type: 'uninstall', plugin: parts[1] }

    case 'enable':
      return { type: 'enable', plugin: parts[1] }

    case 'disable':
      return { type: 'disable', plugin: parts[1] }

    case 'validate': {
      const target = parts.slice(1).join(' ').trim()
      return { type: 'validate', path: target || undefined }
    }

    case 'marketplace':
    case 'market': {
      const action = parts[1]?.toLowerCase()
      const target = parts.slice(2).join(' ')

      switch (action) {
        case 'add':
          return { type: 'marketplace', action: 'add', target }
        case 'remove':
        case 'rm':
          return { type: 'marketplace', action: 'remove', target }
        case 'update':
          return { type: 'marketplace', action: 'update', target }
        case 'list':
          return { type: 'marketplace', action: 'list' }
        default:
          // No action specified, show marketplace menu
          return { type: 'marketplace' }
      }
    }

    default:
      // Unknown command, show menu
      return { type: 'menu' }
  }
}
