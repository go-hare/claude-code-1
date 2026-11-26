/**
 * Official 2.1.331 propose_skills prompts — Rgl / xgl / ve 1:1.
 */

/** Official Rgl */
export const DESCRIPTION =
  'Show the user a review card of proposed skills to save — render-only, nothing is written'

/** Official xgl */
export const PROMPT = `Surface recurring multi-step procedures from this session as skill proposals. Render-only — calling this shows a review card in the conversation; it does not write any files or create the skill. The user reviews and saves from the card. To improve a skill, send only your changes as \`edits\`: the card shows the whole updated SKILL.md.

Call once with all proposals (max 3). Use it when the user asks to turn a workflow or procedure into a skill, or when the same multi-step procedure has recurred and a skill would clearly save future work. Do not call it for one-off tasks, and do not re-propose skills the user has already seen.

An improvement can only update one of the user's own skills, including one of theirs that this session lists as a plugin skill because they uploaded it to claude.ai; the tool tells you when a target is not theirs. Another plugin's skill or a built-in one can't be updated from the card. To customize one of those with this tool, propose it as a new skill under a name of its own — not the original's name, even without its plugin prefix — with a description that says when to use it instead of the original: both stay listed, and the description decides which one is used.`

/** Official ve — error when skillMd has no instructions body below frontmatter. */
export const EMPTY_SKILL_MD_MESSAGE =
  'skillMd has no instructions, so the review card cannot save it. Call again with the complete SKILL.md: its frontmatter between two lines of ---, then the instructions below it. If the user wants the skill deleted or emptied, do not propose it: tell them that they can delete one of their own skills themselves, from their list of skills on claude.ai.'
