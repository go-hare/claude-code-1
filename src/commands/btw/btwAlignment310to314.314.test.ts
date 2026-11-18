import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '../../types/message.js'
import { getViewedSubagentMessages } from './btw.js'

describe('/btw 2.1.314 alignment (#1379, #1409)', () => {
  test('#1379: getViewedSubagentMessages returns subagent transcript messages when viewing a non-main-session local_agent', () => {
    const subMsg = { type: 'user', uuid: 'u-sub' } as unknown as Message
    const res = getViewedSubagentMessages({
      getAppState: () =>
        ({
          viewingAgentTaskId: 'agent-42',
          tasks: {
            'agent-42': {
              id: 'agent-42',
              type: 'local_agent',
              agentType: 'Explore',
            },
          },
          transcripts: {
            'agent-42': { messages: [subMsg] },
          },
        }) as unknown as ReturnType<
          Parameters<typeof getViewedSubagentMessages>[0]['getAppState']
        >,
    })
    expect(res).toEqual({ agentId: 'agent-42', messages: [subMsg] })

    // Main-session or leader returns undefined
    const mainRes = getViewedSubagentMessages({
      getAppState: () =>
        ({
          viewingAgentTaskId: 'agent-main',
          tasks: {
            'agent-main': {
              id: 'agent-main',
              type: 'local_agent',
              agentType: 'main-session',
            },
          },
          transcripts: {},
        }) as unknown as ReturnType<
          Parameters<typeof getViewedSubagentMessages>[0]['getAppState']
        >,
    })
    expect(mainRes).toBeUndefined()
  })

  test('#1409: btw.tsx calls preventDefault and stopImmediatePropagation on Esc', () => {
    const src = readFileSync(join(import.meta.dir, 'btw.tsx'), 'utf8')
    expect(src).toContain('e.preventDefault()')
    expect(src).toContain('stopImmediatePropagation?.()')
  })
})
