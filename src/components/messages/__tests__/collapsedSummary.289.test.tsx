/**
 * densable 2.1.289 Jc — scratchpad / workshop clauses and the local-memory prefix.
 */
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { CollapsedReadSearchContent } from '../CollapsedReadSearchContent.js';
import type { CollapsedReadSearchGroup } from '../../../types/message.js';
import { renderToString } from '../../../utils/staticRender.js';

function group(extra: Partial<CollapsedReadSearchGroup>): CollapsedReadSearchGroup {
  return {
    type: 'collapsed_read_search',
    uuid: '00000000-0000-4000-8000-0000000000aa',
    searchCount: 0,
    readCount: 0,
    listCount: 0,
    replCount: 0,
    memorySearchCount: 0,
    memoryReadCount: 0,
    memoryWriteCount: 0,
    readFilePaths: [],
    searchArgs: [],
    messages: [],
    displayMessage: {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000ab',
      message: { role: 'assistant', content: [] },
    } as CollapsedReadSearchGroup['displayMessage'],
    ...extra,
  };
}

const lookups = {
  erroredToolUseIDs: new Set<string>(),
  toolResultByToolUseID: new Map(),
  progressMessagesByToolUseID: new Map(),
} as unknown as React.ComponentProps<typeof CollapsedReadSearchContent>['lookups'];

async function paint(message: CollapsedReadSearchGroup): Promise<string> {
  return renderToString(
    <CollapsedReadSearchContent
      message={message}
      inProgressToolUseIDs={new Set()}
      shouldAnimate={false}
      verbose={false}
      tools={[]}
      lookups={lookups}
      isActiveGroup={false}
    />,
  );
}

describe('densable 2.1.289 Jc collapsed summary', () => {
  test('workshop-only group renders page edits and the line diff', async () => {
    const out = await paint(
      group({
        workshopWriteCount: 1,
        workshopLinesAdded: 2,
        workshopLinesRemoved: 1,
      }),
    );
    expect(out).toContain('Made 1 page edit');
    expect(out).toContain('+2');
    expect(out).toContain('-1');
  });

  test('scratchpad edits render before a zero diff is omitted', async () => {
    const out = await paint(
      group({
        scratchpadWriteCount: 2,
        scratchpadLinesAdded: 0,
        scratchpadLinesRemoved: 0,
      }),
    );
    expect(out).toContain('Made 2 scratchpad edits');
    expect(out).not.toContain('+0');
  });

  test('account memory keys prefix the recall clause with local', async () => {
    const out = await paint(
      group({
        memoryReadCount: 2,
        accountMemoryReadKeys: ['/notes/a.md'],
      }),
    );
    expect(out).toContain('Recalled 2 local memories');
  });
});
