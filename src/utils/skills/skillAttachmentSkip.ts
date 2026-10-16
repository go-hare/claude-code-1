/**
 * densable 2.1.289 `Lje` / `k3r` / `gZn`.
 * Skip CTe attachments for untrusted remote-ish skill sources.
 * Never export minify Lje|k3r|gZn.
 */

/**
 * densable `Fb` — `CLAUDE_CODE_ENTRYPOINT==="remote_cowork"`.
 */
export function isRemoteCoworkEntrypoint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork'
}

/**
 * densable `gZn` = Boolean(REMOTE) || Boolean(COWORK) || Fb().
 * Raw Boolean — `"0"` is truthy, matching gold, not isEnvTruthy.
 */
export function isRemoteOrCoworkHost(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(env.CLAUDE_CODE_REMOTE) ||
    Boolean(env.CLAUDE_CODE_IS_COWORK) ||
    isRemoteCoworkEntrypoint(env)
  )
}

/**
 * densable `k3r` — untrusted loadedFrom for attachments.
 * `loadedFrom===undefined` → `Boolean(isMcp)`.
 */
export function isUntrustedSkillAttachmentSource(command: {
  loadedFrom?: string
  isMcp?: boolean
}): boolean {
  if (command.loadedFrom === undefined) return Boolean(command.isMcp)
  switch (command.loadedFrom) {
    case 'skills':
    case 'commands_DEPRECATED':
    case 'plugin':
    case 'managed':
    case 'bundled':
      return false
    case 'syncedSkills':
    case 'mcp':
    case 'memoryStore':
    case 'attachedFolder':
      return true
    default:
      return false
  }
}

/**
 * densable `Lje`. syncedSkills → skip attachments unless remote/cowork host.
 * Else k3r.
 */
export function shouldSkipSkillAttachments(
  command: { loadedFrom?: string; isMcp?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (command.loadedFrom === 'syncedSkills') return !isRemoteOrCoworkHost(env)
  return isUntrustedSkillAttachmentSource(command)
}
