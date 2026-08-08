/**
 * densable 2.1.218 #29: /deep-research is user-slash only.
 * The bundled workflow remains model-callable via Workflow({name:'deep-research'});
 * this skill is the manual entry that expands into that Workflow invocation.
 */
import { registerBundledSkill } from '../bundledSkills.js'

const DESCRIPTION =
  'Run a multi-step deep research pipeline (search → fetch → verify → synthesize). User-invoked only.'

export function registerDeepResearchSkill(): void {
  registerBundledSkill({
    name: 'deep-research',
    description: DESCRIPTION,
    argumentHint: '<research question>',
    userInvocable: true,
    // densable 2.1.218: model must not auto-run /deep-research; user slash only
    // (same pattern as /verify and /code-review in 2.1.215).
    disableModelInvocation: true,
    whenToUse:
      'Only when the user explicitly asks for deep research via /deep-research. Do not invoke proactively.',
    async getPromptForCommand(args) {
      const question = args.trim()
      const parts = [
        'Run a thorough multi-step research harness for the user question.',
        '',
        'Use the Workflow tool with the bundled deep-research workflow:',
        '',
        '```',
        question
          ? `Workflow({ name: "deep-research", args: ${JSON.stringify(question)} })`
          : 'Workflow({ name: "deep-research", args: "<question>" })',
        '```',
        '',
        'Do not invent findings — wait for the workflow result, then present the synthesis to the user.',
      ]
      if (question) {
        parts.push('', `## Research question`, '', question)
      } else {
        parts.push(
          '',
          'No question was provided. Ask the user for a research question before launching the workflow.',
        )
      }
      return [{ type: 'text', text: parts.join('\n') }]
    },
  })
}
