import { useEffect, useRef, useSyncExternalStore } from 'react'
import instances from '../core/instances.js'
import useStdin from './use-stdin.js'

/**
 * densable QPf — poll DECXCPR every 200ms on iTerm.app / Apple_Terminal
 * fullscreen sessions to detect external alt-buffer wipes (Cmd+K).
 * When wipe detected, forceRedraw and invoke onDetected (e.g. clear-screen
 * toast / keybinding re-arm).
 *
 * densable:
 *   function QPf(e){
 *     let t=useRef(e); t.current=e
 *     let {internal_querier:r}=useStdin()
 *     let n=useSyncExternalStore(..., ()=>PE()?.terminal??Z.terminal)
 *     useEffect(()=>{
 *       if(!ns()||!r)return
 *       if(n!=="iTerm.app"&&n!=="Apple_Terminal")return
 *       let o=bd.get(process.stdout); if(!o)return
 *       let i=new AbortController
 *       ;(async()=>{
 *         while(!i.signal.aborted){
 *           let s=await o.probeExternalClear(r)
 *           if(i.signal.aborted)return
 *           if(s)t.current()
 *           await Er(200,i.signal,{unref:!0})
 *         }
 *       })()
 *       return()=>i.abort()
 *     },[r,n])
 *   }
 *
 * Local: terminal identity from TERM_PROGRAM (same strings densable uses).
 * `enabled` is the densable `ns()` fullscreen gate — caller passes
 * isFullscreenActive() (or true when already inside fullscreen UI).
 */
export function useProbeExternalClear(
  onDetected: () => void,
  enabled = true,
): void {
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected
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
        const wiped = await ink.probeExternalClear(querier)
        if (ac.signal.aborted) return
        if (wiped) onDetectedRef.current()
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
