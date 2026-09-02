/**
 * densable yWt — schedule UPw comment scan (2.1.239).
 * Source: gold-yWt-239 / gold-kkm-239 (ODw → yWt).
 */
import { mI, SN } from './gates.js'
import { coalesceNotice, formatArtifactDisplayName } from './coalesce.js'
import { scheduleCommentScan, type WakeArgs } from './scan.js'
import { un } from './store.js'

export type YWtInput = WakeArgs & {
  detail?: string
  threadId?: string
}

/**
 * densable yWt — gate + schedule UPw (coalesced). Seed still notifies once.
 */
export function yWt(input: YWtInput): void {
  if (!mI()) return
  if (SN(input.slug)) return

  scheduleCommentScan({
    slug: input.slug,
    url: input.url,
    title: input.title,
    env: input.env,
    seed: input.seed,
    confirm: input.confirm,
    reentry: input.reentry,
    abort: input.abort,
    getTitle: input.getTitle,
  })

  // Seed: also coalesce a one-shot arm notice (densable suppressSummonStatus path).
  if (input.seed === true || input.detail !== undefined) {
    const name = formatArtifactDisplayName(input.title, input.url)
    const detail =
      input.detail ??
      `Artifact ${input.url} comment monitor armed — scanning threads for new comments.`
    coalesceNotice({
      slug: input.slug,
      family: 'artifact-auto-react',
      artifactName: name,
      detail,
      mergeDetails: 'append',
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
    })
  }
}

/** densable ODw ver path → cvl artifact-changed. */
export function notifyArtifactChanged(input: {
  slug: string
  url: string
  ver: string
  title?: string
}): void {
  if (SN(input.slug)) return
  const name = formatArtifactDisplayName(input.title, input.url)
  coalesceNotice({
    slug: input.slug,
    family: 'artifact-changed',
    artifactName: name,
    detail: `Artifact ${input.url} appears to have been republished elsewhere — it is now version ${input.ver}. Your copy is stale; re-read before editing or republishing.`,
    mergeDetails: 'latest',
  })
}
