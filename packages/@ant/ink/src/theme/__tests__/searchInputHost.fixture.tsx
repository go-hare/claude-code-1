import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React, { useRef } from 'react';
import { readFileSync } from 'node:fs';
import Ink from '../../core/ink.js';
import { KeyboardEvent } from '../../core/events/keyboard-event.js';
import { parseMultipleKeypresses, INITIAL_STATE } from '../../core/parse-keypress.js';
import { Input } from '../../components/Input.js';
import Text from '../../components/Text.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { pushToKillRing, resetKillAccumulation, getLastKill } from '../../core/utils/Cursor.js';
import Box from '../../components/Box.js';
import type { DOMElement } from '../../core/dom.js';
import { getFocusManager } from '../../core/focus.js';
import { useIsFocused } from '../../hooks/use-is-focused.js';
import { SearchBox } from '../SearchBox.js';
import { FuzzyPicker } from '../FuzzyPicker.js';

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
let search: ReturnType<typeof useSearchInput>;
let exits = 0;
function Harness() {
  search = useSearchInput({ isActive: true, onExit: () => exits++ });
  return (
    <Input autoFocus onKeyDown={search.handleKeyDown} onPaste={search.handlePaste}>
      <Text>{search.query || ' '}</Text>
    </Input>
  );
}
let focusSearch: () => void;
let searchFocused = false;
let focusedInput: ReturnType<typeof useSearchInput>;
function FocusedHarness({ mounted = true }: { mounted?: boolean }) {
  const rootRef = useRef<DOMElement | null>(null);
  const searchRef = useRef<DOMElement | null>(null);
  searchFocused = useIsFocused(searchRef);
  focusSearch = () => getFocusManager(searchRef.current!).focus(searchRef.current!);
  const input = useSearchInput({
    isActive: true,
    onExit: () => getFocusManager(rootRef.current!).focus(rootRef.current!),
  });
  focusedInput = input;
  return (
    <Box
      ref={rootRef}
      tabIndex={0}
      autoFocus
      onKeyDown={event => {
        // Skills search editing belongs to the focused child; bubbling must not edit again.
        if (event.defaultPrevented || searchFocused) return;
      }}
    >
      {mounted ? (
        <SearchBox
          ref={searchRef}
          query={input.query}
          cursorOffset={input.cursorOffset}
          onKeyDown={input.handleKeyDown}
          onPaste={input.handlePaste}
          isTerminalFocused
        />
      ) : (
        <Text>waiting for input</Text>
      )}
    </Box>
  );
}
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  ink.onRender();
};
const send = async (text: string) => {
  stdin.write(text);
  await settle();
};
try {
  ink.setAltScreenActive(true, 'full');
  ink.render(<Harness />);
  await settle();
  await send('abc');
  assert.equal(search!.query, 'abc');
  assert.equal(search!.cursorOffset, 3);
  await send('\x01');
  await send('\x1b[200~猫👨‍👩‍👧‍👦\r\nignored\x1b[201~');
  assert.equal(search!.query, '猫👨‍👩‍👧‍👦abc');
  assert.equal(search!.cursorOffset, '猫👨‍👩‍👧‍👦'.length);
  await send('\x7f');
  assert.equal(search!.query, '猫abc');
  await send('\x01');
  await send('\x0b');
  assert.equal(search!.query, '');
  assert.equal(getLastKill(), '猫abc');
  resetKillAccumulation();
  pushToKillRing('SHARED');
  await send('\x19');
  assert.equal(search!.query, 'SHARED');
  // Two edits in one render interval must read synchronous refs, not snapshots.
  const event = (text: string) =>
    new KeyboardEvent(
      parseMultipleKeypresses(INITIAL_STATE, text)[0][0] as import('../../core/parse-keypress.js').ParsedKey,
    );
  search!.handleKeyDown(event('x'));
  search!.handleKeyDown(event('y'));
  await settle();
  assert.equal(search!.query, 'SHAREDxy');
  await send('\r');
  assert.equal(exits, 1);
  ink.render(<FocusedHarness mounted={false} />);
  await settle();
  assert.equal(searchFocused, false);
  ink.render(<FocusedHarness />);
  await settle();
  assert.equal(searchFocused, false);
  focusSearch!();
  await settle();
  assert.equal(searchFocused, true);
  await send('focus');
  await send('\x02');
  assert.equal(focusedInput!.cursorOffset, 4);
  await send('\x15');
  assert.equal(focusedInput!.query, 's');
  await send('\r');
  assert.equal(searchFocused, false);
  let selected = '';
  let query = '';
  ink.render(
    <FuzzyPicker
      title="Search fixture"
      items={['alpha', 'beta']}
      getKey={item => item}
      renderItem={item => <Text>{item}</Text>}
      onQueryChange={value => {
        query = value;
      }}
      onSelect={item => {
        selected = item;
      }}
      onCancel={() => {}}
    />,
  );
  await settle();
  await send('\x1b[200~needle\nignored\x1b[201~');
  assert.equal(query, 'needle');
  await send('\x1b[B');
  await send('\r');
  assert.equal(selected, 'beta');
  const skillsSource = readFileSync(
    new URL('../../../../../../src/components/skills/SkillsMenu.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(skillsSource, /if \(isSearchModeRef\.current\) \{\s*handleSearchKeyDown\(e\)/);
  console.log('SEARCH_INPUT_HOST_OK');
} finally {
  ink.unmount();
}
