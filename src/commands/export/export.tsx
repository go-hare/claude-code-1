import { mkdirSync, writeFileSync } from 'fs';
import { dirname, extname, isAbsolute, join, resolve } from 'path';
import React from 'react';
import { getClipboardPath } from '@anthropic/ink';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { ExportDialog } from '../../components/ExportDialog.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { getCwd } from '../../utils/cwd.js';
import { renderMessagesToPlainText } from '../../utils/exportRenderer.js';
import { isRemoteWorkspace } from '../../utils/ultraplanKeyword.js';
import { CLIPBOARD_COPY_STATUS, type ClipboardCopyOutcome } from '../copy/copy.js';

/**
 * Official 2.1.327 (#379) `v`: thrown when exporting in refuse mode to an
 * existing file so `/export <name>` keeps the existing file and tells the user
 * to run `/export` to overwrite it, and the dialog can prompt to overwrite.
 */
export class ExportFileExistsError extends Error {
  readonly filepath: string;
  constructor(filepath: string) {
    super('the file already exists · run /export to overwrite it');
    this.name = 'ExportFileExistsError';
    this.filepath = filepath;
  }
}

/**
 * Official 2.1.327 (#379) + 2.1.328 (#611): reject empty filenames (preventing
 * writing `.txt`), append `.txt` only when no extension is present, and resolve
 * relative to launch dir (in remote workspace) or current working directory.
 */
export function resolveExportFilePath(rawFilename: string, baseDir?: string): string {
  const trimmed = rawFilename.trim();
  if (!trimmed || trimmed === '.txt') {
    throw new Error("Filename can't be empty");
  }
  const finalFilename = extname(trimmed) === '' ? `${trimmed}.txt` : trimmed;
  if (isAbsolute(finalFilename)) {
    return finalFilename;
  }
  const dir = baseDir ?? (isRemoteWorkspace() ? getOriginalCwd() : getCwd());
  return resolve(dir, finalFilename);
}

/**
 * Official 2.1.327 (#379) `C`: atomic create-only (`flag: 'wx'`) when
 * `mode === 'refuse'` so existing files are never silently overwritten.
 */
export function writeExportFile(
  rawFilename: string,
  content: string,
  mode: 'refuse' | 'overwrite' = 'refuse',
  baseDir?: string,
): string {
  const filepath = resolveExportFilePath(rawFilename, baseDir);
  mkdirSync(dirname(filepath), { recursive: true });
  try {
    writeFileSync(filepath, content, {
      encoding: 'utf-8',
      flag: mode === 'refuse' ? 'wx' : 'w',
      flush: true,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'EEXIST') {
      throw new ExportFileExistsError(filepath);
    }
    throw error;
  }
  return filepath;
}

const EXPORT_CLIPBOARD_HINT: Record<ClipboardCopyOutcome, string> = {
  native: '',
  'tmux-buffer': ' · paste with prefix + ]',
  osc52: ' · if paste fails, /export to a file',
  none: ' · /export to a file instead',
};

/**
 * Official 2.1.326 #177 (`T` @338828500): format `/export` clipboard completion
 * message honestly over SSH / OSC 52 / tmux instead of always claiming
 * `"Conversation copied to clipboard"`.
 */
export function formatExportClipboardMessage(
  clipboardPath: ClipboardCopyOutcome = getClipboardPath(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const isSsh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  const outcome: ClipboardCopyOutcome = clipboardPath === 'native' && isSsh ? 'osc52' : clipboardPath;
  return `Conversation ${CLIPBOARD_COPY_STATUS[outcome]}${EXPORT_CLIPBOARD_HINT[outcome]}`;
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

export function extractFirstPrompt(messages: Message[]): string {
  const firstUserMessage = messages.find(msg => msg.type === 'user');

  if (!firstUserMessage || firstUserMessage.type !== 'user') {
    return '';
  }

  const content = firstUserMessage.message?.content;
  let result = '';

  if (typeof content === 'string') {
    result = content.trim();
  } else if (Array.isArray(content)) {
    const textContent = content.find(item => item.type === 'text');
    if (textContent && 'text' in textContent) {
      result = textContent.text.trim();
    }
  }

  // Take first line only and limit length
  result = result.split('\n')[0] || '';
  if (result.length > 50) {
    result = result.substring(0, 49) + '…';
  }

  return result;
}

export function sanitizeFilename(text: string): string {
  // Replace special characters with hyphens
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

async function exportWithReactRenderer(context: ToolUseContext): Promise<string> {
  const tools = context.options.tools || [];
  return renderMessagesToPlainText(context.messages, tools);
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext,
  args: string,
): Promise<React.ReactNode> {
  // Render the conversation content
  const content = await exportWithReactRenderer(context);

  // If args are provided, write directly to file and skip dialog (refuse overwrite!)
  const filename = args.trim();
  if (filename) {
    try {
      const filepath = writeExportFile(filename, content, 'refuse');
      onDone(`Conversation exported to ${filepath}`);
      return null;
    } catch (error) {
      onDone(`Couldn't export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  // Generate default filename from first prompt or timestamp
  const firstPrompt = extractFirstPrompt(context.messages);
  const timestamp = formatTimestamp(new Date());

  let defaultFilename: string;
  if (firstPrompt) {
    const sanitized = sanitizeFilename(firstPrompt);
    defaultFilename = sanitized ? `${timestamp}-${sanitized}.txt` : `conversation-${timestamp}.txt`;
  } else {
    defaultFilename = `conversation-${timestamp}.txt`;
  }

  // Return the dialog component when no args provided
  return (
    <ExportDialog
      content={content}
      defaultFilename={defaultFilename}
      onDone={result => {
        // Official 2.1.326 #177: over SSH / OSC 52 / tmux, replace optimistic
        // "Conversation copied to clipboard" with honest terminal-clipboard wording.
        if (result.success && result.message === 'Conversation copied to clipboard') {
          onDone(formatExportClipboardMessage());
          return;
        }
        onDone(result.message);
      }}
    />
  );
}
