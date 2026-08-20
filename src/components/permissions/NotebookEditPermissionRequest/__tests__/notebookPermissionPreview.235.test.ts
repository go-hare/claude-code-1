import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GFt,
  NOTEBOOK_PREVIEW_FAILURE_REASONS,
  buildNotebookPermissionPreview,
  lookupNotebookCellSource,
} from '../notebookPermissionPreview.js'

const SAMPLE_NOTEBOOK = JSON.stringify({
  cells: [
    {
      id: 'abc',
      cell_type: 'code',
      source: ['print("hi")\n'],
    },
  ],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
})

describe('densable 2.1.235 #7 notebook permission preview', () => {
  test('lookupNotebookCellSource finds by id and by cell-N index', () => {
    expect(lookupNotebookCellSource(SAMPLE_NOTEBOOK, 'abc')).toEqual({
      kind: 'found',
      source: 'print("hi")\n',
    })
    expect(lookupNotebookCellSource(SAMPLE_NOTEBOOK, 'cell-0')).toEqual({
      kind: 'found',
      source: 'print("hi")\n',
    })
    expect(lookupNotebookCellSource(SAMPLE_NOTEBOOK, 'missing')).toEqual({
      kind: 'cell-missing',
    })
    expect(lookupNotebookCellSource('{not json', 'abc')).toEqual({
      kind: 'unparsable',
    })
  })

  test('proposed cell content too large → one-time-only message + contentWithheld', async () => {
    const preview = await buildNotebookPermissionPreview({
      notebook_path: '/tmp/x.ipynb',
      cell_id: 'abc',
      new_source: 'x'.repeat(GFt + 1),
      edit_mode: 'replace',
    })
    expect(preview).toEqual({
      kind: 'no-changes',
      contentWithheld: true,
      message:
        'Proposed cell content is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected).',
    })
  })

  test('remote not found / fetch failed / network path reasons', async () => {
    const notFound = await buildNotebookPermissionPreview({
      notebook_path: '/remote/a.ipynb',
      cell_id: 'abc',
      new_source: 'ok',
      edit_mode: 'replace',
      remoteWorkspace: true,
      remoteOldContent: null,
    })
    expect(notFound.kind).toBe('no-changes')
    expect(notFound.contentWithheld).toBe(true)
    expect(notFound.message).toContain(
      NOTEBOOK_PREVIEW_FAILURE_REASONS.remoteNotFound,
    )

    const fetchFailed = await buildNotebookPermissionPreview({
      notebook_path: '/remote/a.ipynb',
      cell_id: 'abc',
      new_source: 'ok',
      edit_mode: 'delete',
      remoteWorkspace: true,
      remoteOldContent: undefined,
    })
    expect(fetchFailed.message).toContain(
      NOTEBOOK_PREVIEW_FAILURE_REASONS.remoteFetchFailed,
    )
    expect(fetchFailed.message).toContain('deletion')

    // densable Qh/_u network-path gate is Windows-only locally
    // (containsVulnerableUncPath short-circuits non-windows). On darwin this
    // UNC path falls through to could-not-read; assert the helper itself.
    const { isNotebookNetworkPath } = await import(
      '../notebookPermissionPreview.js'
    )
    if (process.platform === 'win32') {
      const network = await buildNotebookPermissionPreview({
        notebook_path: '\\\\server\\share\\nb.ipynb',
        cell_id: 'abc',
        new_source: 'ok',
        edit_mode: 'replace',
      })
      expect(network.message).toContain(
        NOTEBOOK_PREVIEW_FAILURE_REASONS.networkPath,
      )
    } else {
      expect(isNotebookNetworkPath('\\\\server\\share\\nb.ipynb')).toBe(false)
    }
  })

  test('unparsable / cell-missing / could-not-read local paths', async () => {
    const unparsable = await buildNotebookPermissionPreview({
      notebook_path: '/remote/a.ipynb',
      cell_id: 'abc',
      new_source: 'ok',
      edit_mode: 'replace',
      remoteWorkspace: true,
      remoteOldContent: '{bad',
    })
    expect(unparsable.message).toContain(
      NOTEBOOK_PREVIEW_FAILURE_REASONS.unparsable,
    )

    const missing = await buildNotebookPermissionPreview({
      notebook_path: '/remote/a.ipynb',
      cell_id: 'nope',
      new_source: 'ok',
      edit_mode: 'replace',
      remoteWorkspace: true,
      remoteOldContent: SAMPLE_NOTEBOOK,
    })
    expect(missing.message).toContain(
      NOTEBOOK_PREVIEW_FAILURE_REASONS.cellMissing,
    )

    const unread = await buildNotebookPermissionPreview({
      notebook_path: '/definitely/missing/notebook-235.ipynb',
      cell_id: 'abc',
      new_source: 'ok',
      edit_mode: 'replace',
    })
    expect(unread.message).toContain(
      NOTEBOOK_PREVIEW_FAILURE_REASONS.couldNotRead,
    )
  })

  test('current cell too large and successful diff path', async () => {
    const hugeCell = JSON.stringify({
      cells: [
        {
          id: 'big',
          cell_type: 'code',
          source: ['y'.repeat(GFt + 2)],
        },
      ],
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
    })
    const tooLarge = await buildNotebookPermissionPreview({
      notebook_path: '/remote/a.ipynb',
      cell_id: 'big',
      new_source: 'ok',
      edit_mode: 'replace',
      remoteWorkspace: true,
      remoteOldContent: hugeCell,
    })
    expect(tooLarge.message).toContain(
      NOTEBOOK_PREVIEW_FAILURE_REASONS.cellContentsTooLarge,
    )
    expect(tooLarge.message).toMatch(
      /Current cell contents cannot be shown \(.*\) — the edit cannot be reviewed, so approval is one-time only \(deny unless expected\)\./,
    )

    const dir = await mkdtemp(join(tmpdir(), 'nb-preview-235-'))
    const path = join(dir, 'ok.ipynb')
    try {
      await writeFile(path, SAMPLE_NOTEBOOK, 'utf8')
      const ok = await buildNotebookPermissionPreview({
        notebook_path: path,
        cell_id: 'abc',
        new_source: 'print("bye")\n',
        edit_mode: 'replace',
      })
      expect(ok).toEqual({
        kind: 'notebook-edit-diff',
        contentWithheld: false,
        oldCellSource: 'print("hi")\n',
      })

      const insert = await buildNotebookPermissionPreview({
        notebook_path: path,
        cell_id: 'abc',
        new_source: 'print("new")\n',
        edit_mode: 'insert',
      })
      expect(insert.contentWithheld).toBe(false)
      expect(insert.kind).toBe('notebook-edit-diff')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
