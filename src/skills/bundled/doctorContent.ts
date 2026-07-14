/**
 * Official 2.1.208 doctor/checkup skill prompt (tkb).
 * Content extracted from binary — keep in sync with official when re-porting.
 */
import PROMPT_MD from './doctorContent/PROMPT.md' with { type: 'text' }

export const DOCTOR_SKILL_NAME = 'doctor'

export const DOCTOR_SKILL_ALIASES = ['checkup'] as const

export const DOCTOR_SKILL_MENU_DESCRIPTION =
  'Health-check your setup and fix issues: installation, unused extensions, duplicated or bloated memory files, slow hooks, updates, permissions'

export const DOCTOR_SKILL_DESCRIPTION =
  "Health-check the user's Claude Code setup and fix issues: diagnose installation health — what the `claude doctor` terminal diagnostics cover — from local data (duplicate or leftover installs, PATH, unparseable settings files, broken or colliding agent definitions); find unused skills, MCP servers, and plugins versus their context cost and disable dead weight; deduplicate local CLAUDE.md files against checked-in ones; trim checked-in CLAUDE.md files by cutting content a session could derive from the codebase (directory layouts, tech-stack lists, architecture overviews) while keeping gotchas, rationale, and non-standard conventions; migrate always-loaded CLAUDE.md guidance into lazy skills and nested CLAUDE.md files; flag slow hooks and context-heavy extensions; check the installed version is current; make auto mode the default permission mode; and pre-approve frequently denied read-only commands. Use when the user asks for a doctor run, checkup, audit, tune-up, or cleanup of their Claude Code setup or configuration."

export const DOCTOR_SKILL_PROGRESS_MESSAGE = 'running checkup'

/** Official tkb() prompt body. */
export const DOCTOR_SKILL_PROMPT: string = PROMPT_MD
