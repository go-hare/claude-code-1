/**
 * densable classifierMetaLines residual (Crd / wrd / mfo).
 *
 * Auto-mode classifier may attach repoVisibility / gitStatus meta lines for a
 * tool_use. Those lines are:
 * 1. Stored under tool_use id (wrd → Crd Map)
 * 2. Stamped onto the subsequent tool_result UserMessage as classifierMetaLines
 *    when createUserMessage sees a single tool_result (mfo)
 * 3. Re-injected as transcript `meta` blocks before the matching tool_use on
 *    later classifier calls (and() first-pass + live map)
 *
 * Behavior only — never sent to the main model; no analytics.
 */

const classifierMetaByToolUseId = new Map<string, string>()

/** densable wfs — JSON wrapper for structured meta payloads. */
export function serializeClassifierMeta(
  meta: Record<string, unknown>,
): string {
  return JSON.stringify({ meta })
}

/** densable wrd — remember meta lines for a tool_use id. */
export function setClassifierMetaLines(
  toolUseId: string,
  lines: string,
): void {
  if (!toolUseId) return
  classifierMetaByToolUseId.set(toolUseId, lines)
}

/** densable mfo — lookup stored meta lines for a tool_use id. */
export function getClassifierMetaLines(
  toolUseId: string,
): string | undefined {
  if (!toolUseId) return undefined
  return classifierMetaByToolUseId.get(toolUseId)
}

/**
 * densable Nr auto-stamp: when content is a single tool_result, pull meta
 * lines from the live map for that tool_use_id.
 */
export function classifierMetaLinesForToolResultContent(
  content: unknown,
): string | undefined {
  if (!Array.isArray(content)) return undefined
  const toolResults = content.filter(
    (b): b is { type: 'tool_result'; tool_use_id?: string } =>
      typeof b === 'object' &&
      b !== null &&
      (b as { type?: string }).type === 'tool_result',
  )
  if (toolResults.length !== 1) return undefined
  const id = toolResults[0]?.tool_use_id
  if (typeof id !== 'string' || id.length === 0) return undefined
  return getClassifierMetaLines(id)
}

/** Test helper — clear the session map. */
export function clearClassifierMetaLinesForTests(): void {
  classifierMetaByToolUseId.clear()
}
