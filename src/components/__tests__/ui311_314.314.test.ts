import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveWelcomeHeaderModel } from '../LogoV2/CondensedLogo.js'
import { getRestoreOptionConversationText } from '../MessageSelector.js'
import { BEHAVIOR_CARDS, buildUsageRecommendations } from '../Settings/Usage.js'

const ROOT = join(import.meta.dir, '../..')

describe('v2.1.311–314 UI alignment', () => {
  test('#1254 FeedbackDraftNotice hides 1/2/0 and Esc shortcuts when prompt has text', () => {
    const src = readFileSync(
      join(ROOT, 'components/FeedbackDraftNotice.tsx'),
      'utf8',
    )
    expect(src).toContain("const hasEmptyInput = inputValue === '';")
    expect(src).toContain('clear text to answer it')
    expect(src).toContain('clear text to open review or dismiss')
    expect(src).toContain('clear text to review, send, or dismiss')
  })

  test('#1266 Usage BEHAVIOR_CARDS and buildUsageRecommendations surface cache_miss', () => {
    expect(BEHAVIOR_CARDS.cache_miss.headline(42)).toBe(
      '42% of your usage hit a >100k-token cache miss',
    )
    const recs = buildUsageRecommendations({
      totalCost: 100,
      behaviors: [{ key: 'cache_miss', cost: 40, count: 2 }],
      agents: [],
      skills: [],
      plugins: [],
      mcpServers: [],
      loops: [],
    } as unknown as Parameters<typeof buildUsageRecommendations>[0])
    expect(recs.some(r => r.title === 'Compact before you step away')).toBe(
      true,
    )
  })

  test('#1268 & #1269 MessageSelector /rewind texts', () => {
    expect(getRestoreOptionConversationText('both')).toBe(
      'The conversation goes back to before this message.',
    )
    expect(getRestoreOptionConversationText('conversation')).toBe(
      'The conversation goes back to before this message.',
    )
    expect(getRestoreOptionConversationText('code')).toBe(
      'The conversation will be unchanged.',
    )
    const src = readFileSync(
      join(ROOT, 'components/MessageSelector.tsx'),
      'utf8',
    ).replace(/\s+/g, ' ')
    expect(src).toContain(
      'Restored files go back whole, losing later changes by anyone. Bash changes to other files are not undone.',
    )
  })

  test('#1401 AttachmentMessage respects addMargin instead of hardcoding marginTop={1}', () => {
    const src = readFileSync(
      join(ROOT, 'components/messages/AttachmentMessage.tsx'),
      'utf8',
    )
    expect(src).not.toContain('marginTop={1}')
  })

  test('#1403 BackgroundTasksDialog handleKeyDown resolves selection via selectedIdRef.current first', () => {
    const src = readFileSync(
      join(ROOT, 'components/tasks/BackgroundTasksDialog.tsx'),
      'utf8',
    )
    expect(src).toContain(
      'selectedIdRef.current ? allSelectableItems.find(i => i.id === selectedIdRef.current) : undefined',
    )
    expect(src).toContain('stopItem(selection)')
  })

  test('#1410 resolveWelcomeHeaderModel uses viewed subagent or teammate model', () => {
    expect(
      resolveWelcomeHeaderModel({
        sessionModel: 'claude-opus-4-6',
        viewingAgentTaskId: undefined,
        tasks: {},
      }),
    ).toBe('claude-opus-4-6')
    expect(
      resolveWelcomeHeaderModel({
        sessionModel: 'claude-opus-4-6',
        viewingAgentTaskId: 'agent-1',
        tasks: {
          'agent-1': { type: 'local_agent', model: 'claude-haiku-4-5' },
        },
      }),
    ).toBe('claude-haiku-4-5')
    expect(
      resolveWelcomeHeaderModel({
        sessionModel: 'claude-opus-4-6',
        viewingAgentTaskId: 'tm-1',
        tasks: {
          'tm-1': {
            type: 'in_process_teammate',
            selectedAgent: { model: 'claude-sonnet-4-6' },
          },
        },
      }),
    ).toBe('claude-sonnet-4-6')
  })
})
