import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'path'

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  getCwdState,
  getOriginalCwd,
  getProjectRoot,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'
import {
  checkReadPermissionForTool,
  denyBlockedOutsideReadsForFileTool,
} from '../filesystem.js'
import {
  AUTO_MODE_OUTSIDE_READS_KIND,
  blockedOutsideReadCwdMoveMessage,
  blockedOutsideReadFileToolMessage,
  blockedOutsideReadUserChoiceMessage,
  outsideReadsDialogPayload,
  OUTSIDE_READS_DIALOG_QUESTION,
  OUTSIDE_READS_DIALOG_TITLE,
  OUTSIDE_READS_OPTION_ALLOW,
  OUTSIDE_READS_OPTION_ASK_AGAIN,
  OUTSIDE_READS_OPTION_BLOCK,
  shouldOfferBlockOutsideReads,
} from '../outsideReads.js'
import { PermissionsSchema } from '../../settings/types.js'
import { isPathAllowed } from '../pathValidation.js'

const suiteCwd = process.cwd()
let prevCwd: string
let prevOriginal: string
let prevProject: string

beforeEach(() => {
  try {
    prevCwd = getCwdState()
  } catch {
    prevCwd = suiteCwd
  }
  try {
    prevOriginal = getOriginalCwd()
  } catch {
    prevOriginal = suiteCwd
  }
  try {
    prevProject = getProjectRoot()
  } catch {
    prevProject = suiteCwd
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setProjectRoot(suiteCwd)
})

afterEach(() => {
  try {
    setCwdState(prevCwd ?? suiteCwd)
    setOriginalCwd(prevOriginal ?? suiteCwd)
    setProjectRoot(prevProject ?? suiteCwd)
  } catch {
    // ignore
  }
})

describe('permissions.blockReadsOutsideWorkingDirectories (2.1.283)', () => {
  test('PermissionsSchema accepts the boolean', () => {
    const parsed = PermissionsSchema().safeParse({
      blockReadsOutsideWorkingDirectories: true,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.blockReadsOutsideWorkingDirectories).toBe(true)
    }
  })

  test('dialog copy is gold auto_mode_outside_reads Yes/Block/ask_again', () => {
    expect(AUTO_MODE_OUTSIDE_READS_KIND).toBe('auto_mode_outside_reads')
    const payload = outsideReadsDialogPayload({
      toolName: FILE_READ_TOOL_NAME,
      path: '/tmp/secret',
      sandboxFenced: true,
    })
    expect(payload.title).toBe(OUTSIDE_READS_DIALOG_TITLE)
    expect(payload.question).toBe(OUTSIDE_READS_DIALOG_QUESTION)
    expect(payload.options.map(o => o.value)).toEqual([
      'allow',
      'block',
      'ask_again',
    ])
    expect(payload.options[0]?.label).toBe(OUTSIDE_READS_OPTION_ALLOW)
    expect(payload.options[1]?.label).toBe(OUTSIDE_READS_OPTION_BLOCK)
    expect(payload.options[2]?.label).toBe(OUTSIDE_READS_OPTION_ASK_AGAIN)
    expect(payload.explainer).toContain(
      'Auto mode and the sandbox read outside the working directories without asking',
    )
    expect(payload.explainer).toContain(
      'permissions.blockReadsOutsideWorkingDirectories',
    )
  })

  test('file-tool deny uses gold copy', () => {
    const path = '/etc/passwd'
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
    }
    const deny = denyBlockedOutsideReadsForFileTool(path, ctx)
    expect(deny?.behavior).toBe('deny')
    expect(deny?.message).toBe(blockedOutsideReadFileToolMessage(path))
    expect(deny?.message).toContain(
      'permissions.blockReadsOutsideWorkingDirectories',
    )
  })

  test('file-tool deny does not fire inside the working directory', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
    }
    expect(
      denyBlockedOutsideReadsForFileTool(join(suiteCwd, 'src/main.tsx'), ctx),
    ).toBeNull()
  })

  test('checkReadPermissionForTool denies an outside path when the setting is on', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
    }
    const tool = {
      name: FILE_READ_TOOL_NAME,
      getPath: () => '/etc/hosts',
    }
    const result = checkReadPermissionForTool(tool as never, {}, ctx)
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain(
        'reads outside them are blocked (permissions.blockReadsOutsideWorkingDirectories)',
      )
    }
  })

  test('isPathAllowed maps the fence to the gold safetyCheck reason', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
    }
    const result = isPathAllowed('/etc/hosts', ctx, 'read')
    expect(result.allowed).toBe(false)
    expect(result.decisionReason?.type).toBe('safetyCheck')
    if (result.decisionReason?.type === 'safetyCheck') {
      expect(result.decisionReason.reason).toContain(
        'permissions.blockReadsOutsideWorkingDirectories',
      )
    }
  })

  test('cwd-move copy matches gold', () => {
    expect(blockedOutsideReadCwdMoveMessage('cd')).toContain(
      'moves later reads to a directory outside the working directories',
    )
  })

  test('user Block persist-fail suffix is gold', () => {
    expect(
      blockedOutsideReadUserChoiceMessage({ saveError: 'EACCES' }),
    ).toContain('the setting could not be saved to user settings (EACCES)')
  })

  test('shouldOfferBlockOutsideReads is auto first-ask only', () => {
    const base = {
      toolName: FILE_READ_TOOL_NAME,
      hasPath: true,
      behavior: 'ask',
      decisionReasonType: 'workingDir',
      context: {
        mode: 'auto',
        shouldAvoidPermissionPrompts: false,
        blockReadsOutsideWorkingDirectories: false,
      },
      isNonInteractiveSession: false,
    }
    expect(shouldOfferBlockOutsideReads(base)).toBe(true)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        toolName: GREP_TOOL_NAME,
      }),
    ).toBe(true)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        context: { ...base.context, mode: 'default' },
      }),
    ).toBe(false)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        context: {
          ...base.context,
          blockReadsOutsideWorkingDirectories: true,
        },
      }),
    ).toBe(false)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        context: {
          ...base.context,
          shouldAvoidPermissionPrompts: true,
        },
      }),
    ).toBe(false)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        isNonInteractiveSession: true,
      }),
    ).toBe(false)
  })
})
