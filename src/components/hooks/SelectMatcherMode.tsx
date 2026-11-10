/**
 * SelectMatcherMode shows the configured matchers for a selected hook event.
 */
import * as React from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import { Box, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import {
  type HookSource,
  hookSourceInlineDisplayString,
  type IndividualHookConfig,
} from '../../utils/hooks/hooksSettings.js';
import { plural } from '../../utils/stringUtils.js';
import { ItemList } from '../ItemList.js';

type MatcherWithSource = {
  matcher: string;
  sources: HookSource[];
  hookCount: number;
};

type Props = {
  selectedEvent: HookEvent;
  matchersForSelectedEvent: string[];
  hooksByEventAndMatcher: Record<HookEvent, Record<string, IndividualHookConfig[]>>;
  eventDescription: string;
  onSelect: (matcher: string) => void;
  onCancel: () => void;
};

export function SelectMatcherMode({
  selectedEvent,
  matchersForSelectedEvent,
  hooksByEventAndMatcher,
  eventDescription,
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  const matchersWithSources: MatcherWithSource[] = React.useMemo(() => {
    return matchersForSelectedEvent.map(matcher => {
      const hooks = hooksByEventAndMatcher[selectedEvent]?.[matcher] || [];
      const sources = Array.from(new Set(hooks.map(h => h.source)));
      return {
        matcher,
        sources,
        hookCount: hooks.length,
      };
    });
  }, [matchersForSelectedEvent, hooksByEventAndMatcher, selectedEvent]);

  const title = `${selectedEvent} - Matchers`;

  if (matchersForSelectedEvent.length === 0) {
    return (
      <Dialog
        title={title}
        subtitle={eventDescription}
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
    <Dialog title={title} subtitle={eventDescription} onCancel={onCancel}>
      <ItemList
        options={matchersWithSources.map(item => ({
          icon: <Text dimColor>[{item.sources.map(hookSourceInlineDisplayString).join(', ')}]</Text>,
          label: item.matcher || '(all)',
          value: item.matcher,
          facts: [`${item.hookCount} ${plural(item.hookCount, 'hook')}`],
        }))}
        onSelect={index => {
          const item = matchersWithSources[index];
          if (item) {
            onSelect(item.matcher);
          }
        }}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
