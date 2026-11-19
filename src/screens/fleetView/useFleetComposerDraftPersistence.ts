/**
 * densable qd @192241903 — Vk(AIt) + debounced qJt + exit fallback.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useSessionServices } from '../../context/sessionServices.js'
import { registerPreExitFlush } from '../../utils/cleanupRegistry.js'
import { isHoverRestOn } from '../../utils/storageV5/hoverRestPin.js'
import type { StorageV5 } from '../../utils/storageV5/createLocalFsBackend.js'
import {
  clearFleetLauncherDraft,
  fleetComposerDraftForDisk,
  loadFleetLauncherDraft,
  parseFleetComposerDraftFromDisk,
  persistFleetLauncherDraft,
  persistFleetLauncherDraftAsync,
  type FleetLauncherDraftBody,
} from './launcherDraft.js'

const LIVE_PERSIST_MS = 300

export type FleetComposerDraftSnapshot = {
  query: string
  mode: 'prompt' | 'bash'
  collapsed: readonly string[]
}

export type FleetComposerDraftRestore = {
  query: string
  mode: 'prompt' | 'bash'
  collapsed: string[]
}

export function flushFleetComposerDraft(
  canonicalLauncherCwd: string,
  snapshot: FleetComposerDraftSnapshot,
  storage?: StorageV5,
): Promise<void> {
  const q = fleetComposerDraftForDisk(snapshot.query, snapshot.mode)
  if (q || snapshot.collapsed.length > 0) {
    return persistFleetLauncherDraft(
      canonicalLauncherCwd,
      { q, collapsed: [...snapshot.collapsed] },
      storage,
    )
  }
  return clearFleetLauncherDraft(canonicalLauncherCwd, storage)
}

/**
 * Official #1763 — exit / pre-exit persistence must NEVER delete an existing
 * draft saved by another agent view in the same directory when this view is
 * exiting with nothing typed and no collapsed sections.
 */
export async function flushFleetComposerDraftOnExit(
  canonicalLauncherCwd: string,
  snapshot: FleetComposerDraftSnapshot,
  storage?: StorageV5,
): Promise<boolean> {
  const q = fleetComposerDraftForDisk(snapshot.query, snapshot.mode)
  const body = { q, collapsed: [...snapshot.collapsed] }
  if (q || body.collapsed.length > 0) {
    return persistFleetLauncherDraftAsync(canonicalLauncherCwd, body, storage)
  }
  return true
}

/**
 * Official #1764 + #1904 (ku `Wt`) — draft handover before an update relaunch:
 * - Only flush when this view actually typed text (`query` non-empty) OR
 *   actively edited/dirtied its draft (`wasDirty`).
 * - When nothing was typed and this view was never dirtied, leave disk alone
 *   so another agent view's saved draft in the same directory is not erased.
 */
export function handOverFleetComposerDraft(
  canonicalLauncherCwd: string,
  snapshot: FleetComposerDraftSnapshot,
  wasDirty: boolean,
  storage?: StorageV5,
): Promise<void> | undefined {
  const q = fleetComposerDraftForDisk(snapshot.query, snapshot.mode)
  if (!wasDirty && !q) {
    return undefined
  }
  return flushFleetComposerDraft(canonicalLauncherCwd, snapshot, storage)
}

export function useFleetComposerDraftPersistence(input: {
  canonicalLauncherCwd: string
  snapshot: FleetComposerDraftSnapshot
  onRestore: (draft: FleetComposerDraftRestore) => void
}): () => Promise<void> | undefined {
  const { storageV5 } = useSessionServices()
  const storage = storageV5 as StorageV5 | undefined
  const preExitFlushedRef = useRef(false)
  const restoreOnceRef = useRef(false)
  const dirtyRef = useRef(false)
  const baselineRef = useRef<{
    text: string
    collapsed: readonly string[]
  } | null>(null)
  const snapshotRef = useRef(input.snapshot)
  snapshotRef.current = input.snapshot
  const cwdRef = useRef(input.canonicalLauncherCwd)
  cwdRef.current = input.canonicalLauncherCwd
  const storageRef = useRef(storage)
  storageRef.current = storage

  useEffect(() => {
    dirtyRef.current = false
    baselineRef.current = {
      text: fleetComposerDraftForDisk(
        snapshotRef.current.query,
        snapshotRef.current.mode,
      ),
      collapsed: snapshotRef.current.collapsed,
    }
  }, [input.canonicalLauncherCwd, storage])

  useEffect(() => {
    if (restoreOnceRef.current) return
    restoreOnceRef.current = true
    let cancelled = false
    void (async () => {
      const draft = await loadFleetLauncherDraft(
        input.canonicalLauncherCwd,
        storage,
      )
      if (cancelled || !draft) return
      onRestoreSafe(input.onRestore, draft)
    })()
    return () => {
      cancelled = true
    }
  }, [input.canonicalLauncherCwd, input.onRestore, storage])

  useEffect(() => {
    if (preExitFlushedRef.current) return
    const { query, mode, collapsed } = snapshotRef.current
    const q = fleetComposerDraftForDisk(query, mode)
    const prev = baselineRef.current
    if (prev && (q !== prev.text || collapsed !== prev.collapsed)) {
      prev.text = q
      prev.collapsed = collapsed
      dirtyRef.current = true
    }
    if (!dirtyRef.current) return
    const handle = setTimeout(() => {
      if (preExitFlushedRef.current) return
      dirtyRef.current = false
      void flushFleetComposerDraft(
        input.canonicalLauncherCwd,
        snapshotRef.current,
        storage,
      )
    }, LIVE_PERSIST_MS)
    return () => clearTimeout(handle)
  }, [
    input.canonicalLauncherCwd,
    input.snapshot.query,
    input.snapshot.mode,
    input.snapshot.collapsed,
    storage,
  ])

  useEffect(() => {
    return () => {
      if (dirtyRef.current && !preExitFlushedRef.current) {
        dirtyRef.current = false
        void flushFleetComposerDraft(
          cwdRef.current,
          snapshotRef.current,
          storageRef.current,
        )
      }
    }
  }, [])

  useEffect(() => {
    let asyncDone = false
    const unregister =
      isHoverRestOn() && storage !== undefined
        ? registerPreExitFlush(async () => {
            // Official #1763: when exiting with empty draft + no collapsed sections,
            // do NOT call clearFleetLauncherDraft so another agent view's draft stays intact.
            const persisted = await flushFleetComposerDraftOnExit(
              input.canonicalLauncherCwd,
              snapshotRef.current,
              storage,
            )
            preExitFlushedRef.current = persisted
            asyncDone = true
          })
        : undefined

    const flush = () => {
      if (asyncDone || preExitFlushedRef.current) return
      dirtyRef.current = false
      const { query, mode, collapsed } = snapshotRef.current
      const q = fleetComposerDraftForDisk(query, mode)
      if (q || collapsed.length > 0) {
        void persistFleetLauncherDraft(
          input.canonicalLauncherCwd,
          { q, collapsed: [...collapsed] },
          storage,
        )
      }
    }
    process.on('exit', flush)
    return () => {
      unregister?.()
      process.off('exit', flush)
    }
  }, [input.canonicalLauncherCwd, storage])

  return useCallback(() => {
    try {
      const wasDirty = dirtyRef.current
      dirtyRef.current = false
      const pending = handOverFleetComposerDraft(
        cwdRef.current,
        snapshotRef.current,
        wasDirty,
        storageRef.current,
      )
      if (pending) {
        preExitFlushedRef.current = true
        registerPreExitFlush(() => pending)
      }
      return pending
    } catch {
      return undefined
    }
  }, [])
}

function onRestoreSafe(
  onRestore: (draft: FleetComposerDraftRestore) => void,
  draft: FleetLauncherDraftBody,
): void {
  const { query, mode } = parseFleetComposerDraftFromDisk(draft.q)
  onRestore({ query, mode, collapsed: draft.collapsed })
}
