import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Tokens } from 'marked'
import { hasAutoOpenDiffContent } from '../../utils/replDiffMouseHost.js'
import { stripLeadingBlankTokensBeforeCode } from '../../utils/markdown.js'
import {
  extractTableHeaderPrefix,
  STREAM_MD_INCOMPLETE_TABLE_HEADER_RE,
  STREAM_MD_TABLE_LINE_RE,
} from '../Markdown.js'
import {
  IDLE_UPSELL_DELAY_MINUTES,
  PUSH_IDLE_UPSELL_KEY,
  PUSH_NOTIF_UPSELL_MAX_SEEN,
  RC_IDLE_UPSELL_KEY,
} from '../../services/tips/tipRegistry.js'

const SRC_ROOT = join(import.meta.dir, '../..')

describe('Group 3 314 alignment tests', () => {
  test('#1262 hasAutoOpenDiffContent rejects empty/null diff results', () => {
    expect(hasAutoOpenDiffContent(null)).toBe(false)
    expect(hasAutoOpenDiffContent(undefined)).toBe(false)
    expect(hasAutoOpenDiffContent({ stats: { filesCount: 0 } })).toBe(false)
    expect(hasAutoOpenDiffContent({ stats: { filesCount: 2 } })).toBe(true)

    const ctrlSrc = readFileSync(
      join(SRC_ROOT, 'components/diff/ReplDiffSidebarController.tsx'),
      'utf8',
    )
    expect(ctrlSrc).toContain(
      'fetchGitDiff(getPersistedDiffBaseMode(), controller.signal)',
    )
    expect(ctrlSrc).toContain('if (!hasAutoOpenDiffContent(result)) return;')
  })

  test('#1266 usageSessionScan computes recached and includes it in cache_miss', () => {
    const scanSrc = readFileSync(
      join(SRC_ROOT, 'utils/usageSessionScan.ts'),
      'utf8',
    )
    expect(scanSrc).toContain('recached: number')
    expect(scanSrc).toContain('prev.cached + prev.cacheCreate - rec.cached')
    expect(scanSrc).toContain(
      'if (rec.uncached + rec.recached > CACHE_MISS_UNCACHED)',
    )
  })

  test('#1330 PromptInput passes midTaskPending and clears/refreshes effort-level toast', () => {
    const promptSrc = readFileSync(
      join(SRC_ROOT, 'components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(promptSrc).toContain("leftoverIhrSlice('main').turnEffort")
    expect(promptSrc).toContain('const midTaskPending =')
    expect(promptSrc).toContain('midTaskPending,')
    expect(promptSrc).toContain(
      "if (!midTaskPending) {\n      removeNotification('effort-level');",
    )
  })

  test('#1377 StreamingMarkdown table stabilization helpers & openTable tracking', () => {
    expect(extractTableHeaderPrefix('| A | B |\n|---|---|\n| 1 | 2 |\n')).toBe(
      '| A | B |\n|---|---|\n',
    )
    expect(STREAM_MD_TABLE_LINE_RE.test('| col1 | col2')).toBe(true)
    expect(STREAM_MD_TABLE_LINE_RE.test('   | col1')).toBe(true)
    expect(STREAM_MD_TABLE_LINE_RE.test('plain text')).toBe(false)
    expect(STREAM_MD_INCOMPLETE_TABLE_HEADER_RE.test('| A | B |\n|---')).toBe(
      true,
    )

    const mdSrc = readFileSync(
      join(SRC_ROOT, 'components/Markdown.tsx'),
      'utf8',
    )
    expect(mdSrc).toContain('openTable: string | null')
    expect(mdSrc).toContain('extractTableHeaderPrefix')
  })

  test('#1384 collapseReadSearch pops non-tail errored/not-run Bash calls and deducts bashCount', () => {
    const collapseSrc = readFileSync(
      join(SRC_ROOT, 'utils/collapseReadSearch.ts'),
      'utf8',
    )
    expect(collapseSrc).toContain('currentGroup.messages.splice(matchIdx, 1)')
    expect(collapseSrc).toContain(
      'if (isFullscreenEnvEnabled() && info?.isBash)',
    )

    const contentSrc = readFileSync(
      join(SRC_ROOT, 'components/messages/CollapsedReadSearchContent.tsx'),
      'utf8',
    )
    expect(contentSrc).toContain('nonRunBashCount')
    expect(contentSrc).toContain(
      'isActiveGroup ? maxBashCountRef.current : (message.bashCount ?? 0)',
    )
  })

  test('#1400 stripLeadingBlankTokensBeforeCode drops blank tokens before code inside blockquote', () => {
    const codeTok = {
      type: 'code',
      raw: '```ts\nconst x = 1\n```',
      text: 'const x = 1',
      lang: 'ts',
    } as Tokens.Code
    const spaceTok = { type: 'space', raw: '\n\n' } as Tokens.Space
    const emptyHeading = {
      type: 'heading',
      raw: '# \n',
      depth: 1,
      text: '',
      tokens: [],
    } as Tokens.Heading
    const quote: Tokens.Blockquote = {
      type: 'blockquote',
      raw: '> \n> ```ts\n> const x = 1\n> ```',
      text: '',
      tokens: [spaceTok, emptyHeading, codeTok],
    }
    const stripped = stripLeadingBlankTokensBeforeCode(quote, null)
    expect(stripped).toBeDefined()
    expect(stripped?.tokens).toEqual([codeTok])

    const paraQuote: Tokens.Blockquote = {
      type: 'blockquote',
      raw: '> hello',
      text: 'hello',
      tokens: [
        {
          type: 'paragraph',
          raw: 'hello',
          text: 'hello',
          tokens: [],
        } as Tokens.Paragraph,
      ],
    }
    expect(stripLeadingBlankTokensBeforeCode(paraQuote, null)).toBeUndefined()
  })

  test('#1418 push notifications idle upsell constants and REPL wiring', () => {
    expect(IDLE_UPSELL_DELAY_MINUTES).toBe(20)
    expect(PUSH_NOTIF_UPSELL_MAX_SEEN).toBe(3)
    expect(PUSH_IDLE_UPSELL_KEY).toBe('push-idle-upsell')
    expect(RC_IDLE_UPSELL_KEY).toBe('rc-idle-upsell')

    const hookSrc = readFileSync(
      join(SRC_ROOT, 'hooks/notifs/useIdleUpsellNotification.ts'),
      'utf8',
    )
    expect(hookSrc).toContain('tengu_push_notif_upsell_notification_shown')
    expect(hookSrc).toContain('tengu_rc_upsell_notification_shown')

    const replSrc = readFileSync(join(SRC_ROOT, 'screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain(
      'useIdleUpsellNotification(isLoading, lastQueryCompletionTime)',
    )
  })
})
