/**
 * Post-install/post-enable config prompt.
 *
 * densable 2.1.283 `ci`: `ve()` `{storageV5,credentials}` then `sst`/`$Hn`
 * (`getUnconfiguredOptions` / `getUnconfiguredChannels`) and step load/save
 * via `q0`/`BVe`/`QDe`/`mtn`. Empty schema short-circuits to `{steps:[]}`.
 */

import { Text } from '@anthropic/ink';
import * as React from 'react';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useSessionServices } from '../../context/sessionServices.js';
import type { LoadedPlugin } from '../../types/plugin.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';
import { re } from '../../utils/plugins/escapeSafeText.js';
import { loadMcpServerUserConfig, saveMcpServerUserConfig } from '../../utils/plugins/mcpbHandler.js';
import { getUnconfiguredChannels, type UnconfiguredChannel } from '../../utils/plugins/mcpPluginIntegration.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import {
  getUnconfiguredOptions,
  loadPluginOptionsNw,
  type PluginOptionSchema,
  type PluginOptionValues,
  savePluginOptions,
} from '../../utils/plugins/pluginOptionsStorage.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';

/**
 * Post-install lookup: return the LoadedPlugin for the just-installed
 * pluginId so the caller can divert to PluginOptionsFlow. Returns undefined
 * if the plugin somehow didn't make it into the fresh load — callers treat
 * undefined as "carry on closing."
 *
 * Install should have cleared caches already; loadAllPlugins reads fresh.
 */
export async function findPluginOptionsTarget(pluginId: string): Promise<LoadedPlugin | undefined> {
  const { enabled, disabled } = await loadAllPlugins();
  return [...enabled, ...disabled].find(p => p.repository === pluginId || p.source === pluginId);
}

/**
 * A single dialog step in the walk. Top-level options and channels both
 * collapse to this shape — the only difference is which save function runs.
 */
type ConfigStep = {
  key: string;
  title: string;
  subtitle: string;
  schema: PluginOptionSchema;
  /** Returns any already-saved values so PluginOptionsDialog can pre-fill and
   *  skip unchanged sensitive fields on reconfigure. */
  load: () => PluginOptionValues | undefined | Promise<PluginOptionValues | undefined>;
  save: (values: PluginOptionValues) => void | Promise<void>;
};

type LoadedSteps = {
  steps: ConfigStep[];
  error?: string;
};

type Props = {
  plugin: LoadedPlugin;
  /** `name@marketplace` — the savePluginOptions / saveMcpServerUserConfig key. */
  pluginId: string;
  /**
   * `configured` = user filled all fields. `skipped` = nothing needed
   * configuring, or user hit cancel. `error` = save threw.
   */
  onDone: (outcome: 'configured' | 'skipped' | 'error', detail?: string) => void;
};

function channelNeedsConfig(channel: { userConfig?: PluginOptionSchema }): boolean {
  return Boolean(channel.userConfig && Object.keys(channel.userConfig).length > 0);
}

function LoadingSkip({ onDone }: { onDone: Props['onDone'] }): React.ReactNode {
  const cancelled = React.useRef(false);
  useKeybinding(
    'confirm:no',
    () => {
      if (cancelled.current) return;
      cancelled.current = true;
      onDone('skipped');
    },
    { context: 'Settings' },
  );
  return <Text dimColor={true}>Loading…</Text>;
}

function PluginOptionsWalk({ loaded, onDone }: { loaded: LoadedSteps; onDone: Props['onDone'] }): React.ReactNode {
  const [index, setIndex] = React.useState(0);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;
  // densable ui: D.current finishes the walk; V.current is in-flight save.
  const finished = React.useRef(false);
  const saving = React.useRef(false);
  const [pending, setPending] = React.useState<{
    index: number;
    values: PluginOptionValues;
    saveOutcome: Promise<unknown>;
  } | null>(null);

  const finish = React.useCallback((...args: Parameters<Props['onDone']>) => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current(...args);
  }, []);

  React.useEffect(() => {
    if (loaded.error) {
      finish('error', loaded.error);
      return;
    }
    if (loaded.steps.length === 0) {
      finish('skipped');
    }
  }, [loaded.error, loaded.steps.length, finish]);

  React.useEffect(() => {
    if (pending === null) return;
    let cancelled = false;
    void pending.saveOutcome.then(
      () => {
        if (cancelled) return;
        saving.current = false;
        setPending(null);
        const next = pending.index + 1;
        if (next < loaded.steps.length) setIndex(next);
        else finish('configured');
      },
      err => {
        if (cancelled) return;
        saving.current = false;
        setPending(null);
        finish('error', errorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pending, loaded.steps.length, finish]);

  if (loaded.error || loaded.steps.length === 0) {
    return null;
  }

  const current = loaded.steps[index]!;
  const initialValues = React.use(React.useMemo(() => Promise.resolve().then(() => current.load()), [current.key]));

  return (
    <PluginOptionsDialog
      key={current.key}
      title={current.title}
      subtitle={current.subtitle}
      configSchema={current.schema}
      initialValues={initialValues}
      onSave={values => {
        if (finished.current || saving.current || pending !== null) return;
        saving.current = true;
        setPending({
          index,
          values,
          saveOutcome: Promise.resolve().then(() => current.save(values)),
        });
      }}
      onCancel={() => {
        if (saving.current) return;
        finish('skipped');
      }}
    />
  );
}

function PluginOptionsFlowInner({ plugin, pluginId, onDone }: Props): React.ReactNode {
  const { storageV5, credentials } = useSessionServices();
  const hasSchema =
    Object.keys(plugin.manifest.userConfig ?? {}).length > 0 ||
    (plugin.manifest.channels ?? []).some(channelNeedsConfig);

  // densable `ci`: no userConfig/channels → sync `{steps:[]}` (not a Promise).
  if (!hasSchema) {
    return <PluginOptionsWalk loaded={{ steps: [] }} onDone={onDone} />;
  }

  const loaded = React.use(
    React.useMemo(
      () =>
        (async (): Promise<LoadedSteps> => {
          try {
            const result: ConfigStep[] = [];
            const unconfigured = await getUnconfiguredOptions(plugin, credentials);
            if (Object.keys(unconfigured).length > 0) {
              result.push({
                key: 'top-level',
                title: `Configure ${re(plugin.name)}`,
                subtitle: 'Plugin options',
                schema: unconfigured,
                load: () => loadPluginOptionsNw(pluginId, credentials),
                save: values =>
                  savePluginOptions(pluginId, values, plugin.manifest.userConfig!, storageV5, credentials),
              });
            }
            const channels: UnconfiguredChannel[] = await getUnconfiguredChannels(plugin, credentials);
            for (const channel of channels) {
              result.push({
                key: `channel:${channel.server}`,
                title: `Configure ${re(channel.displayName)}`,
                subtitle: `Plugin: ${re(plugin.name)}`,
                schema: channel.configSchema,
                load: async () => (await loadMcpServerUserConfig(pluginId, channel.server, credentials)) ?? undefined,
                save: values =>
                  saveMcpServerUserConfig(
                    pluginId,
                    channel.server,
                    values,
                    channel.configSchema,
                    storageV5,
                    credentials,
                  ),
              });
            }
            return { steps: result };
          } catch (err) {
            logForDebugging(`Failed to read saved plugin options (${pluginId}): ${errorMessage(err)}`, {
              level: 'error',
            });
            return { steps: [], error: errorMessage(err) };
          }
        })(),
      [plugin, pluginId, credentials, storageV5],
    ),
  );

  return <PluginOptionsWalk loaded={loaded} onDone={onDone} />;
}

export function PluginOptionsFlow(props: Props): React.ReactNode {
  return (
    <React.Suspense fallback={<LoadingSkip onDone={props.onDone} />}>
      <PluginOptionsFlowInner {...props} />
    </React.Suspense>
  );
}
