/**
 * Official DPH denser — install/uninstall persistent daemon service
 * (launchd on macOS, systemd --user on Linux).
 *
 * Program: `claude daemon run --origin service` via buildCliLaunch so
 * bundled and script modes both work.
 */

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { buildCliLaunch } from '../utils/cliLaunch.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getPlatform } from '../utils/platform.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { errorMessage } from '../utils/errors.js'

export const DAEMON_SERVICE_ID = 'com.anthropic.claude-daemon'
export const DAEMON_SYSTEMD_UNIT = 'claude-daemon.service'

export type ServiceInstallResult =
  | { ok: true; serviceId: string; servicePath: string }
  | { ok: false; error: string; serviceId: string; servicePath: string }

export type ServiceOpResult = { ok: true } | { ok: false; error: string }

function escapeXml(value: string): string {
  return value
    .replace(/[\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function daemonLogPath(): string {
  return join(getClaudeConfigHomeDir(), 'daemon.log')
}

function launchdPlistPath(): string {
  return join(
    homedir(),
    'Library',
    'LaunchAgents',
    `${DAEMON_SERVICE_ID}.plist`,
  )
}

function launchdDomain(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  return `gui/${uid}`
}

function launchdTarget(): string {
  return `${launchdDomain()}/${DAEMON_SERVICE_ID}`
}

function systemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', DAEMON_SYSTEMD_UNIT)
}

/** Platform supports persistent service install (not Windows; not custom config dir). */
export function isDaemonServiceInstallSupported(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.CLAUDE_CONFIG_DIR) return false
  const platform = getPlatform()
  return platform === 'macos' || platform === 'linux' || platform === 'wsl'
}

function programArguments(): string[] {
  const spec = buildCliLaunch(['daemon', 'run', '--origin', 'service'])
  return [spec.execPath, ...spec.args]
}

async function installLaunchd(): Promise<ServiceInstallResult> {
  const servicePath = launchdPlistPath()
  const logPath = daemonLogPath()
  const pathEnv = process.env.PATH || '/usr/local/bin:/usr/bin:/bin'
  const args = programArguments()
  const programArgsXml = args
    .map(a => `    <string>${escapeXml(a)}</string>`)
    .join('\n')

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${DAEMON_SERVICE_ID}</string>
  <key>ProgramArguments</key><array>
${programArgsXml}
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${escapeXml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
</dict></plist>
`

  try {
    await mkdir(dirname(servicePath), { recursive: true })
    await writeFile(servicePath, plist, 'utf8')
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err),
      serviceId: DAEMON_SERVICE_ID,
      servicePath,
    }
  }

  // Best-effort bootout of any previous registration.
  await execFileNoThrow('launchctl', ['bootout', launchdTarget()], {
    useCwd: false,
    timeout: 10_000,
  })

  const { code, stderr, error } = await execFileNoThrow(
    'launchctl',
    ['bootstrap', launchdDomain(), servicePath],
    { useCwd: false, timeout: 15_000 },
  )
  if (code !== 0) {
    return {
      ok: false,
      error: stderr || error || 'launchctl bootstrap failed',
      serviceId: DAEMON_SERVICE_ID,
      servicePath,
    }
  }
  return {
    ok: true,
    serviceId: DAEMON_SERVICE_ID,
    servicePath,
  }
}

async function uninstallLaunchd(): Promise<ServiceOpResult> {
  const servicePath = launchdPlistPath()
  await execFileNoThrow('launchctl', ['bootout', launchdTarget()], {
    useCwd: false,
    timeout: 10_000,
  })
  try {
    await unlink(servicePath)
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code !== 'ENOENT') {
      return { ok: false, error: errorMessage(err) }
    }
  }
  return { ok: true }
}

async function installSystemd(): Promise<ServiceInstallResult> {
  const servicePath = systemdUnitPath()
  const logPath = daemonLogPath()
  const args = programArguments()
  const execStart = args
    .map(a => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(' ')
  const unit = `[Unit]
Description=Claude Code background daemon
After=default.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=10
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`

  try {
    await mkdir(dirname(servicePath), { recursive: true })
    await writeFile(servicePath, unit, 'utf8')
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err),
      serviceId: DAEMON_SYSTEMD_UNIT,
      servicePath,
    }
  }

  const reload = await execFileNoThrow(
    'systemctl',
    ['--user', 'daemon-reload'],
    { useCwd: false, timeout: 15_000 },
  )
  if (reload.code !== 0) {
    return {
      ok: false,
      error: reload.stderr || reload.error || 'systemctl daemon-reload failed',
      serviceId: DAEMON_SYSTEMD_UNIT,
      servicePath,
    }
  }

  const enable = await execFileNoThrow(
    'systemctl',
    ['--user', 'enable', '--now', DAEMON_SYSTEMD_UNIT],
    { useCwd: false, timeout: 15_000 },
  )
  if (enable.code !== 0) {
    return {
      ok: false,
      error: enable.stderr || enable.error || 'systemctl enable --now failed',
      serviceId: DAEMON_SYSTEMD_UNIT,
      servicePath,
    }
  }

  return {
    ok: true,
    serviceId: DAEMON_SYSTEMD_UNIT,
    servicePath,
  }
}

async function uninstallSystemd(): Promise<ServiceOpResult> {
  const servicePath = systemdUnitPath()
  await execFileNoThrow(
    'systemctl',
    ['--user', 'disable', '--now', DAEMON_SYSTEMD_UNIT],
    { useCwd: false, timeout: 15_000 },
  )
  try {
    await unlink(servicePath)
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code !== 'ENOENT') {
      return { ok: false, error: errorMessage(err) }
    }
  }
  await execFileNoThrow('systemctl', ['--user', 'daemon-reload'], {
    useCwd: false,
    timeout: 15_000,
  })
  return { ok: true }
}

/**
 * Install daemon as a persistent user service (launchd / systemd --user).
 */
export async function installDaemonService(): Promise<ServiceInstallResult> {
  if (!isDaemonServiceInstallSupported()) {
    const platform = getPlatform()
    return {
      ok: false,
      error: process.env.CLAUDE_CONFIG_DIR
        ? 'service install only supports the default config dir — the launchd/systemd unit is a per-user singleton'
        : `service install isn't available on ${platform} — the daemon still runs on demand when a client connects.`,
      serviceId: DAEMON_SERVICE_ID,
      servicePath: '',
    }
  }
  const platform = getPlatform()
  if (platform === 'macos') return installLaunchd()
  return installSystemd()
}

/**
 * Uninstall the persistent daemon service.
 */
export async function uninstallDaemonService(): Promise<ServiceOpResult> {
  const platform = getPlatform()
  if (platform === 'macos') return uninstallLaunchd()
  if (platform === 'linux' || platform === 'wsl') return uninstallSystemd()
  return {
    ok: false,
    error: `service uninstall not available on ${platform}`,
  }
}

/**
 * True when launchd/systemd reports the unit as registered.
 */
export async function isDaemonServiceInstalled(): Promise<boolean> {
  if (!isDaemonServiceInstallSupported()) return false
  const platform = getPlatform()
  if (platform === 'macos') {
    const { code } = await execFileNoThrow(
      'launchctl',
      ['print', launchdTarget()],
      { useCwd: false, timeout: 5_000 },
    )
    return code === 0
  }
  const { code } = await execFileNoThrow(
    'systemctl',
    ['--user', 'is-enabled', DAEMON_SYSTEMD_UNIT],
    { useCwd: false, timeout: 5_000 },
  )
  return code === 0
}

/**
 * True when the service file's ProgramArguments binary is missing (stale).
 */
export async function isDaemonServiceExecStale(): Promise<boolean> {
  if (!isDaemonServiceInstallSupported()) return false
  const platform = getPlatform()
  let content: string
  try {
    const path = platform === 'macos' ? launchdPlistPath() : systemdUnitPath()
    content = await readFile(path, 'utf8')
  } catch {
    return false
  }

  let bin: string | undefined
  if (platform === 'macos') {
    const m = content.match(
      /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/,
    )
    bin = m?.[1]
      ?.replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<')
      .replaceAll('&amp;', '&')
  } else {
    const m = content.match(/^ExecStart=(.+)$/m)
    const line = m?.[1]?.trim()
    if (line) {
      // First token (may be quoted)
      const tok = line.match(/^"([^"]+)"|^(\S+)/)
      bin = tok?.[1] ?? tok?.[2]
    }
  }
  if (!bin) return false
  try {
    const { access } = await import('fs/promises')
    await access(bin)
    return false
  } catch {
    return true
  }
}

export async function startDaemonService(): Promise<ServiceOpResult> {
  return controlDaemonService('start')
}

/**
 * densable t_n — stop the installed user service (launchd kill SIGTERM /
 * systemctl --user stop). Stop failures that only mean "already gone" are ok.
 */
export async function stopDaemonService(): Promise<ServiceOpResult> {
  return controlDaemonService('stop')
}

/**
 * densable mga — start | stop | restart via launchctl/systemctl.
 * stop: launchctl kill SIGTERM <target>; non-zero treated as ok (already down).
 */
async function controlDaemonService(
  op: 'start' | 'stop' | 'restart',
): Promise<ServiceOpResult> {
  const platform = getPlatform()
  if (platform === 'macos') {
    if (op === 'restart') {
      await execFileNoThrow('launchctl', ['kill', 'SIGTERM', launchdTarget()], {
        useCwd: false,
        timeout: 15_000,
      })
      let exited = false
      for (let a = 0; a < 200; a++) {
        const print = await execFileNoThrow(
          'launchctl',
          ['print', launchdTarget()],
          { useCwd: false, timeout: 5_000 },
        )
        if (print.code !== 0 || !/^\s*pid = /m.test(print.stdout)) {
          exited = true
          break
        }
        await new Promise(r => setTimeout(r, 50))
      }
      if (!exited) {
        return {
          ok: false,
          error:
            'daemon did not exit within 10s of SIGTERM; restart aborted before kickstart',
        }
      }
    }
    const args =
      op === 'start' || op === 'restart'
        ? (['kickstart', launchdTarget()] as string[])
        : (['kill', 'SIGTERM', launchdTarget()] as string[])
    const { code, stderr, error } = await execFileNoThrow('launchctl', args, {
      useCwd: false,
      timeout: 15_000,
    })
    if (code !== 0) {
      // densable: stop non-zero → ok (unit already down / no pid)
      if (op === 'stop') return { ok: true }
      return {
        ok: false,
        error: stderr || error || `launchctl ${args[0]} failed`,
      }
    }
    return { ok: true }
  }
  if (platform === 'linux' || platform === 'wsl') {
    const action = op === 'restart' ? 'restart' : op
    const { code, stderr, error } = await execFileNoThrow(
      'systemctl',
      ['--user', action, DAEMON_SYSTEMD_UNIT],
      { useCwd: false, timeout: 15_000 },
    )
    if (code !== 0) {
      if (op === 'stop') return { ok: true }
      return {
        ok: false,
        error: stderr || error || `systemctl ${action} failed`,
      }
    }
    return { ok: true }
  }
  return {
    ok: false,
    error: `service ${op} not available on ${platform} — the daemon runs on demand instead`,
  }
}
