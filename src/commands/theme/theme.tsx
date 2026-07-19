import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import {
  Pane,
  customThemeRef,
  parseCustomThemeRef,
  useCustomThemes,
  useTheme,
  type CustomTheme,
  type ThemeName,
  type ThemeSetting,
} from '@anthropic/ink';
import { ThemePicker } from '../../components/ThemePicker.js';
import { CustomThemeEditor } from '../../components/CustomThemeEditor.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

type View = { kind: 'picker' } | { kind: 'editor'; initial?: CustomTheme };

function ThemePickerCommand({ onDone }: Props): React.ReactNode {
  const [themeName, setTheme] = useTheme();
  const { customThemes } = useCustomThemes();
  const [view, setView] = useState<View>({ kind: 'picker' });

  if (view.kind === 'editor') {
    return (
      <CustomThemeEditor
        initial={view.initial}
        defaultBase={themeName as ThemeName}
        onDone={theme => {
          // setTheme clears previewOverrides; customThemes must already
          // include the saved overrides (CustomThemeEditor reloads first).
          setTheme(customThemeRef(theme.slug));
          onDone(`Using custom theme "${theme.name}"`);
        }}
        onCancel={() => setView({ kind: 'picker' })}
      />
    );
  }

  return (
    <Pane color="permission">
      <ThemePicker
        onThemeSelect={(setting: ThemeSetting) => {
          setTheme(setting);
          const slug = parseCustomThemeRef(String(setting));
          if (slug) {
            const name = customThemes.find(t => t.slug === slug)?.name ?? setting;
            onDone(`Using custom theme "${name}"`);
          } else {
            onDone(`Theme set to ${setting}`);
          }
        }}
        onCustomTheme={initial => setView({ kind: 'editor', initial })}
        onCancel={() => {
          onDone('Theme picker dismissed', { display: 'system' });
        }}
        skipExitHandling={true}
      />
    </Pane>
  );
}

export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <ThemePickerCommand onDone={onDone} />;
};
