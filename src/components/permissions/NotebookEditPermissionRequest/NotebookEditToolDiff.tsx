import { relative } from 'path';
import * as React from 'react';
import { Suspense, use, useMemo } from 'react';
import { Box, NoSelect, Text } from '@anthropic/ink';
import type { NotebookCell, NotebookCellType, NotebookContent } from '../../../types/notebook.js';
import { intersperse } from '../../../utils/array.js';
import { getCwd } from '../../../utils/cwd.js';
import { getPatchForDisplay } from '../../../utils/diff.js';
import { getFsImplementation } from '../../../utils/fsOperations.js';
import { safeParseJSON } from '../../../utils/json.js';
import { parseCellId } from '../../../utils/notebook.js';
import { HighlightedCode } from '../../HighlightedCode.js';
import { StructuredDiff } from '../../StructuredDiff.js';

type Props = {
  notebook_path: string;
  cell_id: string | undefined;
  new_source: string;
  cell_type?: NotebookCellType;
  edit_mode?: string;
  verbose: boolean;
  width: number;
  /** densable oldCellSource — when provided, skip local notebook re-read. */
  oldCellSource?: string;
  /** densable _ou remoteOldContent — parse as notebook JSON. */
  remoteOldContent?: string | null;
  /** densable _ou skipLocalRead — DualInk analog remote workspace. */
  skipLocalRead?: boolean;
};

type InnerProps = {
  notebook_path: string;
  cell_id: string | undefined;
  new_source: string;
  cell_type?: NotebookCellType;
  edit_mode?: string;
  verbose: boolean;
  width: number;
  oldCellSource?: string;
  remoteOldContent?: string | null;
  skipLocalRead?: boolean;
  promise: Promise<NotebookContent | null>;
};

const SKIP_NOTEBOOK_READ = Promise.resolve(null);

export function NotebookEditToolDiff(props: Props): React.ReactNode {
  // Prefer precomputed oldCellSource from permission preview (avoids double-read
  // and empty-diff when withhold path already resolved the cell).
  const notebookDataPromise = useMemo(() => {
    if (props.oldCellSource !== undefined) {
      return SKIP_NOTEBOOK_READ;
    }
    if (props.remoteOldContent !== undefined) {
      if (typeof props.remoteOldContent !== 'string') {
        return SKIP_NOTEBOOK_READ;
      }
      return Promise.resolve(safeParseJSON(props.remoteOldContent) as NotebookContent | null);
    }
    if (props.skipLocalRead) {
      return SKIP_NOTEBOOK_READ;
    }
    return getFsImplementation()
      .readFile(props.notebook_path, { encoding: 'utf-8' })
      .then(content => safeParseJSON(content) as NotebookContent | null)
      .catch(() => null);
  }, [props.notebook_path, props.oldCellSource, props.remoteOldContent, props.skipLocalRead]);

  return (
    <Suspense fallback={null}>
      <NotebookEditToolDiffInner {...props} promise={notebookDataPromise} />
    </Suspense>
  );
}

function NotebookEditToolDiffInner({
  notebook_path,
  cell_id,
  new_source,
  cell_type,
  edit_mode = 'replace',
  verbose,
  width,
  oldCellSource,
  promise,
}: InnerProps): React.ReactNode {
  const notebookData = use(promise);

  const oldSource = useMemo(() => {
    if (oldCellSource !== undefined) {
      return oldCellSource;
    }
    if (!notebookData || !cell_id) {
      return '';
    }
    const cellIndex = parseCellId(cell_id);
    if (cellIndex !== undefined) {
      if (notebookData.cells[cellIndex]) {
        const source = notebookData.cells[cellIndex].source;
        return Array.isArray(source) ? source.join('') : source;
      }
      return '';
    }
    const cell = notebookData.cells.find((cell: NotebookCell) => cell.id === cell_id);
    if (!cell) {
      return '';
    }
    return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
  }, [notebookData, cell_id, oldCellSource]);

  const hunks = useMemo(() => {
    if (edit_mode === 'insert' || edit_mode === 'delete') {
      return null;
    }
    if (oldCellSource === undefined && !notebookData) {
      return null;
    }
    // Create a "fake" file content with just the cell source
    // This allows us to use the regular diff mechanism
    return getPatchForDisplay({
      filePath: notebook_path,
      fileContents: oldSource,
      edits: [
        {
          old_string: oldSource,
          new_string: new_source,
          replace_all: false,
        },
      ],
      ignoreWhitespace: false,
    });
  }, [notebookData, notebook_path, oldSource, new_source, edit_mode, oldCellSource]);

  let editTypeDescription: string;
  switch (edit_mode) {
    case 'insert':
      editTypeDescription = 'Insert new cell';
      break;
    case 'delete':
      editTypeDescription = 'Delete cell';
      break;
    default:
      editTypeDescription = 'Replace cell contents';
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Box paddingBottom={1} flexDirection="column">
          <Text bold>{verbose ? notebook_path : relative(getCwd(), notebook_path)}</Text>
          <Text dimColor>
            {editTypeDescription} for cell {cell_id}
            {cell_type ? ` (${cell_type})` : ''}
          </Text>
        </Box>
        {edit_mode === 'delete' ? (
          <Box flexDirection="column" paddingLeft={2}>
            <HighlightedCode code={oldSource} filePath={notebook_path} />
          </Box>
        ) : edit_mode === 'insert' ? (
          <Box flexDirection="column" paddingLeft={2}>
            <HighlightedCode code={new_source} filePath={cell_type === 'markdown' ? 'file.md' : notebook_path} />
          </Box>
        ) : hunks ? (
          intersperse(
            hunks.map(_ => (
              <StructuredDiff
                key={_.newStart}
                patch={_}
                dim={false}
                width={width}
                filePath={notebook_path}
                firstLine={new_source.split('\n')[0] ?? null}
                fileContent={oldSource}
              />
            )),
            i => (
              <NoSelect fromLeftEdge key={`ellipsis-${i}`}>
                <Text dimColor>...</Text>
              </NoSelect>
            ),
          )
        ) : (
          <HighlightedCode code={new_source} filePath={cell_type === 'markdown' ? 'file.md' : notebook_path} />
        )}
      </Box>
    </Box>
  );
}
