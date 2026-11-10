import {
  formatSyncedPluginShadowedMessage,
  formatSyncedPluginShadowedStatus,
  getPluginErrorMessage,
  type PluginError,
} from '../../types/plugin.js';

export type PluginErrorExtended =
  | PluginError
  | {
      type: 'dependency-version-unsatisfied';
      source: string;
      plugin: string;
      dependency: string;
      required: string;
      installed?: string;
    }
  | {
      type: 'plugin-not-installed';
      source: string;
      plugin: string;
      installedListHeldNote?: string;
    }
  | {
      type: 'autoupdate-deferred-entry-helper';
      source: string;
      plugin?: string;
      message: string;
    }
  | {
      type: 'autoupdate-disabled-by-policy';
      source: string;
      plugin?: string;
      message: string;
    }
  | {
      type: 'autoupdate-blocked-by-pinner';
      source: string;
      plugin?: string;
      heldAt?: string;
      blockedBy: string[];
      disabledPinners: string[];
    };

export function formatErrorMessage(error: PluginErrorExtended): string {
  switch (error.type) {
    case 'path-traversal':
      return `${error.component} path escapes the plugin directory: ${error.path}`;
    case 'path-not-found':
      return `${error.component} path not found: ${error.path}`;
    case 'git-auth-failed':
      return `Git ${error.authType.toUpperCase()} authentication failed for ${error.gitUrl}`;
    case 'git-timeout':
      return `Git ${error.operation} timed out for ${error.gitUrl}`;
    case 'network-error':
      return `Network error accessing ${error.url}${error.details ? `: ${error.details}` : ''}`;
    case 'manifest-parse-error':
      return `Failed to parse manifest at ${error.manifestPath}: ${error.parseError}`;
    case 'manifest-validation-error':
      return `Invalid manifest at ${error.manifestPath}: ${error.validationErrors.join(', ')}`;
    case 'plugin-not-found':
      return `Plugin "${error.pluginId}" not found in marketplace "${error.marketplace}"`;
    case 'marketplace-not-found':
      return `Marketplace "${error.marketplace}" not found`;
    case 'marketplace-load-failed':
      return `Failed to load marketplace "${error.marketplace}": ${error.reason}`;
    case 'mcp-config-invalid':
      return `Invalid MCP server config for "${error.serverName}": ${error.validationError}`;
    case 'mcp-server-suppressed-duplicate': {
      const dup = error.duplicateOf.startsWith('plugin:')
        ? `server provided by plugin "${error.duplicateOf.split(':')[1] ?? '?'}"`
        : `already-configured "${error.duplicateOf}"`;
      return `MCP server "${error.serverName}" skipped — same command/URL as ${dup}`;
    }
    case 'hook-load-failed':
      return `Failed to load hooks from ${error.hookPath}: ${error.reason}`;
    case 'component-load-failed':
      return `Failed to load ${error.component} from ${error.path}: ${error.reason}`;
    case 'mcpb-download-failed':
      return `Failed to download MCPB from ${error.url}: ${error.reason}`;
    case 'mcpb-extract-failed':
      return `Failed to extract MCPB ${error.mcpbPath}: ${error.reason}`;
    case 'mcpb-invalid-manifest':
      return `MCPB manifest invalid at ${error.mcpbPath}: ${error.validationError}`;
    case 'marketplace-blocked-by-policy':
      return error.blockedByBlocklist
        ? `Marketplace "${error.marketplace}" is blocked by enterprise policy`
        : `Marketplace "${error.marketplace}" is not in the allowed marketplace list`;
    case 'dependency-unsatisfied':
      return error.reason === 'not-enabled'
        ? `Dependency "${error.dependency}" is disabled`
        : `Dependency "${error.dependency}" is not installed`;
    case 'dependency-version-unsatisfied':
      return `Requires "${error.dependency}" ${error.required}, installed ${error.installed ?? 'version unknown'}`;
    case 'lsp-config-invalid':
      return `Invalid LSP server config for "${error.serverName}": ${error.validationError}`;
    case 'lsp-server-start-failed':
      return `LSP server "${error.serverName}" failed to start: ${error.reason}`;
    case 'lsp-server-crashed':
      return error.signal
        ? `LSP server "${error.serverName}" crashed with signal ${error.signal}`
        : `LSP server "${error.serverName}" crashed with exit code ${error.exitCode ?? 'unknown'}`;
    case 'lsp-request-timeout':
      return `LSP server "${error.serverName}" timed out on ${error.method} after ${error.timeoutMs}ms`;
    case 'lsp-request-failed':
      return `LSP server "${error.serverName}" ${error.method} failed: ${error.error}`;
    case 'plugin-cache-miss':
      return `Plugin "${error.plugin}" not cached at ${error.installPath}`;
    case 'plugin-not-installed':
      if (error.installedListHeldNote !== undefined) {
        return `Plugin "${error.plugin}" is enabled in project settings, but whether it is installed could not be checked`;
      }
      return `Plugin "${error.plugin}" is enabled in project settings but isn't installed here`;
    case 'autoupdate-deferred-entry-helper':
    case 'autoupdate-disabled-by-policy':
      return error.message;
    case 'autoupdate-blocked-by-pinner': {
      const heldPart = error.heldAt ? ` at ${error.heldAt}` : '';
      const disabledPart =
        error.disabledPinners.length > 0
          ? ` (${error.disabledPinners.join(', ')} ${error.disabledPinners.length === 1 ? 'is' : 'are'} disabled)`
          : '';
      return `Autoupdate held${heldPart} — version constraint from ${error.blockedBy.join(', ')}${disabledPart}`;
    }
    case 'generic-error':
      return error.error;
    case 'synced-plugin-shadowed':
      return formatSyncedPluginShadowedStatus(error.source, error.shadowedBy);
  }
  const _exhaustive: never = error;
  return getPluginErrorMessage(_exhaustive);
}

export function getErrorGuidance(error: PluginErrorExtended): string | null {
  switch (error.type) {
    case 'path-traversal':
      return 'Keep command paths inside the plugin directory';
    case 'path-not-found':
      return 'Check that the path in your manifest or marketplace config is correct';
    case 'git-auth-failed':
      return error.authType === 'ssh'
        ? 'Configure SSH keys or use HTTPS URL instead'
        : 'Configure credentials or use SSH URL instead';
    case 'git-timeout':
    case 'network-error':
      return 'Check your internet connection and try again';
    case 'manifest-parse-error':
      return 'Check manifest file syntax in the plugin directory';
    case 'manifest-validation-error':
      return 'Check manifest file follows the required schema';
    case 'plugin-not-found':
      return `Plugin may not exist in marketplace "${error.marketplace}"`;
    case 'marketplace-not-found':
      return error.availableMarketplaces.length > 0
        ? `Available marketplaces: ${error.availableMarketplaces.join(', ')}`
        : 'Add the marketplace first using /plugin marketplace add';
    case 'mcp-config-invalid':
      return 'Check MCP server configuration in .mcp.json or manifest';
    case 'mcp-server-suppressed-duplicate': {
      // duplicateOf is "plugin:name:srv" when another plugin won dedup —
      // users can't remove plugin-provided servers from their MCP config,
      // so point them at the winning plugin instead.
      if (error.duplicateOf.startsWith('plugin:')) {
        const winningPlugin = error.duplicateOf.split(':')[1] ?? 'the other plugin';
        return `Disable plugin "${winningPlugin}" if you want this plugin's version instead`;
      }
      return `Remove "${error.duplicateOf}" from your MCP config if you want the plugin's version instead`;
    }
    case 'hook-load-failed':
      return "Check the plugin's hooks configuration and that its hooks file is readable";
    case 'component-load-failed':
      return `Check ${error.component} directory structure and file permissions`;
    case 'mcpb-download-failed':
      return 'Check your internet connection and URL accessibility';
    case 'mcpb-extract-failed':
      return 'Verify the MCPB file is valid and not corrupted';
    case 'mcpb-invalid-manifest':
      return 'Contact the plugin author about the invalid manifest';
    case 'marketplace-blocked-by-policy':
      if (error.blockedByBlocklist) {
        return 'This marketplace source is explicitly blocked by your administrator';
      }
      return error.allowedSources.length > 0
        ? `Allowed sources: ${error.allowedSources.join(', ')}`
        : 'Contact your administrator to configure allowed marketplace sources';
    case 'dependency-unsatisfied':
      return error.reason === 'not-enabled'
        ? `Enable "${error.dependency}" or uninstall "${error.plugin}"`
        : `Install "${error.dependency}" or uninstall "${error.plugin}"`;
    case 'dependency-version-unsatisfied':
      return `Update "${error.dependency}" to satisfy ${error.required}, or uninstall "${error.plugin}"`;
    case 'lsp-config-invalid':
      return 'Check LSP server configuration in the plugin manifest';
    case 'lsp-server-start-failed':
    case 'lsp-server-crashed':
    case 'lsp-request-timeout':
    case 'lsp-request-failed':
      return 'Check LSP server logs with --debug for details';
    case 'plugin-cache-miss':
      return 'Run /plugin to refresh the plugin cache';
    case 'plugin-not-installed': {
      if (error.installedListHeldNote !== undefined) return error.installedListHeldNote;
      const safeSource = /^\w[\w.@-]*$/.test(error.source)
        ? `claude plugin install ${error.source} --scope project`
        : null;
      return safeSource
        ? `Run \`${safeSource}\` to install it for this project`
        : 'Install it at project scope to fix this';
    }
    case 'autoupdate-deferred-entry-helper':
    case 'autoupdate-disabled-by-policy':
      return null;
    case 'autoupdate-blocked-by-pinner': {
      const pinner = error.disabledPinners.length > 0 ? error.disabledPinners[0] : error.blockedBy[0];
      return pinner
        ? `Update or uninstall "${pinner}" to unblock${error.disabledPinners.length > 0 ? ' (it is currently disabled)' : ''}`
        : null;
    }
    case 'marketplace-load-failed':
      return error.reason === 'cache-miss'
        ? error.catalogReadFailed
          ? 'The cached marketplace catalog could not be read; run /reload-plugins to refresh it'
          : 'Run /reload-plugins to refresh the marketplace cache'
        : null;
    case 'generic-error':
      return null;
    case 'synced-plugin-shadowed':
      return formatSyncedPluginShadowedMessage(error.source, error.shadowedBy);
  }
  const _exhaustive: never = error;
  return null;
}
