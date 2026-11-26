import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import {
  bashTaskDeliveryBagOf,
  getBashTaskDeliveryBag,
  isBashTaskDeliveryHosted,
  lookupBashTaskSnapshot,
  rememberBashTaskSnapshot,
  reportedBashTaskDeliveries,
  spliceBashTaskDelivery,
} from '../bashTaskDelivery.js'
import {
  getBashTaskDeliveryBag as getOutcomesBashTaskDeliveryBag,
  withdrawQueuedBashTaskNotification,
} from '../bashTaskDeliveryOutcomes.js'
import {
  clearCommandQueue,
  consume,
  createMessageQueue,
  createQueueRecordWriter,
  defaultQueue,
  dequeue,
  enqueue,
  enqueuePendingNotification,
  getActiveMessageQueue,
  getCommandQueue,
  getCommandQueueSnapshot,
  getHostQueueState,
  hasCancelPendingAcked,
  holdBack,
  isFoldInFlight,
  isMidTurnFoldSuspended,
  markCancelPending,
  peek,
  promoteToNow,
  registerFoldInFlight,
  resetCommandQueue,
  setActiveMessageQueue,
  setQueueRecordHookRunner,
  setQueueSessionReadyPromise,
  subscribeCommandsConsumed,
  subscribeCommandsDiscarded,
  subscribeToCommandQueue,
  suspendMidTurnFold,
} from '../messageQueueManager.js'
import {
  createSessionHost,
  exitSessionContext,
  getBootstrapSessionHost,
  resetSessionHostForTests,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import { createRootSession, type Session } from '../sessionRoot.js'
import {
  type CachedSchema,
  clearToolSchemaCache,
  getToolSchemaCache,
  Ip,
  i_,
  kn,
  o_,
  s_,
  toolSchemaCacheOf,
} from '../toolSchemaCache.js'

function makeSimulatedSession(label: string): Session {
  const cwd = `/tmp/${label}`
  return createRootSession({
    host: createSessionHost(),
    id: randomUUID(),
    project: { originalCwd: cwd, projectRoot: cwd, cwd },
  })
}

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

const SCHEMA_A: CachedSchema = {
  name: 'Bash',
  description: 'Host A bash schema',
  input_schema: { type: 'object', properties: { cmdA: { type: 'string' } } },
}

const SCHEMA_B: CachedSchema = {
  name: 'Bash',
  description: 'Host B bash schema',
  input_schema: { type: 'object', properties: { cmdB: { type: 'string' } } },
  strict: true,
}

afterEach(() => {
  resetCommandQueue()
  clearToolSchemaCache()
  getBashTaskDeliveryBag().reset()
  resetSessionHostForTests()
})

describe('Official 2.1.331 multi-SessionHost WeakMap + ALS isolation', () => {
  describe('toolSchemaCache ($St / aos.of(N().host))', () => {
    test('isolates getToolSchemaCache, clearToolSchemaCache, and in-flight generation stamps across concurrent hosts', async () => {
      const [hostA, hostB] = await Promise.all([
        runWithNewHostSession({ cwd: '/tmp/host-a' }, async sessionA => {
          const stampA = kn().stamp()
          await tick(10)
          kn().register('Bash', SCHEMA_A, stampA)
          getToolSchemaCache().set('Read', {
            name: 'Read',
            description: 'Host A read',
            input_schema: { type: 'object', properties: {} },
          })
          await tick(10)
          expect(getToolSchemaCache().get('Bash')).toEqual(SCHEMA_A)
          expect(getToolSchemaCache().has('Grep')).toBe(false)
          clearToolSchemaCache()
          expect(getToolSchemaCache().size).toBe(0)
          expect(kn().stamp()).toBe(1)
          return sessionA.host
        }),
        runWithNewHostSession({ cwd: '/tmp/host-b' }, async sessionB => {
          const stampB = kn().stamp()
          kn().register('Bash', SCHEMA_B, stampB)
          getToolSchemaCache().set('Grep', {
            name: 'Grep',
            description: 'Host B grep',
            input_schema: { type: 'object', properties: {} },
          })
          await tick(25)
          // Host A called clearToolSchemaCache() mid-flight; Host B must be untouched.
          expect(getToolSchemaCache().size).toBe(2)
          expect(getToolSchemaCache().get('Bash')).toEqual(SCHEMA_B)
          expect(getToolSchemaCache().has('Read')).toBe(false)
          expect(kn().stamp()).toBe(0)

          o_()
          expect(kn().stamp()).toBe(1)
          kn().register('StaleTool', SCHEMA_B, stampB)
          expect(getToolSchemaCache().has('StaleTool')).toBe(false)
          return sessionB.host
        }),
      ])

      expect(hostA).not.toBe(hostB)
      expect(toolSchemaCacheOf(hostA)).not.toBe(toolSchemaCacheOf(hostB))
    })

    test('isolates keepAcrossTokenChanges (s_ / Ip) latch per SessionHost and exits to default host cleanly', () => {
      const sessionA = makeSimulatedSession('kestrel-a')
      const sessionB = makeSimulatedSession('kestrel-b')

      let gateValue = false
      const prevReader = i_(() => gateValue)
      try {
        runWithSession(sessionA, () => {
          gateValue = false
          expect(s_()).toBe(false)
          kn().register('Bash', SCHEMA_A, kn().stamp())
        })
        runWithSession(sessionB, () => {
          gateValue = true
          expect(s_()).toBe(true)
          kn().register('Bash', SCHEMA_B, kn().stamp())

          // Exiting ALS inside Host B sees empty default bootstrap host cache.
          exitSessionContext(() => {
            expect(getToolSchemaCache().size).toBe(0)
          })
        })

        // Ip() invalidates all on Host A (s_()===false) while keeping entries on Host B (s_()===true).
        runWithSession(sessionA, () => {
          Ip()
          expect(getToolSchemaCache().size).toBe(0)
          expect(kn().stamp()).toBe(1)
        })
        runWithSession(sessionB, () => {
          Ip()
          expect(getToolSchemaCache().size).toBe(1)
          expect(getToolSchemaCache().get('Bash')).toEqual(SCHEMA_B)
          expect(kn().stamp()).toBe(1)
        })
      } finally {
        i_(prevReader)
      }
    })
  })

  describe('messageQueueManager per-SessionHost HostQueueState', () => {
    test('concurrent hosts never steal or leak queued prompts, notifications, or subscriber events', async () => {
      const sessionA = makeSimulatedSession('queue-a')
      const sessionB = makeSimulatedSession('queue-b')

      const eventsA: number[] = []
      const consumedA: string[] = []
      const discardedB: string[] = []

      const unsubA = runWithSession(sessionA, () =>
        subscribeToCommandQueue(() => {
          eventsA.push(getCommandQueue().length)
        }),
      )
      const unsubConsumedA = runWithSession(sessionA, () =>
        subscribeCommandsConsumed(cmds => {
          consumedA.push(
            ...cmds.map(c => (typeof c.value === 'string' ? c.value : '')),
          )
        }),
      )
      const unsubDiscardedB = runWithSession(sessionB, () =>
        subscribeCommandsDiscarded(cmds => {
          discardedB.push(
            ...cmds.map(c => (typeof c.value === 'string' ? c.value : '')),
          )
        }),
      )

      try {
        await Promise.all([
          runWithSession(sessionA, async () => {
            enqueuePendingNotification({
              value: 'notif-a-later',
              mode: 'task-notification',
            })
            await tick(10)
            enqueue({
              value: 'prompt-a-next',
              mode: 'prompt',
            })
            enqueue({
              value: 'prompt-a-now',
              mode: 'prompt',
              priority: 'now',
            })
            await tick(15)

            // Host B cleared its queue during our await; Host A's 3 items remain intact.
            expect(getCommandQueueSnapshot()).toHaveLength(3)
            expect(peek()?.value).toBe('prompt-a-now')
            expect(dequeue()?.value).toBe('prompt-a-now')

            const nextCmd = getCommandQueue().find(
              c => c.value === 'prompt-a-next',
            )
            expect(nextCmd).toBeDefined()
            if (nextCmd) {
              consume([nextCmd], { reason: 'absorbed_mid_turn' })
            }
            expect(dequeue()?.value).toBe('notif-a-later')
            expect(dequeue()).toBeUndefined()
          }),
          runWithSession(sessionB, async () => {
            enqueue({
              value: 'prompt-b-1',
              mode: 'prompt',
            })
            enqueuePendingNotification({
              value: 'notif-b-1',
              mode: 'task-notification',
            })
            await tick(5)
            expect(getCommandQueue().map(c => c.value)).toEqual([
              'prompt-b-1',
              'notif-b-1',
            ])
            // Clearing Host B must NOT affect Host A or trigger Host A's subscribers.
            clearCommandQueue()
            expect(getCommandQueue()).toHaveLength(0)

            await tick(15)
            enqueue({
              value: 'prompt-b-after-clear',
              mode: 'prompt',
            })
            expect(dequeue()?.value).toBe('prompt-b-after-clear')
          }),
        ])

        expect(consumedA).toEqual(['prompt-a-next'])
        expect(discardedB).toEqual(['prompt-b-1', 'notif-b-1'])
        // Host A saw: +1 (1), +1 (2), +1 (3), dequeue (2), consume (1), dequeue (0)
        expect(eventsA).toEqual([1, 2, 3, 2, 1, 0])
        expect(getHostQueueState(sessionA.host)).not.toBe(
          getHostQueueState(sessionB.host),
        )
      } finally {
        unsubA()
        unsubConsumedA()
        unsubDiscardedB()
      }
    })

    test('isolates foldInFlight, midTurnFoldSuspended, cancelPending, holdBack, activeQueue override, and hook runner per host', async () => {
      const sessionA = makeSimulatedSession('state-a')
      const sessionB = makeSimulatedSession('state-b')
      const sharedUuid = randomUUID()

      runWithSession(sessionA, () => {
        enqueue({ uuid: sharedUuid, value: 'a-msg', mode: 'prompt' })
        registerFoldInFlight([{ uuid: sharedUuid }])
        suspendMidTurnFold()
        markCancelPending('cancel-1', { terminalEmitted: true })
      })

      const releaseHoldA = runWithSession(sessionA, () =>
        holdBack(cmd => cmd.mode === 'prompt'),
      )

      try {
        runWithSession(sessionB, () => {
          enqueue({ uuid: sharedUuid, value: 'b-msg', mode: 'prompt' })
          expect(isFoldInFlight(sharedUuid)).toBe(false)
          expect(isMidTurnFoldSuspended()).toBe(false)
          expect(hasCancelPendingAcked('cancel-1')).toBe(false)
          // Host A's foldInFlight must not block promoteToNow on Host B.
          expect(promoteToNow(sharedUuid)).toBe(true)
          // Host A's active holdBack must not collide with setting holdBack on Host B.
          const releaseHoldB = holdBack(cmd => cmd.mode === 'bash')
          expect(getCommandQueue()[0]?.passive).toBeUndefined()
          releaseHoldB()

          // setActiveMessageQueue(defaultQueue) restores Host B's own defaultQueue, not Host A's.
          const customQueueB = createMessageQueue()
          const hostDefaultB = getActiveMessageQueue()
          setActiveMessageQueue(customQueueB)
          expect(getActiveMessageQueue()).toBe(customQueueB)
          setActiveMessageQueue(defaultQueue)
          expect(getActiveMessageQueue()).toBe(hostDefaultB)
          expect(getActiveMessageQueue()).not.toBe(
            getHostQueueState(sessionA.host).defaultQueue,
          )
        })

        // Verify per-host queue record hook runner & ready promise isolation
        let releaseReadyA!: () => void
        const readyA = new Promise<void>(resolve => {
          releaseReadyA = resolve
        })
        const writtenA: string[] = []
        const writtenB: string[] = []

        runWithSession(sessionA, () => {
          setQueueSessionReadyPromise(readyA)
          setQueueRecordHookRunner(content => `[A] ${content}`)
        })
        runWithSession(sessionB, () => {
          setQueueRecordHookRunner(content => `[B] ${content}`)
        })

        const writerA = createQueueRecordWriter(op => {
          writtenA.push(op.content ?? op.operation)
        })
        const writerB = createQueueRecordWriter(op => {
          writtenB.push(op.content ?? op.operation)
        })

        runWithSession(sessionA, () => {
          writerA({
            type: 'queue-operation',
            operation: 'enqueue',
            timestamp: new Date().toISOString(),
            sessionId: sessionA.id,
            content: 'held',
          })
        })
        runWithSession(sessionB, () => {
          writerB({
            type: 'queue-operation',
            operation: 'enqueue',
            timestamp: new Date().toISOString(),
            sessionId: sessionB.id,
            content: 'immediate',
          })
        })

        await tick(10)
        // Host A is still waiting on readyA; Host B flushed immediately with its own hook runner.
        expect(writtenA).toEqual([])
        expect(writtenB).toEqual(['[B] immediate'])

        releaseReadyA()
        await tick(10)
        expect(writtenA).toEqual(['[A] held'])
      } finally {
        releaseHoldA()
        runWithSession(sessionA, () => {
          setQueueRecordHookRunner(null)
          setQueueSessionReadyPromise(null)
        })
        runWithSession(sessionB, () => {
          setQueueRecordHookRunner(null)
          setQueueSessionReadyPromise(null)
        })
      }
    })
  })

  describe('bashTaskDelivery (yn() / getBashTaskDeliveryBag)', () => {
    test('isolates snapshots, delivery outcomes, reported deliveries, GetTask counts, and notification withdrawal across concurrent hosts', async () => {
      const sessionA = makeSimulatedSession('bash-a')
      const sessionB = makeSimulatedSession('bash-b')
      const sharedMsgId = randomUUID()
      const now = new Date().toISOString()

      await Promise.all([
        runWithSession(sessionA, async () => {
          const bagA = getBashTaskDeliveryBag()
          expect(bagA).toBe(getOutcomesBashTaskDeliveryBag())
          expect(bagA).toBe(bashTaskDeliveryBagOf(sessionA.host))

          rememberBashTaskSnapshot('task-shared', {
            taskId: 'task-shared',
            status: 'completed',
            statusMessage: 'Host A completed',
            createdAt: now,
            lastUpdatedAt: now,
            result: {
              content: [{ type: 'text', text: 'out-a' }],
              isError: false,
            },
          })
          bagA.markBashTaskSnapshotFetched('task-shared')
          expect(bagA.countBashTaskGet('task-shared')).toBe(1)
          expect(
            bagA.countBashTaskGetInResponse(
              'resp-1',
              'task-shared',
              'completed',
            ),
          ).toBe(1)

          enqueuePendingNotification({
            mode: 'task-notification',
            value: 'Host A shell done',
            taskId: 'task-shared',
            taskDelivery: { taskId: 'task-shared', status: 'completed' },
          })

          // Splice with no assistant host records no_host on Host A only.
          const spliced = spliceBashTaskDelivery(
            [],
            {
              taskId: 'task-shared',
              status: 'completed',
              statusMessage: 'Host A completed',
              createdAt: now,
              lastUpdatedAt: now,
              result: {
                content: [{ type: 'text', text: 'out-a' }],
                isError: false,
              },
            },
            sharedMsgId,
            { report: true, startsTurn: true },
          )
          expect(spliced).toBe(false)
          expect(isBashTaskDeliveryHosted(sharedMsgId)).toBe(false)
          expect(reportedBashTaskDeliveries().has(sharedMsgId)).toBe(true)

          await tick(15)
          // Withdraw on Host A removes Host A's notification while leaving Host B's intact.
          const restoreA = withdrawQueuedBashTaskNotification('task-shared')
          expect(restoreA).toBeDefined()
          expect(getCommandQueue()).toHaveLength(0)
        }),
        runWithSession(sessionB, async () => {
          await tick(5)
          const bagB = getBashTaskDeliveryBag()
          expect(bagB).toBe(getOutcomesBashTaskDeliveryBag())

          // Host A's snapshot, counts, outcomes, and reported set must not leak into Host B.
          expect(lookupBashTaskSnapshot('task-shared')).toBeUndefined()
          expect(isBashTaskDeliveryHosted(sharedMsgId)).toBe(true)
          expect(reportedBashTaskDeliveries().has(sharedMsgId)).toBe(false)
          expect(bagB.countBashTaskGet('task-shared')).toBe(1)
          expect(
            bagB.countBashTaskGetInResponse(
              'resp-1',
              'task-shared',
              'completed',
            ),
          ).toBe(1)

          enqueuePendingNotification({
            mode: 'task-notification',
            value: 'Host B shell done',
            taskId: 'task-shared',
            taskDelivery: { taskId: 'task-shared', status: 'completed' },
          })

          await tick(20)
          // Host A withdrew 'task-shared', but Host B's queued notification must still be present!
          expect(getCommandQueue()).toHaveLength(1)
          expect(getCommandQueue()[0]?.value).toBe('Host B shell done')
        }),
      ])

      expect(bashTaskDeliveryBagOf(sessionA.host)).not.toBe(
        bashTaskDeliveryBagOf(sessionB.host),
      )
    })
  })

  describe('resetSessionHostForTests() mints isolated host slots', () => {
    test('new bootstrap SessionHost starts with clean schema cache, command queue, and bash delivery bag', () => {
      resetSessionHostForTests()

      const host1 = getBootstrapSessionHost()
      getToolSchemaCache().set('Bash', SCHEMA_A)
      enqueue({ value: 'host-1-msg', mode: 'prompt' })
      rememberBashTaskSnapshot('host-1-task', { status: 'completed' })

      resetSessionHostForTests()
      const host2 = getBootstrapSessionHost()
      expect(host2).not.toBe(host1)

      expect(getToolSchemaCache().size).toBe(0)
      expect(getCommandQueue()).toHaveLength(0)
      expect(lookupBashTaskSnapshot('host-1-task')).toBeUndefined()

      // Previous host's WeakMap slots remain intact when inspected by host reference.
      expect(toolSchemaCacheOf(host1).get('Bash')).toEqual(SCHEMA_A)
      expect(getHostQueueState(host1).defaultQueue.getCommands()).toHaveLength(
        1,
      )
      expect(
        bashTaskDeliveryBagOf(host1).bashTaskSnapshots.has('host-1-task'),
      ).toBe(true)
    })
  })
})
