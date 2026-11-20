import { useEffect, useRef } from 'react';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useNotifications } from '../../context/notifications.js';
import { useAppStateStore, useSetAppState } from '../../state/AppState.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';
import { leftoverM, leftoverP, leftoverY } from '../../utils/leftoverOt.js';
import { assessPluginReloadCacheImpact } from '../../utils/plugins/activateAfterInstall.js';
import { onPluginsAutoUpdated } from '../../utils/plugins/pluginAutoupdate.js';
import { refreshActivePlugins } from '../../utils/plugins/refresh.js';
import { useMainLoopModel } from '../useMainLoopModel.js';

type PluginAutoupdateReloadOutcome = 'ok' | 'with-errors' | 'failed' | 'skipped';

/**
 * Hook that displays a notification when plugins have been auto-updated.
 * Attempts a safe in-session reload when doing so will not invalidate the
 * prompt cache (official `XHt` @319148248); otherwise instructs the user to
 * run `/reload-plugins` to apply.
 */
export function usePluginAutoupdateNotification(): void {
  const { addNotification } = useNotifications();
  const appStateStore = useAppStateStore();
  const setAppState = useSetAppState();
  const mainLoopModel = useMainLoopModel();

  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;
  const reloadGenRef = useRef(0);

  useEffect(() => {
    if (getIsRemoteMode()) return;

    function showNotice(updatedPlugins: string[], outcome: PluginAutoupdateReloadOutcome): void {
      if (getIsRemoteMode()) return;
      if (updatedPlugins.length === 0) return;

      // Extract plugin names from plugin IDs (format: "name@marketplace")
      const pluginNames = updatedPlugins.map(id => {
        const atIndex = id.indexOf('@');
        return atIndex > 0 ? id.substring(0, atIndex) : id;
      });
      const displayNames = pluginNames.length <= 2 ? pluginNames.join(' and ') : `${pluginNames.length} plugins`;

      let key: string;
      let suffix: string;
      switch (outcome) {
        case 'ok':
          key = 'plugin-autoupdate-reloaded';
          suffix = ' · reloaded for this session';
          break;
        case 'with-errors':
          key = 'plugin-autoupdate-reload-errors';
          suffix = ' · reloaded with errors · /plugin to review';
          break;
        case 'failed':
          key = 'plugin-autoupdate-reload-errors';
          suffix = ' · Run /reload-plugins to apply';
          break;
        case 'skipped':
          key = 'plugin-autoupdate-restart';
          suffix = ' · Run /reload-plugins to apply';
          break;
      }

      addNotificationRef.current({
        key,
        segments: [
          {
            text: `${pluginNames.length === 1 ? 'Plugin' : 'Plugins'} updated: ${displayNames}`,
            color: outcome === 'with-errors' ? 'warning' : 'success',
          },
          {
            text: suffix,
            dim: true,
          },
        ],
        priority: 'low',
        timeoutMs: 10_000,
      });

      logForDebugging(`Plugin autoupdate notice ${key} for: ${pluginNames.join(', ')}`);
    }

    async function trySafeInSessionReload(): Promise<PluginAutoupdateReloadOutcome> {
      try {
        const impact = await assessPluginReloadCacheImpact({
          model: mainLoopModelRef.current,
          mcpClients: appStateStore.getState().mcp.clients,
        });
        if (impact.wouldInvalidateCache) {
          leftoverP('plugin_command_reresolve_reload', 'cache_impact');
          return 'skipped';
        }
        const refreshed = await refreshActivePlugins(setAppState);
        if (refreshed.error_count > 0) {
          leftoverP('plugin_command_reresolve_reload', 'load_errors');
          return 'with-errors';
        }
        leftoverY('plugin_command_reresolve_reload');
        return 'ok';
      } catch (err) {
        logForDebugging(`Plugin autoupdate: in-session reload failed: ${errorMessage(err)}`, {
          level: 'warn',
        });
        leftoverM('plugin_command_reresolve_reload', 'refresh_failed');
        return 'failed';
      }
    }

    const unsubscribe = onPluginsAutoUpdated(plugins => {
      logForDebugging(`Plugin autoupdate notification: ${plugins.length} plugin(s) updated`);
      if (plugins.length === 0) return;

      const gen = ++reloadGenRef.current;
      void trySafeInSessionReload().then(outcome => {
        if (gen !== reloadGenRef.current && (outcome === 'ok' || outcome === 'skipped')) {
          return;
        }
        showNotice(plugins, outcome);
      });
    });

    return unsubscribe;
  }, [appStateStore, setAppState]);
}
