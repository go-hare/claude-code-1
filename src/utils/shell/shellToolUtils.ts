import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Ant defaults on (opt-out via env=0);
 * external defaults off (opt-in via env=1).
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  // Official USE_POWERSHELL_TOOL densable pure env half.
  try {
    const { resolvePowerShellToolEnvOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    const envOverride = resolvePowerShellToolEnvOverride()
    if (envOverride !== null) return envOverride
    // Unset: ant defaults on, external defaults off.
    return process.env.USER_TYPE === 'ant'
  } catch {
    return process.env.USER_TYPE === 'ant'
      ? !isEnvDefinedFalsy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
  }
}
