/**
 * Official 2.1.247 ADt / eA shell-output footer.
 * Format is the contract. Do not map -1 → null / 0 / omitted.
 */
export function formatLocalShellExitFooter(
  status: 'completed' | 'failed' | 'killed',
  exitCode: number | undefined | null,
): string {
  return `\n[${status === 'killed' ? 'killed' : `exited with code ${exitCode ?? 'unknown'}`}]\n`
}

/** Official ADt `if(!u?.isAdopted)` / eA `if(!n.isAdopted)` — skip footer. */
export function shouldAppendLocalShellExitFooter(
  task: { isAdopted?: boolean } | null | undefined,
): boolean {
  return !task?.isAdopted
}
