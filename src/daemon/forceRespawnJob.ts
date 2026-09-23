/**
 * densable X1e force path used by `claude respawn`.
 * Kills the previous worker when it is alive, then dispatches source=respawn
 * with force so the job restarts on the current binary.
 */
import { sendControlRequest } from './controlSocketClient.js'
import { readBgJobState } from './jobState.js'
import {
  killJobConfirmed,
  probeJobAlive,
  probeJobPresent,
} from './xyrRespawn.js'

export type ForceRespawnResult =
  | { ok: true; short: string }
  | { ok: false; alive: true }
  | { ok: false; error: string; alive?: false }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function forceRespawnJob(
  short: string,
): Promise<ForceRespawnResult> {
  const state = readBgJobState(short)
  if (!state) {
    return {
      ok: false,
      error: "Can't respawn — that job's saved state is missing",
    }
  }

  const probe = await probeJobAlive(short)
  if (probe.alive || probe.present) {
    const kill = await killJobConfirmed(short, { force: true })
    if (probe.alive && !kill.confirmed) {
      return { ok: false, alive: true }
    }
    const waitEnd = Date.now() + 3000
    while (Date.now() < waitEnd) {
      if (!(await probeJobPresent(short))) break
      await sleep(100)
    }
  }

  const resumeId = state.resumeSessionId ?? state.sessionId
  const resp = await sendControlRequest(
    {
      proto: 1,
      op: 'dispatch',
      d: {
        short,
        sessionId: state.sessionId,
        intent: state.intent,
        source: 'respawn',
        cwd: state.cwd,
        launch: {
          mode: 'resume',
          sessionId: resumeId,
          fork: false,
          flagArgs: state.respawnFlags ?? [],
          args: [],
        },
        env: {},
        isolation: state.bgIsolation === 'worktree' ? 'worktree' : 'none',
        respawnFlags: state.respawnFlags ?? [],
        cols: process.stdout.columns || 120,
        rows: process.stdout.rows || 30,
        force: true,
      },
      timeoutMs: 10000,
    },
    { timeoutMs: 12000 },
  )
  if (!resp.ok) {
    const error = typeof resp.error === 'string' ? resp.error : 'respawn failed'
    return { ok: false, error }
  }
  const next = typeof resp.short === 'string' && resp.short ? resp.short : short
  return { ok: true, short: next }
}
