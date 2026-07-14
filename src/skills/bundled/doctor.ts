/**
 * Official 2.1.208 Xlf registerDoctorSkill denser.
 *
 * Session slash `/doctor` (alias `/checkup`) is this bundled skill — long
 * multi-check prompt (tkb) covering CLAUDE.md trim/migrate (checks 3–4),
 * unused extensions, hooks, permissions, etc. Model invocation is disabled;
 * user-invocable only. Matches official 208 (only the skill is name:"doctor").
 *
 * Terminal `claude doctor` stays separate (main.tsx → cli/handlers/util →
 * screens/Doctor). The old local-jsx session command under commands/doctor
 * was removed as an unused shell.
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  DOCTOR_SKILL_ALIASES,
  DOCTOR_SKILL_DESCRIPTION,
  DOCTOR_SKILL_MENU_DESCRIPTION,
  DOCTOR_SKILL_NAME,
  DOCTOR_SKILL_PROGRESS_MESSAGE,
  DOCTOR_SKILL_PROMPT,
} from './doctorContent.js'

/**
 * Official Xlf — register doctor/checkup bundled skill.
 */
export function registerDoctorSkill(): void {
  registerBundledSkill({
    name: DOCTOR_SKILL_NAME,
    aliases: [...DOCTOR_SKILL_ALIASES],
    description: DOCTOR_SKILL_DESCRIPTION,
    // menuDescription has no separate field on Command; surface the short
    // official menu string via whenToUse for typeahead/help consumers.
    whenToUse: DOCTOR_SKILL_MENU_DESCRIPTION,
    userInvocable: true,
    disableModelInvocation: true,
    progressMessage: DOCTOR_SKILL_PROGRESS_MESSAGE,
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_DOCTOR_COMMAND),
    async getPromptForCommand(args) {
      let text = DOCTOR_SKILL_PROMPT
      if (args) {
        text += `\n\n## Additional instructions from the user\n\n${args}`
      }
      return [{ type: 'text', text }]
    },
  })
}
