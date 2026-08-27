/**
 * densable odm/Drf + idm/Mrf — eligibility + doo claim-racer teardown.
 */
import { describe, expect, test } from 'bun:test'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import {
  applyIdeEditsToToolInput,
  buildIdeDiffEditsFromTool,
  getIdeDiffEligibility,
} from '../ideDiffEligibility.js'
import { startPermissionDoo } from '../openPermissionDoo.js'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
} from '../index.js'

describe('densable odm / Drf eligibility', () => {
  test('buildIdeDiffEditsFromTool Edit/Write only', () => {
    const edit = buildIdeDiffEditsFromTool(FileEditTool, {
      file_path: 'a.ts',
      old_string: 'a',
      new_string: 'b',
    })
    expect(edit).toMatchObject({
      filePath: 'a.ts',
      edits: [{ old_string: 'a', new_string: 'b' }],
    })
    expect(buildIdeDiffEditsFromTool(BashTool, { command: 'ls' })).toBeNull()
  })

  test('applyIdeEditsToToolInput maps Edit/Write', () => {
    expect(
      applyIdeEditsToToolInput(
        FileEditTool,
        { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
        [{ old_string: 'a', new_string: 'c', replace_all: false }],
      ),
    ).toMatchObject({ new_string: 'c' })
    expect(
      applyIdeEditsToToolInput(
        FileWriteTool,
        { file_path: 'a.ts', content: 'old' },
        [{ old_string: '', new_string: 'new', replace_all: false }],
      ),
    ).toMatchObject({ content: 'new' })
  })

  test('getIdeDiffEligibility null without IDE client', () => {
    const elig = getIdeDiffEligibility(
      FileEditTool,
      { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
      {
        options: { mcpClients: [] },
        abortController: new AbortController(),
      } as never,
    )
    expect(elig).toBeNull()
  })
})

describe('densable idm teardown via doo addTeardown', () => {
  test('onReprompt runs addTeardown closeTab before rebuild', async () => {
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
    let teardownCount = 0
    const confirm = {
      toolUseID: 'tu-ide',
      tool: FileEditTool,
      input: {
        file_path: 'a.ts',
        old_string: 'a',
        new_string: 'b',
      },
      description: 'edit',
      permissionResult: { behavior: 'ask' },
      assistantMessage: { message: { id: 'm' } },
      toolUseContext: {
        options: { mcpClients: [] },
        abortController: new AbortController(),
      },
    } as never

    const session = startPermissionDoo({
      requestDialog,
      confirm,
      onRacersReady: api => {
        api.addTeardown(() => {
          teardownCount += 1
        })
      },
    })

    // wait for first open
    for (let i = 0; i < 50 && store.getState().open.length === 0; i++) {
      await Bun.sleep(0)
    }
    expect(store.getState().open.length).toBeGreaterThan(0)
    expect(teardownCount).toBe(0)

    session.onReprompt({
      finalInput: {
        file_path: 'b.ts',
        old_string: 'x',
        new_string: 'y',
      },
      permissionResult: { behavior: 'ask' },
    })
    expect(teardownCount).toBe(1)

    for (let i = 0; i < 50; i++) {
      const top = store.getState().open.at(-1)
      if (
        top?.kind === 'permission_file' &&
        String((top.payload as { filePath?: string }).filePath ?? '').includes(
          'b.ts',
        )
      ) {
        break
      }
      await Bun.sleep(0)
    }
    const top = store.getState().open.at(-1)
    expect(top?.kind).toBe('permission_file')
    expect((top?.payload as { filePath?: string }).filePath).toContain('b.ts')
    // densable: no showingDiffInIDE on reprompt
    expect(
      (top?.payload as { showingDiffInIDE?: boolean }).showingDiffInIDE,
    ).toBeUndefined()
    store.answer(top!.id, { behavior: 'allow' })
    expect(await session.result).toEqual({ behavior: 'allow' })
  })
})
