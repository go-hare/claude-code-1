import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

/**
 * densable 2.1.247 Xb — `N("tengu_surface_failed_mcp_servers", !0)`.
 * 246 Lb defaulted false; 3P / telemetry-disabled skip GB and now surface.
 */
export function shouldSurfaceFailedMcpServers(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_surface_failed_mcp_servers',
    true,
  )
}
