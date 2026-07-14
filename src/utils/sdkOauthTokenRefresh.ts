/**
 * Official Pt.sdkOAuthTokenRefreshCallback densable store (wSr / pWo).
 * Host callback path for 401 recovery when SDK owns OAuth refresh
 * (claude-desktop / local-agent / claude-vscode).
 */

export type SdkOauthTokenRefreshCallback = () => Promise<string | null>

let sdkOauthTokenRefreshCallback: SdkOauthTokenRefreshCallback | null = null

/** Official wSr */
export function getSdkOauthTokenRefreshCallback(): SdkOauthTokenRefreshCallback | null {
  return sdkOauthTokenRefreshCallback
}

/** Official pWo */
export function setSdkOauthTokenRefreshCallback(
  cb: SdkOauthTokenRefreshCallback | null,
): void {
  sdkOauthTokenRefreshCallback = cb
}

/** Test helper */
export function resetSdkOauthTokenRefreshForTests(): void {
  sdkOauthTokenRefreshCallback = null
}
