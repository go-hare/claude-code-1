/**
 * Official Pt.sdkOAuthTokenRefreshCallback densable store (wSr / pWo).
 * Host callback path for 401 recovery when SDK owns OAuth refresh
 * (claude-desktop / local-agent / claude-vscode).
 *
 * densable 2.1.248: store is n().host.credentialSlots.sdkOAuthTokenRefreshCallback().
 */

import { getBootstrapSessionHost } from './sessionRoot.js'

export type SdkOauthTokenRefreshCallback = () => Promise<string | null>

/** Official wSr / kEe */
export function getSdkOauthTokenRefreshCallback(): SdkOauthTokenRefreshCallback | null {
  return getBootstrapSessionHost().credentialSlots.sdkOAuthTokenRefreshCallback() as SdkOauthTokenRefreshCallback | null
}

/** Official pWo / WLe */
export function setSdkOauthTokenRefreshCallback(
  cb: SdkOauthTokenRefreshCallback | null,
): void {
  getBootstrapSessionHost().credentialSlots.replaceSdkOAuthTokenRefreshCallback(
    cb,
  )
}

/** Test helper */
export function resetSdkOauthTokenRefreshForTests(): void {
  setSdkOauthTokenRefreshCallback(null)
}
