import * as React from 'react';
import { useContext, useSyncExternalStore } from 'react';
import { Box, useModalOrTerminalSize, useTerminalSize } from '@anthropic/ink';
import { CurrentDialogIdContext } from '../../dialog/DialogHost.js';
import { DialogStoreContext } from '../../dialog/DialogStoreContext.js';
import type { PermissionRequestSource } from '../../dialog/permissionRequestSource.js';
import type { Theme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';

const noopSubscribe = (): (() => void) => () => {};
const nullSnapshot = (): string | null => null;

function usePermissionQueueTally(): string | null {
  const dialogId = useContext(CurrentDialogIdContext);
  const store = useContext(DialogStoreContext);
  const subscribe = store
    ? (listener: () => void) => {
        const unsubStore = store.subscribe(listener);
        const unsubTally = store.askTally.subscribe(listener);
        return () => {
          unsubStore();
          unsubTally();
        };
      }
    : noopSubscribe;
  const getSnapshot = () => {
    if (!store) return null;
    const activeId = dialogId ?? store.getState().open.at(-1)?.id;
    if (!activeId) return null;
    return store.askTally.positionLabel(activeId);
  };
  return useSyncExternalStore(subscribe, getSnapshot, nullSnapshot);
}

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  titleColor?: keyof Theme;
  innerPaddingX?: number;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  titleEnd?: React.ReactNode;
  requestSource?: PermissionRequestSource;
  children: React.ReactNode;
};

export function PermissionDialog({
  title,
  subtitle,
  color = 'permission',
  titleColor,
  innerPaddingX = 1,
  workerBadge,
  titleRight,
  titleEnd,
  requestSource,
  children,
}: Props): React.ReactNode {
  const rightNode = titleRight ?? titleEnd;
  const tally = usePermissionQueueTally();
  const terminalSize = useTerminalSize();
  const { columns } = useModalOrTerminalSize(terminalSize);
  const rowColumns = (columns > 0 ? columns : 80) - 2;
  const aside = rightNode === undefined && tally !== null ? { text: tally, rowColumns } : undefined;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      marginTop={1}
    >
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <PermissionRequestTitle
            title={title}
            subtitle={subtitle}
            color={titleColor}
            workerBadge={workerBadge}
            requestSource={requestSource}
            srPrefix="Permission Required:"
            aside={aside}
          />
          {rightNode}
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={innerPaddingX}>
        {children}
      </Box>
    </Box>
  );
}
