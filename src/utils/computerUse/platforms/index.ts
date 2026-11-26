/**
 * Platform dispatcher for Computer Use.
 *
 * Loads the correct platform backend based on `process.platform`.
 * Each backend implements the same unified interface.
 */

import { getBootstrapSessionHost, HostSlot } from '../../sessionHost.js'
import type {
  InputPlatform,
  ScreenshotPlatform,
  DisplayPlatform,
  AppsPlatform,
  WindowManagementPlatform,
} from './types.js'

export interface Platform {
  input: InputPlatform
  screenshot: ScreenshotPlatform
  display: DisplayPlatform
  apps: AppsPlatform
  windowManagement?: WindowManagementPlatform
}

const platformHostSlot = new HostSlot<{ cached: Platform | undefined }>(() => ({
  cached: undefined,
}))

export function loadPlatform(): Platform {
  const hostState = platformHostSlot.of(getBootstrapSessionHost())
  if (hostState.cached) return hostState.cached

  switch (process.platform) {
    case 'darwin':
      hostState.cached = require('./darwin.js').platform
      break
    case 'win32':
      hostState.cached = require('./win32.js').platform
      break
    case 'linux':
      hostState.cached = require('./linux.js').platform
      break
    default:
      throw new Error(`Computer Use not supported on ${process.platform}`)
  }

  return hostState.cached!
}

export type {
  InputPlatform,
  ScreenshotPlatform,
  DisplayPlatform,
  AppsPlatform,
  WindowManagementPlatform,
} from './types.js'
export type {
  WindowHandle,
  ScreenshotResult,
  DisplayInfo,
  InstalledApp,
  FrontmostAppInfo,
  WindowAction,
} from './types.js'
