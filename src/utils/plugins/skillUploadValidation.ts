/**
 * Official 2.1.323 #2146 (`UOi` / `BOi`): pre-upload validation for `SKILL.md`
 * and `.skill` zip archives sent from Cowork cloud sessions so unsaveable skill
 * files are caught before hitting claude.ai's upload endpoint.
 */
import { unzipSync } from 'fflate'
import { basename } from 'path'
import { parseFrontmatter } from '../frontmatterParser.js'

export const SKILL_MAX_DESCRIPTION_CHARS = 1024
export const SKILL_MAX_ARCHIVE_FILES = 200
export const SKILL_RESERVED_NAME_WORDS = ['claude', 'anthropic'] as const

const DISALLOWED_PATH_CHAR_RE = /[^A-Za-z0-9_ .\-/(),\u0080-\uFFFF]/
const IGNORED_ARCHIVE_ENTRY_RE =
  /(?:^|\/)(?:__MACOSX\/|(?:\.DS_Store|Thumbs\.db|desktop\.ini)$)/
const OPEN_ANGLE_RE = /[<\uFE64\uFF1C]/
const CLOSE_ANGLE_RE = /[>\uFE65\uFF1E]/
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const MAX_SKILL_MD_BYTES = 1024 * 1024
const MAX_FRONTMATTER_SNIFF_BYTES = 64 * 1024

export type SkillUploadValidationFailure = {
  rule:
    | 'too_many_files'
    | 'path_character'
    | 'reserved_word_in_name'
    | 'description_too_long'
    | 'description_has_xml_tag'
  why: string
}

/** Official `uss` — detect XML-like angle-bracket tags (`<...>`) in description. */
export function hasSkillDescriptionXmlTag(description: string): boolean {
  const openIdx = description.search(OPEN_ANGLE_RE)
  return openIdx !== -1 && CLOSE_ANGLE_RE.test(description.slice(openIdx + 2))
}

/** Official `UOi` — true when path names `SKILL.md` or a `.skill` package. */
export function isSkillAttachmentPath(filePath: string): boolean {
  const name = basename(filePath)
  return name === 'SKILL.md' || name.toLowerCase().endsWith('.skill')
}

function validateSkillMarkdownBytes(
  bytes: Uint8Array,
): SkillUploadValidationFailure | undefined {
  const head = Buffer.from(
    bytes.subarray(0, MAX_FRONTMATTER_SNIFF_BYTES),
  ).toString('utf8')
  const match = FRONTMATTER_BLOCK_RE.exec(head)
  const body = match?.[1]
  if (body === undefined || body.includes('---')) {
    return undefined
  }
  const { frontmatter } = parseFrontmatter(`---\n${body}\n---\n`)
  const name =
    typeof frontmatter.name === 'string' ? frontmatter.name.toLowerCase() : ''
  if (SKILL_RESERVED_NAME_WORDS.some(word => name.includes(word))) {
    return {
      rule: 'reserved_word_in_name',
      why: 'the name in its SKILL.md header contains "claude" or "anthropic", which a saved skill\'s name cannot include',
    }
  }
  if (typeof frontmatter.description !== 'string') {
    return undefined
  }
  const desc = frontmatter.description.trim()
  const descLen = Array.from(desc).length
  if (descLen > SKILL_MAX_DESCRIPTION_CHARS) {
    return {
      rule: 'description_too_long',
      why: `the description in its SKILL.md header has ${descLen} characters, and a saved skill's description can hold ${SKILL_MAX_DESCRIPTION_CHARS}`,
    }
  }
  if (hasSkillDescriptionXmlTag(desc)) {
    return {
      rule: 'description_has_xml_tag',
      why: "the description in its SKILL.md header contains angle brackets, which a saved skill's description cannot include",
    }
  }
  return undefined
}

/**
 * Official `BOi` — validate a `SKILL.md` or `.skill` zip buffer before upload.
 * Returns `undefined` when valid (or when archive cannot be parsed as a zip).
 */
export function validateSkillAttachmentForUpload(
  filePath: string,
  bytes: Uint8Array,
): SkillUploadValidationFailure | undefined {
  if (basename(filePath) === 'SKILL.md') {
    return validateSkillMarkdownBytes(bytes)
  }
  const fileNames: string[] = []
  let skillMdCount = 0
  let skillMdBytes: Uint8Array | undefined
  try {
    const entries = unzipSync(bytes, {
      filter: info => {
        if (
          info.name.endsWith('/') ||
          IGNORED_ARCHIVE_ENTRY_RE.test(info.name)
        ) {
          return false
        }
        fileNames.push(info.name)
        if (!/^(?:[^/]+\/)?SKILL\.md$/.test(info.name)) {
          return false
        }
        skillMdCount++
        return skillMdCount === 1 && info.originalSize <= MAX_SKILL_MD_BYTES
      },
    })
    skillMdBytes = Object.values(entries)[0]
  } catch {
    return undefined
  }
  if (fileNames.length > SKILL_MAX_ARCHIVE_FILES) {
    return {
      rule: 'too_many_files',
      why: `it holds ${fileNames.length} files, and a saved skill can hold ${SKILL_MAX_ARCHIVE_FILES}`,
    }
  }
  const badChars = fileNames.flatMap(name => {
    const m = DISALLOWED_PATH_CHAR_RE.exec(name)
    return m ? [m[0]] : []
  })
  if (badChars[0] !== undefined) {
    const noun = badChars.length === 1 ? 'paths has' : 'paths have'
    return {
      rule: 'path_character',
      why: `${badChars.length} of its file ${noun} a character that a saved skill's paths cannot hold, such as ${JSON.stringify(badChars[0])}; they can hold letters, digits, spaces, _ . - / ( ) and the comma`,
    }
  }
  return skillMdBytes !== undefined && skillMdCount === 1
    ? validateSkillMarkdownBytes(skillMdBytes)
    : undefined
}

/** Format user/model-facing refusal when a skill file cannot be saved by claude.ai. */
export function formatUnsaveableSkillRefusal(
  filePath: string,
  bytes: Uint8Array,
): { rule: SkillUploadValidationFailure['rule']; message: string } | undefined {
  if (!isSkillAttachmentPath(filePath)) return undefined
  const failure = validateSkillAttachmentForUpload(filePath, bytes)
  if (!failure) return undefined
  return {
    rule: failure.rule,
    message: `not sent: claude.ai would refuse to save it as a skill, because ${failure.why}. Fix the file and send it again; to send it only as a download, give the file a name that is not SKILL.md and does not end in .skill`,
  }
}
