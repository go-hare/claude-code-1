/**
 * HooksConfigMenu is a read-only browser for configured hooks.
 *
 * Starts in a configured-hooks overview (`mode: 'list'`) grouped by event,
 * with an "All events" entry drilling into the full event catalog.
 */
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import { useAppState, useAppStateStore } from 'src/state/AppState.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useSettingsChange } from '../../hooks/useSettingsChange.js';
import {
  Box,
  Byline,
  type ClickEvent,
  Dialog,
  KeyboardShortcutHint,
  Link,
  ListItem,
  StatusIcon,
  Text,
  useModalOrTerminalSize,
  useTerminalSize,
  type WheelEvent,
} from '@anthropic/ink';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import {
  getHookEventMetadata,
  getHooksForMatcher,
  getMatcherMetadata,
  getSortedMatchersForEvent,
  groupHooksByEventAndMatcher,
  type HookEventMetadata,
} from '../../utils/hooks/hooksConfigManager.js';
import { hookSourceInlineDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { isSafeModeEnabled, safeModeDisableHint } from '../../utils/safeMode.js';
import { getSettings_DEPRECATED, getSettingsForSource } from '../../utils/settings/settings.js';
import { capitalize, plural } from '../../utils/stringUtils.js';
import { SelectEventMode } from './SelectEventMode.js';
import { SelectHookMode } from './SelectHookMode.js';
import { SelectMatcherMode } from './SelectMatcherMode.js';
import { getContentFieldValue, ViewHookMode } from './ViewHookMode.js';

export function areSettingsHooksSuspendedBySafeMode(): boolean {
  return isSafeModeEnabled();
}

type Props = {
  toolNames: string[];
  onExit: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

type ModeState =
  | { mode: 'list' }
  | { mode: 'select-event' }
  | { mode: 'select-matcher'; event: HookEvent }
  | { mode: 'select-hook'; event: HookEvent; matcher: string }
  | { mode: 'view-hook'; event: HookEvent; hook: IndividualHookConfig; from?: 'list' | 'select-hook' };

type OverviewVisualRow =
  | { kind: 'gap'; key: string }
  | { kind: 'heading'; key: string; event: HookEvent; summary: string }
  | { kind: 'hook'; key: string; selectableIndex: number; hook: IndividualHookConfig }
  | { kind: 'all-events'; key: string; selectableIndex: number };

function lowercaseLeadingChar(summary: string): string {
  return summary.replace(/^\p{Lu}(?=\p{Ll}|\s)/u, ch => ch.toLowerCase());
}

function HooksOverviewMode({
  hookEventMetadata,
  hooksByEventAndMatcher,
  restrictedByPolicy,
  suspendedBySafeMode,
  defaultFocusIndex,
  onFocusRow,
  onSelectHook,
  onOpenEvents,
  onCancel,
}: {
  hookEventMetadata: Record<HookEvent, HookEventMetadata>;
  hooksByEventAndMatcher: Record<HookEvent, Record<string, IndividualHookConfig[]>>;
  restrictedByPolicy: boolean;
  suspendedBySafeMode?: { exitHint: string; managedHooksStillApply: boolean };
  defaultFocusIndex: number;
  onFocusRow: (index: number) => void;
  onSelectHook: (hook: IndividualHookConfig) => void;
  onOpenEvents: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const eventGroups = useMemo(() => {
    return Object.entries(hookEventMetadata).flatMap(([eventName, metadata]) => {
      const event = eventName as HookEvent;
      const byMatcher = hooksByEventAndMatcher[event] ?? {};
      const hooks = getSortedMatchersForEvent(hooksByEventAndMatcher, event).flatMap(m => byMatcher[m] ?? []);
      return hooks.length > 0 ? [{ event, metadata, hooks }] : [];
    });
  }, [hookEventMetadata, hooksByEventAndMatcher]);

  const allHooks = useMemo(() => eventGroups.flatMap(g => g.hooks), [eventGroups]);
  const totalSelectable = allHooks.length + 1;

  const { visualRows, rowLineForSelectable } = useMemo(() => {
    const rows: OverviewVisualRow[] = [];
    const lineForSelectable: number[] = [];
    let selectableIndex = 0;

    eventGroups.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        rows.push({ kind: 'gap', key: `${group.event}-gap` });
      }
      rows.push({
        kind: 'heading',
        key: `${group.event}-heading`,
        event: group.event,
        summary: lowercaseLeadingChar(group.metadata.summary),
      });
      group.hooks.forEach((hook, hookIdx) => {
        lineForSelectable.push(rows.length);
        rows.push({
          kind: 'hook',
          key: `${group.event}-${hookIdx}`,
          selectableIndex,
          hook,
        });
        selectableIndex++;
      });
    });

    if (allHooks.length > 0) {
      rows.push({ kind: 'gap', key: 'events-gap' });
    }
    lineForSelectable.push(rows.length);
    rows.push({
      kind: 'all-events',
      key: 'events',
      selectableIndex,
    });

    return { visualRows: rows, rowLineForSelectable: lineForSelectable };
  }, [eventGroups, allHooks.length]);

  const { rows: availableRows } = useModalOrTerminalSize(useTerminalSize());
  const windowHeight = Math.max(5, availableRows - (restrictedByPolicy ? 11 : 8) - (suspendedBySafeMode ? 4 : 0));
  const maxOrigin = Math.max(0, visualRows.length - windowHeight);

  const [cursor, setCursor] = useState(() => Math.max(0, Math.min(totalSelectable - 1, defaultFocusIndex)));
  const [origin, setOrigin] = useState(0);

  const moveCursor = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(totalSelectable - 1, next));
      setCursor(clamped);
      onFocusRow(clamped);
      const targetLine = rowLineForSelectable[clamped] ?? 0;
      setOrigin(prev => {
        const cur = Math.min(prev, maxOrigin);
        if (clamped === 0) return 0;
        if (targetLine < cur) return Math.max(0, targetLine - 1);
        if (targetLine >= cur + windowHeight) return Math.min(maxOrigin, targetLine - windowHeight + 1);
        return cur;
      });
    },
    [totalSelectable, onFocusRow, rowLineForSelectable, maxOrigin, windowHeight],
  );

  const activateIndex = useCallback(
    (index: number) => {
      const hook = allHooks[index];
      if (hook) {
        onSelectHook(hook);
      } else {
        onOpenEvents();
      }
    },
    [allHooks, onSelectHook, onOpenEvents],
  );

  useKeybindings(
    {
      'select:next': () => moveCursor(cursor + 1),
      'select:previous': () => moveCursor(cursor - 1),
      'select:first': () => moveCursor(0),
      'select:last': () => moveCursor(totalSelectable - 1),
      'select:accept': () => activateIndex(cursor),
    },
    { context: 'Select' },
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.deltaY === 0 || maxOrigin === 0) return;
      const delta = event.deltaY > 0 ? 1 : -1;
      setOrigin(prev => Math.max(0, Math.min(maxOrigin, Math.min(prev, maxOrigin) + delta)));
      event.stopImmediatePropagation();
    },
    [maxOrigin],
  );

  const clampedOrigin = Math.min(origin, maxOrigin);
  const visibleRows =
    visualRows.length <= windowHeight ? visualRows : visualRows.slice(clampedOrigin, clampedOrigin + windowHeight);

  const subtitle =
    allHooks.length === 0
      ? restrictedByPolicy
        ? 'managed hooks only'
        : 'no hooks yet'
      : `${allHooks.length} ${plural(allHooks.length, 'hook')} on ${eventGroups.length} ${plural(eventGroups.length, 'event')}`;

  return (
    <Dialog
      title="Hooks"
      subtitle={subtitle}
      onCancel={onCancel}
      inputGuide={
        <Byline>
          <KeyboardShortcutHint shortcut="enter" action="view" />
          <KeyboardShortcutHint shortcut="esc" action="close" />
        </Byline>
      }
    >
      <Box flexDirection="column" gap={1}>
        {suspendedBySafeMode && (
          <Box flexDirection="column">
            <Text>
              <StatusIcon status="warning" withSpace />
              Safe mode: hooks from settings files won&apos;t run this session.
            </Text>
            <Text dimColor>
              Session hooks created by /goal, agents and skills still run
              {suspendedBySafeMode.managedHooksStillApply ? ', and managed policy hooks still apply' : ''}. Settings
              edits save but don&apos;t load until safe mode is off. {capitalize(suspendedBySafeMode.exitHint)} to leave
              safe mode.
            </Text>
          </Box>
        )}

        {restrictedByPolicy && (
          <Box flexDirection="column">
            <Text>
              <StatusIcon status="info" withSpace />
              Only hooks from managed settings run here.
            </Text>
            <Text dimColor>
              Hooks in your own settings files (user, project and local) are blocked and aren&apos;t listed. Managed
              hooks aren&apos;t shown here either.
            </Text>
          </Box>
        )}

        <Text dimColor>
          This menu is read-only. To add or change a hook, edit settings.json or ask Claude.{' '}
          <Link url="https://code.claude.com/docs/en/hooks">Learn more</Link>
        </Text>

        <Box flexDirection="column" onWheel={maxOrigin > 0 ? handleWheel : undefined}>
          {visibleRows.map(row => {
            switch (row.kind) {
              case 'gap':
                return <Text key={row.key}> </Text>;
              case 'heading':
                return (
                  <Text key={row.key} wrap="truncate-end">
                    <Text bold>{row.event}</Text>
                    <Text dimColor>
                      {'  '}
                      {row.summary}
                    </Text>
                  </Text>
                );
              case 'hook': {
                const { hook, selectableIndex } = row;
                const meta = [
                  hook.source === 'pluginHook' && hook.pluginName ? hook.pluginName : '',
                  hook.matcher || '',
                  hook.config.type,
                ].filter(Boolean);
                return (
                  <ListItem
                    key={row.key}
                    isFocused={cursor === selectableIndex}
                    icon={<Text dimColor>[{hookSourceInlineDisplayString(hook.source)}]</Text>}
                    meta={meta}
                    onClick={(event: ClickEvent) => {
                      moveCursor(selectableIndex);
                      activateIndex(selectableIndex);
                      event.stopImmediatePropagation();
                    }}
                  >
                    {getContentFieldValue(hook.config).replace(/[\r\n]+/g, ' ')}
                  </ListItem>
                );
              }
              case 'all-events':
                return (
                  <ListItem
                    key={row.key}
                    isFocused={cursor === row.selectableIndex}
                    onClick={(event: ClickEvent) => {
                      moveCursor(row.selectableIndex);
                      onOpenEvents();
                      event.stopImmediatePropagation();
                    }}
                  >
                    All events
                  </ListItem>
                );
            }
          })}
        </Box>
      </Box>
    </Dialog>
  );
}

export function HooksConfigMenu({ toolNames, onExit }: Props): React.ReactNode {
  const [modeState, setModeState] = useState<ModeState>({ mode: 'list' });
  const [listFocusIndex, setListFocusIndex] = useState(0);

  const [disabledByPolicy, setDisabledByPolicy] = useState(() => {
    const settings = getSettings_DEPRECATED();
    const hooksDisabled = settings?.disableAllHooks === true;
    return hooksDisabled && getSettingsForSource('policySettings')?.disableAllHooks === true;
  });

  const [restrictedByPolicy, setRestrictedByPolicy] = useState(() => {
    return getSettingsForSource('policySettings')?.allowManagedHooksOnly === true;
  });

  useSettingsChange(source => {
    if (source === 'policySettings') {
      const settings = getSettings_DEPRECATED();
      const hooksDisabled = settings?.disableAllHooks === true;
      setDisabledByPolicy(hooksDisabled && getSettingsForSource('policySettings')?.disableAllHooks === true);
      setRestrictedByPolicy(getSettingsForSource('policySettings')?.allowManagedHooksOnly === true);
    }
  });

  const mode = modeState.mode;
  const selectedEvent = 'event' in modeState ? modeState.event : 'PreToolUse';
  const selectedMatcher = 'matcher' in modeState ? modeState.matcher : null;

  const mcp = useAppState(s => s.mcp);
  const appStateStore = useAppStateStore();
  const combinedToolNames = useMemo(() => [...toolNames, ...mcp.tools.map(tool => tool.name)], [toolNames, mcp.tools]);

  const hooksByEventAndMatcher = useMemo(
    () => groupHooksByEventAndMatcher(appStateStore.getState(), combinedToolNames),
    [combinedToolNames, appStateStore],
  );

  const sortedMatchersForSelectedEvent = useMemo(
    () => getSortedMatchersForEvent(hooksByEventAndMatcher, selectedEvent),
    [hooksByEventAndMatcher, selectedEvent],
  );

  const hooksForSelectedMatcher = useMemo(
    () => getHooksForMatcher(hooksByEventAndMatcher, selectedEvent, selectedMatcher),
    [hooksByEventAndMatcher, selectedEvent, selectedMatcher],
  );

  const handleExit = useCallback(() => {
    onExit('Hooks dialog dismissed', { display: 'system' });
  }, [onExit]);

  const hookEventMetadata = getHookEventMetadata(combinedToolNames);

  const handleViewHookCancel = useCallback(() => {
    if (modeState.mode !== 'view-hook') return;
    const { event, hook, from } = modeState;
    if (from === 'list') {
      setModeState({ mode: 'list' });
      return;
    }
    const supportsMatcher = hookEventMetadata[event].matcherMetadata !== undefined;
    setModeState({
      mode: 'select-hook',
      event,
      matcher: supportsMatcher ? hook.matcher || '' : '',
    });
  }, [modeState, hookEventMetadata]);

  useKeybinding('confirm:no', handleExit, {
    context: 'Confirmation',
    isActive: mode === 'list',
  });

  useKeybinding(
    'confirm:no',
    () => {
      setModeState({ mode: 'list' });
    },
    {
      context: 'Confirmation',
      isActive: mode === 'select-event',
    },
  );

  useKeybinding(
    'confirm:no',
    () => {
      setModeState({ mode: 'select-event' });
    },
    {
      context: 'Confirmation',
      isActive: mode === 'select-matcher',
    },
  );

  useKeybinding(
    'confirm:no',
    () => {
      if ('event' in modeState) {
        if (hookEventMetadata[modeState.event].matcherMetadata !== undefined) {
          setModeState({ mode: 'select-matcher', event: modeState.event });
        } else {
          setModeState({ mode: 'select-event' });
        }
      }
    },
    {
      context: 'Confirmation',
      isActive: mode === 'select-hook',
    },
  );

  useKeybinding('confirm:no', handleViewHookCancel, {
    context: 'Confirmation',
    isActive: mode === 'view-hook',
  });

  const settings = getSettings_DEPRECATED();
  const hooksDisabled = settings?.disableAllHooks === true;

  const { hooksByEvent, totalHooksCount } = useMemo(() => {
    const byEvent: Partial<Record<HookEvent, number>> = {};
    let total = 0;
    for (const [event, matchers] of Object.entries(hooksByEventAndMatcher)) {
      const eventCount = Object.values(matchers).reduce((sum, hooks) => sum + hooks.length, 0);
      byEvent[event as HookEvent] = eventCount;
      total += eventCount;
    }
    return { hooksByEvent: byEvent, totalHooksCount: total };
  }, [hooksByEventAndMatcher]);

  if (hooksDisabled) {
    const statusPrefix = disabledByPolicy ? 'disabled by your organization' : 'disabled';
    const disabledSubtitle =
      totalHooksCount > 0
        ? `${statusPrefix} · ${totalHooksCount} ${plural(totalHooksCount, 'hook')} not running`
        : statusPrefix;
    const hasManagedHooks = Boolean(getSettingsForSource('policySettings')?.hooks);

    return (
      <Dialog
        title="Hooks"
        subtitle={disabledSubtitle}
        onCancel={handleExit}
        inputGuide={<KeyboardShortcutHint shortcut="esc" action="close" />}
      >
        <Box flexDirection="column" gap={1}>
          <Text>
            While hooks are disabled no hook command runs, the status line isn&apos;t shown, and tools run without hook
            checks.
            {!disabledByPolicy && hasManagedHooks ? ' Hooks set by your organization still run.' : ''}
          </Text>
          {!disabledByPolicy && (
            <Text dimColor>
              To turn hooks back on, remove &quot;disableAllHooks&quot; from settings.json or ask Claude.
            </Text>
          )}
        </Box>
      </Dialog>
    );
  }

  switch (modeState.mode) {
    case 'list': {
      const suspendedBySafeMode = areSettingsHooksSuspendedBySafeMode()
        ? {
            exitHint: safeModeDisableHint(),
            managedHooksStillApply: Boolean(getSettingsForSource('policySettings')?.hooks),
          }
        : undefined;
      return (
        <HooksOverviewMode
          hookEventMetadata={hookEventMetadata}
          hooksByEventAndMatcher={hooksByEventAndMatcher}
          restrictedByPolicy={restrictedByPolicy}
          suspendedBySafeMode={suspendedBySafeMode}
          defaultFocusIndex={listFocusIndex}
          onFocusRow={setListFocusIndex}
          onSelectHook={hook => {
            setModeState({
              mode: 'view-hook',
              event: hook.event,
              hook,
              from: 'list',
            });
          }}
          onOpenEvents={() => {
            setModeState({ mode: 'select-event' });
          }}
          onCancel={handleExit}
        />
      );
    }
    case 'select-event':
      return (
        <SelectEventMode
          hookEventMetadata={hookEventMetadata}
          hooksByEvent={hooksByEvent}
          totalHooksCount={totalHooksCount}
          restrictedByPolicy={restrictedByPolicy}
          onSelectEvent={event => {
            if (getMatcherMetadata(event, combinedToolNames) !== undefined) {
              setModeState({ mode: 'select-matcher', event });
            } else {
              setModeState({ mode: 'select-hook', event, matcher: '' });
            }
          }}
          onCancel={() => {
            setModeState({ mode: 'list' });
          }}
        />
      );
    case 'select-matcher':
      return (
        <SelectMatcherMode
          selectedEvent={modeState.event}
          matchersForSelectedEvent={sortedMatchersForSelectedEvent}
          hooksByEventAndMatcher={hooksByEventAndMatcher}
          eventDescription={hookEventMetadata[modeState.event].description}
          onSelect={matcher => {
            setModeState({
              mode: 'select-hook',
              event: modeState.event,
              matcher,
            });
          }}
          onCancel={() => {
            setModeState({ mode: 'select-event' });
          }}
        />
      );
    case 'select-hook':
      return (
        <SelectHookMode
          selectedEvent={modeState.event}
          selectedMatcher={modeState.matcher}
          hooksForSelectedMatcher={hooksForSelectedMatcher}
          hookEventMetadata={hookEventMetadata[modeState.event]}
          onSelect={hook => {
            setModeState({
              mode: 'view-hook',
              event: modeState.event,
              hook,
              from: 'select-hook',
            });
          }}
          onCancel={() => {
            if (getMatcherMetadata(modeState.event, combinedToolNames) !== undefined) {
              setModeState({
                mode: 'select-matcher',
                event: modeState.event,
              });
            } else {
              setModeState({ mode: 'select-event' });
            }
          }}
        />
      );
    case 'view-hook':
      return (
        <ViewHookMode
          selectedHook={modeState.hook}
          eventSupportsMatcher={getMatcherMetadata(modeState.event, combinedToolNames) !== undefined}
          onCancel={handleViewHookCancel}
        />
      );
  }
}
