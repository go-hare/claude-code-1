/**
 * densable app:openArtifact (ctrl+]) — open the latest session artifact URL
 * in the system browser. densable tracks frameUrls in app state; we derive
 * the same “latest artifact” from transcript messages via extractArtifacts.
 */
import type { Message } from '../types/message.js'
import { extractArtifacts } from '../commands/artifacts/scanner.js'
import { openBrowser } from './browser.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'

/** densable HSr — append via=banner_open for telemetry on the host. */
export function withBannerOpenParam(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('via', 'banner_open')
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Open the newest artifact with a URL. Returns false when none (densable
 * handler returns false so the key is not treated as handled for side UI).
 */
export async function openLatestArtifact(
  messages: readonly Message[],
): Promise<boolean> {
  const artifacts = extractArtifacts(messages as Message[])
  const latest = artifacts.find(a => a.url && !a.isError)
  if (!latest?.url) return false
  const url = withBannerOpenParam(latest.url)
  logEvent('frame_link_open', {
    source:
      'keybinding' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  await openBrowser(url)
  return true
}
