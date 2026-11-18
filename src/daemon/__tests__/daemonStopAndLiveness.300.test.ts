import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { signalAndWaitForExit } from '../main.js'

describe('2.1.299/2.1.300 #697/#797 daemon stop & liveness', () => {
  test('#797 signalAndWaitForExit returns exited when process disappears after SIGTERM', async () => {
    let alive = true
    const signals: Array<NodeJS.Signals | 0 | undefined> = []
    const res = await signalAndWaitForExit(12345, {
      signal: 'SIGTERM',
      gracefulMs: 200,
      pollMs: 10,
      killFn: (_pid, sig) => {
        signals.push(sig)
        if (sig === 'SIGTERM') {
          alive = false
          return
        }
        if (!alive) {
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
        }
      },
    })
    expect(res).toBe('exited')
    expect(signals).toEqual(['SIGTERM', 0])
  })

  test('#797 signalAndWaitForExit returns timed-out if process stays alive past gracefulMs', async () => {
    const res = await signalAndWaitForExit(12345, {
      signal: 'SIGTERM',
      gracefulMs: 30,
      pollMs: 10,
      killFn: () => {},
    })
    expect(res).toBe('timed-out')
  })

  test('#797 signalAndWaitForExit returns eperm on EPERM or pid <= 1', async () => {
    expect(await signalAndWaitForExit(1)).toBe('eperm')
    const res = await signalAndWaitForExit(12345, {
      killFn: () => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      },
    })
    expect(res).toBe('eperm')
  })

  test('#697 daemon/state.ts delegates isProcessAlive to isProcessRunning', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'state.ts'), 'utf8')
    expect(src).toContain('isProcessRunning(pid)')
  })
})
