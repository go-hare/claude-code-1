import { WORKFLOW_TOOL_PROMPT } from '@claude-code/workflow-engine'
import { registerBundledSkill } from '../bundledSkills.js'

/**
 * /ultracode — user-only slash that re-injects the Workflow tool playbook.
 *
 * densable 2.1.211 keeps the full orchestration manual on the **Workflow tool
 * prompt** (not a model-invocable skill with a wide whenToUse). A bundled skill
 * that models can self-invoke with "when task can be parallelized → Workflow"
 * becomes an opt-in bootstrap (skill instructions count as explicit opt-in).
 *
 * Alignment:
 * - Playbook source of truth: packages/workflow-engine/src/tool/playbook.ts
 * - This skill: userInvocable + disableModelInvocation (like /doctor)
 * - Session ultracode / keyword opt-in remain harness attachments, not this skill
 */
export function registerUltracodeSkill(): void {
  registerBundledSkill({
    name: 'ultracode',
    description:
      'Show the Workflow orchestration playbook (opt-in rules, script primitives, quality patterns). Does not turn on session ultracode — use /effort ultracode or the keyword "ultracode" for that.',
    // Short menu/help only — not a model routing signal (model cannot invoke).
    whenToUse:
      'User-invoked reference for multi-agent Workflow scripting. Prefer /effort ultracode or saying "use a workflow" / the keyword ultracode for real opt-in.',
    userInvocable: true,
    disableModelInvocation: true,
    async getPromptForCommand(args) {
      let prompt =
        `# /ultracode — Workflow Orchestration Playbook\n\n` +
        `This slash re-shows the same playbook that ships on the Workflow tool. ` +
        `It does **not** set session ultracode. Standing opt-in is harness-only: ` +
        `\`/effort ultracode\`, settings \`ultracode: true\`, or the keyword ` +
        `"ultracode" in a human turn (system-reminder). Without that, follow the ` +
        `ONLY-call-when rules below — do not treat this slash alone as permission ` +
        `to fan out unless the user also asked to run a workflow.\n\n` +
        WORKFLOW_TOOL_PROMPT
      if (args) {
        prompt += `\n## User input\n\n${args}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
