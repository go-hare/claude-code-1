/**
 * Escape XML/HTML special characters for safe interpolation into element
 * text content (between tags). Use when untrusted strings (process stdout,
 * user input, external data) go inside `<tag>${here}</tag>`.
 */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** densable `cYb` — leftover C0/C1/LS/PS after `&<>` escape */
// biome-ignore lint/suspicious/noControlCharactersInRegex: densable cYb C0/C1
const OUTPUT_STYLE_NAME_CTRL_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g

/**
 * densable `pze`/`ktp` — HTML-escape an output-style name for the per-turn
 * reminder. Control chars become `&#N;` numeric references.
 */
export function escapeOutputStyleName(s: string): string {
  return escapeXml(s).replace(
    OUTPUT_STYLE_NAME_CTRL_RE,
    ch => `&#${ch.charCodeAt(0)};`,
  )
}

/**
 * densable oX(C7_/Fud) — display-side unescape for `&amp;|&lt;|&gt;` only.
 * Inverse of escapeXml / Ua for UI render of local-command / bash stdout·stderr
 * and slash command-message/args that may carry write-side entities (EHe/Ua).
 * Not artifact decodeHtmlEntities/TDr.
 */
const XML_DISPLAY_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
}

const XML_DISPLAY_ENTITY_RE = /&(?:amp|lt|gt);/g

export function unescapeXmlEntities(s: string): string {
  return s.replace(
    XML_DISPLAY_ENTITY_RE,
    entity => XML_DISPLAY_ENTITIES[entity] ?? entity,
  )
}

/**
 * densable O8e — escape path/text for embedding inside system-reminder XML.
 * Adds CR/LF escapes densable uses so multiline paths cannot break the tag.
 */
export function escapeXmlForSystemReminder(s: string): string {
  return escapeXml(s).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
}

/**
 * Escape for interpolation into a double- or single-quoted attribute value:
 * `<tag attr="${here}">`. Escapes quotes in addition to `& < >`.
 */
export function escapeXmlAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
