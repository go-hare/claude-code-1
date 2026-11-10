/**
 * SelectEventMode shows all hook events with hook counts and descriptions.
 */
import * as React from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import type { HookEventMetadata } from 'src/utils/hooks/hooksConfigManager.js';
import { Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';
import { count } from '../../utils/array.js';
import { plural } from '../../utils/stringUtils.js';
import { ItemList } from '../ItemList.js';

type Props = {
  hookEventMetadata: Record<HookEvent, HookEventMetadata>;
  hooksByEvent: Partial<Record<HookEvent, number>>;
  totalHooksCount?: number;
  restrictedByPolicy?: boolean;
  onSelectEvent: (event: HookEvent) => void;
  onCancel: () => void;
};

export function SelectEventMode({ hookEventMetadata, hooksByEvent, onSelectEvent, onCancel }: Props): React.ReactNode {
  const entries = React.useMemo(() => Object.entries(hookEventMetadata), [hookEventMetadata]);
  const eventsWithHooks = React.useMemo(
    () => count(entries, ([name]) => (hooksByEvent[name as HookEvent] ?? 0) > 0),
    [entries, hooksByEvent],
  );
  const subtitle = `${entries.length} ${plural(entries.length, 'event')} · ${eventsWithHooks} with hooks`;

  const options = React.useMemo(
    () =>
      entries.map(([name, metadata]) => {
        const hookCount = hooksByEvent[name as HookEvent] || 0;
        return {
          label: name,
          value: name,
          facts: hookCount > 0 ? [`${hookCount} ${plural(hookCount, 'hook')}`] : [],
          description: metadata.summary,
          lines: 2,
        };
      }),
    [entries, hooksByEvent],
  );

  return (
    <Dialog
      title="Hook events"
      subtitle={subtitle}
      onCancel={onCancel}
      inputGuide={
        <Byline>
          <KeyboardShortcutHint shortcut="enter" action="open" />
          <KeyboardShortcutHint shortcut="esc" action="go back" />
        </Byline>
      }
    >
      <ItemList
        options={options}
        onSelect={index => {
          const entry = entries[index];
          if (entry) {
            onSelectEvent(entry[0] as HookEvent);
          }
        }}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
