import { describe, expect, test } from 'bun:test'
import { parseAgentsFromJson } from '../loadAgentsDir.js'

describe('agent observer frontmatter/json', () => {
  test('parseAgentsFromJson carries observer fields', () => {
    const agents = parseAgentsFromJson(
      {
        worker: {
          description: 'does work',
          prompt: 'You work.',
          observer: '  watcher  ',
          observerMessage: '  be careful  ',
        },
        watcher: {
          description: 'watches',
          prompt: 'You watch.',
        },
      },
      'userSettings',
    )
    const worker = agents.find(a => a.agentType === 'worker')
    expect(worker?.observer).toBe('watcher')
    expect(worker?.observerMessage).toBe('  be careful  ')
    const watcher = agents.find(a => a.agentType === 'watcher')
    expect(watcher?.observer).toBeUndefined()
  })

  test('empty observer string drops field', () => {
    const agents = parseAgentsFromJson(
      {
        worker: {
          description: 'does work',
          prompt: 'You work.',
          observer: '   ',
        },
      },
      'userSettings',
    )
    expect(agents[0]?.observer).toBeUndefined()
  })
})
