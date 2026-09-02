/**
 * densable 2.1.239 bvr / storageV5 call-shape:
 *   F/B/W persist wrappers (disk when storageV5 omitted)
 *   official catalog ids that already have a local host
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { sortConfigCatalog } from '../../../utils/configCatalog.js'

const config = readFileSync(join(import.meta.dir, '../Config.tsx'), 'utf8')
const persist = readFileSync(
  join(import.meta.dir, '../../../utils/config.ts'),
  'utf8',
)
const settings = readFileSync(
  join(import.meta.dir, '../../../utils/settings/settings.ts'),
  'utf8',
)
const diff = readFileSync(
  join(import.meta.dir, '../../../utils/replDiffTab.ts'),
  'utf8',
)
const exit = readFileSync(
  join(import.meta.dir, '../../../utils/exitPromptShutdown.ts'),
  'utf8',
)

describe('densable 2.1.239 bvr persist wrappers', () => {
  test('Config defines official F/B/W wrappers', () => {
    expect(config).toContain('function F(patch: SettingsJson)')
    expect(config).toContain(
      "return updateSettingsForSource('userSettings', patch)",
    )
    expect(config).toContain('function B<K extends keyof SettingsJson>')
    expect(config).toContain('function W(updater: (current: GlobalConfig)')
    expect(config).toContain('saveGlobalConfig(updater)')
  })

  test('official catalog ids with local hosts are present', () => {
    expect(config).toContain("id: 'autoCompact'")
    expect(config).toContain("id: 'tips'")
    expect(config).toContain("id: 'thinking'")
    expect(config).toContain("id: 'fast'")
    expect(config).toContain("id: 'worktreeBaseRef'")
    expect(config).toContain("label: 'Worktree base ref'")
    expect(config).toContain("id: 'workflowKeywordTriggerEnabled'")
    expect(config).toContain("label: 'Ultracode keyword trigger'")
    expect(config).toContain("id: 'modelProposedGoals'")
    expect(config).toContain("label: 'Claude-proposed goals'")
    expect(config).toContain("id: 'recap'")
    expect(config).toContain("label: 'Session recap'")
    expect(config).toContain("id: 'workflows'")
    expect(config).toContain("label: 'Dynamic workflows'")
    expect(config).toContain("id: 'artifacts'")
    expect(config).toContain("label: 'Artifacts'")
    expect(config).toContain("id: 'switchModelsOnFlag'")
    expect(config).toContain("id: 'externalEditorContext'")
    expect(config).toContain("id: 'precomputeCompactionEnabled'")
    expect(config).toContain("id: 'timestamps'")
    expect(config).toContain("id: 'agentsView'")
    expect(config).toContain("id: 'defaultToAgentsView'")
    expect(config).toContain("id: 'leftArrowOpensAgents'")
    expect(config).toContain('message timestamps')
    expect(config).toContain('precompute compaction')
  })

  test('official consentGated rows that already exist', () => {
    expect(config).toMatch(
      /id: 'autoContinueAtUsageLimit'[\s\S]*?consentGated: true/,
    )
    expect(config).toMatch(
      /id: 'askUserQuestionTimeout'[\s\S]*?consentGated: true/,
    )
    expect(config).toMatch(/id: 'modelProposedGoals'[\s\S]*?consentGated: true/)
  })

  test('U_c keeps official hosted ids in section order', () => {
    const sorted = sortConfigCatalog([
      { id: 'worktreeBaseRef' },
      { id: 'workflowKeywordTriggerEnabled' },
      { id: 'modelProposedGoals' },
      { id: 'theme' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'theme',
      'modelProposedGoals',
      'workflowKeywordTriggerEnabled',
      'worktreeBaseRef',
    ])
  })
})

describe('densable 2.1.239 storageV5 call-shape only', () => {
  test('persist helpers accept unused last arg', () => {
    expect(persist).toContain('_storageV5?: unknown')
    expect(settings).toContain('_storageV5?: unknown')
    expect(diff).toContain('_storageV5?: unknown')
    expect(diff).toContain('saveGlobalConfig(')
    expect(diff).toContain('_storageV5')
    expect(exit).toContain('storageV5?: unknown')
  })
})
