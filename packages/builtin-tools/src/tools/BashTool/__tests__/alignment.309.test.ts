import { beforeAll, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from 'src/Tool.js'
import { parseForSecurityFromAst } from 'src/utils/bash/ast.js'
import {
  ensureParserInitialized,
  getParserModule,
} from 'src/utils/bash/bashParser.js'
import { BashTool } from '../BashTool.js'
import {
  applyAssignedVariableGate,
  checkTooComplexRedirectDeny,
  isNormalizedCdCommand,
  isNormalizedGitCommand,
} from '../bashPermissions.js'
import { validateOutputRedirections } from '../pathValidation.js'
import { GITHUB_MENTION_RULE } from '../prompt.js'

beforeAll(async () => {
  await ensureParserInitialized()
})

function makeContext(
  alwaysAllowRules: string[] = [],
  alwaysDenyRules: Record<string, string[]> = {},
): ToolUseContext {
  const base = getEmptyToolPermissionContext()
  return {
    getAppState: () => ({
      toolPermissionContext: {
        ...base,
        mode: 'default',
        alwaysAllowRules: {
          ...base.alwaysAllowRules,
          userSettings: alwaysAllowRules,
        },
        alwaysDenyRules: {
          ...base.alwaysDenyRules,
          ...alwaysDenyRules,
        },
      },
    }),
  } as unknown as ToolUseContext
}

describe('#1122 Bash permission check does not auto-allow assigned/uncertain variables', () => {
  test('assigned variable read converts prefix allow to ask with bashMissKind assigned-variable', () => {
    const cmd = 'X=/tmp/foo > /tmp/out; echo "$X"'
    const mod = getParserModule()
    if (!mod) throw new Error('bashParser unavailable')
    const root = mod.parse(cmd)
    if (!root) throw new Error('mod.parse returned null')
    const astResult = parseForSecurityFromAst(cmd, root)
    const allowResult = {
      behavior: 'allow' as const,
      updatedInput: { command: cmd },
      decisionReason: {
        type: 'rule' as const,
        rule: {
          source: 'userSettings' as const,
          ruleBehavior: 'allow' as const,
          ruleValue: { toolName: 'Bash', ruleContent: 'echo:*' },
        },
      },
    }
    const res = applyAssignedVariableGate(cmd, allowResult, astResult)
    expect(res.behavior).toBe('ask')
    if (res.behavior === 'ask') {
      expect(res.decisionReason).toMatchObject({
        type: 'other',
        bashMissKind: 'assigned-variable',
      })
    }
  })

  test('uncertainWrite alone without usesAssignedValue does not convert allow to ask (SEA Vpn)', () => {
    const cmd = 'echo hello > /tmp/out'
    const allowResult = {
      behavior: 'allow' as const,
      updatedInput: { command: cmd },
      decisionReason: {
        type: 'rule' as const,
        rule: {
          source: 'userSettings' as const,
          ruleBehavior: 'allow' as const,
          ruleValue: { toolName: 'Bash', ruleContent: 'echo:*' },
        },
      },
    }
    const res = applyAssignedVariableGate(cmd, allowResult, {
      kind: 'simple',
      commands: [],
      bareAssignmentNames: [],
      uncertainWrite: true,
    })
    expect(res.behavior).toBe('allow')
  })
})

describe('#1123 wrapped/prefixed cd and git normalization', () => {
  test('detects cd/chdir with time + env var / command / builtin / noglob wrappers', () => {
    expect(isNormalizedCdCommand('time VAR=1 cd /tmp')).toBe(true)
    expect(isNormalizedCdCommand('command -p cd /tmp')).toBe(true)
    expect(isNormalizedCdCommand('builtin -- cd /tmp')).toBe(true)
    expect(isNormalizedCdCommand('noglob chdir /tmp')).toBe(true)
    expect(isNormalizedCdCommand('echo cd /tmp')).toBe(false)
  })

  test('detects git with time + env var / wrapper prefixes', () => {
    expect(isNormalizedGitCommand('time VAR=1 git status')).toBe(true)
    expect(isNormalizedGitCommand('time timeout 5 git status')).toBe(true)
  })
})

describe('#1124 Edit(path) deny rule blocks Bash redirects in cd-compound and subshell commands', () => {
  test('validateOutputRedirections returns deny before cd-compound-redirect ask', () => {
    const base = getEmptyToolPermissionContext()
    const ctx = {
      ...base,
      alwaysDenyRules: {
        ...base.alwaysDenyRules,
        userSettings: ['Edit(//tmp/forbidden.txt)'],
      },
    }
    const res = validateOutputRedirections(
      [{ target: '/tmp/forbidden.txt', operator: '>' }],
      '/tmp',
      ctx,
      true,
    )
    expect(res.behavior).toBe('deny')
  })

  test('subshell command with redirect to Edit-denied path returns deny instead of too-complex ask', () => {
    const cmd = '(echo hello) > /tmp/forbidden.txt'
    const mod = getParserModule()
    if (!mod) throw new Error('bashParser unavailable')
    const root = mod.parse(cmd)
    const ctx = makeContext([], { userSettings: ['Edit(//tmp/forbidden.txt)'] })
    const res = checkTooComplexRedirectDeny(
      root,
      cmd,
      ctx.getAppState().toolPermissionContext,
    )
    expect(res).not.toBeNull()
    expect(res?.behavior).toBe('deny')
  })
})

describe('#1156 GitHub @mention rule in BashTool prompt', () => {
  test('GITHUB_MENTION_RULE is exported and included in BashTool prompt', async () => {
    expect(GITHUB_MENTION_RULE).toContain('@human')
    expect(GITHUB_MENTION_RULE).toContain('@reviewer')
    expect(GITHUB_MENTION_RULE).toContain('@types/node')
    const promptText = await BashTool.prompt()
    expect(promptText).toContain(GITHUB_MENTION_RULE)
  })
})

describe('#1169 sed -i uses standard Bash name instead of simulated file-edit', () => {
  test('userFacingName returns Bash for sed -i', () => {
    expect(
      BashTool.userFacingName({ command: "sed -i 's/foo/bar/' file.txt" }),
    ).toBe('Bash')
  })
})
