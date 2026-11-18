/**
 * densable qd @192241903 — Vk(AIt) + debounced qJt + exit fallback.
 */
import { useEffect, useRef } from 'react'
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

export function useFleetComposerDraftPersistence(input: {
  canonicalLauncherCwd: string
  snapshot: FleetComposerDraftSnapshot
  onRestore: (draft: FleetComposerDraftRestore) => void
}): void {
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
            const { query, mode, collapsed } = snapshotRef.current
            const q = fleetComposerDraftForDisk(query, mode)
            const body = { q, collapsed: [...collapsed] }
            if (q || body.collapsed.length) {
              await persistFleetLauncherDraftAsync(
                input.canonicalLauncherCwd,
                body,
                storage,
              )
              preExitFlushedRef.current = true
            } else {
              await clearFleetLauncherDraft(input.canonicalLauncherCwd, storage)
              preExitFlushedRef.current = true
            }
            asyncDone = true
          })
        : undefined

    const flush = () => {
      if (asyncDone) return
      dirtyRef.current = false
      void flushFleetComposerDraft(
        input.canonicalLauncherCwd,
        snapshotRef.current,
        storage,
      )
    }
    process.on('exit', flush)
    return () => {
      unregister?.()
      process.off('exit', flush)
    }
  }, [input.canonicalLauncherCwd, storage])
}

function onRestoreSafe(
  onRestore: (draft: FleetComposerDraftRestore) => void,
  draft: FleetLauncherDraftBody,
): void {
  const { query, mode } = parseFleetComposerDraftFromDisk(draft.q)
  onRestore({ query, mode, collapsed: draft.collapsed })
}
