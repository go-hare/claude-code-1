/**
 * Official CLAUDE_CODE_MAX_TURNS portable resolver.
 * Must be a positive integer when set; invalid throws (official).
 */

export function resolveMaxTurnsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_MAX_TURNS?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `CLAUDE_CODE_MAX_TURNS must be a positive integer; got "${raw}"`,
    )
  }
  return n
}

export function tryResolveMaxTurnsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  try {
    return resolveMaxTurnsFromEnv(env)
  } catch {
    return undefined
  }
}
