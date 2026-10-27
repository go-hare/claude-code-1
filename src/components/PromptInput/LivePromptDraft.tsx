/**
 * Temporary Phase-2/3 bridge: subscribe to densable nD valueStore locally so
 * survey/notice trees can read live draft text without REPL useState(inputValue).
 */
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { getPromptInputStoreValue, subscribePromptInputCursorStore } from '../../utils/promptInputCursorStore.js';

type Props = {
  setInputValue: (value: string) => void;
  children: (inputValue: string, setInputValue: (value: string) => void) => React.ReactNode;
};

export function LivePromptDraft({ setInputValue, children }: Props): React.ReactNode {
  const inputValue = useSyncExternalStore(
    subscribePromptInputCursorStore,
    getPromptInputStoreValue,
    getPromptInputStoreValue,
  );
  return children(inputValue, setInputValue);
}
