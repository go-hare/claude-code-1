export const SHELL_TYPES = ['bash', 'powershell'] as const
export type ShellType = (typeof SHELL_TYPES)[number]
export const DEFAULT_HOOK_SHELL: ShellType = 'bash'

export type ShellProvider = {
  type: ShellType
  shellPath: string
  detached: boolean
  /**
   * densable 2.1.214 #21 — spawn stdio[0].
   * PowerShell provider sets `"ignore"` so child processes that wait on
   * stdin do not hang until tool timeout. Bash keeps default `"pipe"`.
   */
  stdin?: 'pipe' | 'ignore'

  /**
   * Build the full command string including all shell-specific setup.
   * For bash: source snapshot, session env, disable extglob, eval-wrap, pwd tracking.
   */
  buildExecCommand(
    command: string,
    opts: {
      id: number | string
      sandboxTmpDir?: string
      useSandbox: boolean
    },
  ): Promise<{ commandString: string; cwdFilePath: string }>

  /**
   * Shell args for spawn (e.g., ['-c', '-l', cmd] for bash).
   */
  getSpawnArgs(commandString: string): string[]

  /**
   * Extra env vars for this shell type.
   * May perform async initialization (e.g., tmux socket setup for bash).
   */
  getEnvironmentOverrides(command: string): Promise<Record<string, string>>
}
