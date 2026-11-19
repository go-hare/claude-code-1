import { isDeepStrictEqual } from 'util'
import type { ValidationResult } from 'src/Tool.js'
import { isClaudeSettingsPath } from '../permissions/filesystem.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { validateSettingsFileContent } from './validation.js'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Official 2.1.326 #256 (`rHi`): format only the schema snippets for top-level
 * keys that the edit changed, plus the list of valid top-level keys if any
 * changed key is unrecognized. Avoids dumping the entire ~93k settings schema
 * into the Edit tool error message.
 */
function formatChangedSettingsKeysSchema(
  originalContent: string,
  updatedContent: string,
  fullSchemaJson: string,
): string {
  let afterObj: unknown
  try {
    afterObj = jsonParse(updatedContent)
  } catch {
    return ''
  }
  if (!isPlainRecord(afterObj)) return ''
  let beforeObj: Record<string, unknown> = {}
  try {
    const parsedBefore = jsonParse(originalContent)
    if (isPlainRecord(parsedBefore)) beforeObj = parsedBefore
  } catch {
    // ignore
  }
  let properties: Record<string, unknown> = {}
  try {
    const schemaObj = jsonParse(fullSchemaJson) as {
      properties?: Record<string, unknown>
    }
    if (isPlainRecord(schemaObj?.properties)) {
      properties = schemaObj.properties
    }
  } catch {
    return ''
  }
  const changedKeys = Object.keys(afterObj).filter(
    key => !isDeepStrictEqual(afterObj[key], beforeObj[key]),
  )
  const knownChangedKeys = changedKeys.filter(key =>
    Object.hasOwn(properties, key),
  )
  let out = ''
  if (knownChangedKeys.length > 0) {
    const picked: Record<string, unknown> = {}
    for (const key of knownChangedKeys) {
      picked[key] = properties[key]
    }
    out += `\nSchema of the keys this edit changed:\n${jsonStringify(picked, null, 2)}\n`
  }
  if (knownChangedKeys.length < changedKeys.length) {
    out += `\nValid top-level keys: ${Object.keys(properties).join(', ')}\n`
  }
  return out
}

/**
 * Validates settings file edits to ensure the result conforms to SettingsSchema.
 * This is used by FileEditTool to avoid code duplication.
 *
 * @param filePath - The file path being edited
 * @param originalContent - The original file content before edits
 * @param getUpdatedContent - A closure that returns the content after applying edits
 * @returns Validation result with error details if validation fails
 */
export function validateInputForSettingsFileEdit(
  filePath: string,
  originalContent: string,
  getUpdatedContent: () => string,
): Extract<ValidationResult, { result: false }> | null {
  // Only validate Claude settings files
  if (!isClaudeSettingsPath(filePath)) {
    return null
  }

  // Check if the current file (before edit) conforms to the schema
  const beforeValidation = validateSettingsFileContent(originalContent)

  if (!beforeValidation.isValid) {
    // If the before version is invalid, allow the edit (don't block it)
    return null
  }

  // If the before version is valid, ensure the after version is also valid
  const updatedContent = getUpdatedContent()
  const afterValidation = validateSettingsFileContent(updatedContent)

  if (!afterValidation.isValid) {
    return {
      result: false,
      message: `Claude Code settings.json validation failed after edit:\n${afterValidation.error}\n${formatChangedSettingsKeysSchema(originalContent, updatedContent, afterValidation.fullSchema)}\nIMPORTANT: Do not update the env unless explicitly instructed to do so.`,
      errorCode: 10,
    }
  }

  return null
}
