/**
 * densable 2.1.248 #33 — gold `b` / `C` / `w` / `R`.
 * SEA: b @191865730 · C @191866061 · w @191866145 · R @191864989
 */

export type CommanderOptionLike = {
  attributeName: () => string
  negate: boolean
  long?: string
  flags: string
}

export type CommanderLike = {
  parent: CommanderLike | null
  options: readonly CommanderOptionLike[]
  getOptionValueSource: (name: string) => string | undefined
  getOptionValue: (name: string) => unknown
  args: string[]
}

export type SuppliedRootOption = {
  flag: string
  key: string
  value: unknown
}

const c: Record<string, never> = {}
const p: Record<string, never> = {}

/** Gold `f` — parent flags allowed before `remote-control`. */
const f = new Map<string, (value: unknown) => boolean>([
  ['verbose', () => true],
  ['debug', () => true],
  ['debugToStderr', () => true],
  ['debugFile', () => true],
  ['axScreenReader', () => true],
  ['workload', () => true],
  ['sessionId', () => true],
  ['name', () => true],
  ['remoteControlSessionNamePrefix', () => true],
  ['pluginDir', () => true],
  ['pluginDirNoMcp', () => true],
  ['pluginUrl', () => true],
  ['addDir', () => true],
  ['ide', () => true],
  ['chrome', (t: unknown) => t === true],
  ['model', () => true],
  ['effort', () => true],
  ['fallbackModel', () => true],
  ['betas', () => true],
  ['thinking', () => true],
  ['thinkingDisplay', () => true],
  ['maxThinkingTokens', () => true],
  ['autocompact', () => true],
  ['allowedTools', () => true],
  ['dangerouslySkipPermissions', () => true],
  ['allowDangerouslySkipPermissions', () => true],
  ['enableAutoMode', () => true],
  ['bare', () => true],
])

/** Gold `b` @191865730 */
export function suppliedRootOptions(
  command: CommanderLike,
): SuppliedRootOption[] {
  const parent = command.parent
  if (parent === null) return []
  const seen = new Map<string, SuppliedRootOption>()
  for (const option of parent.options) {
    const key = option.attributeName()
    if (seen.has(key) || parent.getOptionValueSource(key) !== 'cli') {
      continue
    }
    const value = parent.getOptionValue(key)
    const matched =
      parent.options.find(
        candidate =>
          candidate.attributeName() === key &&
          candidate.negate === (value === false),
      ) ?? option
    seen.set(key, {
      flag: matched.long ?? matched.flags,
      key,
      value,
    })
  }
  return [...seen.values()]
}

/** Gold `C` @191866061 */
export function rootOptionsRemoteControlRefuses(
  supplied: readonly SuppliedRootOption[],
): string[] {
  return supplied
    .filter(({ key, value }) => !f.get(key)?.(value))
    .map(({ flag }) => flag)
}

/** Gold `w` @191866145 */
export function rootOptionsRefusedMessage(flags: readonly string[]): string {
  const listed = flags.map(flag => `\`${flag}\``).join(', ')
  const [itThem, isAre] = flags.length === 1 ? ['it', 'is'] : ['them', 'are']
  const permissionHint = flags.includes('--permission-mode')
    ? ' Set the permission mode with `claude remote-control --permission-mode <mode>`.'
    : ''
  const settingsHint = flags.includes('--settings')
    ? ' Pass settings with `claude remote-control --settings <file>`.'
    : ''
  return (
    `Error: ${listed} before \`remote-control\` ${isAre} not carried over to the sessions Remote Control starts, so Remote Control refuses to start rather than drop ${itThem} \u2014 remove ${itThem}, and give Remote Control's own options after the verb (see \`claude remote-control --help\`).` +
    permissionHint +
    settingsHint
  )
}

/**
 * Gold `UZo` @311914537 — whether interactive workspace trust prompt can run
 * (requires TTY stdin/stdout, not bare mode, and CI env not truthy).
 */
export async function canPromptForRemoteControlTrust(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return false
  }
  const { isBareMode, isEnvTruthy } = await import('../utils/envUtils.js')
  return !isBareMode() && !isEnvTruthy(env.CI)
}

/** Gold `m` @191863334 */
export async function refuseRemoteControlLocally(): Promise<
  Record<string, never>
> {
  const { exitWithError } = await import('../utils/process.js')
  const { getSettingsWithErrors } = await import(
    '../utils/settings/settings.js'
  )
  if (getSettingsWithErrors().settings.disableRemoteControl === true) {
    exitWithError(
      "Error: Remote Control is disabled by your organization's policy (managed setting `disableRemoteControl`).",
    )
  }
  const [
    { getClaudeAIOAuthTokens },
    { BRIDGE_LOGIN_ERROR },
    { getBridgeAccessToken },
  ] = await Promise.all([
    import('../utils/auth.js'),
    import('../bridge/types.js'),
    import('../bridge/bridgeConfig.js'),
  ])
  if (!getClaudeAIOAuthTokens()?.accessToken && !getBridgeAccessToken()) {
    exitWithError(BRIDGE_LOGIN_ERROR)
  }
  return c
}

/** Gold `g` @191863896 */
export async function refuseRemoteControlIneligible(
  _local: Record<string, never>,
): Promise<Record<string, never>> {
  const { getBridgeDisabledReason, checkBridgeMinVersion } = await import(
    '../bridge/bridgeEnabled.js'
  )
  const { exitWithError } = await import('../utils/process.js')
  const disabled = await getBridgeDisabledReason()
  if (disabled) {
    exitWithError(`Error: ${disabled}`)
  }
  const versionError = checkBridgeMinVersion()
  if (versionError) {
    exitWithError(versionError)
  }
  const { waitForPolicyLimitsToLoad, isRemotePolicyAllowed } = await import(
    '../services/policyLimits/index.js'
  )
  await waitForPolicyLimitsToLoad()
  if (!isRemotePolicyAllowed('allow_remote_control')) {
    exitWithError(
      "Error: Remote Control is disabled by your organization's policy.",
    )
  }
  return p
}

/** Gold `y` @191864432 — local `bridgeMain` is args-only. */
export async function startRemoteControl(
  _ineligible: Record<string, never>,
  args: string[],
  _storage?: unknown,
  _credentials?: unknown,
): Promise<void> {
  const { bridgeMain } = await import('../bridge/bridgeMain.js')
  await bridgeMain(args)
}

/**
 * Gold `Qqa` + `UZo` (#1367) — verify or interactively prompt for workspace
 * trust before launching `claude remote-control`.
 */
export async function ensureRemoteControlTrust(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const {
    enableConfigs,
    checkHasTrustDialogAccepted,
    saveCurrentProjectConfig,
  } = await import('../utils/config.js')
  const { getCwd } = await import('../utils/cwd.js')
  const { homedir } = await import('os')
  const { exitWithError } = await import('../utils/process.js')
  const { resolve } = await import('path')

  enableConfigs()
  if (checkHasTrustDialogAccepted()) {
    return
  }

  const dir = getCwd()
  const isHomeDir = resolve(dir) === resolve(homedir())
  const unattendedMsg = isHomeDir
    ? `Error: Workspace not trusted. ${dir} is your home directory, and for security home-directory trust is never saved, so running \`claude\` here first won't help. Run \`claude remote-control\` from a project directory instead (run \`claude\` there once to accept the trust dialog).`
    : `Error: Workspace not trusted. Please run \`claude\` in ${dir} first to review and accept the workspace trust dialog.`

  const canPrompt = await canPromptForRemoteControlTrust(env)
  if (!canPrompt) {
    exitWithError(unattendedMsg)
  }

  process.stdout.write(
    `\nQuick safety check: is this a project you created or one you trust?\n  ${dir}\n`,
  )
  if (isHomeDir) {
    process.stdout.write(
      'This is your home directory, so trust lasts for this run only and is not saved.\n',
    )
  }
  const { createInterface } = await import('readline/promises')
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let answer = ''
  try {
    answer = await rl.question(`Trust ${dir}? [y/N] `)
  } finally {
    rl.close()
  }
  const normalized = answer.trim().toLowerCase()
  if (normalized !== 'y' && normalized !== 'yes') {
    exitWithError(
      `Remote Control did not start: ${dir} is not trusted. Run \`claude remote-control\` again to trust it.`,
    )
  }
  if (!isHomeDir) {
    saveCurrentProjectConfig(current => ({
      ...current,
      hasTrustDialogAccepted: true,
    }))
  }
}

/** Gold `R` @191864989 */
export async function enterRemoteControl(
  args: string[],
  storage?: unknown,
  extra?: unknown,
): Promise<void> {
  if (args.some(a => a === '--help' || a === '-h')) {
    const { printRemoteControlHelp } = await import('../bridge/bridgeMain.js')
    await printRemoteControlHelp()
    return
  }
  const local = await refuseRemoteControlLocally()
  const ineligible = await refuseRemoteControlIneligible(local)
  await ensureRemoteControlTrust()
  await startRemoteControl(ineligible, args, storage, extra)
}
