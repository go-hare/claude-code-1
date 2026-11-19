import { performBackgroundPluginInstallations } from '../../services/plugins/PluginInstallationManager.js';
import type { AppState } from '../../state/AppState.js';
import { checkHasTrustDialogAccepted } from '../config.js';
import { logForDebugging } from '../debug.js';
import { isPersistedTrustIgnored } from './addDirPluginSettings.js';
import {
  clearMarketplacesCache,
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
  registerSeedMarketplaces,
} from './marketplaceManager.js';
import { clearPluginCache } from './pluginLoader.js';
import { getSkippedWorktreeMarketplacesNotice } from './worktreePluginSettings.js';

type SetAppState = (f: (prevState: AppState) => AppState) => void;

/**
 * Perform plugin startup checks and initiate background installations
 *
 * This function starts background installation of marketplaces and plugins
 * from trusted sources (repository and user settings) without blocking startup.
 * Installation progress and errors are tracked in AppState and shown via notifications.
 *
 * SECURITY: This function is only called from REPL.tsx after the "trust this folder"
 * dialog has been confirmed. The trust dialog in cli.tsx blocks all execution until
 * the user explicitly trusts the current working directory, ensuring that plugin
 * installations only happen with user consent. This prevents malicious repositories
 * from automatically installing plugins without user approval.
 *
 * @param setAppState Function to update app state with installation progress
 */
export async function performStartupChecks(setAppState: SetAppState): Promise<void> {
  logForDebugging('performStartupChecks called');

  // Check if the current directory has been trusted (#1781: honor CLAUDE_CODE_IGNORE_PERSISTED_TRUST)
  if (isPersistedTrustIgnored() || !checkHasTrustDialogAccepted()) {
    logForDebugging('Trust not accepted for current directory - skipping plugin installations');
    return;
  }

  try {
    logForDebugging('Starting background plugin installations');

    // Register seed marketplaces (CLAUDE_CODE_PLUGIN_SEED_DIR) before diffing.
    // Idempotent; no-op if seed not configured. Without this, background install
    // would see seed marketplaces as missing → clone → defeats seed's purpose.
    //
    // If registration changed state, clear caches so earlier plugin-load passes
    // (e.g. getAllMcpConfigs during REPL init) don't keep stale "marketplace
    // not found" results.
    const seedChanged = await registerSeedMarketplaces();
    if (seedChanged) {
      clearMarketplacesCache();
      clearPluginCache('performStartupChecks: seed marketplaces changed');
      // Set needsRefresh so useManagePlugins notifies the user to run
      // /reload-plugins. Without this signal, the initial plugin-load
      // (which raced and cached "marketplace not found") would persist
      // until the user manually reloads.
      setAppState(prev => {
        if (prev.plugins.needsRefresh) return prev;
        return {
          ...prev,
          plugins: { ...prev.plugins, needsRefresh: true },
        };
      });
    }

    // Official 2.1.326 #330 (`BBt` / `xMr`): show a notice when a worktree
    // session skipped repository plugin settings / marketplaces.
    try {
      const [declared, known] = await Promise.all([
        Promise.resolve(getDeclaredMarketplaces()),
        loadKnownMarketplacesConfig(),
      ]);
      const skippedNotice = getSkippedWorktreeMarketplacesNotice({
        declaredMarketplaces: declared,
        knownMarketplaces: known,
      });
      if (skippedNotice !== null) {
        logForDebugging(`performStartupChecks: ${skippedNotice}`, { level: 'warn' });
        setAppState(prev => {
          const alreadyQueued =
            prev.notifications.current?.key === 'repo-marketplaces-set-aside' ||
            prev.notifications.queue.some(n => n.key === 'repo-marketplaces-set-aside');
          if (alreadyQueued) return prev;
          return {
            ...prev,
            notifications: {
              ...prev.notifications,
              queue: [
                ...prev.notifications.queue,
                {
                  key: 'repo-marketplaces-set-aside',
                  text: skippedNotice,
                  color: 'warning',
                  priority: 'medium',
                  timeoutMs: 15_000,
                },
              ],
            },
          };
        });
      }
    } catch {
      // Non-fatal notice probe
    }

    // Start background installations without waiting
    // This will update AppState as installations progress
    await performBackgroundPluginInstallations(setAppState);
  } catch (error) {
    // Even if something fails here, don't block startup
    logForDebugging(`Error initiating background plugin installations: ${error}`);
  }
}
