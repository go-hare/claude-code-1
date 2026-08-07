/**
 * densable 2.1.216 #27 — skills/commands mid-session appear in slash menu;
 * agents dirs watched; .md-only filter; idle-wake; fingerprint; commands_changed.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const detectorSrc = readFileSync(
  join(import.meta.dir, '../skillChangeDetector.ts'),
  'utf8',
)
const useSkillsSrc = readFileSync(
  join(import.meta.dir, '../../../hooks/useSkillsChange.ts'),
  'utf8',
)
const printSrc = readFileSync(
  join(import.meta.dir, '../../../cli/print.ts'),
  'utf8',
)
const schemaSrc = readFileSync(
  join(import.meta.dir, '../../../entrypoints/sdk/coreSchemas.ts'),
  'utf8',
)

describe('skillChangeDetector densable XoS gold (2.1.216 #27)', () => {
  test('watches agents dirs (user + project)', () => {
    expect(detectorSrc).toContain("'agents'")
    expect(detectorSrc).toContain('.claude/agents')
    expect(detectorSrc).toContain('getClaudeConfigHomeDir')
  })

  test('filters non-.md files (densable ignored)', () => {
    expect(detectorSrc).toContain("!path.endsWith('.md')")
  })

  test('idle poll switch constants match densable zoS/KoS/YoS/bGa', () => {
    expect(detectorSrc).toContain('30_000')
    expect(detectorSrc).toContain('60_000')
    expect(detectorSrc).toContain('10_000')
    expect(detectorSrc).toContain('<skill-watcher-idle-wake>')
    expect(detectorSrc).toContain('_checkIdleTransitionForTest')
  })

  test('usePolling always true (densable fOf)', () => {
    expect(detectorSrc).toMatch(/USE_POLLING\s*=\s*true/)
  })

  test('fingerprint + skip re-announce on unchanged', () => {
    expect(detectorSrc).toContain('contentHash')
    expect(detectorSrc).toContain('skipping re-announce')
    expect(detectorSrc).toContain('forgetSentSkillNames')
  })

  test('ConfigChange hook + clearSkillCaches + clearCommandsCache order', () => {
    expect(detectorSrc).toContain("executeConfigChangeHooks('skills'")
    expect(detectorSrc).toContain('clearSkillCaches()')
    expect(detectorSrc).toContain('clearCommandsCache()')
    expect(detectorSrc).toContain('clearCommandMemoizationCaches()')
  })

  test('exports notifySkillsInvalidated (densable U7)', () => {
    expect(detectorSrc).toContain('notifySkillsInvalidated')
  })
})

describe('useSkillsChange densable mOf (2.1.216 #27)', () => {
  test('reloads agents when onAgentsChange provided', () => {
    expect(useSkillsSrc).toContain('onAgentsChange')
    expect(useSkillsSrc).toContain('getAgentDefinitionsWithOverrides')
    expect(useSkillsSrc).toContain('clearAgentDefinitionsCache')
  })

  test('full clear on watcher; memo-only on GrowthBook', () => {
    expect(useSkillsSrc).toContain('clearCommandsCache()')
    expect(useSkillsSrc).toContain('clearCommandMemoizationCaches()')
    expect(useSkillsSrc).toContain('onGrowthBookRefresh')
  })
})

describe('print stream-json commands_changed (2.1.216 #27 densable aa)', () => {
  test('emits system/commands_changed after skill reload', () => {
    expect(printSrc).toContain("subtype: 'commands_changed'")
    expect(printSrc).toContain("outputFormat !== 'stream-json'")
    expect(printSrc).toContain('emitCommandsChanged')
  })

  test('SDK schema includes commands_changed', () => {
    expect(schemaSrc).toContain("z.literal('commands_changed')")
    expect(schemaSrc).toContain('SDKCommandsChangedMessageSchema')
  })
})

describe('contentHash on skills (densable JoS)', () => {
  test('createSkillCommand / disk load set contentHash', async () => {
    const skillsSrc = readFileSync(
      join(import.meta.dir, '../../../skills/loadSkillsDir.ts'),
      'utf8',
    )
    expect(skillsSrc).toContain('contentHash')
    expect(skillsSrc).toContain('Bun.hash')
  })
})
