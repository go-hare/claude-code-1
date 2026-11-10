import { mkdir, writeFile } from 'fs/promises';
import { marked, type Tokens } from 'marked';
import { tmpdir } from 'os';
import { join } from 'path';
import React, { useContext, useRef } from 'react';
import {
  AccessibilityContext,
  Box,
  Byline,
  type KeyboardEvent,
  KeyboardShortcutHint,
  Pane,
  setClipboard,
  stringWidth,
  Text,
} from '@anthropic/ink';
import type { CommandResultDisplay } from '../../commands.js';
import { ItemList } from '../../components/ItemList.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { logEvent } from '../../services/analytics/index.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { AssistantMessage, Message } from '../../types/message.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { extractTextContent, stripPromptXMLTags } from '../../utils/messages.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { countCharInString, truncateCodeUnitsSafe } from '../../utils/stringUtils.js';

const COPY_DIR = join(tmpdir(), 'claude');
const RESPONSE_FILENAME = 'response.md';
const MAX_LOOKBACK = 20;
const CODE_BLOCK_LABEL_MAX_LEN = 120;

type CodeBlock = {
  code: string;
  lang: string | undefined;
};

function extractCodeBlocks(markdown: string): CodeBlock[] {
  const tokens = marked.lexer(stripPromptXMLTags(markdown));
  const blocks: CodeBlock[] = [];
  for (const token of tokens) {
    if (token.type === 'code') {
      const codeToken = token as Tokens.Code;
      blocks.push({ code: codeToken.text, lang: codeToken.lang });
    }
  }
  return blocks;
}

function extractTableCellRaw(cell: Tokens.TableCell): string {
  return cell.tokens.map(token => token.raw).join('');
}

function safeRepeat(str: string, count: number): string {
  return str.repeat(Number.isFinite(count) && count > 0 ? count : 0);
}

export function tableTokenToMarkdown(token: Tokens.Table): string {
  const rows = [token.header.map(extractTableCellRaw), ...token.rows.map(row => row.map(extractTableCellRaw))].map(
    row => row.map(cell => cell.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ')),
  );
  const colWidths = rows[0]!.map((_cell, colIdx) => Math.max(3, ...rows.map(row => stringWidth(row[colIdx] ?? ''))));
  const formatRow = (row: string[]): string =>
    `| ${row.map((cell, colIdx) => cell + ' '.repeat(Math.max(0, colWidths[colIdx]! - stringWidth(cell)))).join(' | ')} |`;
  const formatSeparatorCell = (width: number, align: 'center' | 'left' | 'right' | null): string => {
    switch (align) {
      case 'center':
        return `:${safeRepeat('-', width - 2)}:`;
      case 'right':
        return `${safeRepeat('-', width - 1)}:`;
      case 'left':
        return `:${safeRepeat('-', width - 1)}`;
      default:
        return '-'.repeat(width);
    }
  };
  const separatorRow = `| ${colWidths.map((width, colIdx) => formatSeparatorCell(width, token.align[colIdx] ?? null)).join(' | ')} |`;
  const [headerRow, ...bodyRows] = rows;
  return [formatRow(headerRow!), separatorRow, ...bodyRows.map(formatRow)].join('\n');
}

export function normalizeTablesInMarkdown(markdown: string): string {
  const tokens = marked.lexer(markdown);
  let result = markdown;
  let searchFrom = 0;
  let offsetDelta = 0;
  for (const token of tokens) {
    const idx = markdown.indexOf(token.raw, searchFrom);
    if (idx === -1) continue;
    searchFrom = idx + token.raw.length;
    if (token.type !== 'table') continue;
    const trailingNewlines = token.raw.match(/\n*$/)?.[0] ?? '';
    const replacement = tableTokenToMarkdown(token as Tokens.Table) + trailingNewlines;
    result = result.slice(0, idx + offsetDelta) + replacement + result.slice(idx + token.raw.length + offsetDelta);
    offsetDelta += replacement.length - token.raw.length;
  }
  return result;
}

/**
 * Walk messages newest-first, returning text from assistant messages that
 * actually said something (skips tool-use-only turns and API errors).
 * Index 0 = latest, 1 = second-to-latest, etc. Caps at MAX_LOOKBACK.
 */
export function collectRecentAssistantTexts(messages: Message[]): string[] {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && texts.length < MAX_LOOKBACK; i--) {
    const msg = messages[i];
    if (msg?.type !== 'assistant' || msg.isApiErrorMessage) continue;
    const content = (msg as AssistantMessage).message.content;
    if (!Array.isArray(content)) continue;
    const text = extractTextContent(content, '\n\n');
    if (text) texts.push(text);
  }
  return texts;
}

export function fileExtension(lang: string | undefined): string {
  if (lang) {
    // Sanitize to prevent path traversal (e.g. ```../../etc/passwd)
    // Language identifiers are alphanumeric: python, tsx, jsonc, etc.
    const sanitized = lang.replace(/[^a-zA-Z0-9]/g, '');
    if (sanitized && sanitized !== 'plaintext') {
      return `.${sanitized}`;
    }
  }
  return '.txt';
}

function hasOsc52ClipboardUtf8Bug(): boolean {
  if (process.env.TERM_PROGRAM !== 'vscode') return false;
  const ver = process.env.TERM_PROGRAM_VERSION;
  if (!ver) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(ver);
  if (!match) return false;
  const num = Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
  return num >= 1_123_000 && num < 1_125_000;
}

function getOsc52ClipboardWarning(text: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII range check matching official ft
  if (!hasOsc52ClipboardUtf8Bug() || !/[^\x00-\x7f]/.test(text)) return null;
  return 'VS Code 1.123/1.124 will mojibake this paste \u2014 update to \u22651.125';
}

async function writeToFile(text: string, filename: string): Promise<string> {
  const filePath = join(COPY_DIR, filename);
  await mkdir(COPY_DIR, { recursive: true, mode: 0o700 });
  await writeFile(filePath, text, { encoding: 'utf-8' });
  return filePath;
}

async function copyOrWriteToFile(text: string, filename: string): Promise<string> {
  const raw = await setClipboard(text);
  if (raw) process.stdout.write(raw);
  const lineCount = countCharInString(text, '\n') + 1;
  const summary = `Copied to clipboard (${text.length} characters, ${lineCount} lines)`;
  const warning = getOsc52ClipboardWarning(text);
  // Also write to a temp file — clipboard paths are best-effort (OSC 52 needs
  // terminal support), so the file provides a reliable fallback.
  try {
    const filePath = await writeToFile(text, filename);
    const warningLine = warning ? `\n\u26A0 ${warning}; the file below is unaffected` : '';
    return `${summary}${warningLine}\nAlso written to ${filePath}`;
  } catch {
    const warningLine = warning ? `\n\u26A0 ${warning}` : '';
    return `${summary}${warningLine}`;
  }
}

function formatCodeBlockLabel(code: string): string {
  const firstNonEmpty = code.split('\n').find(line => line.trim() !== '');
  if (firstNonEmpty === undefined) return '(code block)';
  const truncated = truncateCodeUnitsSafe(firstNonEmpty, CODE_BLOCK_LABEL_MAX_LEN);
  return truncated === firstNonEmpty ? firstNonEmpty : `${truncated}\u2026`;
}

type PickerProps = {
  fullText: string;
  codeBlocks: CodeBlock[];
  messageAge: number;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

type PickerSelection = number | 'full' | 'always';

function CopyPicker({ fullText, codeBlocks, messageAge, onDone }: PickerProps): React.ReactNode {
  const focusedIndexRef = useRef(0);
  const handleCancel = (): void => {
    onDone('Copy cancelled', { display: 'system' });
  };
  const exitState = useExitOnCtrlCDWithKeybindings(handleCancel);
  useKeybinding('select:cancel', handleCancel, { context: 'Select' });
  const isScreenReader = useContext(AccessibilityContext) || isScreenReaderModeEnabled();

  const items: PickerSelection[] = ['full', ...codeBlocks.map((_, index) => index), 'always'];

  const fullMeta = [`${fullText.length} chars`, `${countCharInString(fullText, '\n') + 1} lines`];
  const options = [
    {
      label: 'Full response',
      value: 'full' as PickerSelection,
      meta: fullMeta,
      facts: fullMeta,
    },
    ...codeBlocks.map((block, index) => {
      const blockLines = countCharInString(block.code, '\n') + 1;
      const meta = [block.lang, blockLines > 1 ? `${blockLines} lines` : undefined].filter((x): x is string =>
        Boolean(x),
      );
      return {
        label: formatCodeBlockLabel(block.code),
        value: index as PickerSelection,
        meta,
        facts: meta.length > 0 ? [meta.join(', ')] : [],
      };
    }),
    {
      label: 'Always copy full response',
      value: 'always' as PickerSelection,
      description: 'Skip this picker in the future (revert via /config)',
    },
  ];

  function getSelectionContent(selected: PickerSelection): {
    text: string;
    filename: string;
    blockIndex?: number;
  } {
    if (selected === 'full' || selected === 'always') {
      return { text: fullText, filename: RESPONSE_FILENAME };
    }
    const block = codeBlocks[selected]!;
    return {
      text: block.code,
      filename: `copy${fileExtension(block.lang)}`,
      blockIndex: selected,
    };
  }

  async function handleSelect(selected: PickerSelection): Promise<void> {
    const content = getSelectionContent(selected);
    if (selected === 'always') {
      if (!getGlobalConfig().copyFullResponse) {
        saveGlobalConfig(c => ({ ...c, copyFullResponse: true }));
      }
      logEvent('tengu_copy', {
        block_count: codeBlocks.length,
        always: true,
        message_age: messageAge,
      });
      const result = await copyOrWriteToFile(content.text, content.filename);
      onDone(`${result}\nPreference saved. Use /config to change copyFullResponse`);
      return;
    }
    logEvent('tengu_copy', {
      selected_block: content.blockIndex,
      block_count: codeBlocks.length,
      message_age: messageAge,
    });
    const result = await copyOrWriteToFile(content.text, content.filename);
    onDone(result);
  }

  async function handleWrite(selected: PickerSelection): Promise<void> {
    const content = getSelectionContent(selected);
    logEvent('tengu_copy', {
      selected_block: content.blockIndex,
      block_count: codeBlocks.length,
      message_age: messageAge,
      write_shortcut: true,
    });
    try {
      const filePath = await writeToFile(content.text, content.filename);
      onDone(`Written to ${filePath}`);
    } catch (e) {
      onDone(`Failed to write file: ${e instanceof Error ? e.message : e}`);
    }
  }

  function onRowKeyDown(e: KeyboardEvent, index: number): void {
    const selected = items[index];
    if (e.key !== 'w' || e.ctrl || e.meta || selected === undefined) {
      return;
    }
    e.preventDefault();
    void handleWrite(selected);
  }

  return (
    <Pane>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Select content to copy:</Text>
        <Box
          flexDirection="column"
          onKeyDown={e => {
            if (isScreenReader) {
              if (e.key !== 'w' || e.ctrl || e.meta) return;
              e.preventDefault();
              void handleWrite('full');
              return;
            }
            onRowKeyDown(e, focusedIndexRef.current);
          }}
        >
          <ItemList
            options={options}
            onFocus={index => {
              focusedIndexRef.current = index;
            }}
            onSelect={index => {
              const selected = items[index];
              if (selected !== undefined) {
                void handleSelect(selected);
              }
            }}
          />
        </Box>
        <Text dimColor>
          {exitState.pending ? (
            `Press ${exitState.keyName} again to cancel`
          ) : (
            <Byline>
              {!isScreenReader && <KeyboardShortcutHint shortcut="enter" action="copy" />}
              <KeyboardShortcutHint
                shortcut="w"
                action={isScreenReader ? 'write full response to file' : 'write to file'}
              />
              <KeyboardShortcutHint shortcut="esc" action="cancel" />
            </Byline>
          )}
        </Text>
      </Box>
    </Pane>
  );
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const texts = collectRecentAssistantTexts(context.messages);

  if (texts.length === 0) {
    onDone('No assistant message to copy');
    return null;
  }

  // /copy N reaches back N-1 messages (1 = latest, 2 = second-to-latest, ...)
  let age = 0;
  const arg = args?.trim();
  if (arg) {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1) {
      onDone(`Usage: /copy [N] where N is 1 (latest), 2, 3, \u2026 Got: ${arg}`);
      return null;
    }
    if (n > texts.length) {
      onDone(`Only ${texts.length} assistant ${texts.length === 1 ? 'message' : 'messages'} available to copy`);
      return null;
    }
    age = n - 1;
  }

  const text = normalizeTablesInMarkdown(stripPromptXMLTags(texts[age]!));
  const codeBlocks = extractCodeBlocks(text);
  const config = getGlobalConfig();

  if (codeBlocks.length === 0 || config.copyFullResponse) {
    logEvent('tengu_copy', {
      always: config.copyFullResponse,
      block_count: codeBlocks.length,
      message_age: age,
    });
    const result = await copyOrWriteToFile(text, RESPONSE_FILENAME);
    onDone(result);
    return null;
  }

  return <CopyPicker fullText={text} codeBlocks={codeBlocks} messageAge={age} onDone={onDone} />;
};
