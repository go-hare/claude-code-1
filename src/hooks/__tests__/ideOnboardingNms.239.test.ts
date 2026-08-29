/**
 * densable 2.1.239 sdu(CHr) — hook hosts requestDialog, not focused mailbox.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hook = readFileSync(
  join(import.meta.dir, '../useIDEIntegration.tsx'),
  'utf8',
)
const repl = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)
const ide = readFileSync(join(import.meta.dir, '../../utils/ide.ts'), 'utf8')

describe('useIDEIntegration sdu(CHr)', () => {
  test('opens ideOnboardingSpec via requestDialog queueBehind', () => {
    expect(hook).toContain('ideOnboardingSpec')
    expect(hook).toContain('requestDialog')
    expect(hook).toContain('queueBehind: true')
    expect(hook).toContain('installationStatus: status')
    expect(hook).not.toContain('setShowIdeOnboarding')
    expect(hook).not.toContain('IdeOnboardingDialog')
  })

  test('wa / As / NHy gates + n7n cleanup', () => {
    expect(hook).toContain('getIsRemoteMode()')
    expect(hook).toContain("CLAUDE_CODE_SESSION_KIND === 'bg'")
    expect(hook).toContain('shownLatchRef')
    expect(hook).toContain('cancelCurrentIDESearch')
  })

  test('REPL wires requestDialog and does not mount focused ide-onboarding', () => {
    expect(repl).toContain('useIDEIntegration({')
    expect(repl).toContain('requestDialog,')
    expect(repl).not.toContain('showIdeOnboarding')
    expect(repl).not.toContain('setShowIdeOnboarding')
    expect(repl).not.toContain("focusedInputDialog === 'ide-onboarding'")
    expect(repl).not.toContain('IdeOnboardingDialog')
  })
})

describe('dZa initializeIdeIntegration CHr payload', () => {
  test('VSCode r(status), JetBrains r(null), n7n', () => {
    expect(ide).toContain('onShowIdeOnboarding(status)')
    expect(ide).toContain('onShowIdeOnboarding(null)')
    expect(ide).toContain('export function cancelCurrentIDESearch')
    expect(ide).toContain('currentIDESearch.abort()')
    expect(ide).toContain('currentIDESearch = null')
    expect(ide).not.toContain('onShowIdeOnboarding()')
  })
})
