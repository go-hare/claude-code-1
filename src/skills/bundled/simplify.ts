import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import type { ToolUseContext } from '../../Tool.js'
import { toolMatchesName } from '../../Tool.js'
import { registerBundledSkill } from '../bundledSkills.js'

const GATHER_DIFF = `## Phase 0 — Gather the diff

Run \`git diff @{upstream}...HEAD\` (or \`git diff main...HEAD\` / \`git diff HEAD~1\`
if there's no upstream) to get the unified diff under review. If there are
uncommitted changes, or the range diff is empty, also run \`git diff HEAD\` and
include the working-tree changes in scope — the review often runs before the
commit. If a PR number, branch name, or file path was passed as an argument,
review that target instead. Treat this diff as the review scope.
`

const REUSE_ANGLE = `Flag new code that re-implements something the codebase
already has — Grep shared/utility modules and files adjacent to the change,
and name the existing helper to call instead.
`

const SIMPLIFICATION_ANGLE = `### Simplification

Flag unnecessary complexity the diff adds: redundant or derivable state,
copy-paste with slight variation, deep nesting, dead code left behind. Name
the simpler form that does the same job.
`

const EFFICIENCY_ANGLE = `### Efficiency

Flag wasted work the diff introduces: redundant computation or repeated I/O,
independent operations run sequentially, blocking work added to startup or
hot paths. Also flag long-lived objects built from closures or captured
environments — they keep the entire enclosing scope alive for the object's
lifetime (a memory leak when that scope holds large values); prefer a
class/struct that copies only the fields it needs. Name the cheaper
alternative.
`

const ALTITUDE_ANGLE = `### Altitude

Check that each change fixes the root cause at the right depth rather than
patching a symptom with a fragile bandaid. Special cases layered on shared
infrastructure are a sign the fix isn't deep enough — prefer the simpler, more
general change to the underlying mechanism over adding special cases, and name
that change.
`

function isAgentFanoutAvailable(context: ToolUseContext): boolean {
  const tools = context.options?.tools
  if (!tools) return true
  return tools.some(t => toolMatchesName(t, AGENT_TOOL_NAME))
}

function simplifyPromptWithAgents(): string {
  return `\`/simplify → 4 cleanup agents in parallel → apply the fixes\`

You are improving the quality of the changed code, not hunting for bugs. Review
it for reuse, simplification, efficiency, and altitude issues, then fix what you
find. Do not look for correctness bugs — that is what \`/code-review\` is for.

${GATHER_DIFF}
## Phase 1 — Review (4 cleanup agents in parallel)

Launch **4 independent review agents** via the ${AGENT_TOOL_NAME} tool, all in a
single message so they run concurrently. Pass each agent the diff and one of
the four angles below. Each returns its findings with \`file\`, \`line\`, a
one-line \`summary\`, and the concrete cost (what is duplicated, wasted, or
harder to maintain).

### Reuse

${REUSE_ANGLE}
${SIMPLIFICATION_ANGLE}
${EFFICIENCY_ANGLE}
${ALTITUDE_ANGLE}
## Phase 2 — Apply the fixes

Wait for all four agents to complete, dedup findings that point at the same
line or mechanism, and fix each remaining one directly. Skip any finding whose
fix would change intended behavior, require changes well outside the reviewed
diff, or that you judge to be a false positive — note the skip rather than
arguing with it. Finish with a brief summary of what was fixed and what was
skipped (or confirm the code was already clean).
`
}

function simplifyPromptInline(): string {
  return `\`/simplify → ${AGENT_TOOL_NAME} tool unavailable → single-pass inline cleanup → apply the fixes\`

You are improving the quality of the changed code, not hunting for bugs. Review
it for reuse, simplification, efficiency, and altitude issues, then fix what you
find. Do not look for correctness bugs — that is what \`/code-review\` is for.

The ${AGENT_TOOL_NAME} tool isn't available in this context, so the usual
4-agent fan-out can't run. Work through all four angles below yourself, in
this same context, in one pass — do not skip an angle for lack of fan-out.

${GATHER_DIFF}
## Phase 1 — Review (4 cleanup angles, single pass)

Review the diff against each angle below in turn. For each, note findings with
\`file\`, \`line\`, a one-line \`summary\`, and the concrete cost (what is
duplicated, wasted, or harder to maintain).

### Reuse

${REUSE_ANGLE}
${SIMPLIFICATION_ANGLE}
${EFFICIENCY_ANGLE}
${ALTITUDE_ANGLE}
## Phase 2 — Apply the fixes

Dedup findings that point at the same line or mechanism, and fix each
remaining one directly. Skip any finding whose fix would change intended
behavior, require changes well outside the reviewed diff, or that you judge to
be a false positive — note the skip rather than arguing with it. Finish with a
brief summary of what was fixed and what was skipped (or confirm the code was
already clean). State clearly in your summary that this was a single-pass
review done without the ${AGENT_TOOL_NAME} tool, not the full 4-agent
fan-out, so whoever reads it isn't misled about what actually ran.
`
}

export function registerSimplifySkill(): void {
  registerBundledSkill({
    name: 'simplify',
    menuDescription: 'Clean up the changed code without changing behavior',
    description:
      'Review the changed code for reuse, simplification, efficiency, and altitude cleanups, then apply the fixes. Quality only — it does not hunt for bugs; use /code-review for that.',
    argumentHint: '[<target>]',
    userInvocable: true,
    async getPromptForCommand(args, context) {
      const target = args.trim()
      const prefix = target ? `Review target: \`${target}\`\n\n` : ''
      const body = isAgentFanoutAvailable(context)
        ? simplifyPromptWithAgents()
        : simplifyPromptInline()
      return [{ type: 'text', text: `${prefix}${body}` }]
    },
  })
}
