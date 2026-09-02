/**
 * densable Iiu / Jiu / Wou / Cmy / tyy / Mhy / Vru / teu mailbox helpers (239 SEA).
 *
 * Do not render DialogHost. Gold: myy/yyy/_yy/hyy/gyy; _gy/vgy/Sgy/bgy;
 * Vgy/sLo/Riu/qgy; $Oo/EMs/Y$A/Vru/teu. Wou bgy via S3+EFA (no fake labels).
 * Jiu hyy/gyy + Hnu Lmy mint via S3. Cmy jNA / tyy lUA + Xxs seed.
 * Iiu/Cmy m0n workflow-agent auto-mode. teu DualInk local Lcy (no storageV5/tn).
 * Ynu has no cancelFirst.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { SKILL_TOOL_NAME } from '@claude-code/builtin-tools/tools/SkillTool/constants.js'
import {
  ConsentRow,
  mintConsentRow,
  mintPrefixConsentRow,
  MONITOR_DISPLAYED_TYPES,
  renderMonitorSuggestionsLabel,
  sanitizeEditablePrefix,
} from '../consentRow.js'
import {
  type AskUserQuestionPermissionPayload,
  buildAskUserQuestionAnnotations,
  formatAskUserQuestionAnswer,
  formatAskUserQuestionChatAboutFeedback,
  formatAskUserQuestionSkipInterviewFeedback,
  mapOfyPreview,
  normalizeAskQuestions,
  OFY_PREVIEW_CAP,
  resolveAskUserQuestionDeny,
  resolveAskUserQuestionSubmit,
  toDualInkQuestions,
} from '../permissionAsk.js'
import {
  bashCommandTitle,
  type BashPermissionPayload,
  bashPrefixUpdates,
  buildBashSuggestionsRow,
  isBashAlwaysAllowVetoed,
  isBashCommandWithheld,
  resolveBashPermissionAnswer,
  seedBashEditablePrefix,
  shouldShowBashPersistentAllow,
  shouldShowBashSuggestions,
} from '../permissionBash.js'
import { APPROVAL_WITHHELD_MARKER } from '../permissionBrowser.js'
import {
  buildExitPlanKeepContext,
  EXIT_PLAN_EMPTY_FALLBACK,
  EXIT_PLAN_RESUME_LABEL,
  offerExitPlanResumeAuto,
  type ExitPlanModePermissionPayload,
  exitPlanDisplayText,
  isExitPlanEmpty,
  resolveExitPlanKeepContextAnswer,
  resolveExitPlanModeAnswer,
} from '../permissionExitPlan.js'
import {
  CLAUDE_FOLDER_STANDING_LABEL,
  type FilePermissionPayload,
  filePermissionDialogTitle,
  formatFilePermissionQuestion,
  isFileStandingRowVetoed,
  mintFileStandingRow,
  resolveFilePermissionAnswer,
} from '../permissionFile.js'
import {
  buildMonitorSuggestionsRow,
  isMonitorAlwaysAllowVetoed,
  isMonitorPreviewWithheld,
  type MonitorPermissionPayload,
  resolveMonitorPermissionAnswer,
  shouldShowMonitorSuggestions,
} from '../permissionMonitor.js'
import {
  type PowerShellPermissionPayload,
  buildPowerShellSuggestionsRow,
  isPowerShellAlwaysAllowVetoed,
  isPowerShellCommandWithheld,
  resolvePowerShellPermissionAnswer,
  seedPowerShellEditablePrefix,
  shouldShowPowerShellPersistentAllow,
  shouldShowPowerShellSuggestions,
} from '../permissionPowerShell.js'
import {
  buildPromptDontAskAgainRow,
  formatPromptDescription,
  isPromptAlwaysAllowVetoed,
  type PromptPermissionPayload,
  resolvePromptPermissionAnswer,
  shouldShowPromptAlwaysAllow,
} from '../permissionPromptIiu.js'
import {
  buildSkillExactAllowRow,
  buildSkillPrefixAllowRow,
  extractSkillPrefix,
  resolveSkillPermissionAnswer,
  type SkillPermissionPayload,
  shouldShowSkillExactAllow,
  shouldShowSkillPrefixAllow,
} from '../permissionSkill.js'

const skillPayload = (
  extra: Partial<SkillPermissionPayload> = {},
): SkillPermissionPayload => ({
  requestId: 'r',
  toolName: SKILL_TOOL_NAME,
  permissionResult: { behavior: 'ask' },
  skill: '/review foo',
  input: { skill: '/review foo' },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

const monitorPayload = (
  extra: Partial<MonitorPermissionPayload> = {},
): MonitorPermissionPayload => ({
  requestId: 'r',
  toolName: 'Monitor',
  permissionResult: { behavior: 'ask' },
  intervalMs: 0,
  input: { command: 'tail -f x' },
  command: { kind: 'full', text: 'tail -f x', needsGutter: false },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

const promptPayload = (
  extra: Partial<PromptPermissionPayload> = {},
): PromptPermissionPayload => ({
  requestId: 'r',
  toolName: 'Glob',
  userFacingName: 'Glob',
  permissionResult: { behavior: 'ask' },
  input: { pattern: '*' },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

describe('Jiu myy / yyy / _yy / byy', () => {
  test('yes allow; exact/prefix addRules Skill localSettings; invalid degrades; no deny', () => {
    const payload = skillPayload()
    const exactRow = buildSkillExactAllowRow(payload)
    const prefixRow = buildSkillPrefixAllowRow(payload)
    expect(ConsentRow.is(exactRow)).toBe(true)
    expect(ConsentRow.is(prefixRow)).toBe(true)
    expect(exactRow?.applies).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: SKILL_TOOL_NAME, ruleContent: '/review foo' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    expect(prefixRow?.applies).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: SKILL_TOOL_NAME, ruleContent: '/review:*' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    expect(
      resolveSkillPermissionAnswer('yes', payload, { exactRow, prefixRow }),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(
      resolveSkillPermissionAnswer('yes-exact', payload, {
        exactRow,
        prefixRow,
      }),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: [...exactRow!.applies],
    })
    expect(
      resolveSkillPermissionAnswer('yes-prefix', payload, {
        exactRow,
        prefixRow,
      }),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: [...prefixRow!.applies],
    })
    expect(
      resolveSkillPermissionAnswer('yes-exact', payload, {
        exactRow: null,
        prefixRow,
      }),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(
      resolveSkillPermissionAnswer('no', payload, { exactRow, prefixRow }),
    ).toEqual({ behavior: 'deny' })
  })

  test('Syy / yyy / _yy / byy gates', () => {
    expect(shouldShowSkillExactAllow(skillPayload())).toBe(true)
    expect(shouldShowSkillPrefixAllow(skillPayload())).toBe(true)
    expect(shouldShowSkillExactAllow(skillPayload({ skill: 'review:*' }))).toBe(
      false,
    )
    expect(extractSkillPrefix('review')).toBe(null)
    expect(extractSkillPrefix('review:* rest')).toBe(null)
    expect(extractSkillPrefix('/review foo')).toBe('/review')
    expect(
      shouldShowSkillExactAllow(skillPayload({ showAlwaysAllow: false })),
    ).toBe(false)
    expect(
      shouldShowSkillExactAllow(skillPayload({ isAskCappedByOrg: true })),
    ).toBe(false)
  })

  test('hyy S3: Wce-null skill does not mint', () => {
    expect(buildSkillExactAllowRow(skillPayload({ skill: '   ' }))).toBe(null)
  })

  test('hyy/gyy source-lock S3 mint', () => {
    const src = readFileSync(
      join(import.meta.dir, '../permissionSkill.ts'),
      'utf8',
    )
    expect(src).toContain('mintConsentRow')
    expect(src).toContain('displayedTypes: SKILL_DAA_TYPES')
    expect(src).toContain('toTildePath')
    expect(src).not.toContain('stand-in')
  })
})

describe('Wou _gy / vgy / Sgy / bgy', () => {
  test('yes allow; schema-invalid suggestions stay null; S3 mints EFA; no deny', () => {
    const payload = monitorPayload()
    expect(buildMonitorSuggestionsRow(payload)).toBe(null)
    expect(
      buildMonitorSuggestionsRow(
        monitorPayload({
          permissionResult: {
            behavior: 'ask',
            suggestions: [{ type: 'addRules' }],
          },
        }),
      ),
    ).toBe(null)
    const minted = buildMonitorSuggestionsRow(
      monitorPayload({
        permissionResult: {
          behavior: 'ask',
          suggestions: [
            {
              type: 'addRules',
              rules: [{ toolName: 'Monitor' }],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ],
        },
      }),
    )
    expect(minted?.applies).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Monitor' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    const dirs = buildMonitorSuggestionsRow(
      monitorPayload({
        permissionResult: {
          behavior: 'ask',
          suggestions: [
            {
              type: 'addDirectories',
              directories: ['/tmp/proj'],
              destination: 'session',
            },
          ],
        },
      }),
    )
    expect(dirs?.applies).toEqual([
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp/proj'],
      },
    ])
    expect(shouldShowMonitorSuggestions(payload)).toBe(true)
    expect(resolveMonitorPermissionAnswer('yes', payload, null)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(
      resolveMonitorPermissionAnswer('yes-apply-suggestions', payload, null),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(resolveMonitorPermissionAnswer('no', payload, null)).toEqual({
      behavior: 'deny',
    })
  })

  test('vgy ask-gated classifier; Sgy withheld hides suggestions', () => {
    expect(
      isMonitorAlwaysAllowVetoed(
        monitorPayload({
          permissionResult: {
            behavior: 'ask',
            decisionReason: {
              type: 'safetyCheck',
              reason: 'crit',
              classifierApprovable: false,
            },
          },
        }),
      ),
    ).toBe(true)
    expect(
      isMonitorAlwaysAllowVetoed(
        monitorPayload({
          permissionResult: {
            behavior: 'allow',
            decisionReason: {
              type: 'safetyCheck',
              reason: 'crit',
              classifierApprovable: false,
            },
          },
        }),
      ),
    ).toBe(false)
    expect(
      isMonitorPreviewWithheld(monitorPayload({ command: undefined })),
    ).toBe(true)
    expect(
      isMonitorPreviewWithheld(
        monitorPayload({
          command: { kind: 'withheld', marker: APPROVAL_WITHHELD_MARKER },
        }),
      ),
    ).toBe(true)
    expect(
      shouldShowMonitorSuggestions(
        monitorPayload({
          command: { kind: 'withheld', marker: APPROVAL_WITHHELD_MARKER },
        }),
      ),
    ).toBe(false)
    expect(
      isMonitorAlwaysAllowVetoed(
        monitorPayload({
          permissionResult: {
            behavior: 'ask',
            decisionReason: {
              type: 'subcommandResults',
              reasons: new Map([
                [
                  'nested',
                  {
                    behavior: 'ask',
                    decisionReason: {
                      type: 'safetyCheck',
                      reason: 'crit',
                      classifierApprovable: false,
                    },
                  },
                ],
              ]),
            },
          },
        }),
      ),
    ).toBe(true)
  })
})

describe('iJ0 / $bn / SFc', () => {
  const mintAddRules = (
    rules: Array<{ toolName: string; ruleContent?: string }>,
  ) =>
    mintConsentRow(
      [
        {
          type: 'addRules',
          rules,
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
      {
        displayedTypes: MONITOR_DISPLAYED_TYPES,
        renderLabel: renderMonitorSuggestionsLabel,
      },
    )

  test('SFc keeps round-trippable ruleContent; drops empty and *', () => {
    expect(
      mintAddRules([{ toolName: 'Bash', ruleContent: 'ls' }])?.applies[0],
    ).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
      behavior: 'allow',
      destination: 'localSettings',
    })
    expect(mintAddRules([{ toolName: 'Bash', ruleContent: '' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'Bash', ruleContent: '*' }])).toBe(null)
  })

  test('$bn rejects pjt, wildcard tool name, and mcp server-only', () => {
    expect(mintAddRules([{ toolName: '(invalid tool name)' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'Bash*' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'mcp__github' }])).toBe(null)
    expect(
      mintAddRules([{ toolName: 'mcp__github__list_issues' }])?.applies[0],
    ).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'mcp__github__list_issues' }],
      behavior: 'allow',
      destination: 'localSettings',
    })
  })

  test('$bn aJ0 rejects Wwe / _g unicode', () => {
    expect(mintAddRules([{ toolName: 'Bash\u200b' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'Bash\u202e' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'Bash\u2800' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'Bash\u0001' }])).toBe(null)
    expect(mintAddRules([{ toolName: 'Bash' }])?.applies[0]).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'Bash' }],
      behavior: 'allow',
      destination: 'localSettings',
    })
    expect(mintAddRules([{ toolName: 'A'.repeat(5000) }])).toBe(null)
  })
})

describe('Iiu Vgy / sLo / Riu / qgy', () => {
  test('yes allow; DAA addRules toolName only; invalid degrades; no deny', () => {
    const payload = promptPayload()
    const row = buildPromptDontAskAgainRow(payload, {
      cwd: '/tmp/proj',
      maxLabelWidth: 80,
    })
    expect(typeof row?.node).toBe('string')
    expect(String(row?.node)).toContain("don't ask again")
    expect(row?.applies).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Glob' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    expect(resolvePromptPermissionAnswer('yes', payload, row)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(
      resolvePromptPermissionAnswer('yes-dont-ask-again', payload, row),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: [...row!.applies],
    })
    expect(
      resolvePromptPermissionAnswer('yes-dont-ask-again', payload, null),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(
      resolvePromptPermissionAnswer('yes-enable-auto-mode', payload, row),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(resolvePromptPermissionAnswer('no', payload, row)).toEqual({
      behavior: 'deny',
    })
  })

  test('Riu vetoes DAA; remote-agent; description split/filter', () => {
    expect(shouldShowPromptAlwaysAllow(promptPayload())).toBe(true)
    expect(
      isPromptAlwaysAllowVetoed(
        promptPayload({ requestSource: { type: 'remote-agent' } }),
      ),
    ).toBe(true)
    expect(
      shouldShowPromptAlwaysAllow(promptPayload({ isAskCappedByOrg: true })),
    ).toBe(false)
    expect(formatPromptDescription('One. Two. . Three.')).toBe(
      'One. Two. Three',
    )
    expect(formatPromptDescription(undefined)).toBe('')
    expect(
      shouldShowPromptAlwaysAllow(promptPayload({ toolName: 'Bash*' })),
    ).toBe(false)
    expect(
      isPromptAlwaysAllowVetoed(
        promptPayload({
          permissionResult: {
            decisionReason: {
              type: 'subcommandResults',
              reasons: new Map([
                [
                  'nested',
                  {
                    behavior: 'ask',
                    decisionReason: {
                      type: 'safetyCheck',
                      reason: 'crit',
                      classifierApprovable: false,
                    },
                  },
                ],
              ]),
            },
          },
        }),
      ),
    ).toBe(true)
  })
})

const bashPayload = (
  extra: Partial<BashPermissionPayload> = {},
): BashPermissionPayload => ({
  requestId: 'r',
  toolName: 'Bash',
  permissionResult: { behavior: 'ask' },
  command: 'ls',
  input: { command: 'ls' },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

const psPayload = (
  extra: Partial<PowerShellPermissionPayload> = {},
): PowerShellPermissionPayload => ({
  requestId: 'r',
  toolName: 'PowerShell',
  permissionResult: { behavior: 'ask' },
  command: 'Get-ChildItem',
  input: { command: 'Get-ChildItem' },
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

const filePayload = (
  extra: Partial<FilePermissionPayload> = {},
): FilePermissionPayload => ({
  requestId: 'r',
  toolName: FILE_EDIT_TOOL_NAME,
  permissionResult: { behavior: 'ask' },
  input: { file_path: 'a.ts' },
  title: 'Edit file',
  question: { kind: 'file-action', verbPhrase: 'edit', fileName: 'a.ts' },
  content: { kind: 'no-changes', message: 'No changes' },
  contentWithheld: false,
  filePath: 'a.ts',
  operationType: 'write',
  symlinkTarget: null,
  showAlwaysAllow: true,
  isAskCappedByOrg: false,
  ...extra,
})

const askPayload = (
  extra: Partial<AskUserQuestionPermissionPayload> = {},
): AskUserQuestionPermissionPayload => ({
  requestId: 'r',
  toolName: 'AskUserQuestion',
  permissionResult: { behavior: 'ask' },
  input: { questions: [] },
  questions: [],
  ...extra,
})

const exitPayload = (
  extra: Partial<ExitPlanModePermissionPayload> = {},
): ExitPlanModePermissionPayload => ({
  requestId: 'r',
  toolName: 'ExitPlanMode',
  permissionResult: { behavior: 'ask' },
  input: {},
  ...extra,
})

describe('Cmy $Oo Xxs', () => {
  test('yes allow; apply-suggestions DualInk raw; prefix Xxs; no deny; withheld vetoes row', () => {
    const payload = bashPayload()
    expect(buildBashSuggestionsRow(payload)).toBe(null)
    expect(shouldShowBashSuggestions(payload)).toBe(true)
    expect(shouldShowBashPersistentAllow(payload)).toBe(false)
    expect(resolveBashPermissionAnswer('yes', payload, null)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(
      resolveBashPermissionAnswer('yes-apply-suggestions', payload, null),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(
      resolveBashPermissionAnswer('yes-prefix-edited', payload, null),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(
      resolveBashPermissionAnswer('yes-prefix-edited', payload, null, {
        editablePrefixSeed: 'ls *',
        editablePrefix: 'npm run *',
      }),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: bashPrefixUpdates('ls *', 'npm run *'),
    })
    expect(
      resolveBashPermissionAnswer('yes-prefix-edited', payload, null, {
        editablePrefix: 'npm run *',
      }),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(
      resolveBashPermissionAnswer('yes-enable-auto-mode', payload, null),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(resolveBashPermissionAnswer('no', payload, null)).toEqual({
      behavior: 'deny',
    })
    expect(
      isBashAlwaysAllowVetoed(
        bashPayload({ requestSource: { type: 'remote-agent' } }),
      ),
    ).toBe(true)
    expect(isBashCommandWithheld(bashPayload({ input: { command: 1 } }))).toBe(
      true,
    )
    expect(
      shouldShowBashSuggestions(bashPayload({ isAskCappedByOrg: true })),
    ).toBe(false)
    expect(
      isBashAlwaysAllowVetoed(
        bashPayload({
          permissionResult: {
            decisionReason: {
              type: 'subcommandResults',
              reasons: new Map([
                [
                  'rm -rf /',
                  {
                    behavior: 'ask',
                    decisionReason: {
                      type: 'safetyCheck',
                      reason: 'crit',
                      classifierApprovable: false,
                    },
                  },
                ],
              ]),
            },
          },
        }),
      ),
    ).toBe(true)
  })

  test('jNA S3: addRules Bash applies; non-compound seed ls *', () => {
    const suggestions = [
      {
        type: 'addRules' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
      },
    ]
    const payload = bashPayload({
      permissionResult: { behavior: 'ask', suggestions },
    })
    const row = buildBashSuggestionsRow(payload)
    expect(ConsentRow.is(row)).toBe(true)
    expect(row?.applies).toEqual(suggestions)
    expect(shouldShowBashPersistentAllow(payload)).toBe(true)
    expect(
      resolveBashPermissionAnswer('yes-apply-suggestions', payload, row),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: suggestions,
    })
    expect(seedBashEditablePrefix(payload)).toBe('ls *')
    expect(
      seedBashEditablePrefix(
        bashPayload({ command: 'ls -la', input: { command: 'ls -la' } }),
      ),
    ).toBe('ls *')
  })

  test('compound single Bash rule seed is YAe(ruleContent)', () => {
    const payload = bashPayload({
      permissionResult: {
        behavior: 'ask',
        suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
        decisionReason: {
          type: 'subcommandResults',
          reasons: new Map([['ls', { behavior: 'ask' }]]),
        },
      },
    })
    expect(seedBashEditablePrefix(payload)).toBe('ls:*')
  })

  test('title is Bash command when sandboxing off', () => {
    expect(bashCommandTitle(bashPayload())).toBe('Bash command')
  })
})

describe('Xxs YAe', () => {
  test('YAe keeps space-star; rejects tab/nl', () => {
    expect(sanitizeEditablePrefix('ls *')).toBe('ls *')
    expect(sanitizeEditablePrefix('npm run *')).toBe('npm run *')
    expect(sanitizeEditablePrefix('ls\t*')).toBe(undefined)
    expect(sanitizeEditablePrefix('ls\n*')).toBe(undefined)
    expect(sanitizeEditablePrefix(undefined)).toBe(undefined)
  })

  test('star is bare-tool addRules; bad seed/edited fail-closed', () => {
    const star = mintPrefixConsentRow('ls *', '*', 'Bash')
    expect(ConsentRow.is(star)).toBe(true)
    expect(star?.applies).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    expect(mintPrefixConsentRow(undefined, 'ls *', 'Bash')).toBe(null)
    expect(mintPrefixConsentRow('ls *', '  ', 'Bash')).toBe(null)
    expect(mintPrefixConsentRow('ls\t*', 'ls *', 'Bash')).toBe(null)
    expect(bashPrefixUpdates('ls *', 'npm run *')).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm run *' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
  })
})

describe('tyy EMs Xxs', () => {
  test('yes allow; apply-suggestions DualInk raw; prefix Xxs; no deny', () => {
    const payload = psPayload()
    expect(buildPowerShellSuggestionsRow(payload)).toBe(null)
    expect(shouldShowPowerShellSuggestions(payload)).toBe(true)
    expect(shouldShowPowerShellPersistentAllow(payload)).toBe(false)
    expect(resolvePowerShellPermissionAnswer('yes', payload, null)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(
      resolvePowerShellPermissionAnswer('yes-apply-suggestions', payload, null),
    ).toEqual({ behavior: 'allow', updatedInput: payload.input })
    expect(
      resolvePowerShellPermissionAnswer('yes-prefix-edited', payload, null, {
        editablePrefixSeed: 'Get-ChildItem',
        editablePrefix: 'Get-Process *',
      }),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: [
        {
          type: 'addRules',
          rules: [{ toolName: 'PowerShell', ruleContent: 'Get-Process *' }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    })
    expect(resolvePowerShellPermissionAnswer('no', payload, null)).toEqual({
      behavior: 'deny',
    })
    expect(
      isPowerShellAlwaysAllowVetoed(
        psPayload({ requestSource: { type: 'remote-agent' } }),
      ),
    ).toBe(true)
    expect(
      isPowerShellCommandWithheld(psPayload({ input: { command: 1 } })),
    ).toBe(true)
    expect(seedPowerShellEditablePrefix(payload)).toBe('Get-ChildItem')
    expect(
      seedPowerShellEditablePrefix(
        psPayload({
          command: 'a\nb',
          input: { command: 'a\nb' },
        }),
      ),
    ).toBe(undefined)
  })
})

describe('Mhy Y$A E$A', () => {
  test('yes allow; missing standing degrades; minted claude-folder; no deny', () => {
    const payload = filePayload()
    expect(resolveFilePermissionAnswer('yes', payload, null)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    expect(resolveFilePermissionAnswer('yes-session', payload, null)).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
    })
    const standing = mintFileStandingRow(
      join(getOriginalCwd(), '.claude', 'settings.json'),
      'write',
      undefined,
    )
    expect(standing?.value).toBe('yes-claude-folder')
    expect(standing?.row.node).toBe(CLAUDE_FOLDER_STANDING_LABEL)
    expect(
      resolveFilePermissionAnswer('yes-claude-folder', payload, standing),
    ).toEqual({
      behavior: 'allow',
      updatedInput: payload.input,
      permissionUpdates: [
        {
          type: 'addRules',
          rules: [
            { toolName: FILE_EDIT_TOOL_NAME, ruleContent: '/.claude/**' },
          ],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
    expect(resolveFilePermissionAnswer('no', payload, null)).toEqual({
      behavior: 'deny',
    })
    expect(
      isFileStandingRowVetoed(filePayload({ contentWithheld: true })),
    ).toBe(true)
    expect(
      isFileStandingRowVetoed(
        filePayload({ requestSource: { type: 'remote-agent' } }),
      ),
    ).toBe(true)
    expect(
      formatFilePermissionQuestion({
        kind: 'file-action',
        verbPhrase: 'edit',
        fileName: 'a.ts',
      }),
    ).toBe('Do you want to edit a.ts?')
    expect(filePermissionDialogTitle(payload)).toBe('Edit file')
    expect(
      filePermissionDialogTitle(filePayload({ showingDiffInIDE: true })),
    ).toBe('Opened changes in IDE ⧉')
    expect(
      filePermissionDialogTitle(
        filePayload({ showingDiffInIDE: true, ideName: 'VS Code' }),
      ),
    ).toBe('Opened changes in VS Code ⧉')
  })
})

describe('Vru submit analog', () => {
  test('normalize keeps question+options; submit allow+answers keyed by question', () => {
    const questions = [
      {
        question: 'Pick one',
        header: 'Choice',
        options: [{ label: 'A', description: 'alpha' }, { label: 'B' }],
      },
      { question: '', options: [{ label: 'skip' }] },
    ]
    expect(normalizeAskQuestions(questions)).toEqual([
      {
        question: 'Pick one',
        header: 'Choice',
        options: [{ label: 'A', description: 'alpha' }, { label: 'B' }],
      },
    ])
    const payload = askPayload({
      input: { questions },
      questions,
    })
    expect(resolveAskUserQuestionSubmit(payload, { 'Pick one': 'A' })).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Pick one': 'A' } },
    })
    expect(
      resolveAskUserQuestionSubmit(
        payload,
        { 'Pick one': 'A' },
        { afkTimeoutMs: 60_000, contentBlocks: [{ type: 'image' }] },
      ),
    ).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions,
        answers: { 'Pick one': 'A' },
        afkTimeoutMs: 60_000,
      },
      contentBlocks: [{ type: 'image' }],
    })
    expect(formatAskUserQuestionAnswer('A', undefined, 0)).toBe('A')
    expect(formatAskUserQuestionAnswer('__other__', 'typed', 0)).toBe('typed')
    expect(formatAskUserQuestionAnswer('__other__', 'typed', 1)).toBe(
      'typed (Image attached)',
    )
    expect(formatAskUserQuestionAnswer('__other__', undefined, 1)).toBe(
      '(Image attached)',
    )
  })

  test('Ofy preview kind full|withheld; annotations extras; Chat about deny', () => {
    const questions = [
      {
        question: 'Which layout?',
        header: 'Layout',
        options: [
          {
            label: 'A',
            description: 'alpha',
            preview: { kind: 'full', markdown: '# A' },
          },
          { label: 'B', preview: 'plain B' },
          { label: 'C', preview: { kind: 'snippet', markdown: 'skip' } },
          { label: 'D', preview: { kind: 'withheld' } },
          { label: 'E', preview: 'x'.repeat(2001) },
        ],
        multiSelect: true,
      },
    ]
    expect(normalizeAskQuestions(questions)).toEqual([
      {
        question: 'Which layout?',
        header: 'Layout',
        options: [
          {
            label: 'A',
            description: 'alpha',
            preview: { kind: 'full', markdown: '# A' },
          },
          { label: 'B', preview: { kind: 'full', markdown: 'plain B' } },
          { label: 'C' },
          { label: 'D', preview: { kind: 'withheld' } },
          { label: 'E', preview: { kind: 'withheld' } },
        ],
        multiSelect: true,
      },
    ])
    expect(toDualInkQuestions(normalizeAskQuestions(questions))).toEqual([
      {
        question: 'Which layout?',
        header: 'Layout',
        options: [
          { label: 'A', description: 'alpha', preview: '# A' },
          { label: 'B', description: '', preview: 'plain B' },
          { label: 'C', description: '' },
          { label: 'D', description: '' },
          { label: 'E', description: '' },
        ],
        multiSelect: true,
      },
    ])
    const payload = askPayload({ input: { questions }, questions })
    const annotations = buildAskUserQuestionAnnotations(
      normalizeAskQuestions(questions),
      { 'Which layout?': 'A' },
      { 'Which layout?': { textInputValue: '  note  ' } },
    )
    expect(annotations).toEqual({
      'Which layout?': { preview: '# A', notes: 'note' },
    })
    expect(
      resolveAskUserQuestionSubmit(
        payload,
        { 'Which layout?': 'A' },
        { annotations },
      ),
    ).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions,
        answers: { 'Which layout?': 'A' },
        annotations,
      },
    })
    expect(resolveAskUserQuestionDeny()).toEqual({ behavior: 'deny' })
    expect(
      resolveAskUserQuestionDeny({
        feedback: 'x',
        contentBlocks: [{ type: 'image' }],
      }),
    ).toEqual({
      behavior: 'deny',
      feedback: 'x',
      contentBlocks: [{ type: 'image' }],
    })
    expect(
      formatAskUserQuestionChatAboutFeedback([{ question: 'Which layout?' }], {
        'Which layout?': 'A',
      }),
    ).toContain('The user wants to clarify these questions.')
    expect(
      formatAskUserQuestionSkipInterviewFeedback(
        [{ question: 'Which layout?' }],
        { 'Which layout?': 'A' },
      ),
    ).toContain('Stop asking clarifying questions')
    expect(OFY_PREVIEW_CAP).toBe(2000)
    expect(mapOfyPreview(undefined)).toBeUndefined()
    expect(mapOfyPreview('\uFFFD  \n')).toBeUndefined()
    expect(mapOfyPreview('ok')).toEqual({ kind: 'full', markdown: 'ok' })
    expect(mapOfyPreview('x'.repeat(OFY_PREVIEW_CAP + 1))).toEqual({
      kind: 'withheld',
    })
  })
})

describe('teu Yes/No analog', () => {
  test('Lcy keep-context PYe/DPo minted applies; $cy deny missing row', () => {
    const bypass = buildExitPlanKeepContext({
      isBypassPermissionsModeAvailable: true,
    })
    expect(bypass.options.map(o => o.value)).toEqual([
      'yes-accept-edits-keep-context',
      'yes-default-keep-context',
    ])
    const bypassRow = bypass.keepContextRows['yes-accept-edits-keep-context']
    expect(ConsentRow.is(bypassRow)).toBe(true)
    expect(bypassRow?.applies).toEqual([
      {
        type: 'setMode',
        mode: 'bypassPermissions',
        destination: 'session',
      },
    ])
    expect(
      resolveExitPlanKeepContextAnswer(
        'yes-accept-edits-keep-context',
        bypass,
        { plan: 'p' },
        'note',
      ),
    ).toEqual({
      behavior: 'allow',
      updatedInput: { plan: 'p' },
      permissionUpdates: [
        {
          type: 'setMode',
          mode: 'bypassPermissions',
          destination: 'session',
        },
      ],
      feedback: 'note',
    })

    const edits = buildExitPlanKeepContext({})
    expect(edits.options.map(o => o.value)).toEqual([
      'yes-accept-edits-keep-context',
      'yes-default-keep-context',
    ])
    expect(
      edits.keepContextRows['yes-accept-edits-keep-context']?.applies,
    ).toEqual([
      {
        type: 'setMode',
        mode: 'acceptEdits',
        destination: 'session',
      },
    ])
    expect(edits.keepContextRows['yes-default-keep-context']?.applies).toEqual([
      { type: 'setMode', mode: 'default', destination: 'session' },
    ])

    const resume = buildExitPlanKeepContext({ offerResumeAuto: true })
    expect(resume.options[0]?.value).toBe('yes-resume-auto-mode')
    expect(resume.keepContextRows['yes-resume-auto-mode']?.applies).toEqual([])
    expect(EXIT_PLAN_RESUME_LABEL).toBe('Yes, and use auto mode')
    expect(offerExitPlanResumeAuto(true, true)).toBe(true)
    expect(offerExitPlanResumeAuto(true, false)).toBe(false)
    expect(offerExitPlanResumeAuto(false, true)).toBe(false)
    expect(edits.options[0]?.value).toBe('yes-accept-edits-keep-context')
    expect(
      resolveExitPlanKeepContextAnswer(
        'yes-accept-edits-keep-context',
        { options: [], keepContextRows: {}, keepContextModes: {} },
        {},
      ),
    ).toEqual({ behavior: 'deny' })
  })

  test('empty plan DualInk copy; yes setMode default session; no deny', () => {
    const empty = exitPayload({ plan: '' })
    expect(isExitPlanEmpty(empty)).toBe(true)
    expect(exitPlanDisplayText(empty)).toBe(EXIT_PLAN_EMPTY_FALLBACK)
    expect(resolveExitPlanModeAnswer('yes', empty)).toEqual({
      behavior: 'allow',
      updatedInput: {},
      permissionUpdates: [
        { type: 'setMode', mode: 'default', destination: 'session' },
      ],
    })
    expect(resolveExitPlanModeAnswer('no', empty)).toEqual({
      behavior: 'deny',
    })
    const filled = exitPayload({ plan: 'ship it', input: { plan: 'ship it' } })
    expect(isExitPlanEmpty(filled)).toBe(false)
    expect(exitPlanDisplayText(filled)).toBe('ship it')
    expect(resolveExitPlanModeAnswer('yes', filled)).toEqual({
      behavior: 'allow',
      updatedInput: { plan: 'ship it' },
      permissionUpdates: [
        { type: 'setMode', mode: 'default', destination: 'session' },
      ],
    })
  })
})
