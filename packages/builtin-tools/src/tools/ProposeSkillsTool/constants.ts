/**
 * Official 2.1.331 propose_skills constants — See / Fti / uYo / $ti.
 */

export const PROPOSE_SKILLS_TOOL_NAME = 'propose_skills'

export const PROPOSE_SKILLS_MAX_PROPOSALS = 3

/** Official Fti = 64 codepoints max for a new skill name. */
export const PROPOSE_SKILLS_MAX_NAME_CHARS = 64

/** Official uYo = 1024 chars max for a skill description. */
export const PROPOSE_SKILLS_MAX_DESCRIPTION_CHARS = 1024

/** Official $ti = forbidden substrings in a new skill name. */
export const PROPOSE_SKILLS_FORBIDDEN_NAME_SUBSTRINGS = [
  'claude',
  'anthropic',
] as const
