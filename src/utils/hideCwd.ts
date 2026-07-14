/**
 * Official CLAUDE_CODE_HIDE_CWD — suppress cwd in version/banner strings.
 */

import { isEnvTruthy } from './envUtils.js'

export function shouldHideCwd(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_HIDE_CWD)
}

/**
 * Official shape: when hide, empty cwd segment; else `label in host` or label.
 */
export function formatVersionCwdLabel(input: {
  label: string
  host?: string
  env?: NodeJS.ProcessEnv
}): string {
  if (shouldHideCwd(input.env ?? process.env)) return ''
  if (input.host) {
    const host = input.host.replace(/^https?:\/\//, '')
    return `${input.label} in ${host}`
  }
  return input.label
}
