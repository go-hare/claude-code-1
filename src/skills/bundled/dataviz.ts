/**
 * Official registerDatavizSkill denser (2.1.208 fIb).
 *
 * Skill name: dataviz
 * Always registered (no env force-off). Content extracted to disk on invoke
 * via registerBundledSkill files= map (references/* + validate_palette scripts).
 *
 * Companion GB callout tengu_cobalt_plinth_dataviz is injected into the
 * use-artifacts skill (fork stand-in for official artifact-design).
 */

import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  DATAVIZ_SKILL_DESCRIPTION,
  DATAVIZ_SKILL_NAME,
  SKILL_FILES,
  SKILL_MD,
} from './datavizContent.js'

const { content: SKILL_BODY } = parseFrontmatter(SKILL_MD)

/**
 * Official fIb / registerDatavizSkill.
 */
export function registerDatavizSkill(): void {
  registerBundledSkill({
    name: DATAVIZ_SKILL_NAME,
    description: DATAVIZ_SKILL_DESCRIPTION,
    userInvocable: true,
    files: SKILL_FILES,
    async getPromptForCommand(args) {
      const parts: string[] = [SKILL_BODY.trimStart()]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
