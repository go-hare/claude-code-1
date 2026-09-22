import { useEffect } from 'react'
import { useSessionServices } from './context/sessionServices.js'
import { formatTotalCost, saveCurrentSessionCosts } from './cost-tracker.js'
import { hasConsoleBillingAccess } from './utils/billing.js'
import { registerPreExitFlush } from './utils/cleanupRegistry.js'
import type { FpsMetrics } from './utils/fpsTracker.js'
import { isHoverRestOn } from './utils/storageV5/hoverRestPin.js'

/**
 * Official Aye @203114499 — Vk(ZFn) when D()&&storageV5; sync eUn fallback on exit.
 * Invent-ban: no Jhe / graceful-shutdown project-config fields (leftover has neither).
 */
export function useCostSummary(
  getFpsMetrics?: () => FpsMetrics | undefined,
): void {
  const { storageV5 } = useSessionServices()
  useEffect(() => {
    let asyncDone = false
    const unregister =
      isHoverRestOn() && storageV5 !== undefined
        ? registerPreExitFlush(async () => {
            saveCurrentSessionCosts(getFpsMetrics?.(), storageV5)
            asyncDone = true
          })
        : undefined
    const f = () => {
      if (hasConsoleBillingAccess()) {
        process.stdout.write('\n' + formatTotalCost() + '\n')
      }

      if (!asyncDone) {
        saveCurrentSessionCosts(getFpsMetrics?.())
      }
    }
    process.on('exit', f)
    return () => {
      unregister?.()
      process.off('exit', f)
    }
  }, [storageV5, getFpsMetrics])
}
