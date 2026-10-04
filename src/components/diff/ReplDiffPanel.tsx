import {
  Box,
  ProgressBar,
  ScrollBox,
  Text,
  wrapText,
  useInput,
  type DOMElement,
  type ScrollBoxHandle,
} from '@anthropic/ink';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StructuredPatchHunk } from 'diff';
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js';
import { useDiffData, type DiffFile } from '../../hooks/useDiffData.js';
import { useRegisterKeybindingContext } from '../../keybindings/KeybindingContext.js';
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { useNotifications } from '../../context/notifications.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import {
  closeReplDiffTab,
  cycleDiffBaseMode,
  getPersistedDiffBaseMode,
  getReplDiffHost,
  partitionReplDiffFiles,
  REPL_DIFF_ARROW_DOWN,
  REPL_DIFF_ARROW_UP,
  REPL_DIFF_LIST_WINDOW,
  REPL_DIFF_PRESESSION_HUNKS_CAP,
  REPL_DIFF_STAGED_NO_COMMITS,
  REPL_DIFF_TOO_MANY_HEADLINE,
  REPL_DIFF_TOO_MANY_HINT,
  REPL_DIFF_UNAVAILABLE_HEADLINE,
  REPL_DIFF_UNAVAILABLE_HINT,
  replDiffEmptyCopy,
  replDiffHiddenEmptyCopy,
  replDiffPathIsReadDenied,
  replDiffPreSessionStats,
  replDiffRequestedModeLabel,
  type DiffBaseMode,
} from '../../utils/replDiffTab.js';
import { plural } from '../../utils/stringUtils.js';
import { truncateStartToWidth } from '../../utils/format.js';
import { DiffDetailView } from './DiffDetailView.js';
import {
  hideDiffPanelLatch,
  nodeScreenRect,
  parseSgrWheel,
  resolveDiffFileAtY,
  showDiffPanelLatch,
  useReplDiffSelectionAttach,
  type DiffSelectionAttach,
} from '../../utils/replDiffMouseHost.js';

type Props = {
  width: number;
  /** densable Obe `minCol` — transcript columns to the left of the panel. */
  minCol?: number;
  /** densable Obe `onAskAboutSelection` from LX. Optional — no REPL invent. */
  onAskAboutSelection?: (payload: DiffSelectionAttach) => void;
};

type EmptyCopy = { headline: string; hint: string | null };

function AddedRemoved({ added, removed }: { added: number; removed: number }): ReactNode {
  return (
    <Text>
      {added > 0 && <Text color="success">+{added}</Text>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <Text color="error">-{removed}</Text>}
    </Text>
  );
}

/** densable `Nbe` — close control (`D1t` ✕). */
function ReplDiffCloseButton({ onClose }: { onClose: () => void }): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box onClick={onClose} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Text bold={hover} dimColor={!hover}>
        {'✕'}
      </Text>
    </Box>
  );
}

/** densable `Lbe` */
function ReplDiffNoiseToggle({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box
      flexDirection="row"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text dimColor={!hover} underline={hover}>
        {count} {plural(count, 'test')}/generated ({shown ? 'hide' : 'show'})
      </Text>
    </Box>
  );
}

/** densable `Fbe` */
function ReplDiffFileStripItem({
  path,
  added,
  removed,
  width,
  onClick,
}: {
  path: string;
  added: number;
  removed: number;
  width: number;
  onClick: () => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  const label = truncateStartToWidth(path, Math.max(width - 12, 8));
  return (
    <Box flexDirection="row" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Text dimColor={!hover} underline={hover}>
        {label}
      </Text>
      <Box flexGrow={1} />
      <AddedRemoved added={added} removed={removed} />
    </Box>
  );
}

/** densable `TU` */
function ReplDiffPreSessionSection({
  files,
  hunks,
  shown,
  onToggle,
  width,
}: {
  files: DiffFile[];
  hunks: Map<string, StructuredPatchHunk[]>;
  shown: boolean;
  onToggle: () => void;
  width: number;
}): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="row"
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <Text dimColor={!hover} underline={hover}>
          {`+${files.length} ${plural(files.length, 'file')} edited before this session (${shown ? 'hide' : 'show'})`}
        </Text>
      </Box>
      {shown && (
        <Box flexDirection="column">
          <Box flexDirection="column" marginTop={1}>
            {files.map(file => (
              <Box key={file.path} flexDirection="row" width={width}>
                <Text dimColor>{truncateStartToWidth(file.path, Math.max(width - 12, 8))}</Text>
                <Box flexGrow={1} />
                <AddedRemoved added={file.linesAdded} removed={file.linesRemoved} />
              </Box>
            ))}
          </Box>
          {files.length > REPL_DIFF_PRESESSION_HUNKS_CAP ? (
            <Text dimColor>{`diffs hidden above ${REPL_DIFF_PRESESSION_HUNKS_CAP} files`}</Text>
          ) : (
            files.map(file => (
              <Box key={`hunk:${file.path}`} flexDirection="column">
                <DiffDetailView
                  filePath={file.path}
                  hunks={hunks.get(file.path) ?? []}
                  isBinary={file.isBinary}
                  isLargeFile={file.isLargeFile}
                  isTruncated={file.isTruncated}
                  isUntracked={file.isUntracked}
                  width={width}
                />
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * densable `Obe` / `Zmu` fullscreen uncommitted panel.
 */
export function ReplDiffPanel({ width, minCol = 0, onAskAboutSelection }: Props): ReactNode {
  useRegisterKeybindingContext('DiffPanel');
  const [requestedMode, setRequestedMode] = useState<DiffBaseMode>(getPersistedDiffBaseMode);
  const revision = useAppState(s => s.fileHistory.snapshotSequence);
  const permissionContext = useAppState(s => s.toolPermissionContext);
  const sessionId = getSessionId();
  const sessionTodos = useAppState(s => s.todos[sessionId] ?? []);
  const { files, loading, source, baseMode, stats, hunks, noCommits } = useDiffData(requestedMode, revision);
  const setAppState = useSetAppState();
  const host = getReplDiffHost();
  const cwd = getCwd();
  const screenReader = isScreenReaderModeEnabled();
  const inner = Math.max(width - 2, 20);

  useKeybinding(
    'app:cycleDiffBase',
    () => {
      setRequestedMode(current => cycleDiffBaseMode(current));
    },
    { context: 'DiffPanel' },
  );

  const preSessionStats = replDiffPreSessionStats(files);
  const [showNoise, setShowNoise] = useState(false);
  const [showPreSession, setShowPreSession] = useState(false);
  const [listOffset, setListOffset] = useState(0);
  const fileNodeMap = useRef(new Map<string, DOMElement>());
  const scrollRef = useRef<ScrollBoxHandle>(null);
  const panelRef = useRef<DOMElement>(null);
  const stripRef = useRef<DOMElement>(null);
  const bodyRef = useRef<DOMElement>(null);
  const { processQueue } = useNotifications();

  // densable Obe `T(()=>(ro(ruo),()=>{ro(auo),lo()}))`
  useEffect(() => {
    setAppState(showDiffPanelLatch);
    return () => {
      setAppState(hideDiffPanelLatch);
      processQueue();
    };
  }, [processQueue, setAppState]);

  const partition = useMemo(() => {
    // densable Obe `Wn=qr===Un?[Un]:[Un,qr]`
    const original = getOriginalCwd();
    const roots = cwd === original ? [original] : [original, cwd];
    return partitionReplDiffFiles(
      files,
      path => roots.some(root => replDiffPathIsReadDenied(root, path, permissionContext)),
      showNoise,
    );
  }, [cwd, files, permissionContext, showNoise]);

  const { files: visible, preSessionFiles, noiseCount, deniedHidden } = partition;
  const allPreSession =
    files.length > 0 && preSessionStats.filesCount === files.length && noiseCount === 0 && deniedHidden === 0;
  const visibleAdded = allPreSession ? 0 : (stats?.linesAdded ?? 0) - preSessionStats.linesAdded;
  const visibleRemoved = allPreSession ? 0 : (stats?.linesRemoved ?? 0) - preSessionStats.linesRemoved;
  const visibleCount = allPreSession ? 0 : (stats?.filesCount ?? files.length) - preSessionStats.filesCount;
  const maxOffset = Math.max(0, visible.length - REPL_DIFF_LIST_WINDOW);
  const offset = Math.min(listOffset, maxOffset);
  const windowFiles = visible.slice(offset, offset + REPL_DIFF_LIST_WINDOW);
  const moreAbove = offset;
  const moreBelow = visible.length - (offset + windowFiles.length);
  const notShown = Math.max(0, visibleCount - (files.length - preSessionStats.filesCount));
  const noiseHidden = showNoise ? 0 : noiseCount;
  const listDownShortcut = getShortcutDisplay('app:diffFileListDown', 'Global', 'alt+down');

  let empty: EmptyCopy | null = null;
  if (!loading) {
    if (stats === null) {
      empty = {
        headline: REPL_DIFF_UNAVAILABLE_HEADLINE,
        hint: REPL_DIFF_UNAVAILABLE_HINT,
      };
    } else if (visibleCount === 0) {
      empty = replDiffEmptyCopy(baseMode === 'auto' ? requestedMode : baseMode, source, noCommits);
    }
  }

  const hiddenEmpty: EmptyCopy | null =
    !loading && empty === null && files.length === 0
      ? { headline: REPL_DIFF_TOO_MANY_HEADLINE, hint: REPL_DIFF_TOO_MANY_HINT }
      : !loading && empty === null && visible.length === 0
        ? replDiffHiddenEmptyCopy(deniedHidden, noiseHidden)
        : null;
  const banner = empty ?? hiddenEmpty;
  const emptyCentered = loading || (banner !== null && !showPreSession);

  useKeybinding('app:toggleDiffNoiseFilter', () => setShowNoise(v => !v), {
    context: 'Global',
    isActive: noiseCount > 0,
  });
  useKeybindings(
    {
      'app:diffFileListUp': () => setListOffset(v => Math.max(0, Math.min(v, maxOffset) - 1)),
      'app:diffFileListDown': () => setListOffset(v => Math.min(maxOffset, Math.min(v, maxOffset) + 1)),
    },
    { context: 'Global', isActive: maxOffset > 0 },
  );
  useKeybinding('app:toggleDiffPreSession', () => setShowPreSession(v => !v), {
    context: 'Global',
    isActive: preSessionFiles.length > 0,
  });

  const scrollToFile = useCallback((path: string) => {
    const node = fileNodeMap.current.get(path);
    if (node) scrollRef.current?.scrollToElement(node);
  }, []);

  const getMaxRow = useCallback(() => {
    const rect = nodeScreenRect(panelRef.current);
    if (!rect) return null;
    return rect.top + rect.height - 1;
  }, []);
  const resolveFile = useCallback((y: number) => resolveDiffFileAtY(y, bodyRef.current, fileNodeMap.current), []);
  useReplDiffSelectionAttach(minCol, getMaxRow, onAskAboutSelection, resolveFile);

  // densable Obe `onWheel`: Box has no onWheel type. Wheel is InputEvent
  // (`wheelup`/`wheeldown`) + SGR row. Gold: strip `Ls(deltaY)` when ls>0;
  // body `scrollBy(deltaY*3)`.
  useInput(
    (_input, key, event) => {
      const wheel = parseSgrWheel(event.keypress.sequence, key);
      if (!wheel) return;
      const { deltaY, row } = wheel;
      if (maxOffset > 0) {
        const strip = nodeScreenRect(stripRef.current);
        if (strip && row !== null && row >= strip.top && row < strip.top + strip.height) {
          setListOffset(v => Math.max(0, Math.min(maxOffset, Math.min(v, maxOffset) + deltaY)));
          event.stopImmediatePropagation();
          return;
        }
      }
      const body = nodeScreenRect(bodyRef.current);
      if (body && (row === null || (row >= body.top && row < body.top + body.height))) {
        scrollRef.current?.scrollBy(deltaY * 3);
        event.stopImmediatePropagation();
      }
    },
    { isActive: true, prepend: true },
  );

  const completedTodos = sessionTodos.filter(t => t.status === 'completed').length;
  const todoTotal = sessionTodos.length;
  // densable Obe: `Ft=uU()?Ot:void 0` — todo meter only while screen-reader.
  const showTodoBar = screenReader && todoTotal > 0;

  const subtitle =
    stats !== null &&
    (noCommits
      ? visibleCount > 0 && <Text dimColor>{REPL_DIFF_STAGED_NO_COMMITS}</Text>
      : (requestedMode !== 'session' || baseMode !== 'session') && (
          <Text dimColor>{replDiffRequestedModeLabel(requestedMode, source, requestedMode !== baseMode)}</Text>
        ));

  const headerStats =
    !loading && empty === null ? (
      <Text>
        <Text bold>
          {visibleCount} {plural(visibleCount, 'file')}
        </Text>{' '}
        changed
        {(visibleAdded > 0 || visibleRemoved > 0) && ' '}
        {(visibleAdded > 0 || visibleRemoved > 0) && <AddedRemoved added={visibleAdded} removed={visibleRemoved} />}
      </Text>
    ) : null;

  const wrapEmpty = (copy: EmptyCopy): ReactNode =>
    [copy.headline, copy.hint ?? '']
      .flatMap(line => (line === '' ? [] : wrapText(line, inner, 'wrap').split('\n')))
      .map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ));

  return (
    <Box ref={panelRef} flexDirection="column" width={width} height="100%" overflow="hidden" selectionScope>
      <Box flexDirection="column" paddingX={1} paddingY={1} flexShrink={0}>
        <Box flexDirection="row">
          {headerStats}
          <Box flexGrow={1} />
          <ReplDiffCloseButton onClose={() => closeReplDiffTab(host, setAppState)} />
        </Box>
        {subtitle}
        {showTodoBar && (
          <Box marginTop={1} flexDirection="row" gap={1}>
            <ProgressBar
              ratio={completedTodos / todoTotal}
              width={Math.min(20, inner - 12)}
              fillColor="success"
              emptyColor="inactive"
            />
            <Text dimColor>
              {completedTodos}/{todoTotal}
            </Text>
          </Box>
        )}
        {(windowFiles.length > 0 || noiseCount > 0) && (
          <Box ref={stripRef} flexDirection="column" marginTop={1}>
            {moreAbove > 0 && (
              <Text dimColor>
                {REPL_DIFF_ARROW_UP} {moreAbove} more above
              </Text>
            )}
            {windowFiles.map(file => (
              <ReplDiffFileStripItem
                key={file.path}
                path={file.path}
                added={file.linesAdded}
                removed={file.linesRemoved}
                width={inner}
                onClick={() => scrollToFile(file.path)}
              />
            ))}
            {(moreBelow > 0 || deniedHidden > 0 || notShown > 0) && (
              <Text dimColor>
                {moreBelow > 0 ? `${REPL_DIFF_ARROW_DOWN} ` : '… '}
                {[
                  moreBelow > 0
                    ? `${moreBelow} more below${listDownShortcut ? ` (${listDownShortcut} to scroll)` : ''}`
                    : null,
                  deniedHidden > 0 ? `${deniedHidden} read-denied` : null,
                  notShown > 0 ? `${notShown} not shown` : null,
                ]
                  .filter(Boolean)
                  .join(' \xB7 ')}
              </Text>
            )}
            {noiseCount > 0 && (
              <ReplDiffNoiseToggle count={noiseCount} shown={showNoise} onToggle={() => setShowNoise(v => !v)} />
            )}
          </Box>
        )}
      </Box>
      <Box ref={bodyRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {emptyCentered ? (
          <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={1}>
            {loading ? <Text dimColor>Loading diff…</Text> : banner !== null && wrapEmpty(banner)}
          </Box>
        ) : (
          <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" stickyScroll={false} paddingX={1}>
            <Box flexDirection="column" width={inner}>
              {banner !== null ? (
                <Box flexDirection="column">
                  <Text>{banner.headline}</Text>
                  {banner.hint ? <Text dimColor>{banner.hint}</Text> : null}
                </Box>
              ) : (
                <Box flexDirection="column" gap={1}>
                  {visible.map(file => (
                    <Box
                      key={file.path}
                      flexDirection="column"
                      ref={(node: DOMElement | null) => {
                        if (node) fileNodeMap.current.set(file.path, node);
                        else fileNodeMap.current.delete(file.path);
                      }}
                    >
                      <DiffDetailView
                        filePath={file.path}
                        hunks={hunks.get(file.path) ?? []}
                        isBinary={file.isBinary}
                        isLargeFile={file.isLargeFile}
                        isTruncated={file.isTruncated}
                        isUntracked={file.isUntracked}
                        width={inner}
                      />
                    </Box>
                  ))}
                </Box>
              )}
              {stats !== null && preSessionFiles.length > 0 && (
                <ReplDiffPreSessionSection
                  files={preSessionFiles}
                  hunks={hunks}
                  shown={showPreSession}
                  onToggle={() => setShowPreSession(v => !v)}
                  width={inner}
                />
              )}
            </Box>
          </ScrollBox>
        )}
        {emptyCentered && stats !== null && preSessionFiles.length > 0 && (
          <Box flexShrink={0} paddingX={1} paddingBottom={1}>
            <ReplDiffPreSessionSection
              files={preSessionFiles}
              hunks={hunks}
              shown={showPreSession}
              onToggle={() => setShowPreSession(v => !v)}
              width={inner}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
