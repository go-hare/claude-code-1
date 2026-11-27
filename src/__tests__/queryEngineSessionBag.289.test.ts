/**
 * Headless ask() must keep print's session toolState and a credentials
 * handle on both tool contexts. The stop-hook snapshot copies that context,
 * so a later side question sees the same bag.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const engine = readFileSync(
  new URL('../QueryEngine.ts', import.meta.url),
  'utf8',
)
const printDir = fileURLToPath(new URL('../cli/print', import.meta.url))
const printSrc = [
  readFileSync(new URL('../cli/print.ts', import.meta.url), 'utf8'),
  ...readdirSync(printDir)
    .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
    .sort()
    .map(f => readFileSync(join(printDir, f), 'utf8')),
].join('\n')

describe('QueryEngine session bag', () => {
  test('both tool contexts keep the engine bag and pinned credentials', () => {
    const contexts = engine.split('processUserInputContext').length - 1
    expect(contexts).toBeGreaterThanOrEqual(2)
    const bag = engine.match(/toolState: this\.sessionToolState/g) ?? []
    const creds =
      engine.match(
        /toolState: this\.sessionToolState,\n {6}credentials: headlessCredentials\(this\.config\.credentials\)/g,
      ) ?? []
    expect(bag).toHaveLength(2)
    expect(creds).toHaveLength(2)
    expect(engine).toContain(
      'this.sessionToolState = config.toolState ?? new ToolStateSlots()',
    )
  })

  test('ask() forwards the print bag into the engine', () => {
    const askAt = engine.indexOf('export async function* ask(')
    const ctor = engine.indexOf('const engine = new QueryEngine({', askAt)
    const end = engine.indexOf('snipReplay:', ctor)
    const head = engine.slice(ctor, end)
    expect(head).toContain('toolState,')
    expect(head).toContain('credentials,')
    expect(printSrc).toContain('toolState: sessionToolState,')
  })

  test('active_goal applies AppState only (gold worker, no idle cancel)', () => {
    const block = engine.slice(
      engine.indexOf("case 'active_goal'"),
      engine.indexOf("case 'assistant'"),
    )
    expect(block).toContain('setAppState')
    expect(block).toContain('activeGoal: value')
    expect(block).not.toContain('cancelPendingGoalIdleCheckin')
    expect(engine).not.toContain("from './services/goal/goalIdleCheckin.js'")
  })
})
