import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { SettingsSchema } from '../../utils/settings/types.js'

describe('2.1.299-301 REPL / AgentView / Settings alignment', () => {
  test('#567 SettingsSchema accepts idleCompaction boolean', () => {
    const schema = SettingsSchema()
    expect(schema.parse({ idleCompaction: false }).idleCompaction).toBe(false)
    expect(schema.parse({ idleCompaction: true }).idleCompaction).toBe(true)
    expect(schema.parse({}).idleCompaction).toBeUndefined()
  })

  test('#574 AgentView FleetPeekPanel renders safe mode line when --safe-mode is in respawnFlags and not heldInTerminal', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../AgentView.tsx'),
      'utf8',
    )
    expect(src).toContain("includes('--safe-mode')")
    expect(src).toContain('!heldInTerminal')
    expect(src).toContain('<Text dimColor>safe mode</Text>')
    expect(src).toContain('<Text dimColor>customizations are off</Text>')
  })

  test('#871 REPL tracks lastTurnStopTime on onCancel and publishes to idleReturnTurnSourceRef', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../REPL.tsx'), 'utf8')
    expect(src).toContain(
      'const [lastTurnStopTime, setLastTurnStopTime] = useState(0);',
    )
    expect(src).toContain('setLastTurnStopTime(Date.now());')
    expect(src).toContain('lastTurnStopTime,')
  })
})
