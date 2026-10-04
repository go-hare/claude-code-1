/**
 * densable 2.1.283 `--watch-artifact` / `--watch-artifact-no-autoreact`.
 * gold `Tno` / `Rno` @189694374.
 */
import { artifactViewerUrlFor, parseArtifactUrl } from '../utils/artifactUrl.js'

const ARTIFACT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type WatchArtifactParse =
  | { slug: string; url: string; autoReactDisarmed?: boolean }
  | { error: string }

export const WATCH_ARTIFACT_REMOTE =
  "Error: --watch-artifact isn't supported yet from remote sessions — run it in Claude Code on your own machine"
export const WATCH_ARTIFACT_INTERACTIVE =
  'Error: --watch-artifact requires an interactive session (not print mode, --sdk-url, --init-only, or redirected output)'
export const WATCH_ARTIFACT_ATTACHED =
  'Error: --watch-artifact is not available in sessions attached to a remote environment — run it in a plain local session'
export const WATCH_ARTIFACT_EXPECTS =
  'Error: --watch-artifact expects an artifact id or a claude.ai artifact URL'

/** gold `Tno` — local CLI env is prod. */
export function parseWatchArtifactArg(raw: string): WatchArtifactParse {
  const e = raw.trim()
  const env: 'prod' = 'prod'
  if (ARTIFACT_ID.test(e)) {
    const slug = e.toLowerCase()
    return { slug, url: artifactViewerUrlFor({ slug, env }) }
  }
  const parsed = parseArtifactUrl(e)
  if (parsed === null) {
    return { error: WATCH_ARTIFACT_EXPECTS }
  }
  if (parsed.env !== env) {
    return {
      error: `Error: --watch-artifact got a ${parsed.env} artifact URL, but this session is signed in to ${env}`,
    }
  }
  return { slug: parsed.slug, url: artifactViewerUrlFor(parsed) }
}

let pendingWatch: (WatchArtifactParse & { slug: string; url: string }) | null =
  null

/** gold `Rno` */
export function setPendingWatchArtifact(
  value: { slug: string; url: string; autoReactDisarmed?: boolean } | null,
): void {
  pendingWatch = value
}

/** gold `xno` — take once */
export function takePendingWatchArtifact(): {
  slug: string
  url: string
  autoReactDisarmed?: boolean
} | null {
  const a = pendingWatch
  pendingWatch = null
  return a
}

/** gold `Pno` */
export function peekPendingWatchArtifact(): {
  slug: string
  url: string
  autoReactDisarmed?: boolean
} | null {
  return pendingWatch
}
