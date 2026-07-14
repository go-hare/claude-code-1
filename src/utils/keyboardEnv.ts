/**
 * Official keyboard/input env gates (portable pure):
 * CLAUDE_CODE_ALTGR_AS_TEXT / BS_AS_CTRL_BACKSPACE
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type AltGrAsTextMode = 'force' | 'off' | 'auto'

/**
 * Official Lxh shape:
 * truthy env → force; falsy env → off; unset → auto if WT_SESSION else off.
 */
export function resolveAltGrAsTextMode(input?: {
  env?: NodeJS.ProcessEnv
  wtSession?: boolean
}): AltGrAsTextMode {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_ALTGR_AS_TEXT
  if (isEnvTruthy(raw)) return 'force'
  if (isEnvDefinedFalsy(raw)) return 'off'
  const wt = input?.wtSession ?? !!env.WT_SESSION
  return wt ? 'auto' : 'off'
}

/**
 * Official Oxh shape for BS→Ctrl+Backspace:
 * truthy force on; falsy force off; else win32 && not mintty/cygwin.
 */
export function shouldMapBsAsCtrlBackspace(input?: {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): boolean {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_BS_AS_CTRL_BACKSPACE
  if (isEnvTruthy(raw)) return true
  if (isEnvDefinedFalsy(raw)) return false
  const platform = input?.platform ?? process.platform
  return (
    platform === 'win32' &&
    env.TERM_PROGRAM !== 'mintty' &&
    env.TERM !== 'cygwin'
  )
}
