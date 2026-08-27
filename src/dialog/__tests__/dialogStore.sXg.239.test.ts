/**
 * densable bGl / Bgp / sXg — DialogStore + managed_settings_security queueBehind.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
  installManagedSettingsSxg,
  managedSettingsSecuritySpec,
  managedSettingsSecurityUpdates,
  type DialogStore,
} from '../index.js'
import {
  getManagedSettingsConsentRegistry,
  resetManagedSettingsConsentRegistryForTests,
} from '../../services/remoteManagedSettings/consentRequester.js'

afterEach(() => {
  resetManagedSettingsConsentRegistryForTests()
})

async function waitForTop(
  store: DialogStore,
  kind: string,
  timeoutMs = 1000,
): Promise<NonNullable<ReturnType<DialogStore['getState']>['open'][number]>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const top = store.getState().open.at(-1)
    if (top?.kind === kind) return top
    await Bun.sleep(0)
  }
  throw new Error(`timed out waiting for dialog kind=${kind}`)
}

describe('densable bGl DialogStore queueBehind', () => {
  test('queueBehind prepends under current top', () => {
    const store = createDialogStore()
    store.open({ id: 'a', kind: 'permission', payload: {} })
    store.open({
      id: 'b',
      kind: 'managed_settings_security',
      payload: { settings: {} },
      queueBehind: true,
    })
    const open = store.getState().open
    expect(open.map(d => d.id)).toEqual(['b', 'a'])
    expect(open.at(-1)?.id).toBe('a')
  })

  test('answer removes and promotes next with swappedAt', () => {
    const store = createDialogStore()
    store.open({ id: 'under', kind: 'managed_settings_security', payload: {} })
    store.open({ id: 'top', kind: 'permission', payload: {} })
    let closed: unknown
    store.onClosed(e => {
      closed = e
    })
    store.answer('top', 'ok')
    expect(closed).toEqual({ id: 'top', type: 'answered', result: 'ok' })
    const open = store.getState().open
    expect(open).toHaveLength(1)
    expect(open[0]!.id).toBe('under')
    expect(open[0]!.swappedAt).toBeGreaterThan(0)
  })
})

describe('densable Bgp + GSn streaming', () => {
  test('requestDialog resolves approved via mailbox reply', async () => {
    const mailbox = createDialogMailbox()
    const store = createDialogStore()
    const owned = new Set<string>()
    mailbox.subscribe(entry => {
      owned.add(entry.id)
      store.open(entry)
    })
    store.onClosed(event => {
      if (!owned.delete(event.id)) return
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    const requestDialog = createRequestDialog(mailbox)
    const pending = requestDialog(
      managedSettingsSecuritySpec,
      managedSettingsSecurityUpdates(
        { env: { A: '1' } } as never,
        (async function* () {})(),
      ),
      { queueBehind: true },
    )
    const top = await waitForTop(store, 'managed_settings_security')
    store.answer(top.id, 'approved')
    expect(await pending).toBe('approved')
  })
})

describe('densable permission_prompt + managed-settings queueBehind', () => {
  test('managed-settings queues under open permission_prompt', () => {
    const store = createDialogStore()
    store.open({
      id: 'permission_prompt:t1',
      kind: 'permission_prompt',
      payload: { requestId: 't1', toolName: 'Bash' },
    })
    store.open({
      id: 'ms',
      kind: 'managed_settings_security',
      payload: { settings: {} },
      queueBehind: true,
    })
    const open = store.getState().open
    expect(open.map(d => d.id)).toEqual(['ms', 'permission_prompt:t1'])
    expect(open.at(-1)?.kind).toBe('permission_prompt')
  })
})

describe('densable doo opens permission via requestDialog', () => {
  test('requestDialog(permission_bash) lands on store as top', async () => {
    const { BashTool } = await import(
      '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
    )
    const mailbox = createDialogMailbox()
    const store = createDialogStore()
    mailbox.subscribe(entry => store.open(entry))
    store.onClosed(event => {
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    const requestDialog = createRequestDialog(mailbox)
    const { openPermissionDoo } = await import('../openPermissionDoo.js')
    const pending = openPermissionDoo({
      requestDialog,
      confirm: {
        toolUseID: 'tu-1',
        tool: BashTool,
        input: { command: 'ls' },
        description: 'list',
        permissionResult: { behavior: 'ask' },
        assistantMessage: { message: { id: 'msg-1' } },
        toolUseContext: {},
      } as never,
    })
    const top = await waitForTop(store, 'permission_bash')
    expect(top.payload).toMatchObject({
      requestId: 'tu-1',
      toolName: BashTool.name,
      command: 'ls',
      classifierState: 'none',
    })
    store.answer(top.id, { behavior: 'allow' })
    expect(await pending).toEqual({ behavior: 'allow' })
  })

  test('foo file arm await Lno → permission_file with preview fields', async () => {
    const { FileEditTool } = await import(
      '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
    )
    const mailbox = createDialogMailbox()
    const store = createDialogStore()
    mailbox.subscribe(entry => store.open(entry))
    mailbox.onCancel(id => store.dismiss(id))
    store.onClosed(event => {
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    const requestDialog = createRequestDialog(mailbox)
    const { openPermissionDoo } = await import('../openPermissionDoo.js')
    const pending = openPermissionDoo({
      requestDialog,
      confirm: {
        toolUseID: 'tu-edit',
        tool: FileEditTool,
        input: {
          file_path: 'x.ts',
          old_string: 'old',
          new_string: 'new',
        },
        description: 'edit',
        permissionResult: { behavior: 'ask' },
        assistantMessage: { message: { id: 'msg-2' } },
        toolUseContext: {},
      } as never,
    })
    const top = await waitForTop(store, 'permission_file')
    expect(top.payload).toMatchObject({
      requestId: 'tu-edit',
      title: 'Edit file',
      operationType: 'write',
      content: { kind: 'file-edit-diff' },
    })
    store.answer(top.id, { behavior: 'allow' })
    expect(await pending).toEqual({ behavior: 'allow' })
  })

  test('onReprompt aborts gen1 and rebuilds Lno for new file path', async () => {
    const { FileEditTool } = await import(
      '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
    )
    const mailbox = createDialogMailbox()
    const store = createDialogStore()
    mailbox.subscribe(entry => store.open(entry))
    mailbox.onCancel(id => store.dismiss(id))
    store.onClosed(event => {
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    const requestDialog = createRequestDialog(mailbox)
    const { startPermissionDoo } = await import('../openPermissionDoo.js')
    const confirm = {
      toolUseID: 'tu-reprompt',
      tool: FileEditTool,
      input: {
        file_path: 'a.ts',
        old_string: 'a',
        new_string: 'b',
      },
      description: 'edit a',
      permissionResult: { behavior: 'ask' },
      assistantMessage: { message: { id: 'msg-r' } },
      toolUseContext: {},
    } as never
    const session = startPermissionDoo({ requestDialog, confirm })
    const top1 = await waitForTop(store, 'permission_file')
    expect(top1.payload).toMatchObject({
      requestId: 'tu-reprompt',
      filePath: expect.stringContaining('a.ts'),
    })
    expect(session.isReprompted()).toBe(false)

    session.onReprompt({
      finalInput: {
        file_path: 'b.ts',
        old_string: 'x',
        new_string: 'y',
      },
      permissionResult: { behavior: 'ask', message: 'rewritten' },
      description: 'edit b',
    })
    expect(session.isReprompted()).toBe(true)

    const top2 = await waitForTop(store, 'permission_file')
    expect(top2.id).not.toBe(top1.id)
    expect(top2.payload).toMatchObject({
      requestId: 'tu-reprompt',
      filePath: expect.stringContaining('b.ts'),
    })
    // gen1 abort must not settle the outer promise
    store.answer(top2.id, { behavior: 'allow' })
    expect(await session.result).toEqual({ behavior: 'allow' })
  })

  test('onReprompt file path loss → deny (no stale preview)', async () => {
    const { FileEditTool } = await import(
      '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
    )
    const mailbox = createDialogMailbox()
    const store = createDialogStore()
    mailbox.subscribe(entry => store.open(entry))
    mailbox.onCancel(id => store.dismiss(id))
    store.onClosed(event => {
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    const requestDialog = createRequestDialog(mailbox)
    const { startPermissionDoo } = await import('../openPermissionDoo.js')
    const confirm = {
      toolUseID: 'tu-fail',
      tool: FileEditTool,
      input: {
        file_path: 'ok.ts',
        old_string: 'a',
        new_string: 'b',
      },
      description: 'edit',
      permissionResult: { behavior: 'ask' },
      assistantMessage: { message: { id: 'msg-f' } },
      toolUseContext: {},
    } as never
    const session = startPermissionDoo({ requestDialog, confirm })
    await waitForTop(store, 'permission_file')
    session.onReprompt({
      finalInput: { not_a_path: true },
      permissionResult: { behavior: 'ask' },
    })
    const denied = await session.result
    expect(denied.behavior).toBe('deny')
    expect(denied.feedback).toMatch(/cannot preview|stale preview/i)
  })
})

describe('densable sXg via installManagedSettingsSxg', () => {
  test('registers requester that routes through GSn', async () => {
    const mailbox = createDialogMailbox()
    const store = createDialogStore()
    mailbox.subscribe(entry => store.open(entry))
    store.onClosed(event => {
      mailbox.reply(
        event.type === 'answered'
          ? { id: event.id, result: event.result }
          : { id: event.id, cancelled: true },
      )
    })
    const requestDialog = createRequestDialog(mailbox)
    const dispose = installManagedSettingsSxg(requestDialog)
    const reg = getManagedSettingsConsentRegistry()
    const review = reg.review(reg.replRequester!, {
      env: { ANTHROPIC_API_KEY: 'x' },
    } as never)
    const top = await waitForTop(store, 'managed_settings_security')
    store.answer(top.id, 'rejected')
    expect(await review).toBe('rejected')
    dispose()
  })
})
