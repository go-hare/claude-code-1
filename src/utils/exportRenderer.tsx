import React, { useRef } from 'react';
import stripAnsi from 'strip-ansi';
import { Messages } from '../components/Messages.js';
import { KeybindingProvider } from '../keybindings/KeybindingContext.js';
import { loadKeybindingsSyncWithWarnings } from '../keybindings/loadUserBindings.js';
import type { KeybindingContextName } from '../keybindings/types.js';
import { AppStateProvider } from '../state/AppState.js';
import type { Tools } from '../Tool.js';
import type { Message } from '../types/message.js';
import { renderToAnsiString } from './staticRender.js';

/**
 * Minimal keybinding provider for static/headless renders.
 * Provides keybinding context without the ChordInterceptor (which uses useInput
 * and would hang in headless renders with no stdin).
 */
function StaticKeybindingProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const { bindings } = loadKeybindingsSyncWithWarnings();
  const pendingChordRef = useRef(null);
  const handlerRegistryRef = useRef(new Map());
  const activeContexts = useRef(new Set<KeybindingContextName>()).current;

  return (
    <KeybindingProvider
      bindings={bindings}
      pendingChordRef={pendingChordRef}
      pendingChord={null}
      setPendingChord={() => {}}
      activeContexts={activeContexts}
      registerActiveContext={() => {}}
      unregisterActiveContext={() => {}}
      handlerRegistryRef={handlerRegistryRef}
    >
      {children}
    </KeybindingProvider>
  );
}

// Upper-bound how many NormalizedMessages a Message can produce.
// normalizeMessages splits one Message with N content blocks into N
// NormalizedMessages — 1:1 with block count. String content = 1 block.
// AttachmentMessage etc. have no .message and normalize to ≤1.
function normalizedUpperBound(m: Message): number {
  if (!('message' in m)) return 1;
  const c = m.message!.content;
  return Array.isArray(c) ? c.length : 1;
}

/**
 * Streams rendered messages in chunks, ANSI codes preserved. Each chunk is a
 * fresh renderToAnsiString — yoga layout tree + Ink's screen buffer are sized
 * to the tallest CHUNK instead of the full session. Measured (Mar 2026,
 * 538-msg session): −55% plateau RSS vs a single full render. The sink owns
 * the output — write to stdout for `[` dump-to-scrollback, appendFile for `v`.
 *
 * Messages.renderRange slices AFTER normalize→group→collapse, so tool-call
 * grouping stays correct across chunk seams; buildMessageLookups runs on
 * the full normalized array so tool_use↔tool_result resolves regardless of
 * which chunk each landed in.
 */
export async function streamRenderedMessages(
  messages: Message[],
  tools: Tools,
  sink: (ansiChunk: string) => void | Promise<void>,
  {
    columns,
    verbose = false,
    chunkSize = 40,
    onProgress,
  }: {
    columns?: number;
    verbose?: boolean;
    chunkSize?: number;
    onProgress?: (rendered: number) => void;
  } = {},
): Promise<void> {
  // Official 2.1.323 (#2032): track exact post-collapse row count reported by
  // Messages via onRowCount instead of breaking on the first empty chunk (which
  // silently stopped /export after a long run of calls to an unloaded MCP tool).
  let totalRows = 0;
  const renderChunk = (range: readonly [number, number]) =>
    renderToAnsiString(
      <AppStateProvider>
        <StaticKeybindingProvider>
          <Messages
            messages={messages}
            tools={tools}
            commands={[]}
            verbose={verbose}
            toolJSX={null}
            inProgressToolUseIDs={new Set()}
            isMessageSelectorVisible={false}
            conversationId="export"
            screen="prompt"
            streamingToolUses={[]}
            showAllInTranscript={true}
            isLoading={false}
            renderRange={range}
            onRowCount={count => {
              totalRows = count;
            }}
          />
        </StaticKeybindingProvider>
      </AppStateProvider>,
      columns,
    );

  let offset = 0;
  do {
    const ansi = await renderChunk([offset, offset + chunkSize]);
    if (stripAnsi(ansi).trim() !== '') {
      await sink(ansi);
    }
    offset += chunkSize;
    onProgress?.(offset);
  } while (offset < totalRows);
}

/**
 * Renders messages to a plain text string suitable for export.
 * Uses the same React rendering logic as the interactive UI.
 */
export async function renderMessagesToPlainText(
  messages: Message[],
  tools: Tools = [],
  columns?: number,
): Promise<string> {
  const parts: string[] = [];
  await streamRenderedMessages(messages, tools, chunk => void parts.push(stripAnsi(chunk)), { columns });
  return parts.join('');
}
