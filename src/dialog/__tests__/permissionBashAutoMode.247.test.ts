/**
 * densable 2.1.247 #3 — xOe / KNe / NX / UNe bash auto-mode tip.
 * WORKFLOW_AUTO_MODE_LABEL stays 239 workflow-only (same sW.workflow string).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { WORKFLOW_AUTO_MODE_LABEL } from '../consentRow.js'
import {
  BASH_AUTO_MODE_DESCRIPTION,
  BASH_AUTO_MODE_TIP,
  BASH_PERMISSION_PROMPT_UPSELL_TRIGGER,
  isBashAutoModeOfferBlocked,
  shouldShowBashAutoModeOption,
  shouldShowWorkflowAutoModeOption,
  WORKFLOW_AUTO_MODE_DESCRIPTION,
  WORKFLOW_PERMISSION_PROMPT_TRIGGER,
  workflowAutoModeSelectOption,
} from '../permissionAutoMode.js'
import { bashToolUseOptions } from '../../components/permissions/BashPermissionRequest/bashToolUseOptions.js'

const root = join(import.meta.dir, '../../..')

describe('densable 2.1.247 #3 bash auto-mode tip', () => {
  test('UNe / NX / upsell trigger are locked SEA strings', () => {
    expect(BASH_AUTO_MODE_DESCRIPTION).toBe(
      '· auto mode handles these prompts for you',
    )
    expect(BASH_AUTO_MODE_TIP).toBe(
      'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
    )
    expect(BASH_PERMISSION_PROMPT_UPSELL_TRIGGER).toBe(
      'bash_permission_prompt_upsell',
    )
    expect(WORKFLOW_AUTO_MODE_LABEL).toBe('Yes, and switch to auto mode')
    expect(WORKFLOW_AUTO_MODE_DESCRIPTION).toBe(
      '· workflows run best with it on',
    )
  })

  test('xOe show = !a && !c && canOffer && !fe (not offered-only)', () => {
    expect(shouldShowBashAutoModeOption(false, false, true, false)).toBe(true)
    expect(shouldShowBashAutoModeOption(true, false, true, false)).toBe(false)
    expect(shouldShowBashAutoModeOption(false, true, true, false)).toBe(false)
    expect(shouldShowBashAutoModeOption(false, false, false, false)).toBe(false)
    expect(shouldShowBashAutoModeOption(false, false, true, true)).toBe(false)
    expect(shouldShowWorkflowAutoModeOption(false, false, false)).toBe(false)
  })

  test('fe blocks matchedAskRule ask and hook', () => {
    expect(
      isBashAutoModeOfferBlocked({ matchedAskRule: { ruleBehavior: 'ask' } }),
    ).toBe(true)
    expect(
      isBashAutoModeOfferBlocked({ decisionReason: { type: 'hook' } }),
    ).toBe(true)
    expect(
      isBashAutoModeOfferBlocked({ decisionReason: { type: 'rule' } }),
    ).toBe(false)
  })

  test('KNe: !offered uses UNe; offered default is RA', () => {
    const upsell = workflowAutoModeSelectOption(BASH_AUTO_MODE_DESCRIPTION)
    expect(upsell.label).toBe(WORKFLOW_AUTO_MODE_LABEL)
    expect(upsell.description).toBe(BASH_AUTO_MODE_DESCRIPTION)
    expect(upsell.value).toBe('yes-enable-auto-mode')
    const workflow = workflowAutoModeSelectOption()
    expect(workflow.description).toBe(WORKFLOW_AUTO_MODE_DESCRIPTION)
  })

  test('DualInk KNe inserts yes-enable-auto-mode before No', () => {
    const options = bashToolUseOptions({
      onRejectFeedbackChange: () => {},
      onAcceptFeedbackChange: () => {},
      showEnableAutoModeOption: true,
      enableAutoModeDescription: BASH_AUTO_MODE_DESCRIPTION,
    })
    const values = options.map(o => o.value)
    expect(values).toContain('yes-enable-auto-mode')
    expect(values.indexOf('yes-enable-auto-mode')).toBeLessThan(
      values.indexOf('no'),
    )
    const auto = options.find(o => o.value === 'yes-enable-auto-mode')
    expect(auto?.label).toBe(WORKFLOW_AUTO_MODE_LABEL)
    expect(auto?.description).toBe(BASH_AUTO_MODE_DESCRIPTION)
  })

  test('Cmy xOe wires NX subtitle + upsell trigger; no SendFeedback invent', () => {
    const src = readFileSync(
      join(root, 'src/dialog/dialogs/PermissionBashDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('BASH_AUTO_MODE_TIP')
    expect(src).toContain('shouldShowBashAutoModeOption')
    expect(src).toContain('BASH_PERMISSION_PROMPT_UPSELL_TRIGGER')
    expect(src).toContain('WORKFLOW_PERMISSION_PROMPT_TRIGGER')
    expect(src).not.toContain('SendFeedback')
    expect(WORKFLOW_PERMISSION_PROMPT_TRIGGER).toBe(
      'workflow_permission_prompt',
    )
  })
})
