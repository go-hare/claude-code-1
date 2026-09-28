import { getTaskOutputPath } from './diskOutput.js'

export const TASK_MAX_OUTPUT_UPPER_LIMIT = 160_000
export const TASK_MAX_OUTPUT_DEFAULT = 32_000

/**
 * densable 2.1.283 — TaskOutput removed; taskOutputMaxChars and
 * TASK_MAX_OUTPUT_LENGTH no longer have any effect. Keep a fixed default so
 * leftover formatTaskOutput callers still bound inline previews.
 */
export function getMaxTaskOutputLength(): number {
  return TASK_MAX_OUTPUT_DEFAULT
}

/**
 * Format task output for API consumption, truncating if too large.
 * When truncated, includes a header with the file path and returns
 * the last N characters that fit within the limit.
 */
export function formatTaskOutput(
  output: string,
  taskId: string,
): { content: string; wasTruncated: boolean } {
  const maxLen = getMaxTaskOutputLength()

  if (output.length <= maxLen) {
    return { content: output, wasTruncated: false }
  }

  const filePath = getTaskOutputPath(taskId)
  const header = `[Truncated. Full output: ${filePath}]\n\n`
  const availableSpace = maxLen - header.length
  const truncated = output.slice(-availableSpace)

  return { content: header + truncated, wasTruncated: true }
}
