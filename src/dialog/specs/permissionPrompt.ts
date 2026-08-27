/**
 * Back-compat re-exports — prefer `./permissionKinds.js`.
 */
export {
  PERMISSION_PROMPT_KIND,
  permissionPromptSpec,
  permissionPromptDialogId,
  type PermissionPromptResult,
  isPermissionDialogKind,
} from './permissionKinds.js'

export type PermissionPromptPayload = {
  requestId: string
  toolName: string
}
