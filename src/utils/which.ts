import { execa } from 'execa'
import { execSync_DEPRECATED } from './execSyncWrapper.js'

function resolveWindowsExecutable(command: string): string | null {
  const { resolveWindowsExecutableOnPath } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./windowsPaths.js') as typeof import('./windowsPaths.js')
  return resolveWindowsExecutableOnPath(command)
}

async function whichNodeAsync(command: string): Promise<string | null> {
  if (process.platform === 'win32') {
    // Official 2.1.321 #1925 & #1944: in-process PATH+PATHEXT lookup skipping
    // relative/UNC entries and network-share links, picking up settings PATH.
    return resolveWindowsExecutable(command)
  }

  // On POSIX systems (macOS, Linux, WSL), use which
  // Cross-platform safe: Windows is handled above
  // eslint-disable-next-line custom-rules/no-cross-platform-process-issues
  const result = await execa(`which ${command}`, {
    shell: true,
    stderr: 'ignore',
    reject: false,
  })
  if (result.exitCode !== 0 || !result.stdout) {
    return null
  }
  return result.stdout.trim()
}

function whichNodeSync(command: string): string | null {
  if (process.platform === 'win32') {
    // Official 2.1.321 #1925 & #1944: in-process PATH+PATHEXT lookup without
    // spawning where.exe.
    return resolveWindowsExecutable(command)
  }

  try {
    const result = execSync_DEPRECATED(`which ${command}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return result.toString().trim() || null
  } catch {
    return null
  }
}

const bunWhich =
  typeof Bun !== 'undefined' && typeof Bun.which === 'function'
    ? Bun.which
    : null

/**
 * Finds the full path to a command executable.
 * On Windows (#1925 / #1944), uses in-process PATH+PATHEXT cache lookup that
 * skips relative/UNC/network-share links and honors settings PATH.
 * On POSIX, uses Bun.which when running in Bun (fast, no process spawn),
 * otherwise spawns `which`.
 */
export const which: (command: string) => Promise<string | null> = async (
  command: string,
) => {
  if (process.platform === 'win32') {
    return resolveWindowsExecutable(command)
  }
  return bunWhich ? bunWhich(command) : whichNodeAsync(command)
}

/**
 * Synchronous version of `which`.
 */
export const whichSync: (command: string) => string | null = (
  command: string,
) => {
  if (process.platform === 'win32') {
    return resolveWindowsExecutable(command)
  }
  return bunWhich ? bunWhich(command) : whichNodeSync(command)
}
