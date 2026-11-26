import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { getPlatform } from '../platform.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

function computeManagedFilePath(): string {
  // Allow override for testing/demos (Ant-only, eliminated from external builds)
  if (
    process.env.USER_TYPE === 'ant' &&
    process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
  ) {
    return process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
  }

  switch (getPlatform()) {
    case 'macos':
      return '/Library/Application Support/ClaudeCode'
    case 'windows':
      return 'C:\\Program Files\\ClaudeCode'
    default:
      return '/etc/claude-code'
  }
}

const getManagedFilePathHostSlot = new HostSlot(() =>
  memoize(computeManagedFilePath),
)
const getManagedFilePathImpl = (() =>
  getManagedFilePathHostSlot.of(getBootstrapSessionHost())()) as ReturnType<
  typeof memoize<typeof computeManagedFilePath>
>
Object.defineProperty(getManagedFilePathImpl, 'cache', {
  get() {
    return getManagedFilePathHostSlot.of(getBootstrapSessionHost()).cache
  },
  set(next) {
    getManagedFilePathHostSlot.of(getBootstrapSessionHost()).cache = next
  },
  configurable: true,
  enumerable: true,
})

/**
 * Get the path to the managed settings directory based on the current platform.
 */
export const getManagedFilePath = getManagedFilePathImpl

/**
 * Official 325 `OH` — Windows managed settings path as visible from WSL2 DrvFs.
 */
export const WSL_WINDOWS_MANAGED_PATH = '/mnt/c/Program Files/ClaudeCode'

function computeManagedSettingsDropInDir(): string {
  return join(getManagedFilePath(), 'managed-settings.d')
}

const getManagedSettingsDropInDirHostSlot = new HostSlot(() =>
  memoize(computeManagedSettingsDropInDir),
)
const getManagedSettingsDropInDirImpl = (() =>
  getManagedSettingsDropInDirHostSlot.of(
    getBootstrapSessionHost(),
  )()) as ReturnType<typeof memoize<typeof computeManagedSettingsDropInDir>>
Object.defineProperty(getManagedSettingsDropInDirImpl, 'cache', {
  get() {
    return getManagedSettingsDropInDirHostSlot.of(getBootstrapSessionHost())
      .cache
  },
  set(next) {
    getManagedSettingsDropInDirHostSlot.of(getBootstrapSessionHost()).cache =
      next
  },
  configurable: true,
  enumerable: true,
})

/**
 * Get the path to the managed-settings.d/ drop-in directory.
 * managed-settings.json is merged first (base), then files in this directory
 * are merged alphabetically on top (drop-ins override base, later files win).
 */
export const getManagedSettingsDropInDir = getManagedSettingsDropInDirImpl
