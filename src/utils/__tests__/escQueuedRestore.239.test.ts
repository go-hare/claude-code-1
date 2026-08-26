import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPL = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)
const QUEUE_PROC = readFileSync(
  join(import.meta.dir, '../../hooks/useQueueProcessor.ts'),
  'utf8',
)
const CUY = readFileSync(join(import.meta.dir, '../queueProcessor.ts'), 'utf8')

describe('densable 2.1.239 #11 Esc + queued prompt', () => {
  test('restore waits for official Cuy in-flight drain', () => {
    expect(REPL).toContain('!someInFlightDrainCommand()')
    expect(REPL).toContain('getCommandQueueLength() === 0')
  })

  test('Ruy checks snapshot or live isActive', () => {
    expect(QUEUE_PROC).toContain('isQueryActive || queryGuard.isActive')
  })

  test('Cuy wraps executeInput with set/clear same-reference drain', () => {
    expect(CUY).toContain('setInFlightDrainBatch(batch)')
    expect(CUY).toContain('clearInFlightDrainBatch(batch)')
    expect(CUY).toContain('cmd.passive !== true')
  })
})
