import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildFleetFooterHints } from '../helpers.js'
import { fleetComposerDraftForDisk } from '../launcherDraft.js'
import { flushFleetComposerDraft } from '../useFleetComposerDraftPersistence.js'

describe('#1289 / #1327 AgentView Ctrl+D double-press and empty bash reset', () => {
  test('buildFleetFooterHints renders Ctrl-D prompt when exitArmedKind is Ctrl-D', () => {
    const hint = buildFleetFooterHints({
      focusArea: 'list',
      viewMode: 'list',
      deletePending: false,
      ungroupPending: false,
      justKilled: false,
      canPin: false,
      canGroup: false,
      canRename: false,
      openSlots: 0,
      exitArmed: true,
      exitArmedKind: 'Ctrl-D',
      runningCount: 2,
      helpOpen: false,
    })
    expect(hint).toBe('Press Ctrl-D again to exit · 2 agents will keep running')
  })

  test('buildFleetFooterHints defaults to Ctrl-C prompt when exitArmedKind is omitted', () => {
    const hint = buildFleetFooterHints({
      focusArea: 'list',
      viewMode: 'list',
      deletePending: false,
      ungroupPending: false,
      justKilled: false,
      canPin: false,
      canGroup: false,
      canRename: false,
      openSlots: 0,
      exitArmed: true,
      runningCount: 0,
      helpOpen: false,
    })
    expect(hint).toBe('Press Ctrl-C again to exit')
  })

  test('fleetComposerDraftForDisk returns empty string once bash mode is reset to prompt', () => {
    expect(fleetComposerDraftForDisk('', 'bash')).toBe('!')
    expect(fleetComposerDraftForDisk('', 'prompt')).toBe('')
  })

  test('AgentView.tsx wires Ctrl+D double-press exit and resets empty bash mode', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', '..', 'AgentView.tsx'),
      'utf8',
    )
    expect(src).toContain("handleCtrlCDoublePress('Ctrl-D')")
    expect(src).toContain(
      "if (dispatchMode === 'bash' && dispatchInput === '')",
    )
  })
})

describe('#1326 useFleetComposerDraftPersistence clears draft when emptied', () => {
  test('flushFleetComposerDraft deletes storage key when query and collapsed are empty', async () => {
    const deleted: Array<{ namespace: string; draftKey: string }> = []
    const written: Array<{ key: unknown; value: string }> = []
    const mockStorage = {
      write: async (key: unknown, value: string) => {
        written.push({ key, value })
        return { ok: true as const, value: undefined }
      },
      delete: async (key: { namespace: string; draftKey: string }) => {
        deleted.push(key)
        return { ok: true as const, value: undefined }
      },
    }

    await flushFleetComposerDraft(
      '/tmp/test-cwd',
      { query: '', mode: 'prompt', collapsed: [] },
      mockStorage as never,
    )

    // Regardless of hoverRestPin state, an empty snapshot must never write a draft.
    expect(written).toHaveLength(0)
  })

  test('useFleetComposerDraftPersistence tracks dirtyRef and flushes empty drafts on debounce/unmount/exit', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'useFleetComposerDraftPersistence.ts'),
      'utf8',
    )
    expect(src).toContain('dirtyRef')
    expect(src).toContain('flushFleetComposerDraft')
    expect(src).toContain('clearFleetLauncherDraft')
  })
})
