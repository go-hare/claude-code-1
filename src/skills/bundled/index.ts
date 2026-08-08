import { feature } from 'bun:bundle'
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { registerBatchSkill } from './batch.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerUseArtifactsSkill } from './useArtifacts.js'
import { registerDatavizSkill } from './dataviz.js'
import { registerDoctorSkill } from './doctor.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerUltracodeSkill } from './ultracode.js'
import { registerCronDeleteSkill, registerCronListSkill } from './cronManage.js'
import { registerLoopSkill } from './loop.js'
import { registerDreamSkill } from './dream.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerDeepResearchSkill } from './deepResearch.js'
import { registerVerifySkill } from './verify.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  // Official cae densable — env OR settings.disableBundledSkills.
  let settingsDisable = false
  try {
    const { getInitialSettings } =
      require('../../utils/settings/settings.js') as {
        getInitialSettings: () => { disableBundledSkills?: boolean }
      }
    settingsDisable = getInitialSettings().disableBundledSkills === true
  } catch {
    // Settings optional at skill init.
  }
  try {
    const { isBundledSkillsDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    if (
      isBundledSkillsDisabled({
        settingsDisableBundledSkills: settingsDisable,
      })
    ) {
      return
    }
  } catch {
    if (
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS) ||
      settingsDisable
    ) {
      return
    }
  }
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  // densable 2.1.218 #29: /deep-research user-slash only
  registerDeepResearchSkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerUseArtifactsSkill()
  // Official 2.1.208 fIb: registerDatavizSkill (always on; chart/dashboard guidance)
  registerDatavizSkill()
  // Official 2.1.208 Xlf: doctor/checkup skill (survives bundled kill-switch
  // via separate registration path in official; here always registered when
  // bundled skills init runs; DISABLE_DOCTOR_COMMAND gates isEnabled).
  registerDoctorSkill()
  registerBatchSkill()
  registerStuckSkill()
  registerUltracodeSkill()
  registerLoopSkill()
  registerCronListSkill()
  registerCronDeleteSkill()
  registerDreamSkill()
  if (feature('REVIEW_ARTIFACT')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerHunterSkill } = require('./hunter.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerHunterSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      registerScheduleRemoteAgentsSkill,
    } = require('./scheduleRemoteAgents.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerClaudeApiSkill } = require('./claudeApi.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerClaudeApiSkill()
  }
  // Official 2.1.207: if (!DISABLE_CLAUDE_CODE_SKILL) registerClaudeCodeSkill()
  // Skill name claude-code-docs; isEnabled via GB tengu_birch_kettle.
  {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { maybeRegisterClaudeCodeSkill } = require('./claudeCodeDocs.js') as {
      maybeRegisterClaudeCodeSkill: () => void
    }
    /* eslint-enable @typescript-eslint/no-require-imports */
    maybeRegisterClaudeCodeSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerRunSkillGeneratorSkill } = require('./runSkillGenerator.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerRunSkillGeneratorSkill()
  }
}
