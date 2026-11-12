import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

const SRC = readFileSync(
  new URL('../toolExecution.ts', import.meta.url),
  'utf8',
)

describe('remote tool forward gate (densable dr / Eh)', () => {
  test('does not refuse every remoteExecution tool before the local run', () => {
    expect(SRC).not.toContain('the machine is not announcing on this session')
  })

  test('a named host is routed, and a resolved machine is sent', () => {
    expect(SRC).toContain('remoteHostRoute(')
    expect(SRC).toContain('toolUse.input')
    expect(SRC).toContain('tool.name')
    expect(SRC).toContain('callRemoteTool(')
  })
})
