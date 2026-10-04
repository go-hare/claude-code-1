/**
 * densable `ne` claim_session path screen — `g1`/`h1` @190551319.
 *
 * Gold `ne` @210326103:
 *   `g1(o.cwd,r,s.getToolPermissionContext().trustedNetworkDirectories)`
 *   `h1(n,s.getToolPermissionContext().trustedNetworkDirectories)`
 * First minify `g1` @180171152 is ReflectMessage — skip that name.
 */
import type { ToolPermissionContext } from '../Tool.js'
import {
  resolvedNetworkPathReasonH1,
  screenNetworkPathG1,
} from '../utils/permissions/trustedNetworkDirectories.js'

export function screenClaimPath(
  raw: string,
  expanded: string,
  context: Pick<ToolPermissionContext, 'trustedNetworkDirectories'>,
): { ok: true } | { ok: false } {
  const screened = screenNetworkPathG1(
    raw,
    expanded,
    context.trustedNetworkDirectories,
  )
  return screened.ok ? { ok: true } : { ok: false }
}

export function resolvedClaimPathScreenReason(
  resolved: string,
  context: Pick<ToolPermissionContext, 'trustedNetworkDirectories'>,
): string | undefined {
  return resolvedNetworkPathReasonH1(
    resolved,
    context.trustedNetworkDirectories,
  )
}
