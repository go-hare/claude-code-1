/**
 * densable Yie / uK / LYt — `--resume` of a live background session.
 * Names `claude attach <id>` (and stop) instead of loading the transcript.
 */
import { JOB_SHORT_RE } from '../../daemon/deleteJob.js'
import { listAllLiveSessions } from '../../utils/udsClient.js'

export type RunningBackgroundHolder = {
  kind: string
  jobId?: string
}

export async function findRunningBackgroundHolder(
  sessionId: string,
): Promise<RunningBackgroundHolder | null> {
  let live: Awaited<ReturnType<typeof listAllLiveSessions>>
  try {
    live = await listAllLiveSessions()
  } catch {
    return null
  }
  const rows = live.flatMap(session => {
    if (session.sessionId !== sessionId) return []
    if (session.pid === process.pid) return []
    if (!session.kind) return []
    if (session.kind === 'interactive' && session.parkedJobId !== undefined) {
      return []
    }
    return [
      {
        kind: session.kind,
        jobId: session.jobId,
      },
    ]
  })
  const holder = rows.find(row => row.kind !== 'interactive')
  if (!holder) return null
  const jobId =
    holder.jobId !== undefined && JOB_SHORT_RE.test(holder.jobId)
      ? holder.jobId
      : undefined
  return { kind: holder.kind, jobId }
}

/** densable Yie */
export function formatRunningBackgroundResume(input: {
  sessionId: string
  holder: RunningBackgroundHolder
  canFork: boolean
}): string {
  const jobId = input.holder.jobId
  const attach = jobId
    ? `Run \`claude attach ${jobId}\` to open it, or \`claude stop ${jobId}\` first to resume it here.`
    : 'Run `claude agents` to find its id, then `claude attach <id>` to open it, or `claude stop <id>` first to resume it here.'
  const fork = input.canFork
    ? ' Add --fork-session to branch off a copy instead.'
    : ''
  const id = jobId ? ` (${jobId})` : ''
  return `Session ${input.sessionId} is running as a background session${id}. ${attach}${fork}`
}
