/**
 * densable fiu / miu / CFn / K_w (2.1.239 Iiu MCP table + description clip).
 *
 * Highlight / channel-link / DJn collision-escape are DualInk analogs:
 * keys stay printable or JSON.stringify; block values wrap without ode.
 */
import React, { type ReactNode } from 'react';
import { Box, Link, stringWidth, supportsHyperlinks, Text, wrapAnsi } from '@anthropic/ink';
import { truncateToWidth } from '../utils/truncate.js';

/** densable Kgy — Iiu description line cap */
export const PROMPT_DESCRIPTION_LINE_CAP = 2;

/** densable eLo / RHr / diu / TFA / kFA / CFA / MFA */
const TABLE_INLINE_WIDTH = 80;
const UNITS_BUDGET = 200_000;
const TOTAL_CHAR_BUDGET = UNITS_BUDGET;
const ELEMENT_BUDGET = 10_000;
const MAX_PARAMS = 1000;
const NESTED_KEY_BOUND = 200_000;
const DEPTH_BOUND = 64;
const PARSE_FAILURE_KEY = '__unparsedToolInput';
const DATE_TIME_FORMAT = 'date-time';
const DATE_TIME_FORMATS = new Set([DATE_TIME_FORMAT]);
const UNIX_TS_KEYS = new Set(['ts', 'thread_ts']);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
const YEAR_HINT = /\b\d{4}\b/;
const CLOCK_HINT = /\d{1,2}:\d{2}/;
const SLACK_TS = /^\d{10}\.\d{6}$/;
const HTTP_URL = /^https?:\/\/\S+$/;
/** densable Xgt analog — i4S ∪ s4S */
const WITHHOLD_CHARS = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;

export type ParamFormatHints = Record<string, string>;

export type McpTableEntry = {
  kind: 'inline' | 'block';
  key: string;
  text: string;
  unrenderable?: boolean;
  parseFailureSentinel?: boolean;
  language?: string;
  annotation?: string;
  linkUrl?: string;
};

function jsonStringify(value: unknown): string {
  return JSON.stringify(value);
}

function sanitizeDisplay(text: string): string {
  return text.replace(/\t/g, ' ');
}

function displayKey(key: string): string {
  if (/^[\x20-\x7e]+$/.test(key)) return key;
  return jsonStringify(key);
}

function displayKeys(keys: string[]): Map<string, string> {
  const mapped = new Map<string, string>();
  for (const key of keys) mapped.set(key, displayKey(key));
  const counts = new Map<string, number>();
  for (const shown of mapped.values()) {
    counts.set(shown, (counts.get(shown) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const key of keys) {
    const shown = mapped.get(key) ?? key;
    out.set(key, (counts.get(shown) ?? 0) > 1 ? jsonStringify(key) : shown);
  }
  return out;
}

/** densable AXt */
function fitsInline(key: string, value: string, annotation: string | undefined, columns: number): boolean {
  const extra = annotation === undefined ? 0 : stringWidth(annotation) + 3;
  return stringWidth(key) + 2 + stringWidth(value) + extra <= Math.min(TABLE_INLINE_WIDTH, columns - 2);
}

function isCodeLanguage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256;
}

function formatIsoAnnotation(raw: string): string | undefined {
  const match = raw.trim().match(ISO_DATE);
  if (!match) return undefined;
  const year = Number(match[1] ?? '');
  const month = Number(match[2] ?? '');
  const day = Number(match[3] ?? '');
  if (year < 100) return undefined;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > lastDay) return undefined;
  return raw.trim();
}

function valueAnnotation(key: string, text: string, hints: ParamFormatHints | undefined): string | undefined {
  const dateTime = hints?.[key] === DATE_TIME_FORMAT && YEAR_HINT.test(text) && CLOCK_HINT.test(text);
  if (UNIX_TS_KEYS.has(key) && SLACK_TS.test(text)) {
    return formatIsoAnnotation(new Date(Number(text) * 1000).toISOString());
  }
  if (dateTime || ISO_DATE.test(text)) {
    return formatIsoAnnotation(text);
  }
  return undefined;
}

function linkFor(key: string, text: string): string | undefined {
  if (HTTP_URL.test(text) && !WITHHOLD_CHARS.test(text)) return text;
  void key;
  return undefined;
}

/** densable yCe */
export function parseFailureSentinel(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const entries = Object.entries(input);
  if (entries.length !== 1) return null;
  const [key, value] = entries[0]!;
  if (key !== PARSE_FAILURE_KEY || typeof value !== 'object' || value === null) {
    return null;
  }
  const raw = (value as { raw?: unknown; len?: unknown }).raw;
  const len = (value as { raw?: unknown; len?: unknown }).len;
  if (typeof raw !== 'string' || typeof len !== 'number') return null;
  return `input JSON failed to parse — ${len} bytes`;
}

/** densable piu */
function formatNested(
  value: unknown,
  indent = 0,
  depth = 0,
  budget = { remaining: ELEMENT_BUDGET, unitsRemaining: UNITS_BUDGET },
): string {
  if (typeof value === 'string') {
    if (value.length + 2 > budget.unitsRemaining) {
      throw new Error('value exceeds the units display budget');
    }
    const encoded = jsonStringify(value);
    budget.unitsRemaining -= encoded.length;
    if (budget.unitsRemaining < 0) {
      throw new Error('value exceeds the units display budget');
    }
    return encoded;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    const encoded = String(value);
    budget.unitsRemaining -= encoded.length;
    if (budget.unitsRemaining < 0) {
      throw new Error('value exceeds the units display budget');
    }
    return encoded;
  }
  if (depth >= DEPTH_BOUND) {
    throw new Error('value exceeds the display depth bound');
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const length = value.length;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      throw new Error('value exceeds the element display budget');
    }
    budget.remaining -= length;
    if (budget.remaining < 0) {
      throw new Error('value exceeds the element display budget');
    }
    const items = [];
    for (let i = 0; i < length; i++) {
      items.push(formatNested(value[i], indent + 1, depth + 1, budget));
    }
    if (items.every(item => !item.includes('\n'))) {
      const inline = `[${items.join(', ')}]`;
      if (stringWidth(inline) <= TABLE_INLINE_WIDTH) return inline;
    }
    const inner = '  '.repeat(indent + 1);
    const outer = '  '.repeat(indent);
    return `[\n${items.map(item => inner + item).join(',\n')}\n${outer}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    budget.remaining -= entries.length;
    if (budget.remaining < 0) {
      throw new Error('value exceeds the element display budget');
    }
    for (const [key] of entries) {
      if (key.length > NESTED_KEY_BOUND) {
        throw new Error('nested key exceeds the display bound');
      }
      if (key.length > budget.unitsRemaining) {
        throw new Error('keys exceed the units display budget');
      }
      budget.unitsRemaining -= key.length;
    }
    const keys = displayKeys(entries.map(([key]) => key));
    for (const [key] of entries) {
      const shown = keys.get(key) ?? key;
      if (shown.length > key.length) {
        budget.unitsRemaining -= shown.length - key.length;
        if (budget.unitsRemaining < 0) {
          throw new Error('keys exceed the units display budget');
        }
      }
    }
    const fields = entries.map(
      ([key, nested]) => `${keys.get(key) ?? key}: ${formatNested(nested, indent + 1, depth + 1, budget)}`,
    );
    if (fields.every(field => !field.includes('\n'))) {
      const inline = `{ ${fields.join(', ')} }`;
      if (stringWidth(inline) <= TABLE_INLINE_WIDTH) return inline;
    }
    const inner = '  '.repeat(indent + 1);
    const outer = '  '.repeat(indent);
    return `{\n${fields.map(field => inner + field).join(',\n')}\n${outer}}`;
  }
  if (typeof value === 'bigint') {
    throw new Error('bigint value cannot be rendered');
  }
  return 'undefined';
}

function unrenderableRow(key: string, text: string, columns: number): McpTableEntry {
  if (!fitsInline(key, text, undefined, columns)) {
    return { kind: 'block', key, text, unrenderable: true };
  }
  return { kind: 'inline', key, text, unrenderable: true };
}

/** densable K_w */
export function paramFormatHintsFromSchema(schema: unknown): ParamFormatHints | undefined {
  const properties =
    schema !== null && typeof schema === 'object' ? (schema as { properties?: unknown }).properties : undefined;
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return undefined;
  }
  let hints: ParamFormatHints | undefined;
  for (const [name, spec] of Object.entries(properties)) {
    if (spec === null || typeof spec !== 'object' || !('format' in spec)) continue;
    const format = (spec as { format?: unknown }).format;
    if (typeof format === 'string' && DATE_TIME_FORMATS.has(format)) {
      hints ??= {};
      hints[name] = format;
    }
  }
  return hints;
}

/** densable CFn — wrap-ansi trim+hard, then clip to `maxLines`. */
export function clipWrappedLines(text: string, width: number, maxLines: number): string {
  if (maxLines <= 0 || width <= 0) return '';
  const wrapped = wrapAnsi(text, width, { trim: true, hard: true }).split('\n');
  if (wrapped.length <= maxLines) return wrapped.join('\n');
  const clipped = wrapped.slice(0, maxLines);
  clipped[maxLines - 1] = truncateToWidth(`${clipped[maxLines - 1] ?? ''}…`, width);
  return clipped.join('\n');
}

/** densable rUA */
export function isUnrenderableEntry(entry: McpTableEntry): boolean {
  return entry.unrenderable === true;
}

/** densable fiu */
export function buildMcpParamTable(
  input: unknown,
  hints?: ParamFormatHints,
  columns: number = TABLE_INLINE_WIDTH,
): McpTableEntry[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return [
      {
        kind: 'inline',
        key: 'input',
        text: '(parameters are not an object — deny unless expected)',
        unrenderable: true,
      },
    ];
  }
  const entries = Object.entries(input);
  const parseFail = parseFailureSentinel(input);
  if (parseFail !== null) {
    return [
      {
        kind: 'inline',
        key: 'input',
        text: parseFail,
        unrenderable: true,
        parseFailureSentinel: true,
      },
    ];
  }
  const rows: McpTableEntry[] = [];
  if (entries.length > MAX_PARAMS) {
    return [
      {
        kind: 'inline',
        key: 'input',
        text: `(${entries.length} parameters — too many to show — deny unless expected)`,
        unrenderable: true,
      },
    ];
  }
  const shownKeys: string[] = [];
  let oversizedNames = 0;
  let totalChars = 0;
  for (const [key, value] of entries) {
    if (key.length > UNITS_BUDGET) {
      oversizedNames += 1;
      continue;
    }
    shownKeys.push(key);
    totalChars += key.length;
    if (typeof value === 'string' && value.length <= UNITS_BUDGET) {
      totalChars += value.length;
    }
  }
  if (totalChars > TOTAL_CHAR_BUDGET) {
    return [
      {
        kind: 'inline',
        key: 'input',
        text: `(parameters total ${totalChars.toLocaleString()} characters — too much to show — deny unless expected)`,
        unrenderable: true,
      },
    ];
  }
  if (oversizedNames > 0) {
    rows.push({
      kind: 'inline',
      key: 'input',
      text: `(${oversizedNames} parameter ${oversizedNames === 1 ? 'name is' : 'names are'} too large to show — deny unless expected)`,
      unrenderable: true,
    });
  }
  const keys = displayKeys(shownKeys);
  const language = entries.find(([key]) => key === 'language')?.[1];
  for (const [key, value] of entries) {
    if (key.length > UNITS_BUDGET) continue;
    const shown = keys.get(key) ?? key;
    if (typeof value === 'string') {
      if (value.length > UNITS_BUDGET) {
        rows.push(
          unrenderableRow(
            shown,
            `(value of ${value.length.toLocaleString()} characters cannot be shown — deny unless expected)`,
            columns,
          ),
        );
        continue;
      }
      const cleaned = sanitizeDisplay(value);
      if (WITHHOLD_CHARS.test(cleaned)) {
        rows.push(
          unrenderableRow(
            shown,
            `(value of ${value.length.toLocaleString()} characters cannot be shown in full — deny unless expected)`,
            columns,
          ),
        );
        continue;
      }
      const spaced = cleaned.replace(/\t/g, ' ');
      if (cleaned.includes('\n') || stringWidth(cleaned) > TABLE_INLINE_WIDTH) {
        rows.push({
          kind: 'block',
          key: shown,
          text: spaced,
          language: key === 'code' && isCodeLanguage(language) ? language : undefined,
        });
        continue;
      }
      const encoded = jsonStringify(cleaned);
      const annotation = valueAnnotation(key, cleaned, hints);
      if (!fitsInline(shown, encoded, annotation, columns)) {
        rows.push({
          kind: 'block',
          key: shown,
          text: spaced,
          annotation,
          language: key === 'code' && isCodeLanguage(language) ? language : undefined,
        });
        continue;
      }
      rows.push({
        kind: 'inline',
        key: shown,
        text: encoded,
        linkUrl: linkFor(key, cleaned),
        annotation,
      });
      continue;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value);
      if (!fitsInline(shown, text, undefined, columns)) {
        rows.push({ kind: 'block', key: shown, text });
        continue;
      }
      rows.push({ kind: 'inline', key: shown, text });
      continue;
    }
    let formatted: string;
    let formattedLength = 0;
    try {
      const nested = formatNested(value, 0);
      formattedLength = nested.length;
      if (nested.length > UNITS_BUDGET) {
        rows.push(
          unrenderableRow(
            shown,
            `(value of ${nested.length.toLocaleString()} formatted characters cannot be shown — deny unless expected)`,
            columns,
          ),
        );
        continue;
      }
      formatted = sanitizeDisplay(nested);
    } catch {
      rows.push(
        unrenderableRow(shown, '(value too large or too deeply nested to render — deny unless expected)', columns),
      );
      continue;
    }
    totalChars += formattedLength;
    if (totalChars > TOTAL_CHAR_BUDGET) {
      return [
        {
          kind: 'inline',
          key: 'input',
          text: `(parameters total over ${TOTAL_CHAR_BUDGET.toLocaleString()} rendered characters — too much to show — deny unless expected)`,
          unrenderable: true,
        },
      ];
    }
    if (WITHHOLD_CHARS.test(formatted)) {
      rows.push(
        unrenderableRow(
          shown,
          `(value of ${formattedLength.toLocaleString()} formatted characters cannot be shown in full — deny unless expected)`,
          columns,
        ),
      );
      continue;
    }
    if (formatted.includes('\n') || stringWidth(formatted) > TABLE_INLINE_WIDTH) {
      rows.push({ kind: 'block', key: shown, text: formatted });
      continue;
    }
    if (!fitsInline(shown, formatted, undefined, columns)) {
      rows.push({ kind: 'block', key: shown, text: formatted });
      continue;
    }
    rows.push({ kind: 'inline', key: shown, text: formatted });
  }
  return rows;
}

/** densable sz fallback when OSC 8 is off. */
function linkedInlineText(url: string, text: string): string {
  if (text !== url && url !== `http://${text}` && url !== `https://${text}`) {
    return `${text} (${url})`;
  }
  return url;
}

/** densable miu — DualInk wrap, no ode highlight. gd+sz for linkUrl. */
export function McpParamTable({
  entries,
  contentColumns,
}: {
  entries: McpTableEntry[];
  contentColumns: number;
}): ReactNode {
  const sentinel =
    entries.length === 1 && entries[0]!.kind === 'inline' && entries[0]!.parseFailureSentinel === true
      ? entries[0]!
      : null;
  if (sentinel !== null) {
    return (
      <Box marginTop={1}>
        <Text dimColor>{sentinel.text}</Text>
      </Box>
    );
  }
  if (entries.length === 0) return null;
  const wrapWidth = Math.max(10, contentColumns - 4);
  return (
    <Box flexDirection="column" marginTop={1}>
      {entries.map((entry, index) =>
        entry.kind === 'inline' ? (
          <Text key={index}>
            <Text dimColor>{entry.key}: </Text>
            {entry.linkUrl !== undefined && supportsHyperlinks() ? (
              <Link url={entry.linkUrl}>{entry.text}</Link>
            ) : (
              <Text>{entry.linkUrl !== undefined ? linkedInlineText(entry.linkUrl, entry.text) : entry.text}</Text>
            )}
            {entry.annotation !== undefined ? <Text dimColor> ({entry.annotation})</Text> : null}
          </Text>
        ) : (
          <Box key={index} flexDirection="column">
            <Text dimColor>{entry.key}:</Text>
            <Box
              marginLeft={2}
              borderStyle="single"
              borderLeft
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderDimColor
              paddingLeft={1}
            >
              <Text>{wrapAnsi(entry.text, wrapWidth, { hard: true, trim: false })}</Text>
            </Box>
            {entry.annotation !== undefined ? (
              <Box marginLeft={2}>
                <Text dimColor>({entry.annotation})</Text>
              </Box>
            ) : null}
          </Box>
        ),
      )}
    </Box>
  );
}
