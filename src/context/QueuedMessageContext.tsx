import * as React from 'react';

type QueuedMessageContextValue = {
  isQueued: boolean;
  /** Official 2.1.328 `CTo` — only set while queueEditIndex maps onto this row. */
  selectionHighlight?: 'on' | 'off';
  /** Official 2.1.328 `CTo` — system-line flag inherited by queued notices. */
  noticeSystemLines?: boolean;
};

const QueuedMessageContext = React.createContext<QueuedMessageContextValue | undefined>(undefined);

export function useQueuedMessage(): QueuedMessageContextValue | undefined {
  return React.useContext(QueuedMessageContext);
}

type Props = {
  /** Official 2.1.328 `CTo` — only set while queueEditIndex maps onto this row. */
  selectionHighlight?: 'on' | 'off';
  noticeSystemLines?: boolean;
  children: React.ReactNode;
};

export function QueuedMessageProvider({ selectionHighlight, noticeSystemLines, children }: Props): React.ReactNode {
  const value = React.useMemo(
    () => ({ isQueued: true, selectionHighlight, noticeSystemLines }),
    [selectionHighlight, noticeSystemLines],
  );

  return <QueuedMessageContext.Provider value={value}>{children}</QueuedMessageContext.Provider>;
}
