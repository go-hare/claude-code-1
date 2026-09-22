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

export function useFleetComposerDraftPersistence(input: {
  canonicalLauncherCwd: string
  snapshot: FleetComposerDraftSnapshot
  onRestore: (draft: FleetComposerDraftRestore) => void
}): void {
  const { storageV5 } = useSessionServices()
  const storage = storageV5 as StorageV5 | undefined
  const preExitFlushedRef = useRef(false)
  const restoreOnceRef = useRef(false)
  const snapshotRef = useRef(input.snapshot)
  snapshotRef.current = input.snapshot

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
    if (!q && collapsed.length === 0) return
    const handle = setTimeout(() => {
      if (preExitFlushedRef.current) return
      void persistFleetLauncherDraft(
        input.canonicalLauncherCwd,
        { q, collapsed: [...collapsed] },
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
            }
            asyncDone = true
          })
        : undefined

    const flush = () => {
      if (asyncDone) return
      const { query, mode, collapsed } = snapshotRef.current
      const q = fleetComposerDraftForDisk(query, mode)
      const body = { q, collapsed: [...collapsed] }
      if (q || body.collapsed.length) {
        void persistFleetLauncherDraft(
          input.canonicalLauncherCwd,
          body,
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
}

function onRestoreSafe(
  onRestore: (draft: FleetComposerDraftRestore) => void,
  draft: FleetLauncherDraftBody,
): void {
  const { query, mode } = parseFleetComposerDraftFromDisk(draft.q)
  onRestore({ query, mode, collapsed: draft.collapsed })
}
