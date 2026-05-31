/**
 * Attach Handler — DEPRECATED.
 *
 * The attach logic is now inline in bgManager.ts (handleAttachOp).
 * This file is kept as a stub for any remaining imports.
 */

export type { AttacherEntry } from './bgWorker.js'
export type { BgWorker as AttachableWorker } from './bgWorker.js'
export type { ControlRequest as AttachRequest } from './controlSocket.js'

// The handleAttach function is no longer needed as a separate export.
// Attach logic lives in bgManager.ts handleAttachOp.
