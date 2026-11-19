import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Command } from '../../../commands.js'
import { formatCommandUsage } from '../../../commands/help/help.js'
import { findNearestSliderStopIndex } from '../../EffortPanel/EffortPanel.js'
import { getUniqueSkillRowKey } from '../../skills/SkillsMenu.js'
import {
  buildDisabledFeaturesProperties,
  deduplicateDiagnostics,
  getDisabledCommandReason,
} from '../../../utils/status.js'
import { rewriteSlashHelpInvocation } from '../../../utils/processUserInput/processSlashCommand.js'
import { formatConfigOnOffValue } from '../Config.js'
import { shouldShowPlanLimitsFirst } from '../Usage.js'

function makeBuiltinCmd(
  name: string,
  overrides: Partial<Command> = {},
): Command {
  return {
    type: 'local',
    name,
    description: `Run ${name}`,
    isEnabled: () => true,
    load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
    ...overrides,
  } as Command
}

describe('Wave 326 Group 4D: Status / Config / Usage / Skills / Help / Model / Effort', () => {
  test('#4 & #210: /status disabled features row and deduplicated installation warnings', () => {
    const prevTelemetry = process.env.DISABLE_TELEMETRY
    try {
      process.env.DISABLE_TELEMETRY = '1'
      const rows = buildDisabledFeaturesProperties([])
      expect(rows.some(r => r.label === 'Features')).toBe(true)
      const value = String(rows.find(r => r.label === 'Features')?.value ?? '')
      expect(value).toContain('DISABLE_TELEMETRY')
      expect(value).toContain('https://code.claude.com/docs/en/env-vars')
    } finally {
      if (prevTelemetry === undefined) delete process.env.DISABLE_TELEMETRY
      else process.env.DISABLE_TELEMETRY = prevTelemetry
    }

    const deduped = deduplicateDiagnostics([
      'Install warning A',
      'Install warning A',
      'Install warning B',
      '  Install warning A  ',
    ])
    expect(deduped).toEqual(['Install warning A', 'Install warning B'])
  })

  test('#184 & #286: Show tips & Reduce motion write userSettings; Config displays on/off', () => {
    expect(formatConfigOnOffValue(true)).toBe('on')
    expect(formatConfigOnOffValue(false)).toBe('off')
    expect(formatConfigOnOffValue('true')).toBe('on')
    expect(formatConfigOnOffValue('false')).toBe('off')
    expect(formatConfigOnOffValue('default')).toBe('default')
    expect(formatConfigOnOffValue('true', true)).toBe('true')

    const configSrc = readFileSync(
      join(import.meta.dir, '../Config.tsx'),
      'utf8',
    )
    const tipsBlock = configSrc.slice(
      configSrc.indexOf("id: 'tips'"),
      configSrc.indexOf("id: 'tips'") + 500,
    )
    expect(tipsBlock).not.toContain("updateSettingsForSource('localSettings'")
    expect(tipsBlock).toContain('F({')

    const motionBlock = configSrc.slice(
      configSrc.indexOf("id: 'reduceMotion'"),
      configSrc.indexOf("id: 'reduceMotion'") + 550,
    )
    expect(motionBlock).not.toContain("updateSettingsForSource('localSettings'")
    expect(motionBlock).toContain('F({')
  })

  test('#345: fullscreen /usage shows plan limit bars first for subscribers; /cost starts with cost', () => {
    expect(
      shouldShowPlanLimitsFirst({
        insideModal: true,
        isSubscriber: true,
        apiProvider: 'firstParty',
        openedForCost: false,
      }),
    ).toBe(true)

    expect(
      shouldShowPlanLimitsFirst({
        insideModal: true,
        isSubscriber: true,
        apiProvider: 'firstParty',
        openedForCost: true,
      }),
    ).toBe(false)

    expect(
      shouldShowPlanLimitsFirst({
        insideModal: false,
        isSubscriber: true,
        apiProvider: 'firstParty',
        openedForCost: false,
      }),
    ).toBe(false)

    expect(
      shouldShowPlanLimitsFirst({
        insideModal: true,
        isSubscriber: true,
        apiProvider: 'gateway',
        openedForCost: false,
      }),
    ).toBe(false)
  })

  test('#39 & #124: SkillsMenu double Ctrl+C/D saves & closes; unique row keys for same-name skills', () => {
    const skillsMenuSrc = readFileSync(
      join(import.meta.dir, '../../skills/SkillsMenu.tsx'),
      'utf8',
    )
    expect(skillsMenuSrc).toContain(
      'useExitOnCtrlCDWithKeybindings(() => {\n    void saveAndClose();',
    )

    const skillA = {
      name: 'deploy',
      source: 'projectSettings',
      loadedFrom: 'skills',
      skillRoot: '/repo/.claude/skills/deploy',
    } as Parameters<typeof getUniqueSkillRowKey>[0]
    const skillB = {
      name: 'deploy',
      source: 'projectSettings',
      loadedFrom: 'commands_DEPRECATED',
    } as Parameters<typeof getUniqueSkillRowKey>[0]
    expect(getUniqueSkillRowKey(skillA, 0)).not.toBe(
      getUniqueSkillRowKey(skillB, 1),
    )
  })

  test('#130 & #262: /clear --help rewrites to /help clear; /help <cmd> formats usage; disabled commands explain why', () => {
    const cmds = [
      makeBuiltinCmd('help', { argumentHint: '[command]' }),
      makeBuiltinCmd('clear', {
        description: 'Clear conversation history',
        aliases: ['reset'],
      }),
      makeBuiltinCmd('model', { description: 'Select model' }),
    ]

    expect(rewriteSlashHelpInvocation('/clear --help', cmds)).toBe(
      '/help clear',
    )
    expect(rewriteSlashHelpInvocation('/clear -h', cmds)).toBe('/help clear')
    expect(rewriteSlashHelpInvocation('/help --help', cmds)).toBe('/help')
    expect(rewriteSlashHelpInvocation('/help model', cmds)).toBe(
      '/model --help',
    )
    expect(rewriteSlashHelpInvocation('/model --help', cmds)).toBe(
      '/model --help',
    )

    const usage = formatCommandUsage(cmds[1]!)
    expect(usage).toContain('/clear')
    expect(usage).toContain('Clear conversation history')
    expect(usage).toContain('Also: /reset')
    expect(usage).toContain('Docs: https://code.claude.com/docs/en/commands')

    const prevTelemetry = process.env.DISABLE_TELEMETRY
    try {
      process.env.DISABLE_TELEMETRY = '1'
      const disabled = getDisabledCommandReason('import', [])
      expect(disabled).toBeDefined()
      expect(disabled?.reason).toContain('/import')
      expect(disabled?.reason).toContain('DISABLE_TELEMETRY')
    } finally {
      if (prevTelemetry === undefined) delete process.env.DISABLE_TELEMETRY
      else process.env.DISABLE_TELEMETRY = prevTelemetry
    }
  })

  test('#139, #228, #221: /model & /effort direct inline path, CacheMissConfirmDialog key hints, slider click stop mapping', () => {
    expect(findNearestSliderStopIndex(0, [2, 10, 20, 30])).toBe(0)
    expect(findNearestSliderStopIndex(12, [2, 10, 20, 30])).toBe(1)
    expect(findNearestSliderStopIndex(27, [2, 10, 20, 30])).toBe(3)

    const modelSrc = readFileSync(
      join(import.meta.dir, '../../../commands/model/model.tsx'),
      'utf8',
    )
    expect(modelSrc).not.toContain('hideInputGuide')
    expect(modelSrc).toContain('executeDirectModelArg')

    const effortSrc = readFileSync(
      join(import.meta.dir, '../../../commands/effort/effort.tsx'),
      'utf8',
    )
    expect(effortSrc).toContain('if (!needsCacheConfirm)')
  })
})
