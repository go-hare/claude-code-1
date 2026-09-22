/**
 * densable 2.1.212 Xyr client-side ceremony helpers (hLp / D9e / Zxe / gLp).
 *
 * Full Xyr lives in the fleet/respawn client; the daemon already has `has`/`kill`.
 * This module is the ENOJOB reopen path used by AgentView (and any CLI respawn).
 *
 * extract: docs/upstream-extraction/v2.1.212/xyr_full.extract.md
 */

import { sendControlRequest } from './controlSocket.js'

export type AliveProbe = {
  alive: boolean
  present: boolean
  daemonUp: boolean
}

/**
 * densable hLp — probe whether the short is still in the daemon worker map.
 * Falls back to `{alive:false,present:false,daemonUp:false}` on ENOCONN.
 */
export async function probeJobAlive(short: string): Promise<AliveProbe> {
  try {
    const resp = await sendControlRequest(
      { proto: 1, op: 'has', short },
      { timeoutMs: 3000 },
    )
    if (resp.ok && resp.op === 'has') {
      const alive = resp.alive === true
      const present = typeof resp.present === 'boolean' ? resp.present : alive
      return { alive, present, daemonUp: true }
    }
  } catch {
    // fall through
  }
  return { alive: false, present: false, daemonUp: false }
}

/**
 * densable gLp — present-only poll (used while waiting for kill to clear).
 */
export async function probeJobPresent(short: string): Promise<boolean> {
  const p = await probeJobAlive(short)
  return p.present
}

export type KillConfirm = {
  confirmed: boolean
  error?: string
}

/**
 * densable D9e subset — ask daemon to kill short; retry ESTARTING; treat ENOJOB
 * as confirmed gone. Full Yia SIGTERM roster fallback is best-effort below.
 */
export async function killJobConfirmed(
  short: string,
  opts?: { force?: boolean },
): Promise<KillConfirm> {
  void opts
  let lastError: string | undefined
  for (let s = 0; s < 10; s++) {
    const resp = await sendControlRequest(
      { proto: 1, op: 'kill', short, signal: 'SIGTERM' },
      { timeoutMs: 5000 },
    )
    if (resp.ok) return { confirmed: true }
    const code = typeof resp.code === 'string' ? resp.code : undefined
    if (code === 'ENOJOB') {
      // densable: ENOJOB → Yia fallback; if no match, confirmed gone
      const yia = await killJobYiaFallback(short)
      if (yia.anyMatch) return { confirmed: yia.confirmed }
      return { confirmed: true }
    }
    if (code === 'ESTARTING') {
      await sleep(200)
      continue
    }
    if (code === 'ENOCONN' || code === 'ETIMEOUT') {
      const yia = await killJobYiaFallback(short)
      return { confirmed: yia.anyMatch ? yia.confirmed : true }
    }
    lastError = typeof resp.error === 'string' ? resp.error : 'kill failed'
    break
  }
  return {
    confirmed: false,
    error:
      lastError ??
      "Couldn't stop the previous worker — supervisor may be starting, retry in a moment",
  }
}

/**
 * densable Yia subset — scan concurrent live bg sessions matching jobId/session
 * prefix and SIGTERM them. Returns anyMatch + confirmed (all died).
 */
export async function killJobYiaFallback(
  short: string,
): Promise<{ confirmed: boolean; anyMatch: boolean }> {
  try {
    const { listAllLiveSessions } = await import('../utils/udsClient.js')
    const live = await listAllLiveSessions()
    let anyMatch = false
    let confirmed = true
    for (const s of live) {
      if (s.kind !== 'bg') continue
      const jobId = (s as { jobId?: string }).jobId
      const sid = s.sessionId ?? ''
      if (jobId !== short && !sid.startsWith(short)) continue
      anyMatch = true
      try {
        process.kill(s.pid, 'SIGTERM')
      } catch {
        // already dead
      }
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        try {
          process.kill(s.pid, 0)
          await sleep(100)
        } catch {
          break
        }
      }
      try {
        process.kill(s.pid, 0)
        confirmed = false
      } catch {
        // dead
      }
    }
    return { confirmed, anyMatch }
  } catch {
    return { confirmed: true, anyMatch: false }
  }
}

/**
 * densable 2.1.248 #19 v$e — interactive holder owns resume sessionId.
 * Gold @189584464 / respawn `ie.kind==="interactive"?v$e:…`.
 */
export const RESUME_SESSION_LIVE_ELSEWHERE_INTERACTIVE =
  "Can't open \u2014 this session is running in another terminal"

/**
 * densable 2.1.248 #19 non-interactive spawn-refuse fallback.
 * Gold @189673903 — same sentence when holder is not interactive.
 */
export const RESUME_SESSION_LIVE_ELSEWHERE_FALLBACK =
  'This conversation is already open in another running Claude session — use that one, or close it and try again'

/** Official `ie.kind==="interactive"?v$e:fallback`. */
export function formatResumeSessionLiveElsewhereError(kind: string): string {
  return kind === 'interactive'
    ? RESUME_SESSION_LIVE_ELSEWHERE_INTERACTIVE
    : RESUME_SESSION_LIVE_ELSEWHERE_FALLBACK
}

/**
 * densable Zxe / Rqt — live sessions owning this resume sessionId.
 * Prefer interactive (official `J.find(se=>se.kind==="interactive")??J[0]`).
 * Own jobIds are filtered by the caller (official filter before find).
 */
export async function findResumeSessionConflict(
  resumeSessionId: string,
  opts?: { excludeJobIds?: readonly string[] },
): Promise<{ kind: string; jobId?: string } | null> {
  try {
    const { listAllLiveSessions } = await import('../utils/udsClient.js')
    const live = await listAllLiveSessions()
    const matches: { kind: string; jobId?: string }[] = []
    for (const s of live) {
      if (s.sessionId !== resumeSessionId) continue
      if (s.pid === process.pid) continue
      const jobId = (s as { jobId?: string }).jobId
      if (
        jobId !== undefined &&
        opts?.excludeJobIds !== undefined &&
        opts.excludeJobIds.includes(jobId)
      ) {
        continue
      }
      matches.push({
        kind: typeof s.kind === 'string' ? s.kind : 'unknown',
        jobId,
      })
    }
    return matches.find(m => m.kind === 'interactive') ?? matches[0] ?? null
  } catch {
    // ignore
  }
  return null
}

/**
 * densable Xyr preflight before dispatch on ENOJOB reopen:
 * 1) hLp alive → already running (unless force)
 * 2) D9e kill + wait present clear when was alive
 * 3) Zxe conflict when hasMessages resume
 *
 * Returns error string to show user, or null to continue.
 */
export async function xyrPreflightBeforeRespawn(opts: {
  short: string
  resumeSessionId: string
  hasMessages: boolean
  force?: boolean
  forceRefusalRetry?: boolean
}): Promise<string | null> {
  const force = opts.force === true || opts.forceRefusalRetry === true
  const probe = await probeJobAlive(opts.short)
  if (!force && probe.alive) {
    return `Session ${opts.short} is already running`
  }

  // densable 2.1.246 Kn: present && !alive is a booting worker. Killing it
  // is the Windows "stopped while the respawn was in flight" race.
  if (!force && probe.present && !probe.alive) {
    return null
  }

  const { readBgJobState } = await import('./jobState.js')
  const stateBefore = readBgJobState(opts.short)

  // densable: when daemonUp && !alive && !present && same short → skip kill (parallel Yia)
  const skipKill = probe.daemonUp && !probe.alive && !probe.present
  if (!skipKill) {
    if (probe.alive || probe.present) {
      const kill = await killJobConfirmed(opts.short, { force })
      if (probe.alive && !kill.confirmed) {
        return (
          kill.error ??
          "Couldn't stop the previous worker — supervisor may be starting, retry in a moment"
        )
      }
      const waitEnd = Date.now() + 3000
      while (Date.now() < waitEnd) {
        if (!(await probeJobPresent(opts.short))) break
        await sleep(100)
      }
    }
  }

  // densable Kn: if(!force && i.state!=="stopped") { re-read; if stopped → bail }
  if (!force && stateBefore && stateBefore.state !== 'stopped') {
    const stateAfter = readBgJobState(opts.short)
    if (stateAfter?.state === 'stopped') {
      return `Session ${opts.short} was stopped while the respawn was in flight`
    }
  }

  // densable R path: resume conflict only when hasMessages.
  // Official: prefer interactive holder → v$e; else long fallback.
  // Own jobId is OK (filtered via excludeJobIds).
  if (opts.hasMessages) {
    const conflict = await findResumeSessionConflict(opts.resumeSessionId, {
      excludeJobIds: [opts.short],
    })
    if (conflict) {
      return formatResumeSessionLiveElsewhereError(conflict.kind)
    }
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
