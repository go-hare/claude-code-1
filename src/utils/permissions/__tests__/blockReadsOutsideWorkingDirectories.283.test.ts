import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod'

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { CLAUDE_FOLDER_PERMISSION_PATTERN } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import {
  getAllowRules,
  hasPermissionsToUseTool,
  isAutoModeDroppedHearthbotAllow,
} from '../permissions.js'
import {
  getCwdState,
  getOriginalCwd,
  getProjectRoot,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'
import {
  allWorkingDirectories,
  checkPathSafetyForAutoEdit,
  checkReadPermissionForTool,
  checkWritePermissionForTool,
  denyBlockedOutsideReadsForFileTool,
  pathInWorkingPath,
  shouldHonorAllowForServedCall,
  workingDirectoriesForOutsideReadFence,
  workingDirPathsForPermission,
} from '../filesystem.js'
import {
  AUTO_MODE_OUTSIDE_READS_KIND,
  blockedOutsideReadCwdMoveMessage,
  blockedOutsideReadFileToolMessage,
  blockedOutsideReadUserChoiceMessage,
  OUTSIDE_READS_ASK_AGAIN_REASON,
  OUTSIDE_READS_BLOCKED_REASON,
  outsideReadAskAgainDecision,
  getOutsideReadPrompt,
  isAutoModeOrPlanActingAsAuto,
  outsideReadsDialogPayload,
  OUTSIDE_READS_DIALOG_QUESTION,
  OUTSIDE_READS_DIALOG_TITLE,
  OUTSIDE_READS_OPTION_ALLOW,
  OUTSIDE_READS_OPTION_ASK_AGAIN,
  OUTSIDE_READS_OPTION_BLOCK,
  resetOutsideReadPromptForTests,
  settingsHaveBlockReadsOutsideWorkingDirectories,
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
  resetOutsideReadPromptForTests()
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
    expect(deny?.blockedPath).toBe(path)
  })

  test('gold qWn: served ask is gated on settingsHaveBlockReadsOutsideWorkingDirectories', () => {
    const src = readFileSync(join(import.meta.dir, '../filesystem.ts'), 'utf8')
    expect(src).toContain('!settingsHaveBlockReadsOutsideWorkingDirectories()')
    expect(src).toContain("circuitBreaker: 'outsideReadsBlocked'")
    expect(src).toContain('context.servedCall === true')
    expect(src).toContain('!context.restricted')
    expect(typeof settingsHaveBlockReadsOutsideWorkingDirectories).toBe(
      'function',
    )
    const path = '/etc/passwd'
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
      servedCall: true,
    }
    const decision = denyBlockedOutsideReadsForFileTool(path, ctx)
    expect(decision?.behavior === 'ask' || decision?.behavior === 'deny').toBe(
      true,
    )
    if (decision?.behavior === 'ask') {
      expect(decision.decisionReason).toMatchObject({
        type: 'safetyCheck',
        circuitBreaker: 'outsideReadsBlocked',
      })
    }
  })

  test('gold Vy: fence membership is caseFold false', () => {
    expect(
      pathInWorkingPath('/Secrets/token', '/secrets', {
        caseFold: false,
        uncShapeParity: true,
      }),
    ).toBe(false)
    expect(pathInWorkingPath('/secrets/token', '/secrets')).toBe(true)
  })

  test('gold Tp uncShapeParity: UNC spelling vs non-UNC working dir is outside', () => {
    expect(
      pathInWorkingPath('//server/share/file', '/tmp', {
        caseFold: false,
        uncShapeParity: true,
      }),
    ).toBe(false)
  })

  test('lL t6n: auto drops hearthbot FQN whole-tool allow, not chrome FQN', () => {
    expect(
      isAutoModeDroppedHearthbotAllow('mcp__hearthbot__update_memory'),
    ).toBe(true)
    expect(
      isAutoModeDroppedHearthbotAllow('mcp__claude-in-chrome__navigate'),
    ).toBe(false)
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        userSettings: [
          'mcp__hearthbot__update_memory',
          'mcp__claude-in-chrome__navigate',
        ],
      },
    }
    expect(
      getAllowRules({ ...ctx, mode: 'auto' }).map(r => r.ruleValue.toolName),
    ).toEqual(['mcp__claude-in-chrome__navigate'])
    expect(
      getAllowRules({ ...ctx, mode: 'default' }).map(r => r.ruleValue.toolName),
    ).toEqual([
      'mcp__hearthbot__update_memory',
      'mcp__claude-in-chrome__navigate',
    ])
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
      expect(result.decisionReason.circuitBreaker).toBe('outsideReadsBlocked')
      expect(result.decisionReason.classifierApprovable).toBe(false)
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

  test('yBt xa: plan + auto-mode active stamps DualInk; plan inactive does not', async () => {
    const autoMode = await import('../autoModeState.js')
    autoMode._resetForTesting()
    const base = {
      toolName: FILE_READ_TOOL_NAME,
      hasPath: true,
      behavior: 'ask',
      decisionReasonType: 'workingDir',
      context: {
        mode: 'plan',
        shouldAvoidPermissionPrompts: false,
        blockReadsOutsideWorkingDirectories: false,
      },
      isNonInteractiveSession: false,
    }
    expect(isAutoModeOrPlanActingAsAuto('auto')).toBe(true)
    expect(isAutoModeOrPlanActingAsAuto('plan')).toBe(false)
    expect(isAutoModeOrPlanActingAsAuto('default')).toBe(false)
    expect(shouldOfferBlockOutsideReads(base)).toBe(false)
    autoMode.setAutoModeActive(true)
    expect(isAutoModeOrPlanActingAsAuto('plan')).toBe(true)
    // densable xa(e, s=true): served plan+auto does not count as auto
    expect(isAutoModeOrPlanActingAsAuto('plan', true)).toBe(false)
    expect(isAutoModeOrPlanActingAsAuto('auto', true)).toBe(true)
    expect(shouldOfferBlockOutsideReads(base)).toBe(true)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        context: { ...base.context, mode: 'default' },
      }),
    ).toBe(false)
    autoMode._resetForTesting()
  })

  test('yBt skips DualInk when servedCall or forRemoteExecution', () => {
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
        forRemoteExecution: true,
      }),
    ).toBe(false)
    expect(
      shouldOfferBlockOutsideReads({
        ...base,
        context: { ...base.context, servedCall: true },
      }),
    ).toBe(false)
  })

  test('yBt Et: isBgSession skips DualInk first-ask', () => {
    const src = readFileSync(
      join(import.meta.dir, '../outsideReads.ts'),
      'utf8',
    )
    expect(src).toContain('isBgSession() || isTeammate()')
  })

  test('yBt session latch: second toolUseId is blocked while first is open', () => {
    const base = {
      toolName: FILE_READ_TOOL_NAME,
      hasPath: true,
      behavior: 'ask' as const,
      decisionReasonType: 'workingDir',
      context: {
        mode: 'auto',
        shouldAvoidPermissionPrompts: false,
        blockReadsOutsideWorkingDirectories: false,
      },
      isNonInteractiveSession: false,
    }
    expect(shouldOfferBlockOutsideReads({ ...base, toolUseId: 'a' })).toBe(true)
    getOutsideReadPrompt().open('a')
    expect(shouldOfferBlockOutsideReads({ ...base, toolUseId: 'b' })).toBe(
      false,
    )
    expect(shouldOfferBlockOutsideReads(base)).toBe(false)
    expect(shouldOfferBlockOutsideReads({ ...base, toolUseId: 'a' })).toBe(true)
    getOutsideReadPrompt().closeFor('a')
    expect(shouldOfferBlockOutsideReads({ ...base, toolUseId: 'b' })).toBe(true)
    getOutsideReadPrompt().open('b')
    getOutsideReadPrompt().markAnswered()
    expect(shouldOfferBlockOutsideReads({ ...base, toolUseId: 'c' })).toBe(
      false,
    )
  })

  test('W() ask-again is behavior ask + gold reason, not cancelAndAbort', () => {
    const again = outsideReadAskAgainDecision()
    expect(again.behavior).toBe('ask')
    expect(again.message).toBe(
      'The user did not allow this read outside the working directories.',
    )
    expect(again.userFeedback).toBeUndefined()
    expect(again.decisionReason).toEqual({
      type: 'other',
      reason: OUTSIDE_READS_ASK_AGAIN_REASON,
    })
    const withFeedback = outsideReadAskAgainDecision({
      feedback: 'stay in cwd',
    })
    expect(withFeedback.message).toBe(
      'The user did not allow this read outside the working directories: stay in cwd',
    )
    expect(withFeedback.userFeedback).toBe('stay in cwd')
  })

  test('eval confined cwd is not realpathed (gold lke)', () => {
    const prev = process.env.CLAUDE_CODE_EVAL_CONFINED
    process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
    try {
      const cwd = suiteCwd
      expect(workingDirPathsForPermission(cwd)).toEqual([cwd])
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_EVAL_CONFINED
      else process.env.CLAUDE_CODE_EVAL_CONFINED = prev
    }
  })

  test('gold lke skips realpath for originalCwd, not getCwd after /cd', () => {
    const src = readFileSync(join(import.meta.dir, '../filesystem.ts'), 'utf8')
    expect(src).toContain('isEvalConfined() && path === getOriginalCwd()')
    expect(src).not.toContain('path === getCwd()')
    const prev = process.env.CLAUDE_CODE_EVAL_CONFINED
    process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
    try {
      setOriginalCwd(suiteCwd)
      setCwdState('/tmp')
      expect(workingDirPathsForPermission(suiteCwd)).toEqual([suiteCwd])
    } finally {
      setCwdState(suiteCwd)
      if (prev === undefined) delete process.env.CLAUDE_CODE_EVAL_CONFINED
      else process.env.CLAUDE_CODE_EVAL_CONFINED = prev
    }
  })

  test('Rfo persist writes session fence and sandboxRefreshed', () => {
    const src = readFileSync(
      join(import.meta.dir, '../outsideReads.ts'),
      'utf8',
    )
    expect(src).toContain('sandboxRefreshed')
    expect(src).toContain('setSessionToolPermissionContext')
    expect(src).toContain('SandboxManager.refreshConfig()')
    expect(src).toContain('hasSeenAutoModeOutsideReadPrompt')
  })

  test('KDt: servedCall skips implicit allow, not deny/ask', () => {
    expect(
      shouldHonorAllowForServedCall(
        { behavior: 'allow' },
        { servedCall: true },
      ),
    ).toBe(false)
    expect(
      shouldHonorAllowForServedCall({ behavior: 'deny' }, { servedCall: true }),
    ).toBe(true)
    expect(
      shouldHonorAllowForServedCall({ behavior: 'ask' }, { servedCall: true }),
    ).toBe(true)
    expect(shouldHonorAllowForServedCall({ behavior: 'allow' }, {})).toBe(true)
    expect(
      shouldHonorAllowForServedCall(
        { behavior: 'allow' },
        { servedCall: 'true' as unknown as boolean },
      ),
    ).toBe(true)
  })

  test('lL xa(servedCall): plan+auto served keeps broad allow rules', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain('context.servedCall === true')
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: { userSettings: ['Bash'] },
    }
    // xa(mode=auto, served=true) is still auto — broad allow is filtered.
    expect(
      getAllowRules({
        ...ctx,
        mode: 'auto',
        servedCall: true,
      }).map(r => r.ruleValue.toolName),
    ).toEqual([])
    // xa(mode=plan, served=true) is not auto — broad allow is kept.
    expect(
      getAllowRules({
        ...ctx,
        mode: 'plan',
        servedCall: true,
      }).map(r => r.ruleValue.toolName),
    ).toEqual(['Bash'])
  })

  test('NHo XH: dontAsk and consecutive-denial use effective mode', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain(
      "if (effectiveModeForAuto === 'dontAsk' && !chromeAlwaysAllowAuto)",
    )
    expect(src).not.toContain(
      "if (layeredPermissionContext.mode === 'dontAsk')",
    )
    expect(src).toContain(
      "getEffectivePermissionMode(tool, layeredPermissionContext) === 'auto'",
    )
    expect(src).not.toContain("layeredMode === 'auto'")
  })

  test('NHo DualInk yBt is inside auto after requiresUserInteraction', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    const autoEntry = src.indexOf('isAutoModeOrPlanActingAsAuto(')
    const requires = src.indexOf('tool.requiresUserInteraction?.()')
    const dualInk = src.indexOf('shouldOfferBlockOutsideReads({')
    const outsidePrompt = src.indexOf("'outside_read_first_prompt'")
    expect(autoEntry).toBeGreaterThan(-1)
    expect(requires).toBeGreaterThan(autoEntry)
    expect(dualInk).toBeGreaterThan(requires)
    expect(outsidePrompt).toBeGreaterThan(dualInk)
    expect(src.split('shouldOfferBlockOutsideReads({').length).toBe(2)
  })

  test('NHo Fe: xHo && Ale wrap chromeAlwaysAllowAuto', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain(
      'isChromeFamilyClassifierEligible(tool, layeredPermissionContext)',
    )
    expect(src).toContain(
      'toolAlwaysAllowedRule(layeredPermissionContext, tool) !== null',
    )
    expect(src).toContain('chromeAlwaysAllowAuto')
    expect(src).toContain('||\n        chromeAlwaysAllowAuto)')
    expect(src).toContain('chromeCommandBypassesDontAsk(result)')
    expect(src).toContain('context.hookAskFloor === true')
  })

  test('NHo br: acceptEdits fastpath skips only when effective mode is plan', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain(
      "effectiveModeForAuto === 'plan' || isServerHeldClassifierAsk(result)",
    )
    expect(src).not.toContain("layeredPermissionContext.mode === 'plan' ||")
  })

  test('BTe: plan is auto-context only when bypass is not listable', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain('context.isBypassPermissionsModeAvailable !== true')
    expect(src).not.toContain("context.prePlanMode !== 'bypassPermissions'")
  })

  test('NHo xa(effectiveMode, servedCall): plan+served is not auto', async () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain('isAutoModeOrPlanActingAsAuto(')
    expect(src).toContain('layeredPermissionContext.servedCall === true')
    expect(src).not.toContain('const planActingAsAuto =')
    const autoMode = await import('../autoModeState.js')
    autoMode._resetForTesting()
    autoMode.setAutoModeActive(true)
    try {
      expect(isAutoModeOrPlanActingAsAuto('plan')).toBe(true)
      expect(isAutoModeOrPlanActingAsAuto('plan', true)).toBe(false)
      expect(isAutoModeOrPlanActingAsAuto('auto', true)).toBe(true)
    } finally {
      autoMode._resetForTesting()
    }
  })

  test('served && !restricted: deny→ask (local qWn host absent ⇒ !qWn)', () => {
    const path = '/etc/passwd'
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
      servedCall: true,
    }
    const result = denyBlockedOutsideReadsForFileTool(path, ctx)
    expect(result?.behavior).toBe('ask')
    if (result?.behavior === 'ask') {
      expect(result.decisionReason).toEqual({
        type: 'safetyCheck',
        reason: OUTSIDE_READS_BLOCKED_REASON,
        classifierApprovable: false,
        circuitBreaker: 'outsideReadsBlocked',
      })
      expect(result.message).toBe(blockedOutsideReadFileToolMessage(path))
    }
    const restricted = denyBlockedOutsideReadsForFileTool(path, {
      ...ctx,
      restricted: true,
    })
    expect(restricted?.behavior).toBe('deny')
    const notStrictTrue = denyBlockedOutsideReadsForFileTool(path, {
      ...ctx,
      servedCall: 'true' as unknown as boolean,
    })
    expect(notStrictTrue?.behavior).toBe('deny')
  })

  test('checkReadPermissionForTool served maps the fence to ask', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
      servedCall: true,
    }
    const tool = {
      name: FILE_READ_TOOL_NAME,
      getPath: () => '/etc/hosts',
    }
    const result = checkReadPermissionForTool(tool as never, {}, ctx)
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.decisionReason).toMatchObject({
        type: 'safetyCheck',
        circuitBreaker: 'outsideReadsBlocked',
      })
    }
  })

  test('Aln: projectSettings additionalDirectories do not skip the read fence', () => {
    const secret = '/secrets/token'
    const dirs = new Map([
      ['/secrets', { path: '/secrets', source: 'projectSettings' as const }],
    ])
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
      additionalWorkingDirectories: dirs,
    }
    expect([...allWorkingDirectories(ctx)]).toContain('/secrets')
    expect([...workingDirectoriesForOutsideReadFence(ctx)]).not.toContain(
      '/secrets',
    )
    const deny = denyBlockedOutsideReadsForFileTool(secret, ctx)
    expect(deny?.behavior).toBe('deny')
    const tool = {
      name: FILE_READ_TOOL_NAME,
      getPath: () => secret,
    }
    expect(checkReadPermissionForTool(tool as never, {}, ctx).behavior).toBe(
      'deny',
    )
    const allowed = isPathAllowed(secret, ctx, 'read')
    expect(allowed.allowed).toBe(false)
    expect(allowed.decisionReason).toMatchObject({
      type: 'safetyCheck',
      circuitBreaker: 'outsideReadsBlocked',
    })
  })

  test('Aln: userSettings additionalDirectories still skip the read fence', () => {
    const secret = '/secrets/token'
    const dirs = new Map([
      ['/secrets', { path: '/secrets', source: 'userSettings' as const }],
    ])
    const ctx = {
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
      additionalWorkingDirectories: dirs,
    }
    expect([...workingDirectoriesForOutsideReadFence(ctx)]).toContain(
      '/secrets',
    )
    expect(denyBlockedOutsideReadsForFileTool(secret, ctx)).toBeNull()
    const tool = {
      name: FILE_READ_TOOL_NAME,
      getPath: () => secret,
    }
    expect(checkReadPermissionForTool(tool as never, {}, ctx).behavior).toBe(
      'allow',
    )
    expect(isPathAllowed(secret, ctx, 'read').allowed).toBe(true)
  })

  test('a6n: /net automount asks even when userSettings additional covers it', () => {
    const path = '/net/host/secret'
    const dirs = new Map([
      ['/net', { path: '/net', source: 'userSettings' as const }],
    ])
    const ctx = {
      ...getEmptyToolPermissionContext(),
      additionalWorkingDirectories: dirs,
    }
    const tool = { name: FILE_READ_TOOL_NAME, getPath: () => path }
    const result = checkReadPermissionForTool(tool as never, {}, ctx)
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.decisionReason).toEqual({
        type: 'other',
        reason: 'Automount -hosts path detected (defense-in-depth check)',
      })
    }
  })

  test('a6n: trusted UNC alias is not asked; untrusted UNC is asked', () => {
    const path = '//fileserver/share/proj/src'
    const tool = { name: FILE_READ_TOOL_NAME, getPath: () => path }
    const untrusted = checkReadPermissionForTool(
      tool as never,
      {},
      getEmptyToolPermissionContext(),
    )
    expect(untrusted.behavior).toBe('ask')
    if (untrusted.behavior === 'ask') {
      expect(untrusted.decisionReason).toEqual({
        type: 'other',
        reason: 'UNC path detected (defense-in-depth check)',
      })
    }
    const trusted = checkReadPermissionForTool(
      tool as never,
      {},
      {
        ...getEmptyToolPermissionContext(),
        additionalWorkingDirectories: new Map([
          [
            '//fileserver/share/proj',
            {
              path: '//fileserver/share/proj',
              source: 'userSettings' as const,
            },
          ],
        ]),
        trustedNetworkDirectories: new Map([
          ['Z:\\proj', ['Z:\\proj', '//fileserver/share/proj']],
        ]),
      },
    )
    expect(trusted.behavior).toBe('allow')
  })

  test('a6n: WSL UNC is not treated as a network share', () => {
    const path = '//wsl$/Ubuntu/home/u/file'
    const ctx = {
      ...getEmptyToolPermissionContext(),
      additionalWorkingDirectories: new Map([
        [
          '//wsl$/Ubuntu/home/u',
          { path: '//wsl$/Ubuntu/home/u', source: 'userSettings' as const },
        ],
      ]),
    }
    const tool = { name: FILE_READ_TOOL_NAME, getPath: () => path }
    expect(checkReadPermissionForTool(tool as never, {}, ctx).behavior).toBe(
      'allow',
    )
  })

  test('a6n: deny rule still wins over UNC ask', () => {
    const path = '//fileserver/share/secret'
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { userSettings: [`Read(${path})`] },
    }
    const tool = { name: FILE_READ_TOOL_NAME, getPath: () => path }
    const result = checkReadPermissionForTool(tool as never, {}, ctx)
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.decisionReason.type).toBe('rule')
    }
  })

  test('NS: session .claude allow skips when nested .claude after cwd (Xa>1)', () => {
    const nested = join(suiteCwd, '.claude', '.claude', 'settings.json')
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        session: [`Edit(${CLAUDE_FOLDER_PERMISSION_PATTERN})`],
      },
    }
    const tool = {
      name: 'Edit',
      getPath: () => nested,
    }
    const result = checkWritePermissionForTool(tool as never, {}, ctx)
    expect(result.behavior).not.toBe('allow')
  })

  test('NS: session .claude allow still fires for a single .claude segment', () => {
    const path = join(suiteCwd, '.claude', 'settings.json')
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        session: [`Edit(${CLAUDE_FOLDER_PERMISSION_PATTERN})`],
      },
    }
    const tool = {
      name: 'Edit',
      getPath: () => path,
    }
    const result = checkWritePermissionForTool(tool as never, {}, ctx)
    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.decisionReason?.type).toBe('rule')
    }
  })

  test('uK TX: 8.3 short name is suspiciousWindowsPath', () => {
    const result = checkPathSafetyForAutoEdit('/tmp/GIT~1/file.ts')
    expect(result.safe).toBe(false)
    if (!result.safe) {
      expect(result.circuitBreaker).toBe('suspiciousWindowsPath')
    }
  })

  test('uK TX: trusted UNC is not suspiciousWindowsPath', () => {
    const path = '//fileserver/share/proj/src/file.ts'
    const trusted = new Map<string, readonly string[]>([
      ['Z:\\proj', ['Z:\\proj', '//fileserver/share/proj']],
    ])
    const untrusted = checkPathSafetyForAutoEdit(path)
    const honoured = checkPathSafetyForAutoEdit(path, undefined, trusted)
    if (
      !untrusted.safe &&
      untrusted.circuitBreaker === 'suspiciousWindowsPath'
    ) {
      expect(
        honoured.safe || honoured.circuitBreaker !== 'suspiciousWindowsPath',
      ).toBe(true)
      return
    }
    // darwin: // may hit isDangerousFilePathToAutoEdit before TX.
    expect(untrusted.safe).toBe(false)
  })

  test('pct: symlink-leaf write is deny after NS (gold FileWrite h=NS; pct??h)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xl-write-'))
    const link = join(dir, 'passwd-link')
    try {
      symlinkSync('/etc/passwd', link)
    } catch {
      return
    }
    setCwdState(dir)
    setOriginalCwd(dir)
    const tool = { name: 'Write', getPath: () => link }
    const result = checkWritePermissionForTool(
      tool as never,
      {},
      getEmptyToolPermissionContext(),
    )
    // leftover DualInk expected ask; gold pct after NS denies the symlink leaf.
    expect(result.behavior).toBe('deny')
    if (result.behavior !== 'deny') return
    expect(result.message).toContain('it is a symbolic link')
    expect(result.blockedPath).toBeTruthy()
    expect(result.message).toContain(String(result.blockedPath))
  })

  test('xl: carried-out symlink read ask is workingDir + blockedPath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xl-read-'))
    const link = join(dir, 'passwd-link')
    try {
      symlinkSync('/etc/passwd', link)
    } catch {
      return
    }
    setCwdState(dir)
    setOriginalCwd(dir)
    const tool = { name: FILE_READ_TOOL_NAME, getPath: () => link }
    const result = checkReadPermissionForTool(
      tool as never,
      {},
      getEmptyToolPermissionContext(),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.blockedPath).toBe('/etc/passwd')
      expect(result.decisionReason?.type).toBe('workingDir')
      expect(result.message).toContain(
        'resolves through a symlink to /etc/passwd',
      )
    }
  })

  test('NHo DualInk: session auto + MCP dontAsk does not stamp', async () => {
    const result = await hasPermissionsToUseTool(
      makeOutsideReadAskTool({
        mcpInfo: { serverName: 'acme', toolName: 'read' },
      }),
      { file_path: '/etc/hosts' },
      makeAskContext({
        mode: 'auto',
        mcpPermissionModeOverrides: { acme: 'dontAsk' },
      }),
      dummyAssistant,
      'tu_dontask',
    )
    expect(result.behavior).toBe('deny')
    expect(result.decisionReason).toEqual({ type: 'mode', mode: 'dontAsk' })
    expect(result.offersBlockOutsideReads).toBeUndefined()
  })
})

const dummyAssistant = {} as AssistantMessage

function makeAskContext(extra: {
  mode: 'auto' | 'dontAsk' | 'default'
  mcpPermissionModeOverrides?: Record<string, 'dontAsk' | 'default' | 'auto'>
}): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: extra.mode,
    shouldAvoidPermissionPrompts: false,
    blockReadsOutsideWorkingDirectories: false,
    ...(extra.mcpPermissionModeOverrides
      ? { mcpPermissionModeOverrides: extra.mcpPermissionModeOverrides }
      : {}),
  }
  return {
    getAppState: () =>
      ({
        toolPermissionContext,
        mcp: { tools: [] },
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
  } as unknown as ToolUseContext
}

function makeOutsideReadAskTool(extra?: {
  mcpInfo?: { serverName: string; toolName: string }
}): Tool {
  return {
    name: FILE_READ_TOOL_NAME,
    inputSchema: z.object({ file_path: z.string() }),
    getPath: (input: { file_path?: string }) => input.file_path,
    ...(extra?.mcpInfo ? { mcpInfo: extra.mcpInfo } : {}),
    checkPermissions: async () => ({
      behavior: 'ask' as const,
      message: 'outside',
      decisionReason: {
        type: 'workingDir' as const,
        reason: 'outside working directory',
      },
    }),
  } as unknown as Tool
}
