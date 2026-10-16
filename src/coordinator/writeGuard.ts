import type { ValidationResult } from '../Tool.js'

type ValidateCoordinatorWriteAccessInput = {
  filePath: string
  sourceTool: string
}

/**
 * densable 2.1.289: coordinator file-lock unique English is 0 hits.
 * ownedFiles already cut; this host stays an allow-no-op so FileEdit /
 * FileWrite / Bash coordinatorWriteValidation keep compiling.
 */
export function validateCoordinatorWriteAccess(
  _input: ValidateCoordinatorWriteAccessInput,
): ValidationResult {
  return { result: true }
}
