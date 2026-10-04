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
 * densable 2.1.283: TaskOutput is gone from the live pool;
 * TASK_MAX_OUTPUT_LENGTH / taskOutputMaxChars no longer cap product.
 * Residual callers get the full string. Disk cap stays in diskOutput.ts.
 */
export function formatTaskOutput(
  output: string,
  _taskId: string,
): { content: string; wasTruncated: boolean } {
  return { content: output, wasTruncated: false }
}
