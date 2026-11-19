import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  detectGitOperation,
  isGhPrActionRefused,
  parseGitPushBranch,
} from '../../../packages/builtin-tools/src/tools/shared/gitOperationTracking.js'
import { createPrStatusShared, PrStatusPoller } from '../prStatusPoller.js'

const ROOT = join(import.meta.dir, '../../..')

describe('Wave 326 Group 4B — Git / PR / Notebook / Output / UI', () => {
  test('#212 parseGitPushBranch prefers To section and skips fetched branches', () => {
    const fetchThenPushOutput = [
      'From github.com:org/repo',
      '   abc1234..def5678  main       -> origin/main',
      'To github.com:org/repo.git',
      '   1111111..2222222  feat/my-branch -> feat/my-branch',
    ].join('\n')
    expect(parseGitPushBranch(fetchThenPushOutput)).toBe('feat/my-branch')

    const dryRunOp = detectGitOperation(
      'git push --dry-run origin main',
      'To github.com:org/repo.git\n   111..222  main -> main',
    )
    expect(dryRunOp.push).toBeUndefined()
  })

  test('#212 isGhPrActionRefused & detectGitOperation ignore refused gh pr merge/close', () => {
    const refusedOutput =
      'X Pull request org/repo#42 is not mergeable: review required'
    expect(isGhPrActionRefused('merged', refusedOutput)).toBe(true)
    expect(isGhPrActionRefused('closed', refusedOutput)).toBe(true)
    expect(isGhPrActionRefused('created', refusedOutput)).toBe(false)

    expect(
      detectGitOperation('gh pr merge 42', refusedOutput).pr,
    ).toBeUndefined()
    expect(
      detectGitOperation('gh pr close 42', refusedOutput).pr,
    ).toBeUndefined()
  })

  test('#211 PrStatusPoller detects branch switch and bumps poller', async () => {
    let currentBranch = 'feat/a'
    let bumped = 0
    const shared = createPrStatusShared()
    const unsubBump = shared.bump.subscribe(() => {
      bumped++
    })
    const poller = new PrStatusPoller(
      {
        setTimeout: () => () => {},
        now: () => 10_000,
        getLastInteractionTime: () => 10_000,
        fetchPrStatus: async () => null,
        getBranch: async () => currentBranch,
        isDirectApiEnabled: () => true,
        shared,
      },
      { enabled: true, isLoading: false, focused: true },
    )
    poller.checkBranch()
    await new Promise(r => setTimeout(r, 15))
    expect(bumped).toBe(0)

    currentBranch = 'feat/b'
    poller.checkBranch()
    await new Promise(r => setTimeout(r, 15))
    expect(bumped).toBe(1)

    unsubBump()
  })

  test('#224/#226/#227/#229/#114/#116/#118/#132/#6 source verification', () => {
    const nbUiSrc = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/NotebookEditTool/UI.tsx'),
      'utf8',
    )
    expect(nbUiSrc).toContain('if (!notebook_path)')
    expect(nbUiSrc).not.toContain('!cell_type')

    const outputLineSrc = readFileSync(
      join(ROOT, 'src/components/shell/OutputLine.tsx'),
      'utf8',
    )
    expect(outputLineSrc).toContain('if (/^\\s/.test(line))')

    const thinkingSrc = readFileSync(
      join(ROOT, 'src/components/messages/HighlightedThinkingText.tsx'),
      'utf8',
    )
    expect(thinkingSrc).toContain('text.hiddenLines === 0 ? text.hiddenChars')

    const helpSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputHelpMenu.tsx'),
      'utf8',
    )
    expect(helpSrc).toContain('columns < 80')

    const zxtSrc = readFileSync(
      join(ROOT, 'src/components/Spinner/leftoverZxt.tsx'),
      'utf8',
    )
    expect(zxtSrc).toContain('retrying…')
    expect(zxtSrc).toContain('Retrying in')

    const statusNoticesSrc = readFileSync(
      join(ROOT, 'src/components/StatusNotices.tsx'),
      'utf8',
    )
    expect(statusNoticesSrc).toContain('showAllNotices')

    const sysMsgSrc = readFileSync(
      join(ROOT, 'src/components/messages/SystemTextMessage.tsx'),
      'utf8',
    )
    expect(sysMsgSrc).toContain('LatestTurnDurationContext')

    const logoSrc = readFileSync(
      join(ROOT, 'src/components/LogoV2/LogoV2.tsx'),
      'utf8',
    )
    expect(logoSrc).toContain('resolveWelcomeHeaderModel')
  })
})
