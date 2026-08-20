/**
 * Escape XML/HTML special characters for safe interpolation into element
 * text content (between tags). Use when untrusted strings (process stdout,
 * user input, external data) go inside `<tag>${here}</tag>`.
 */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
