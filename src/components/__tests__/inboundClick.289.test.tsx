import { expect, test } from 'bun:test';
import React, { useMemo } from 'react';
import { PassThrough } from 'node:stream';
import { Box, ScrollBox, ScrollViewport, useInput } from '@anthropic/ink';
import Ink from '../../../packages/@ant/ink/src/core/ink.js';
import { charInCellAt } from '../../../packages/@ant/ink/src/core/screen.js';
import { Messages } from '../Messages.js';
import { AppStateProvider } from '../../state/AppState.js';
import type { UserMessage } from '../../types/message.js';

const message: UserMessage = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-0000000000aa',
  timestamp: '2026-11-16T10:00:00.000Z',
  message: {
    role: 'user',
    content: [
      {
        type: 'text',
        text: '<agent-message from="general-purpose">\nCLICK_BODY_SENTINEL\nsecond line\n</agent-message>',
      },
    ],
  },
  origin: { kind: 'peer', senderTaskId: 'click-test', name: 'general-purpose' },
};

function Harness({ isLoading }: { isLoading: boolean }) {
  useInput(() => {});
  const scrollViewport = useMemo(() => new ScrollViewport(), []);
  return (
    <Box height={24} paddingTop={9} flexDirection="column">
      <ScrollBox ref={scrollViewport.attach}>
        <Messages
          messages={[message]}
          tools={[]}
          commands={[]}
          verbose={false}
          toolJSX={null}
          inProgressToolUseIDs={new Set()}
          isMessageSelectorVisible={false}
          conversationId="click-test"
          screen="prompt"
          streamingToolUses={[]}
          hideLogo
          isLoading={isLoading}
          scrollViewport={scrollViewport}
        />
      </ScrollBox>
    </Box>
  );
}

for (const isLoading of [false, true]) {
  test(`inbound row expands and collapses through raw Ink mouse input (loading=${isLoading})`, async () => {
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
    stdout.resume();
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
    const ink = new Ink({
      stdout: stdout as never,
      stdin: stdin as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const readPainted = (): string => {
      const screen = (ink as unknown as { frontFrame: { screen: { height: number; width: number } } }).frontFrame
        .screen;
      return Array.from({ length: screen.height }, (_, y) =>
        Array.from({ length: screen.width }, (_, x) => charInCellAt(screen as never, x, y) ?? '').join(''),
      ).join('\n');
    };
    try {
      ink.setAltScreenActive(true, 'full');
      ink.render(
        <AppStateProvider>
          <Harness isLoading={isLoading} />
        </AppStateProvider>,
      );
      await new Promise(resolve => setTimeout(resolve, 30));
      ink.onRender();
      expect(readPainted()).toContain('Message from @general-purpose');
      expect(readPainted()).not.toContain('CLICK_BODY_SENTINEL');
      stdin.write('\x1b[<0;6;11M\x1b[<0;6;11m');
      await new Promise(resolve => setTimeout(resolve, 30));
      ink.onRender();
      expect(readPainted()).toContain('CLICK_BODY_SENTINEL');
      // A different column keeps these two fast events separate from word selection.
      // Official 2.1.299 (#595) delays collapse of an expanded row by 250ms.
      stdin.write('\x1b[<0;12;11M\x1b[<0;12;11m');
      await new Promise(resolve => setTimeout(resolve, 280));
      ink.onRender();
      expect(readPainted()).not.toContain('CLICK_BODY_SENTINEL');
    } finally {
      ink.unmount();
    }
  });
}
