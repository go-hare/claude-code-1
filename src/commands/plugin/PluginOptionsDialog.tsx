import figures from 'figures';
import React, { useCallback, useMemo, useState } from 'react';
import { Dialog } from '@anthropic/ink';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text input for config dialog
import { Box, Text, useInput, stringWidth } from '@anthropic/ink';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import type { McpbUserConfigurationOption } from '../../utils/plugins/mcpbHandler.js';
import type { PluginOptionSchema, PluginOptionValues } from '../../utils/plugins/pluginOptionsStorage.js';

/**
 * densable 2.1.283 `zs`: first-line split + trim; empty sensitive keep existing
 * (omit); empty number omit; empty non-required omit if no initial; number /
 * boolean / string coerce.
 *
 * Exported for unit testing.
 */
export function buildFinalValues(
  fields: string[],
  collected: Record<string, string>,
  configSchema: PluginOptionSchema,
  initialValues: PluginOptionValues | undefined,
): PluginOptionValues {
  const finalValues: PluginOptionValues = {};
  for (const fieldKey of fields) {
    const schema = configSchema[fieldKey];
    const value = ((collected[fieldKey] ?? '').split(/\r\n|\r|\n/, 1)[0] ?? '').trim();

    if (value === '') {
      if (schema?.sensitive === true && initialValues?.[fieldKey] !== undefined) {
        continue;
      }
      if (schema?.type === 'number') {
        continue;
      }
      if (schema?.required !== true && initialValues?.[fieldKey] === undefined) {
        continue;
      }
    }

    if (schema?.type === 'number') {
      const num = Number(value);
      finalValues[fieldKey] = Number.isNaN(num) ? value : num;
    } else if (schema?.type === 'boolean') {
      finalValues[fieldKey] = isEnvTruthy(value);
    } else {
      finalValues[fieldKey] = value;
    }
  }
  return finalValues;
}

/** densable `Ki` — string + options (not multiple) → select choices. */
export function stringOptions(schema: McpbUserConfigurationOption | undefined): string[] | undefined {
  return schema?.type === 'string' && schema.multiple !== true ? schema.options : undefined;
}

export type PluginOptionField =
  | {
      type: 'select';
      key: string;
      label: string;
      options: string[];
      hint: () => string | undefined;
    }
  | {
      type: 'text';
      key: string;
      label: string;
      required: boolean;
      mask: '*' | undefined;
      placeholder: string | undefined;
      hint: () => string | undefined;
    };

/**
 * densable `Ao` field list: string+options → select; sensitive mask `*`;
 * existing secret placeholder `(unchanged)`.
 */
export function buildFieldDescriptors(
  fields: string[],
  configSchema: PluginOptionSchema,
  initialValues: PluginOptionValues | undefined,
): PluginOptionField[] {
  return fields.map(key => {
    const schema = configSchema[key];
    const options = stringOptions(schema);
    if (options !== undefined) {
      return {
        type: 'select' as const,
        key,
        label: schema?.title || key,
        options,
        hint: () => schema?.description,
      };
    }
    const sensitive = schema?.sensitive === true;
    const existingSecret = sensitive && initialValues?.[key] !== undefined;
    return {
      type: 'text' as const,
      key,
      label: schema?.title || key,
      required: schema?.required === true && !existingSecret,
      mask: sensitive ? '*' : undefined,
      placeholder: existingSecret ? '(unchanged)' : undefined,
      hint: () => schema?.description,
    };
  });
}

/** densable `Ao` initial buffer: skip sensitive; select prefers initial/default in options else first option. */
export function initialCollectedValues(
  fields: string[],
  configSchema: PluginOptionSchema,
  initialValues: PluginOptionValues | undefined,
): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const key of fields) {
    const schema = configSchema[key];
    const existing = schema?.sensitive === true ? undefined : initialValues?.[key];
    const options = stringOptions(schema);
    if (options === undefined) {
      collected[key] = existing === undefined ? '' : String(existing);
    } else {
      const preferred = [existing, schema?.default].find(
        (candidate): candidate is string => typeof candidate === 'string' && options.includes(candidate),
      );
      collected[key] = preferred ?? options[0] ?? '';
    }
  }
  return collected;
}

type Props = {
  title: string;
  subtitle: string;
  configSchema: PluginOptionSchema;
  /** Pre-fill fields when reconfiguring. Sensitive fields are not prepopulated. */
  initialValues?: PluginOptionValues;
  onSave: (config: PluginOptionValues) => void;
  onCancel: () => void;
};

/** densable MN `k(P)` — required empty text blocks submit. */
export function requiredFieldError(field: PluginOptionField, value: string): string | null {
  if (field.type !== 'text') return null;
  if (field.required && value.trim() === '') return `${field.label} is required`;
  return null;
}

/**
 * densable `Ao` → `MN` @199566135: all fields + Save configuration row.
 * Required empty trim blocks submit. Select ←/→ cycles options.
 */
export function PluginOptionsDialog({
  title,
  subtitle,
  configSchema,
  initialValues,
  onSave,
  onCancel,
}: Props): React.ReactNode {
  const fields = useMemo(() => Object.keys(configSchema), [configSchema]);
  const descriptors = useMemo(
    () => buildFieldDescriptors(fields, configSchema, initialValues),
    [fields, configSchema, initialValues],
  );

  const [focus, setFocus] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialCollectedValues(fields, configSchema, initialValues),
  );

  const saveIndex = descriptors.length;
  const focusedField = focus < descriptors.length ? descriptors[focus] : undefined;
  const blockingError = descriptors
    .map(field => requiredFieldError(field, values[field.key] ?? ''))
    .find(error => error !== null);

  const moveFocus = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(saveIndex, next));
      if (clamped === focus) return;
      setFocus(clamped);
    },
    [focus, saveIndex],
  );

  const submit = useCallback(() => {
    if (blockingError) return;
    onSave(buildFinalValues(fields, values, configSchema, initialValues));
  }, [blockingError, fields, values, configSchema, initialValues, onSave]);

  const accept = useCallback(() => {
    if (focus === saveIndex) submit();
    else moveFocus(focus + 1);
  }, [focus, saveIndex, submit, moveFocus]);

  const cycleSelect = useCallback(
    (delta: number) => {
      if (focusedField?.type !== 'select') return;
      const options = focusedField.options;
      const current = values[focusedField.key] ?? options[0] ?? '';
      const idx = options.indexOf(current);
      const next = options[(idx + delta + options.length) % options.length];
      if (next !== undefined) {
        setValues(prev => ({ ...prev, [focusedField.key]: next }));
      }
    },
    [focusedField, values],
  );

  useKeybinding('confirm:no', onCancel, { context: 'Settings' });
  useKeybindings(
    {
      'select:previous': () => moveFocus(focus - 1),
      'select:next': () => moveFocus(focus + 1),
      'select:accept': accept,
      'select:cancel': onCancel,
    },
    { context: 'Select', isActive: focusedField?.type !== 'text' },
  );
  useKeybindings(
    {
      'tabs:previous': () => cycleSelect(-1),
      'tabs:next': () => cycleSelect(1),
    },
    { context: 'Tabs', isActive: focusedField?.type === 'select' },
  );

  useInput((char, key) => {
    if (focusedField?.type !== 'text') return;
    if (key.return) {
      accept();
      return;
    }
    if (key.backspace || key.delete) {
      setValues(prev => ({
        ...prev,
        [focusedField.key]: (prev[focusedField.key] ?? '').slice(0, -1),
      }));
      return;
    }
    if (char && !key.ctrl && !key.meta && !key.tab && !key.return) {
      setValues(prev => ({
        ...prev,
        [focusedField.key]: (prev[focusedField.key] ?? '') + char,
      }));
    }
  });

  if (descriptors.length === 0) return null;

  return (
    <Dialog title={title} subtitle={subtitle} onCancel={onCancel} isCancelActive={false}>
      <Box flexDirection="column">
        {descriptors.map((field, index) => {
          const raw = values[field.key] ?? '';
          const focused = index === focus;
          const display = field.type === 'text' && field.mask ? field.mask.repeat(stringWidth(raw)) : raw;
          const placeholder = field.type === 'text' && field.placeholder !== undefined && raw === '';
          return (
            <Box key={field.key} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
              <Text bold={focused}>
                {focused ? figures.pointerSmall + ' ' : '  '}
                {field.label}
                {field.type === 'text' && field.required ? <Text color="error"> *</Text> : null}
              </Text>
              {field.type === 'select' ? (
                <Text dimColor={!focused}>
                  {'  '}
                  {focused ? '◂ ' : '  '}
                  {raw}
                  {focused ? ' ▸' : ''}
                </Text>
              ) : (
                <Text dimColor={placeholder || !focused}>
                  {'  '}
                  {placeholder ? field.placeholder : display}
                  {focused ? '█' : ''}
                </Text>
              )}
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text color={focus === saveIndex ? 'suggestion' : undefined}>
            {focus === saveIndex ? figures.pointer + ' ' : '  '}
            Save configuration
          </Text>
        </Box>
        {blockingError ? <Text color="error">{blockingError}</Text> : null}
      </Box>
    </Dialog>
  );
}
