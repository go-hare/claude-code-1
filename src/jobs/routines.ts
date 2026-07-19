/**
 * Local routines registry for FleetView composer `@routine` mentions.
 *
 * Official cloud routines live under claude.ai; local portable surface is
 * markdown files under `.claude/routines/` (project) and `~/.claude/routines/`.
 * When empty, parseDispatch still accepts the routines arg as `[]`.
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import type { FrontmatterData } from '../utils/frontmatterParser.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { extractDescriptionFromMarkdown } from '../utils/markdownConfigLoader.js'

export interface RoutineInfo {
  name: string
  description: string
  filePath: string
  frontmatter: FrontmatterData
  content: string
}

/**
 * Walk cwd → parents for `.claude/routines`, plus `~/.claude/routines`.
 * Not registered in ClaudeConfigDirectory (cloud routines are separate).
 */
function getRoutinesDirs(): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()
  let cur = process.cwd()
  const home = getClaudeConfigHomeDir()
  // Stop when we leave the filesystem root or hit home parent.
  for (let i = 0; i < 32; i++) {
    const candidate = join(cur, '.claude', 'routines')
    if (!seen.has(candidate) && existsSync(candidate)) {
      seen.add(candidate)
      dirs.push(candidate)
    }
    const parent = dirname(cur)
    if (parent === cur) break
    // Don't climb above the user's home project tree for local routines.
    if (cur === home || parent === dirname(home)) break
    cur = parent
  }
  const userDir = join(home, 'routines')
  if (!seen.has(userDir) && existsSync(userDir)) {
    dirs.push(userDir)
  }
  return dirs
}

/** List local routines (markdown under .claude/routines / ~/.claude/routines). */
export function listRoutines(): RoutineInfo[] {
  const routines: RoutineInfo[] = []
  const seenNames = new Set<string>()

  for (const dir of getRoutinesDirs()) {
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const name = basename(file, '.md')
      if (seenNames.has(name)) continue
      seenNames.add(name)

      const filePath = join(dir, file)
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const { frontmatter, content } = parseFrontmatter(raw, filePath)
        const description =
          (typeof frontmatter.description === 'string'
            ? frontmatter.description
            : '') || extractDescriptionFromMarkdown(content, 'No description')

        routines.push({ name, description, filePath, frontmatter, content })
      } catch {
        // Skip unreadable files
      }
    }
  }

  return routines
}

export function loadRoutine(name: string): RoutineInfo | null {
  return listRoutines().find(t => t.name === name) ?? null
}
