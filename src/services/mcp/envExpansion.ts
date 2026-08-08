/**
 * Shared utilities for expanding environment variables in MCP server configurations.
 * densable 2.1.219 S7 — optional primary env + fallbackEnv for managed policy predicates.
 */

export type EnvLookup = NodeJS.Dict<string> | Record<string, string | undefined>

/**
 * densable ZGu — env values that inject wildcard semantics into policy predicates.
 */
export function envValueContainsWildcard(value: string): boolean {
  try {
    if (value.normalize('NFKC').includes('*') || /%2a/i.test(value)) {
      return true
    }
    if (value.includes('%')) {
      try {
        return decodeURIComponent(value).normalize('NFKC').includes('*')
      } catch {
        return false
      }
    }
  } catch {
    return false
  }
  return false
}

/**
 * Expand environment variables in a string value.
 * Handles ${VAR} and ${VAR:-default} syntax (densable S7).
 *
 * @param value String that may contain ${VAR} placeholders
 * @param env Primary lookup (default: process.env). Policy predicates use
 *   startup freeze + managed-settings env (Y6u), not live settings-file env.
 * @param fallbackEnv Optional secondary lookup (deny path Hyy fallbackEnv:
 *   globalConfig / user / flag / policy settings.env)
 * @returns expanded string, missing var names, and vars whose values inject *
 */
export function expandEnvVarsInString(
  value: string,
  env: EnvLookup = process.env,
  fallbackEnv?: EnvLookup,
): {
  expanded: string
  missingVars: string[]
  wildcardVars: string[]
} {
  const missingVars: string[] = []
  const wildcardVars: string[] = []

  // densable S7 regex: only valid shell-ish identifiers (+ optional :-default)
  const expanded = value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?)\}/g,
    (match, varContent: string) => {
      const sep = varContent.indexOf(':-')
      const varName = sep === -1 ? varContent : varContent.slice(0, sep)
      const defaultValue = sep === -1 ? undefined : varContent.slice(sep + 2)

      const primary = env[varName]
      if (typeof primary === 'string') {
        if (envValueContainsWildcard(primary)) {
          wildcardVars.push(varName)
        }
        return primary
      }

      if (defaultValue !== undefined) {
        return defaultValue
      }

      const fallback = fallbackEnv?.[varName]
      if (typeof fallback === 'string') {
        if (envValueContainsWildcard(fallback)) {
          wildcardVars.push(varName)
        }
        return fallback
      }

      missingVars.push(varName)
      return match
    },
  )

  return {
    expanded,
    missingVars,
    wildcardVars,
  }
}
