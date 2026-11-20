/**
 * SelectHookMode shows all hooks configured for a given event+matcher pair.
 */
import * as React from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import type { HookEventMetadata } from 'src/utils/hooks/hooksConfigManager.js';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import {
  getHookDisplayText,
  hookSourceHeaderDisplayString,
  type IndividualHookConfig,
} from '../../utils/hooks/hooksSettings.js';
import { ItemList } from '../ItemList.js';

type Props = {
  selectedEvent: HookEvent;
  selectedMatcher: string | null;
  hooksForSelectedMatcher: IndividualHookConfig[];
  hookEventMetadata: HookEventMetadata;
  defaultFocusIndex?: number;
  onFocus?: (index: number) => void;
  onSelect: (hook: IndividualHookConfig) => void;
  onCancel: () => void;
};

export function SelectHookMode({
  selectedEvent,
  selectedMatcher,
  hooksForSelectedMatcher,
  hookEventMetadata,
  defaultFocusIndex,
  onFocus,
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  const title =
    hookEventMetadata.matcherMetadata !== undefined
      ? `${selectedEvent} - Matcher: ${selectedMatcher || '(all)'}`
      : selectedEvent;

  if (hooksForSelectedMatcher.length === 0) {
    return (
      <Dialog
        title={title}
        subtitle={hookEventMetadata.description}
        onCancel={onCancel}
        inputGuide={<KeyboardShortcutHint shortcut="esc" action="go back" />}
      >
        <Box flexDirection="column">
          <Text dimColor>No hooks configured for this event</Text>
          <Text dimColor>To add hooks, edit settings.json directly or ask Claude</Text>
        </Box>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={title}
      subtitle={hookEventMetadata.description}
      onCancel={onCancel}
      inputGuide={
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="select" />
          <KeyboardShortcutHint shortcut="Esc" action="go back" />
        </Byline>
      }
    >
      <ItemList
        defaultFocusIndex={defaultFocusIndex}
        onFocus={onFocus}
        options={hooksForSelectedMatcher.map((hook, index) => ({
          label: getHookDisplayText(hook.config),
          value: String(index),
          facts: [hook.config.type],
          description:
            hook.source === 'pluginHook' && hook.pluginName
              ? `${hookSourceHeaderDisplayString(hook.source)} (${hook.pluginName})`
              : hookSourceHeaderDisplayString(hook.source),
          lines: 2,
        }))}
        onSelect={index => {
          const hook = hooksForSelectedMatcher[index];
          if (hook) {
            onSelect(hook);
          }
        }}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
