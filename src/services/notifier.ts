import {
  attacherCaps,
  getXtversionName,
  isGhosttyXtversion,
  Jk,
  type TerminalNotification,
} from '@anthropic/ink'
import { getGlobalConfig } from '../utils/config.js'
import { env } from '../utils/env.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { executeNotificationHooks } from '../utils/hooks.js'
import { logError } from '../utils/log.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from './analytics/index.js'

export type NotificationOptions = {
  message: string
  title?: string
  notificationType: string
}

export async function sendNotification(
  notif: NotificationOptions,
  terminal: TerminalNotification,
): Promise<void> {
  const config = getGlobalConfig()
  const channel = config.preferredNotifChannel

  await executeNotificationHooks(notif)

  const methodUsed = await sendToChannel(channel, notif, terminal)

  logEvent('tengu_notification_method_used', {
    configured_channel:
      channel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    method_used:
      methodUsed as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    term: env.terminal as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

const DEFAULT_TITLE = 'Claude Code'

async function sendToChannel(
  channel: string,
  opts: NotificationOptions,
  terminal: TerminalNotification,
): Promise<string> {
  const title = opts.title || DEFAULT_TITLE

  try {
    switch (channel) {
      case 'auto':
        return sendAuto(opts, terminal)
      case 'iterm2':
        terminal.notifyITerm2(opts)
        return 'iterm2'
      case 'iterm2_with_bell':
        terminal.notifyITerm2(opts)
        terminal.notifyBell()
        return 'iterm2_with_bell'
      case 'kitty':
        terminal.notifyKitty({ ...opts, title, id: generateKittyId() })
        return 'kitty'
      case 'ghostty':
        terminal.notifyGhostty({ ...opts, title })
        return 'ghostty'
      case 'terminal_bell':
        terminal.notifyBell()
        return 'terminal_bell'
      case 'notifications_disabled':
        return 'disabled'
      default:
        return 'none'
    }
  } catch {
    return 'error'
  }
}

/**
 * Official 2.1.326 (#176) fallback auto-notification detection via XTVERSION
 * and tmux passthrough probe: enables desktop notifications inside tmux (when
 * allow-passthrough is not off) and to iTerm2/kitty/Ghostty over SSH when
 * TERM_PROGRAM is not forwarded.
 */
export function detectProbedNotificationChannel():
  | 'ghostty'
  | 'iterm2'
  | 'kitty'
  | undefined {
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg' && !attacherCaps()) {
    return undefined
  }
  if (Jk().tmuxPane?.passthrough === 'off') {
    return undefined
  }
  if (isGhosttyXtversion()) {
    return 'ghostty'
  }
  const xtversion = getXtversionName()?.toLowerCase()
  if (xtversion?.startsWith('iterm2')) {
    return 'iterm2'
  }
  return xtversion?.startsWith('kitty') ? 'kitty' : undefined
}

async function sendAuto(
  opts: NotificationOptions,
  terminal: TerminalNotification,
): Promise<string> {
  const title = opts.title || DEFAULT_TITLE
  const detectedTerminal = attacherCaps()?.terminal ?? env.terminal

  switch (detectedTerminal) {
    case 'Apple_Terminal': {
      const bellDisabled = await isAppleTerminalBellDisabled()
      if (bellDisabled) {
        terminal.notifyBell()
        return 'terminal_bell'
      }
      return 'no_method_available'
    }
    case 'iTerm.app':
      terminal.notifyITerm2(opts)
      return 'iterm2'
    case 'kitty':
      terminal.notifyKitty({ ...opts, title, id: generateKittyId() })
      return 'kitty'
    case 'ghostty':
      terminal.notifyGhostty({ ...opts, title })
      return 'ghostty'
    default: {
      const fallback = detectProbedNotificationChannel()
      if (fallback === 'iterm2') {
        terminal.notifyITerm2(opts)
        return 'iterm2'
      }
      if (fallback === 'kitty') {
        terminal.notifyKitty({ ...opts, title, id: generateKittyId() })
        return 'kitty'
      }
      if (fallback === 'ghostty') {
        terminal.notifyGhostty({ ...opts, title })
        return 'ghostty'
      }
      return 'no_method_available'
    }
  }
}

function generateKittyId(): number {
  return Math.floor(Math.random() * 10000)
}

async function isAppleTerminalBellDisabled(): Promise<boolean> {
  try {
    if (env.terminal !== 'Apple_Terminal') {
      return false
    }

    const osascriptResult = await execFileNoThrow('osascript', [
      '-e',
      'tell application "Terminal" to name of current settings of front window',
    ])
    const currentProfile = osascriptResult.stdout.trim()

    if (!currentProfile) {
      return false
    }

    const defaultsOutput = await execFileNoThrow('defaults', [
      'export',
      'com.apple.Terminal',
      '-',
    ])

    if (defaultsOutput.code !== 0) {
      return false
    }

    // Lazy-load plist (~280KB with xmlbuilder+@xmldom) — only hit on
    // Apple_Terminal with auto-channel, which is a small fraction of users.
    const plist = await import('plist')
    const parsed: Record<string, unknown> = plist.parse(
      defaultsOutput.stdout,
    ) as any
    const windowSettings = parsed?.['Window Settings'] as
      | Record<string, unknown>
      | undefined
    const profileSettings = windowSettings?.[currentProfile] as
      | Record<string, unknown>
      | undefined

    if (!profileSettings) {
      return false
    }

    return profileSettings.Bell === false
  } catch (error) {
    logError(error)
    return false
  }
}
