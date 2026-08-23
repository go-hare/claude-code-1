import { useEffect, useSyncExternalStore } from 'react'
import instances from '../core/instances.js'
import useStdin from './use-stdin.js'

/**
 * densable Wzg / QPf — poll DECXCPR every 200ms on iTerm.app / Apple_Terminal
 * fullscreen sessions to detect external alt-buffer wipes (Cmd+K).
 * probeExternalClear itself forceRedraws; gold Wzg does NOT also invoke
 * onDetected (that double-redrawed after wipe).
 *
 * densable Wzg (PromptInput, 2.1.238):
 *   function Wzg(){
 *     let {internal_querier:e}=Q8()
 *     let t=useSyncExternalStore(..., ()=>n0()?.terminal??V.terminal)
 *     useEffect(()=>{
 *       if(!Ws()||!e)return
 *       if(t!=="iTerm.app"&&t!=="Apple_Terminal")return
 *       let r=ef.get(process.stdout); if(!r)return
 *       let n=new AbortController
 *       return (async()=>{
 *         while(!n.signal.aborted) await r.probeExternalClear(e), await Pr(200,n.signal,{unref:!0})
 *       })(), ()=>n.abort()
 *     },[e,t])
 *   }
 *
 * `enabled` is the densable `Ws()`/`ns()` fullscreen gate — caller passes
 * isFullscreenActive().
 */
export function useProbeExternalClear(enabled = true): void {
  const { internal_querier: querier } = useStdin()
  const termProgram = useSyncExternalStore(
    subscribeTermProgram,
    getTermProgram,
    getTermProgram,
  )

  useEffect(() => {
    if (!enabled || !querier) return
    if (termProgram !== 'iTerm.app' && termProgram !== 'Apple_Terminal') return
    const ink = instances.get(process.stdout)
    if (!ink) return

    const ac = new AbortController()
    ;(async () => {
      while (!ac.signal.aborted) {
        await ink.probeExternalClear(querier)
        await sleepMs(200, ac.signal)
      }
    })()
    return () => ac.abort()
  }, [querier, termProgram, enabled])
}

function getTermProgram(): string {
  return process.env.TERM_PROGRAM ?? ''
}

/** TERM_PROGRAM is static for a process — subscribe is a no-op. */
function subscribeTermProgram(_onStoreChange: () => void): () => void {
  return () => {}
}

/** densable Er(ms, signal, {unref:true}) — resolve on timeout or abort. */
function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
