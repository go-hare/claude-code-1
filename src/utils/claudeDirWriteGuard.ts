/**
 * densable 2.1.216 — project `.claude` write guard.
 *
 * Re-exports densable YNn chain (`assertDirChainReal`) as the public
 * `assertProjectClaudeDirWritable` surface used by cron / workflow call sites.
 * Prefer importing from `symlinkWriteGuard.js` for full M6 / Fle types.
 */

export {
  assertDirChainReal,
  assertProjectClaudeDirWritable,
  isClaudeConfigDirPath,
  SymlinkWriteRefusedError,
  // Back-compat alias used by older tests / call sites
  SymlinkWriteRefusedError as ClaudeDirSymlinkEscapeError,
} from './symlinkWriteGuard.js'
