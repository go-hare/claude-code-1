import { describe, expect, test } from 'bun:test'
import {
  dequeueAll,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import { stopTask } from '../stopTask.js'

describe('#1091 stopTask client notice includes outputFile', () => {
  test('client-stopped local_bash task notification includes <output-file> and client summary', async () => {
    resetCommandQueue()

    const task = {
      id: 'bash_1',
      type: 'local_bash' as const,
      status: 'running' as const,
      description: 'long build',
      command: 'npm run build',
      outputFile: '/tmp/bash_1.output',
      toolUseId: 'toolu_1',
      startTime: Date.now(),
      shellCommand: {
        kill: () => {},
        cleanup: () => {},
      },
    }

    await stopTask('bash_1', {
      getAppState: () => ({ tasks: { bash_1: task } }) as never,
      setAppState: () => {},
      source: 'client',
    })

    const notifications = dequeueAll()
    expect(notifications.length).toBe(1)
    const msg = notifications[0]!
    expect(msg.value).toContain('<output-file>/tmp/bash_1.output</output-file>')
    expect(msg.value).toContain(
      'was stopped by the user or by the app connected to this session',
    )
  })
})
