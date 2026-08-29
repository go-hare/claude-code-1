/**
 * densable Fwl / foo / Lno / jsu — specialized kinds + async file preview.
 */
import { describe, expect, test } from 'bun:test'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import { AskUserQuestionTool } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { MonitorTool } from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import { PowerShellTool } from '@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js'
import { SkillTool } from '@claude-code/builtin-tools/tools/SkillTool/SkillTool.js'
import { WebFetchTool } from '@claude-code/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import { DIALOG_COMPONENTS_KINDS_FOR_TEST } from '../DialogHost.js'
import { JSU_NON_PERMISSION_KIND_LIST } from '../jsuRenderers.js'
import { openPermissionDoo } from '../openPermissionDoo.js'
import { shouldQueuePermissionBehind } from '../permissionQueueBehind.js'
import {
  selectBashPermissionDialog,
  selectFilePermissionDialog,
  selectPermissionDialog,
  selectPermissionDialogFwl,
} from '../selectPermissionDialog.js'
import {
  isPermissionDialogKind,
  PERMISSION_ASK_USER_QUESTION_KIND,
  PERMISSION_BASH_KIND,
  PERMISSION_BROWSER_KIND,
  PERMISSION_DIALOG_KINDS,
  PERMISSION_FILE_KIND,
  PERMISSION_MONITOR_KIND,
  PERMISSION_POWERSHELL_KIND,
  PERMISSION_PROMPT_KIND,
  PERMISSION_SKILL_KIND,
  PERMISSION_WEBFETCH_KIND,
} from '../specs/permissionKinds.js'
import { MANAGED_SETTINGS_SECURITY_KIND } from '../specs/managedSettingsSecurity.js'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
} from '../index.js'

function confirm(
  tool: { name: string },
  input: Record<string, unknown> = {},
): ToolUseConfirm {
  return {
    toolUseID: 'tu',
    tool,
    input,
    description: 'd',
    permissionResult: { behavior: 'ask' },
    assistantMessage: { message: { id: 'm1' } },
    toolUseContext: {},
  } as unknown as ToolUseConfirm
}

describe('densable foo order (Fwl → file → bash → bEt)', () => {
  test('Fwl: WebFetch before file/bash', () => {
    const fwl = selectPermissionDialogFwl(
      confirm(WebFetchTool, { url: 'https://example.com/x' }),
    )
    expect(fwl?.spec.kind).toBe(PERMISSION_WEBFETCH_KIND)
    expect(fwl?.descriptor).toMatchObject({ hostname: 'example.com' })
  })

  test('Fwl: Bash is NOT in Fwl', () => {
    expect(
      selectPermissionDialogFwl(confirm(BashTool, { command: 'ls' })),
    ).toBe(null)
  })

  test('Fwl: Monitor → permission_monitor', () => {
    const fwl = selectPermissionDialogFwl(
      confirm(MonitorTool, { command: 'tail -f x', description: 'watch' }),
    )
    expect(fwl?.spec.kind).toBe(PERMISSION_MONITOR_KIND)
    expect(fwl?.descriptor).toMatchObject({ intervalMs: 0 })
  })

  test('Fwl: LUt default false → chrome MCP is not Cno', () => {
    const fwl = selectPermissionDialogFwl(
      confirm({ name: 'mcp__claude-in-chrome__click' }, {}),
    )
    expect(fwl).toBeNull()
  })

  test('file arm → await Lno → permission_file', async () => {
    const selected = await selectFilePermissionDialog(
      confirm(FileEditTool, {
        file_path: 'a.ts',
        old_string: 'a',
        new_string: 'b',
      }),
    )
    expect(selected?.spec.kind).toBe(PERMISSION_FILE_KIND)
    expect(selected?.descriptor).toMatchObject({
      title: 'Edit file',
      content: { kind: 'file-edit-diff' },
    })
  })

  test('Bash sed in-place → permission_file (ISl arm)', async () => {
    const { unlinkSync, writeFileSync } = await import('fs')
    // Relative path — Windows abs paths lose backslashes in shellQuote tokens
    const tmp = '.tmp-sed-perm-preview.txt'
    writeFileSync(tmp, 'hello world\n')
    try {
      const selected = await selectBashPermissionDialog(
        confirm(BashTool, { command: `sed -i 's/hello/hi/' ${tmp}` }),
      )
      expect(selected?.spec.kind).toBe(PERMISSION_FILE_KIND)
      expect(selected?.descriptor).toMatchObject({
        title: 'Edit file',
        content: { kind: 'file-edit-diff' },
      })
    } finally {
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
  })

  test('Bash non-sed → permission_bash', async () => {
    const selected = await selectBashPermissionDialog(
      confirm(BashTool, { command: 'echo hi' }),
    )
    expect(selected?.spec.kind).toBe(PERMISSION_BASH_KIND)
    expect(selected?.descriptor).toMatchObject({ command: 'echo hi' })
  })

  test('sync selectPermissionDialog falls to prompt for Bash (not Fwl)', () => {
    const { spec } = selectPermissionDialog(
      confirm(BashTool, { command: 'ls' }),
    )
    expect(spec.kind).toBe(PERMISSION_PROMPT_KIND)
  })

  test('openPermissionDoo foo order: Bash → permission_bash', async () => {
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
    const pending = openPermissionDoo({
      requestDialog: createRequestDialog(mailbox),
      confirm: confirm(BashTool, { command: 'ls -la' }),
    })
    const top = store.getState().open.at(-1)
    // may need tick for async
    let kind = top?.kind
    for (let i = 0; i < 20 && kind !== PERMISSION_BASH_KIND; i++) {
      await Bun.sleep(0)
      kind = store.getState().open.at(-1)?.kind
    }
    expect(kind).toBe(PERMISSION_BASH_KIND)
    store.answer(store.getState().open.at(-1)!.id, { behavior: 'allow' })
    expect(await pending).toEqual({ behavior: 'allow' })
  })

  test('Skill / PowerShell / Ask still Fwl', () => {
    expect(
      selectPermissionDialogFwl(confirm(SkillTool, { skill: 'x' }))?.spec.kind,
    ).toBe(PERMISSION_SKILL_KIND)
    expect(
      selectPermissionDialogFwl(confirm(PowerShellTool, { command: 'g' }))?.spec
        .kind,
    ).toBe(PERMISSION_POWERSHELL_KIND)
    expect(
      selectPermissionDialogFwl(confirm(AskUserQuestionTool, { questions: [] }))
        ?.spec.kind,
    ).toBe(PERMISSION_ASK_USER_QUESTION_KIND)
  })
})

describe('queueBehind densable gate', () => {
  test('main session false; workerBadge true; forRemoteExecution true', () => {
    expect(
      shouldQueuePermissionBehind(confirm(BashTool, { command: 'x' })),
    ).toBe(false)
    expect(
      shouldQueuePermissionBehind({
        ...confirm(BashTool, { command: 'x' }),
        workerBadge: { name: 'w' },
      } as never),
    ).toBe(true)
    expect(
      shouldQueuePermissionBehind({
        ...confirm(BashTool, { command: 'x' }),
        toolUseContext: { forRemoteExecution: true },
      } as never),
    ).toBe(true)
  })
})

describe('permission + jsu kind registry', () => {
  test('isPermissionDialogKind covers pealed set', () => {
    for (const kind of PERMISSION_DIALOG_KINDS) {
      expect(isPermissionDialogKind(kind)).toBe(true)
    }
    expect(isPermissionDialogKind('managed_settings_security')).toBe(false)
  })

  test('DialogHost jsu registers all permission kinds', () => {
    for (const kind of PERMISSION_DIALOG_KINDS) {
      expect(DIALOG_COMPONENTS_KINDS_FOR_TEST).toContain(kind)
    }
    expect(DIALOG_COMPONENTS_KINDS_FOR_TEST).toContain(
      MANAGED_SETTINGS_SECURITY_KIND,
    )
  })

  test('DialogHost jsu registers full densable non-permission set', () => {
    for (const kind of JSU_NON_PERMISSION_KIND_LIST) {
      expect(DIALOG_COMPONENTS_KINDS_FOR_TEST).toContain(kind)
    }
    expect(JSU_NON_PERMISSION_KIND_LIST).toHaveLength(16)
  })
})
