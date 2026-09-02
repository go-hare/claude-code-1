/**
 * densable Jiu / myy / yyy / _yy / hyy / gyy / Syy / byy.
 *
 * Gold 2.1.239: jsu `vM(Fno,Jiu)`. Esc/onCancel → `{behavior:"deny"}`.
 * hyy/gyy mint via S3 (vyy=addRules). Wce is sanitizeHostDisplay — no
 * oge/Xil. Th is toTildePath. Host answer is store.answer; do not dequeue.
 */
import React from 'react'
import { SKILL_TOOL_NAME } from '@claude-code/builtin-tools/tools/SkillTool/constants.js'
import { getOriginalCwd } from '../bootstrap/state.js'
import { Text } from '@anthropic/ink'
import { toTildePath } from '../components/permissions/dontAskAgainLabel.js'
import { ConsentRow, mintConsentRow } from './consentRow.js'
import { sanitizeHostDisplay } from './permissionBrowser.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

/** densable vyy */
const SKILL_DAA_TYPES = new Set(['addRules'])

export type SkillPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  skill: string
  skillDescription?: string
  input?: unknown
  isMcp?: boolean
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
}

export type SkillAllowRow = ConsentRow

export type SkillPermissionChoice = 'yes' | 'yes-exact' | 'yes-prefix' | 'no'

function isValidAllowRow(row: SkillAllowRow | null): row is SkillAllowRow {
  return ConsentRow.is(row) && row.applies.length > 0
}

function isSafetyCheckBlocked(permissionResult: unknown): boolean {
  const reason = (
    permissionResult as {
      decisionReason?: { type?: string; classifierApprovable?: boolean }
    } | null
  )?.decisionReason
  return reason?.type === 'safetyCheck' && !reason.classifierApprovable
}

/** densable Syy */
export function shouldShowSkillAlwaysAllow(
  payload: SkillPermissionPayload,
): boolean {
  return (
    payload.showAlwaysAllow === true &&
    !isSafetyCheckBlocked(payload.permissionResult) &&
    payload.isAskCappedByOrg !== true
  )
}

/** densable byy */
export function extractSkillPrefix(skill: string): string | null {
  const t = skill.indexOf(' ')
  if (t <= 0) return null
  const r = skill.substring(0, t)
  if (
    (r.startsWith('/') ? r.substring(1) : r) === '' ||
    r.includes('*') ||
    r.includes(':')
  ) {
    return null
  }
  return r
}

/** densable yyy */
export function shouldShowSkillExactAllow(
  payload: SkillPermissionPayload,
): boolean {
  return (
    shouldShowSkillAlwaysAllow(payload) &&
    payload.skill !== '' &&
    !payload.skill.endsWith(':*') &&
    !payload.skill.endsWith(' *')
  )
}

/** densable _yy */
export function shouldShowSkillPrefixAllow(
  payload: SkillPermissionPayload,
): boolean {
  if (!shouldShowSkillAlwaysAllow(payload)) return false
  return extractSkillPrefix(payload.skill) !== null
}

/** densable hyy — S3 addRules Skill localSettings; label uses Wce + Th. */
export function buildSkillExactAllowRow(
  payload: SkillPermissionPayload,
  cwd: string = getOriginalCwd(),
): SkillAllowRow | null {
  return mintConsentRow(
    [
      {
        type: 'addRules',
        rules: [
          {
            toolName: SKILL_TOOL_NAME,
            ruleContent: payload.skill,
          },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
    {
      displayedTypes: SKILL_DAA_TYPES,
      renderLabel: updates => {
        const update = updates.length === 1 ? updates[0] : undefined
        if (
          update === undefined ||
          update.type !== 'addRules' ||
          update.rules.length !== 1 ||
          update.rules[0]?.toolName !== SKILL_TOOL_NAME ||
          update.rules[0]?.ruleContent !== payload.skill
        ) {
          return null
        }
        const sanitized = sanitizeHostDisplay(payload.skill)
        if (sanitized === null) return null
        return React.createElement(
          Text,
          null,
          "Yes, and don't ask again for ",
          React.createElement(Text, { bold: true }, sanitized.display),
          ' in ',
          React.createElement(Text, { bold: true }, toTildePath(cwd)),
        )
      },
    },
  )
}

/** densable gyy */
export function buildSkillPrefixAllowRow(
  payload: SkillPermissionPayload,
  cwd: string = getOriginalCwd(),
): SkillAllowRow | null {
  const prefix = extractSkillPrefix(payload.skill)
  if (prefix === null) return null
  return mintConsentRow(
    [
      {
        type: 'addRules',
        rules: [
          {
            toolName: SKILL_TOOL_NAME,
            ruleContent: `${prefix}:*`,
          },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
    {
      displayedTypes: SKILL_DAA_TYPES,
      renderLabel: updates => {
        const update = updates.length === 1 ? updates[0] : undefined
        if (
          update === undefined ||
          update.type !== 'addRules' ||
          update.rules.length !== 1 ||
          update.rules[0]?.toolName !== SKILL_TOOL_NAME ||
          update.rules[0]?.ruleContent !== `${prefix}:*`
        ) {
          return null
        }
        const sanitized = sanitizeHostDisplay(prefix)
        if (sanitized === null) return null
        return React.createElement(
          Text,
          null,
          "Yes, and don't ask again for ",
          React.createElement(Text, { bold: true }, `${sanitized.display}:*`),
          ' commands in ',
          React.createElement(Text, { bold: true }, toTildePath(cwd)),
        )
      },
    },
  )
}

/** densable myy */
export function resolveSkillPermissionAnswer(
  choice: SkillPermissionChoice,
  payload: SkillPermissionPayload,
  rows: { exactRow: SkillAllowRow | null; prefixRow: SkillAllowRow | null },
  feedback?: string,
): PermissionPromptResult {
  switch (choice) {
    case 'yes':
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        ...(feedback ? { feedback } : {}),
      }
    case 'yes-exact':
      if (!isValidAllowRow(rows.exactRow)) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: [...rows.exactRow!.applies],
      }
    case 'yes-prefix':
      if (!isValidAllowRow(rows.prefixRow)) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: [...rows.prefixRow!.applies],
      }
    case 'no':
      return {
        behavior: 'deny',
        ...(feedback ? { feedback } : {}),
      }
  }
}
