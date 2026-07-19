/**
 * densable q9o — custom theme create/edit UI.
 * Steps: name (new/fork) → color FuzzyPicker → value edit.
 */
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import path from 'path';
import TextInput from './TextInput.js';
import {
  Box,
  Byline,
  FuzzyPicker,
  KeyboardShortcutHint,
  Pane,
  Text,
  getTheme,
  getThemesDir,
  isValidThemeColor,
  saveCustomTheme,
  uniqueThemeSlug,
  useCustomThemes,
  useKeybinding,
  useTheme,
  type CustomTheme,
  type Theme,
  type ThemeName,
} from '@anthropic/ink';

type Props = {
  initial?: CustomTheme;
  /** densable defaultBase — current resolved base when creating. */
  defaultBase: ThemeName;
  onDone: (theme: CustomTheme) => void;
  onCancel: () => void;
};

function omitKey<T extends Record<string, unknown>>(obj: T, key: string): Partial<T> {
  const next = { ...obj };
  delete next[key];
  return next;
}

function ColorSwatch({ value }: { value: string }): React.ReactNode {
  // densable Rze — double block with raw color (value already validated or from palette)
  return <Text color={value as 'rgb(0,0,0)'}>{'██'}</Text>;
}

export function CustomThemeEditor({ initial, defaultBase, onDone, onCancel }: Props): React.ReactNode {
  const [, setThemeSetting] = useTheme();
  const { customThemes, reloadCustomThemes, setPreviewOverrides } = useCustomThemes();

  const isFork = initial !== undefined && initial.source !== 'user';
  const [step, setStep] = useState<'name' | 'colors'>(initial && !isFork ? 'colors' : 'name');
  const [name, setName] = useState(initial?.name ?? '');
  const [nameCursor, setNameCursor] = useState(name.length);
  const [slug, setSlug] = useState(isFork ? '' : (initial?.slug ?? ''));
  const base: ThemeName = initial?.base ?? defaultBase;
  const basePalette = useMemo(() => getTheme(base), [base]);
  const [overrides, setOverrides] = useState<Partial<Record<keyof Theme, string>>>(() => initial?.overrides ?? {});
  const [filter, setFilter] = useState('');
  const [editingKey, setEditingKey] = useState<keyof Theme | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editCursor, setEditCursor] = useState(0);

  const tokenKeys = useMemo(() => (Object.keys(basePalette) as (keyof Theme)[]).sort(), [basePalette]);

  const filteredKeys = useMemo(() => {
    const q = filter.toLowerCase();
    return q ? tokenKeys.filter(k => String(k).toLowerCase().includes(q)) : tokenKeys;
  }, [tokenKeys, filter]);

  const effectiveSlug =
    slug ||
    uniqueThemeSlug(
      name,
      customThemes.filter(t => t.slug !== slug),
    );

  // Clear live preview overrides on unmount (densable)
  useEffect(() => {
    return () => setPreviewOverrides(null);
  }, [setPreviewOverrides]);

  const resolveColor = (key: keyof Theme): string => overrides[key] ?? basePalette[key];

  const persist = async (nextSlug: string, nextOverrides: Partial<Record<keyof Theme, string>>) => {
    const trimmed = name.trim() || nextSlug;
    await saveCustomTheme({
      slug: nextSlug,
      name: trimmed,
      base,
      overrides: nextOverrides,
    });
    // densable: disk write → reload provider list so resolvedTheme keeps
    // overrides after setPreviewOverrides(null) on editor exit.
    await reloadCustomThemes();
  };

  // Serialize saves so finish() never reloads a stale file mid-write.
  const persistChainRef = React.useRef(Promise.resolve());

  const applyAndSave = (nextSlug: string, nextOverrides: Partial<Record<keyof Theme, string>>) => {
    setOverrides(nextOverrides);
    setPreviewOverrides(nextOverrides);
    persistChainRef.current = persistChainRef.current
      .then(() => persist(nextSlug, nextOverrides))
      .catch(() => {
        /* non-fatal */
      });
  };

  const finish = () => {
    const doneSlug = slug || effectiveSlug;
    const doneTheme: CustomTheme = {
      slug: doneSlug,
      name: name.trim() || doneSlug,
      base,
      overrides,
      source: 'user',
    };
    // Flush any in-flight color saves, then re-persist current overrides so
    // ThemeProvider.customThemes is current before preview is cleared.
    void persistChainRef.current
      .then(() => persist(doneSlug, overrides))
      .catch(() => {
        /* non-fatal — still exit with local overrides */
      })
      .finally(() => {
        setPreviewOverrides(null);
        onDone(doneTheme);
      });
  };

  // Escape while typing name / color value → Settings confirm:no
  const textActive = step === 'name' || editingKey !== null;
  useKeybinding(
    'confirm:no',
    () => {
      if (editingKey !== null) {
        setPreviewOverrides(overrides);
        setEditingKey(null);
        return;
      }
      onCancel();
    },
    { context: 'Settings', isActive: textActive },
  );

  if (step === 'name') {
    const trimmed = name.trim();
    const canContinue = trimmed.length > 0;
    const title = isFork && initial ? `Fork ${initial.name} to your themes` : 'New custom theme';

    return (
      <Pane color="permission">
        <Box flexDirection="column" gap={1}>
          <Text bold color="permission">
            {title}
          </Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={() => {
                if (!canContinue) return;
                const nextSlug = uniqueThemeSlug(
                  trimmed,
                  customThemes.filter(t => t.slug !== slug),
                );
                setSlug(nextSlug);
                setName(trimmed);
                setStep('colors');
                void saveCustomTheme({
                  slug: nextSlug,
                  name: trimmed,
                  base,
                  overrides,
                })
                  .then(() => reloadCustomThemes())
                  .then(() => {
                    setThemeSetting(`custom:${nextSlug}`);
                  })
                  .catch(() => {
                    /* non-fatal */
                  });
              }}
              onExit={onCancel}
              placeholder="my-theme"
              columns={40}
              cursorOffset={nameCursor}
              onChangeCursorOffset={setNameCursor}
              disableCursorMovementForUpDownKeys
              disableEscapeDoublePress
              focus
              showCursor
            />
          </Box>
          <Text dimColor>
            based on {base} · saved to {getThemesDir()}
            {path.sep}
            {effectiveSlug}.json
          </Text>
          <Text dimColor>
            <Byline>
              {canContinue && <KeyboardShortcutHint shortcut="Enter" action="continue" />}
              <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            </Byline>
          </Text>
        </Box>
      </Pane>
    );
  }

  if (editingKey !== null) {
    const valid = isValidThemeColor(editValue);
    const display = valid ? editValue : basePalette[editingKey];
    return (
      <Pane color="permission">
        <Box flexDirection="column" gap={1}>
          <Text bold color="permission">
            {name}
          </Text>
          <Box>
            <ColorSwatch value={display} />
            <Text> </Text>
            <Text bold>{String(editingKey)}</Text>
          </Box>
          <Text dimColor>preset: {basePalette[editingKey]}</Text>
          <Box>
            <Text>Value: </Text>
            <TextInput
              value={editValue}
              onChange={v => {
                setEditValue(v);
                if (isValidThemeColor(v)) {
                  setPreviewOverrides({ ...overrides, [editingKey]: v });
                }
              }}
              onSubmit={() => {
                if (!isValidThemeColor(editValue)) return;
                const next =
                  editValue === basePalette[editingKey]
                    ? (omitKey(overrides as Record<string, unknown>, String(editingKey)) as Partial<
                        Record<keyof Theme, string>
                      >)
                    : { ...overrides, [editingKey]: editValue };
                applyAndSave(slug || effectiveSlug, next);
                setEditingKey(null);
              }}
              onExit={() => {
                setPreviewOverrides(overrides);
                setEditingKey(null);
              }}
              placeholder="rgb(r,g,b) · #rrggbb · ansi:red"
              columns={40}
              cursorOffset={editCursor}
              onChangeCursorOffset={setEditCursor}
              disableCursorMovementForUpDownKeys
              disableEscapeDoublePress
              focus
              showCursor
            />
          </Box>
          <Text dimColor>
            {valid ? (
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="save" />
                <KeyboardShortcutHint shortcut="Esc" action="cancel" />
              </Byline>
            ) : (
              'Accepts rgb(r,g,b), #rrggbb, ansi256(n), or ansi:name'
            )}
          </Text>
        </Box>
      </Pane>
    );
  }

  const overrideCount = Object.keys(overrides).length;
  const matchLabel =
    overrideCount > 0
      ? `${overrideCount} color${overrideCount === 1 ? '' : 's'} customized · ${slug || effectiveSlug}.json`
      : `editing ${slug || effectiveSlug}.json`;

  return (
    <FuzzyPicker
      title={`${name} · based on ${base}`}
      placeholder="Filter color tokens…"
      items={filteredKeys}
      getKey={k => String(k)}
      initialQuery={filter}
      onQueryChange={setFilter}
      onSelect={key => {
        const current = resolveColor(key);
        setEditValue(current);
        setEditCursor(current.length);
        setEditingKey(key);
      }}
      onTab={{
        action: 'reset',
        handler: key => {
          if (!(key in overrides)) return;
          const next = omitKey(overrides as Record<string, unknown>, String(key)) as Partial<
            Record<keyof Theme, string>
          >;
          applyAndSave(slug || effectiveSlug, next);
        },
      }}
      onCancel={finish}
      selectAction="edit"
      matchLabel={matchLabel}
      emptyMessage="No matching tokens"
      renderItem={(key, isFocused) => {
        const customized = overrides[key] !== undefined;
        return (
          <Box>
            <ColorSwatch value={resolveColor(key)} />
            <Text> </Text>
            <Text color={isFocused ? 'suggestion' : undefined}>{String(key)}</Text>
            {customized && <Text dimColor> custom</Text>}
          </Box>
        );
      }}
      renderPreview={key => (
        <Box flexDirection="column">
          <Text>
            current: <ColorSwatch value={resolveColor(key)} /> {resolveColor(key)}
          </Text>
          {overrides[key] !== undefined && (
            <Text dimColor>
              preset: <ColorSwatch value={basePalette[key]} /> {basePalette[key]}
            </Text>
          )}
        </Box>
      )}
    />
  );
}
