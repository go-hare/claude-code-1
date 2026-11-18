import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { registerImmediateCommandRunner } from '../rendezvousServer.js'

const BG_MANAGER_SRC = readFileSync(
  join(import.meta.dir, '..', 'bgManager.ts'),
  'utf8',
)
const BG_WORKER_SRC = readFileSync(
  join(import.meta.dir, '..', 'bgWorker.ts'),
  'utf8',
)
const RV_SRC = readFileSync(
  join(import.meta.dir, '..', 'rendezvousServer.ts'),
  'utf8',
)

describe('daemon v2.1.290 (#49 forceUnresponsive, #156 nextTurn/immediate)', () => {
  test('bgManager handles nextTurn ESKEW, forceUnresponsive, and replyOnResume', () => {
    expect(BG_MANAGER_SRC).toContain("code: 'ESKEW'")
    expect(BG_MANAGER_SRC).toContain(
      'worker.reply(req.text as string, { nextTurn })',
    )
    expect(BG_MANAGER_SRC).toContain('if (d.forceUnresponsive)')
    expect(BG_MANAGER_SRC).toContain("'--reply-on-resume'")
  })

  test('bgWorker.reply supports { nextTurn } without PTY fallback', () => {
    expect(BG_WORKER_SRC).toContain(
      '{ nextTurn = false }: { nextTurn?: boolean } = {}',
    )
    expect(BG_WORKER_SRC).toContain(
      "if (nextTurn || (blocked && this.dispatch.launch.mode !== 'exec'))",
    )
  })

  test('rendezvousServer handles nextTurn and registerImmediateCommandRunner', () => {
    expect(RV_SRC).toContain('if (msg.nextTurn === true)')
    expect(RV_SRC).toContain('skipSlashCommands: true')
    expect(RV_SRC).toContain('if (tryImmediateCommand(msg.text))')
    const fn = () => true
    registerImmediateCommandRunner(fn)
    registerImmediateCommandRunner(null)
  })
})
