import * as React from 'react';
import { useContext, useSyncExternalStore } from 'react';
import {
  Box,
  Byline,
  Dialog,
  DialogWait,
  KeyboardShortcutHint,
  ModalContext,
  PANE_PADDING_X_INLINE,
  PANE_PADDING_X_MODAL,
  stringWidth,
  Text,
  useIsInsideModal,
  useModalOrTerminalSize,
  useTerminalSize,
} from '@anthropic/ink';
import { CurrentDialogIdContext } from '../../dialog/DialogHost.js';
import { DialogStoreContext } from '../../dialog/DialogStoreContext.js';
import { formatRequestSourceLabel, type PermissionRequestSource } from '../../dialog/permissionRequestSource.js';
import { sanitizeDisplayText } from '../../utils/displaySanitize.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import type { Theme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';

const noopSubscribe = (): (() => void) => () => {};
const nullSnapshot = (): string | null => null;
const DEFAULT_SR_PREFIX = 'Permission Required:';
const LOWER_KEY_FORMAT = { keyCase: 'lower' as const };

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

function sanitizeTitleSuffix(raw: string | undefined): string {
  if (raw === undefined) return '';
  return sanitizeDisplayText(raw.replace(/\s+/g, ' ').trim());
}

/** Official 2.1.328 `vcn` (chunk@308267981.js @1621) — title + source + badge width check. */
function titleFitsRow(
  title: string,
  requestSource: PermissionRequestSource | undefined,
  workerBadge: WorkerBadgeProps | undefined,
  maxColumns: number,
): boolean {
  const sourceLabel = formatRequestSourceLabel(requestSource);
  const workerWidth = workerBadge ? 1 + stringWidth(`· @${workerBadge.name}`) : 0;
  return (
    stringWidth(title) + (sourceLabel == null ? 0 : 1 + stringWidth(`· ${sourceLabel}`)) + workerWidth <= maxColumns
  );
}

/** Official 2.1.328 `Xa.frame` / `fe` framed-card configuration. */
export type PermissionDialogFrame = {
  onCancel: () => void;
  titleSuffix?: string;
  notice?: string;
  hints?: React.ReactNode;
  showHintLine?: boolean;
  showPermissionsHint?: boolean;
};

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  titleColor?: keyof Theme;
  innerPaddingX?: number;
  /** Official 2.1.328 `Xa.hasPanelInset`: widen paddingX to pane inset (2) when title fits. */
  hasPanelInset?: boolean;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  titleEnd?: React.ReactNode;
  /** Official 2.1.328 inline dimmed suffix rendered as `· <suffix>` beside the title. */
  titleSuffix?: string;
  requestSource?: PermissionRequestSource;
  /** Official 2.1.328 `Xa.srPrefix`: screen-reader prefix (pass `null` to suppress). */
  srPrefix?: string | null;
  /** Official 2.1.328 `Xa.marginTop`: outer top margin (default `1`). */
  marginTop?: number;
  /** Official 2.1.328 `Xa.hideBorder`: suppress the outer rounded top border (default `false`). */
  hideBorder?: boolean;
  /** Official 2.1.328 `Xa.frame`: render in framed-card `<Dialog>` mode (`fe`). */
  frame?: PermissionDialogFrame;
  children: React.ReactNode;
};

function FramedPermissionDialog({
  title,
  subtitle,
  color,
  requestSource,
  workerBadge,
  titleRight,
  titleSuffix,
  askPosition,
  columns,
  insideModal,
  srPrefix,
  frame,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  color: keyof Theme;
  requestSource?: PermissionRequestSource;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  titleSuffix?: string;
  askPosition: string | null;
  columns: number;
  insideModal: boolean;
  srPrefix: string | null;
  frame: PermissionDialogFrame;
  children: React.ReactNode;
}): React.ReactNode {
  const suffixText = sanitizeTitleSuffix(frame.titleSuffix ?? titleSuffix);
  const sourceLabel = formatRequestSourceLabel(requestSource);
  const isScreenReader = isScreenReaderModeEnabled();
  const modalCtx = useContext(ModalContext);
  const innerCols = Math.max(1, columns - 2 * (insideModal ? PANE_PADDING_X_MODAL : PANE_PADDING_X_INLINE));
  const headerWidth =
    stringWidth(title) +
    (suffixText === '' ? 0 : 3 + stringWidth(suffixText)) +
    (sourceLabel == null ? 0 : 3 + stringWidth(sourceLabel)) +
    (workerBadge ? 3 + stringWidth(`@${workerBadge.name}`) : 0);
  const titleEndValue =
    titleRight ??
    (askPosition !== null && headerWidth + 2 + stringWidth(askPosition) <= innerCols ? askPosition : undefined);

  const ariaLabel = srPrefix === null ? undefined : `${srPrefix} ${title}`;
  const titleNode = <Text accessibility={ariaLabel !== undefined ? { label: ariaLabel } : undefined}>{title}</Text>;
  const titleSuffixNode =
    suffixText === '' && sourceLabel == null && !workerBadge ? undefined : (
      <>
        {suffixText !== '' && (
          <Text dimColor>
            {' · '}
            {suffixText}
          </Text>
        )}
        {sourceLabel != null && (
          <Text dimColor>
            {' · '}
            {sourceLabel}
          </Text>
        )}
        {workerBadge && (
          <Text dimColor>
            {' · '}@{workerBadge.name}
          </Text>
        )}
      </>
    );
  const subtitleNode =
    typeof subtitle === 'string' ? (
      <Text dimColor wrap="truncate-start">
        {subtitle}
      </Text>
    ) : (
      (subtitle ?? undefined)
    );

  const inputGuide =
    isScreenReader && frame.notice !== undefined ? (
      <Text color="warning">{frame.notice}</Text>
    ) : (
      <Byline>
        {frame.notice !== undefined && (
          <Text key="notice" color="warning">
            {frame.notice}
          </Text>
        )}
        <KeyboardShortcutHint key="cancel" shortcut="escape" action="cancel" format={LOWER_KEY_FORMAT} />
        {frame.showPermissionsHint !== false && <Text key="permissions">/permissions</Text>}
        {React.Children.toArray(frame.hints)}
      </Byline>
    );

  const nextModalCtx = modalCtx === null ? null : { ...modalCtx, columns: innerCols };

  return (
    <Dialog
      title={titleNode}
      titleSuffix={titleSuffixNode}
      subtitle={subtitleNode}
      isSubtitleDimmed={false}
      titleEnd={titleEndValue}
      color={color}
      onCancel={frame.onCancel}
      isCancelActive={false}
      truncateInputGuide={true}
      hideInputGuide={frame.showHintLine === false}
      inputGuide={inputGuide}
    >
      <ModalContext.Provider value={nextModalCtx}>
        <Box flexDirection="column">{children}</Box>
      </ModalContext.Provider>
    </Dialog>
  );
}

export function PermissionDialog({
  title,
  subtitle,
  color = 'permission',
  titleColor,
  innerPaddingX = 1,
  hasPanelInset = false,
  workerBadge,
  titleRight,
  titleEnd,
  titleSuffix,
  requestSource,
  srPrefix = DEFAULT_SR_PREFIX,
  marginTop = 1,
  hideBorder = false,
  frame,
  children,
}: Props): React.ReactNode {
  const rightNode = titleRight ?? titleEnd;
  const tally = usePermissionQueueTally();
  const terminalSize = useTerminalSize();
  const { columns } = useModalOrTerminalSize(terminalSize);
  const effectiveCols = columns > 0 ? columns : 80;
  const insideModal = useIsInsideModal();
  const useFramed = frame !== undefined;
  const headerPaddingX =
    hasPanelInset &&
    !insideModal &&
    titleFitsRow(
      title,
      requestSource,
      workerBadge,
      effectiveCols - 2 * PANE_PADDING_X_INLINE - (tally === null ? 0 : 1 + stringWidth(tally)),
    )
      ? PANE_PADDING_X_INLINE
      : 1;
  const bodyPaddingX = hasPanelInset && !useFramed ? headerPaddingX : innerPaddingX;

  if (frame !== undefined) {
    return (
      <FramedPermissionDialog
        title={title}
        subtitle={subtitle}
        color={color}
        requestSource={requestSource}
        workerBadge={workerBadge}
        titleRight={rightNode}
        titleSuffix={titleSuffix}
        askPosition={tally}
        columns={effectiveCols}
        insideModal={insideModal}
        srPrefix={srPrefix}
        frame={frame}
      >
        {children}
      </FramedPermissionDialog>
    );
  }

  const rowColumns = effectiveCols - 2 * headerPaddingX;
  const aside = rightNode === undefined && tally !== null ? { text: tally, rowColumns } : undefined;
  const suffixText = sanitizeTitleSuffix(titleSuffix);
  const titleElement = (
    <PermissionRequestTitle
      title={title}
      subtitle={subtitle}
      color={titleColor}
      workerBadge={workerBadge}
      requestSource={requestSource}
      srPrefix={srPrefix ?? undefined}
      aside={aside}
    />
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      borderTop={!hideBorder}
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      marginTop={marginTop}
    >
      <Box paddingX={headerPaddingX} flexDirection="column">
        <Box justifyContent="space-between">
          {suffixText !== '' ? (
            <Box flexDirection="row">
              {titleElement}
              <Text dimColor>
                {' · '}
                {suffixText}
              </Text>
            </Box>
          ) : (
            titleElement
          )}
          {rightNode}
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={bodyPaddingX}>
        {children}
      </Box>
      <DialogWait />
    </Box>
  );
}
