import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Pane, useTheme } from '@anthropic/ink';
import { ThemePicker } from '../../components/ThemePicker.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { logError } from '../../utils/log.js';
import { runFunctionHookChain } from '../../utils/plugins/functionHooksModules.js';
import type { ThemeSetting } from '../../utils/theme.js';

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

export type SaveThemeHookResult = { kind: 'saved'; saved: ThemeSetting } | { kind: 'refused'; reason?: string };

/**
 * Official 2.1.292 (#243): ask plugin `config.set` hooks before persisting a
 * theme selection via `/theme`.
 */
export async function saveThemeWithConfigSetHook(
  setting: ThemeSetting,
  setTheme: (setting: ThemeSetting) => void,
  signal?: AbortSignal,
): Promise<SaveThemeHookResult> {
  let saved: ThemeSetting | undefined;
  try {
    const res = await runFunctionHookChain(
      'config.set',
      { key: 'theme', value: setting },
      async arg => {
        const finalSetting = typeof arg?.value === 'string' ? (arg.value as ThemeSetting) : setting;
        saved = finalSetting;
        setTheme(finalSetting);
        return { value: finalSetting };
      },
      undefined,
      undefined,
      signal ? { signal } : undefined,
    );
    if (saved !== undefined) {
      return { kind: 'saved', saved };
    }
    const deny =
      res && typeof res === 'object' && 'deny' in res && typeof (res as { deny?: unknown }).deny === 'string'
        ? (res as { deny: string }).deny
        : undefined;
    return { kind: 'refused', reason: deny };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(new Error(`/theme: config.set failed: ${message}`));
    return { kind: 'refused', reason: message };
  }
}

function ThemePickerCommand({ onDone }: Props): React.ReactNode {
  const [, setTheme] = useTheme();
  const pendingRef = React.useRef<AbortController | null>(null);

  return (
    <Pane color="permission">
      <ThemePicker
        onThemeSelect={setting => {
          pendingRef.current?.abort();
          const controller = new AbortController();
          pendingRef.current = controller;
          void saveThemeWithConfigSetHook(setting, setTheme, controller.signal).then(result => {
            if (pendingRef.current === controller) {
              pendingRef.current = null;
            }
            if (controller.signal.aborted) return;
            if (result.kind === 'saved') {
              onDone(`Theme set to ${result.saved}`);
            } else {
              onDone(`Couldn't save Theme${result.reason ? `: ${result.reason}` : ''}`, { display: 'system' });
            }
          });
        }}
        onCancel={() => {
          pendingRef.current?.abort();
          onDone('Theme picker dismissed', { display: 'system' });
        }}
        onCustomTheme={() => {
          // densable: extra `New custom theme…` row when this handler is set.
        }}
        skipExitHandling={true}
      />
    </Pane>
  );
}

export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <ThemePickerCommand onDone={onDone} />;
};
