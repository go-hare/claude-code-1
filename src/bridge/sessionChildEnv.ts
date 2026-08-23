/**
 * densable 2.1.238 #21 — NDl session-child env for RC spawn.
 *
 * parent env + Vso→undefined + MDl keep + override `l`, then case-insensitive
 * duplicate-key delete, Eot (UKT uppercase delete), wot (strip vscode/desktop
 * ENTRYPOINT). Does **not** apply mrn / ANTHROPIC_MODEL (that's agent/bg spawn).
 *
 * Callers may overlay tip extras (POST_FOR_SESSION_INGRESS_V2 / USE_CCR_V2)
 * after this builder.
 */

/** Keys restored from parent after the Vso wipe. */
export const SESSION_CHILD_KEEP_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
] as const

/** Session/host keys scrubbed to undefined before overrides. */
export const SESSION_CHILD_SCRUB_KEYS = [
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_WORKER_EPOCH',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS',
  'CLAUDE_CODE_RESUME_PROMPT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SYNC_SESSION_REFS',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_TRIGGER_ID',
  'CLAUDE_CODE_BASE_REF',
  'CLAUDE_CODE_BASE_REFS',
  'CLAUDE_CODE_REPO_CHECKOUTS',
  'CLAUDE_CODE_DIAGNOSTICS_FILE',
  'CLAUDE_SESSION_INGRESS_TOKEN_FILE',
  ...SESSION_CHILD_KEEP_KEYS,
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDE_CODE_SKILL_PROPOSALS',
  'CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR',
  'CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH',
  'CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES',
  'CLAUDE_RUNNER_ACTIVITY_FD',
] as const

/** densable UKT — case-insensitive delete after the merge. */
export const SESSION_CHILD_UPPERCASE_DELETE_KEYS = [
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR',
  'CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH',
  'CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES',
] as const

/** densable BKT — strip CLAUDE_CODE_ENTRYPOINT when inherited from vscode/desktop. */
export const SESSION_CHILD_STRIP_ENTRYPOINTS = [
  'claude-vscode',
  'claude-desktop',
  'claude-desktop-3p',
] as const

export type SessionChildEnvOpts = {
  accessToken: string
  workerEpoch?: number
  sandbox?: boolean
}

function deleteUppercaseMatches(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): void {
  const upper = new Set(names.map(name => name.toUpperCase()))
  for (const key of Object.keys(env)) {
    if (upper.has(key.toUpperCase())) {
      delete env[key]
    }
  }
}

function stripHostEntrypoint(env: NodeJS.ProcessEnv): void {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  if (
    typeof entry === 'string' &&
    (SESSION_CHILD_STRIP_ENTRYPOINTS as readonly string[]).includes(entry)
  ) {
    delete env.CLAUDE_CODE_ENTRYPOINT
  }
}

/**
 * densable NDl — build the child env for a Remote Control session spawn.
 */
export function buildSessionChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  opts: SessionChildEnvOpts,
): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {
    CLAUDE_CODE_OAUTH_TOKEN: undefined,
    CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
    ...(opts.sandbox ? { CLAUDE_CODE_FORCE_SANDBOX: '1' } : {}),
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: opts.accessToken,
    CLAUDE_CODE_WORKER_EPOCH:
      opts.workerEpoch !== undefined ? String(opts.workerEpoch) : undefined,
    CLAUDE_CODE_RESUME_INTERRUPTED_TURN:
      (opts.workerEpoch ?? 0) > 1 ? '1' : undefined,
    CLAUDE_CODE_RESUME_FROM_SESSION: undefined,
    CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR: undefined,
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: undefined,
    CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: undefined,
    CLAUDE_BG_AUTH_SNAPSHOT_PATH: undefined,
    CLAUDE_CODE_ACCOUNT_UUID: undefined,
    CLAUDE_CODE_ORGANIZATION_UUID: undefined,
    CLAUDE_CODE_USER_EMAIL: undefined,
    CCR_SESSION_ACCOUNT_EMAIL: undefined,
    SESSION_INGRESS_URL: undefined,
    CLAUDE_CODE_EXIT_AFTER_STOP_DELAY: undefined,
  }

  const env: NodeJS.ProcessEnv = { ...parentEnv }
  for (const key of SESSION_CHILD_SCRUB_KEYS) {
    env[key] = undefined
  }
  for (const key of SESSION_CHILD_KEEP_KEYS) {
    env[key] = parentEnv[key]
  }
  Object.assign(env, overrides)

  const protectedKeys = new Set<string>([
    ...SESSION_CHILD_SCRUB_KEYS,
    ...Object.keys(overrides),
  ])
  for (const key of Object.keys(env)) {
    if (!protectedKeys.has(key) && protectedKeys.has(key.toUpperCase())) {
      delete env[key]
    }
  }

  deleteUppercaseMatches(env, SESSION_CHILD_UPPERCASE_DELETE_KEYS)
  stripHostEntrypoint(env)
  return env
}
