/**
 * Shared messageQueueManager mock for process-global mock.module.
 *
 * Bun mock.module is last-write-wins across the whole test process. Incomplete
 * stubs (missing hasCommandsInQueue / enqueue / resetCommandQueue) break
 * SleepTool and other co-running suites. Always spread the real module and
 * override only what the test needs.
 *
 * Usage:
 *   import * as realMessageQueue from 'src/utils/messageQueueManager.js'
 *   import { createMessageQueueManagerMock } from '../../../tests/mocks/messageQueueManager.js'
 *   mock.module('src/utils/messageQueueManager.js', createMessageQueueManagerMock(realMessageQueue, {
 *     enqueuePendingNotification: noop,
 *   }))
 */
import type * as MessageQueueManager from 'src/utils/messageQueueManager.js'

export type MessageQueueManagerModule = typeof MessageQueueManager

export function createMessageQueueManagerMock(
  real: MessageQueueManagerModule,
  overrides: Partial<MessageQueueManagerModule> = {},
): () => MessageQueueManagerModule {
  return () => ({
    ...real,
    ...overrides,
  })
}
