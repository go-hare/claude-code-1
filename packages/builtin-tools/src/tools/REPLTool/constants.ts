import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'

export const REPL_TOOL_NAME = 'REPL'

/**
 * REPL mode is default-on for ants in the interactive CLI (opt out with
 * CLAUDE_CODE_REPL=0). The legacy CLAUDE_REPL_MODE=1 also forces it on.
 *
 * SDK entrypoints (sdk-ts, sdk-py, sdk-cli) are NOT defaulted on — SDK
 * consumers script direct tool calls (Bash, Read, etc.) and REPL mode
 * hides those tools. USER_TYPE is a build-time --define, so the ant-native
 * binary would otherwise force REPL mode on every SDK subprocess regardless
 * of the env the caller passes.
 */
export function isReplModeEnabled(): boolean {
  // Official KO densable: defined-falsy REPL → off; truthy REPL → on; else
  // legacy CLAUDE_REPL_MODE; else cli|remote + ant/GB.
  try {
    const { resolveReplModeEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
    return resolveReplModeEnabled({
      antDefault:
        process.env.USER_TYPE === 'ant' &&
        (process.env.CLAUDE_CODE_ENTRYPOINT === 'cli' ||
          process.env.CLAUDE_CODE_ENTRYPOINT === 'remote'),
    })
  } catch {
    if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_REPL)) return false
    if (isEnvTruthy(process.env.CLAUDE_CODE_REPL)) return true
    if (isEnvTruthy(process.env.CLAUDE_REPL_MODE)) return true
    return (
      process.env.USER_TYPE === 'ant' &&
      (process.env.CLAUDE_CODE_ENTRYPOINT === 'cli' ||
        process.env.CLAUDE_CODE_ENTRYPOINT === 'remote')
    )
  }
}

/**
 * Tools that are only accessible via REPL when REPL mode is enabled.
 * When REPL mode is on, these tools are hidden from Claude's direct use,
 * forcing Claude to use REPL for batch operations.
 *
 * Wire-name literals (not imported *_TOOL_NAME consts) — FileReadTool/prompt
 * and sibling tool modules loop back through the tool registry, so a
 * module-init Set of those bindings hits "Cannot access before
 * initialization". Same cycle getReplPrimitiveTools() already defers.
 */
export const REPL_ONLY_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'NotebookEdit',
  'Agent',
])
