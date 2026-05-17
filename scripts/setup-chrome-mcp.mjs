#!/usr/bin/env node

/**
 * Unified Chrome MCP setup script.
 *
 * Usage:
 *   node scripts/setup-chrome-mcp.mjs           # Run full setup (fix-permissions → register → doctor)
 *   node scripts/setup-chrome-mcp.mjs doctor    # Run a single sub-command
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.CLAUDE_CODE_SKIP_CHROME_MCP_SETUP === '1') {
  process.exit(0)
}

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function resolvePackageJsonPath() {
  try {
    return require.resolve('@go-hare/mcp-chrome-bridge/package.json')
  } catch {
    const workspacePackageJson = join(
      projectRoot,
      'packages',
      'mcp-chrome-bridge',
      'package.json',
    )
    return existsSync(workspacePackageJson) ? workspacePackageJson : null
  }
}

const packageJsonPath = resolvePackageJsonPath()
if (!packageJsonPath) {
  console.log(
    '[chrome-mcp] mcp-chrome-bridge package not found, skipping setup.',
  )
  process.exit(0)
}
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const binEntry = packageJson?.bin?.['mcp-chrome-bridge']
if (!binEntry) {
  console.log('[chrome-mcp] mcp-chrome-bridge bin not found, skipping setup.')
  process.exit(0)
}
const cliPath = resolve(dirname(packageJsonPath), binEntry)
if (!existsSync(cliPath)) {
  console.log('[chrome-mcp] mcp-chrome-bridge cli not found, skipping setup.')
  process.exit(0)
}

const userArgs = process.argv.slice(2)

function getChromeMcpLogDir() {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Logs', 'mcp-chrome-bridge')
  }
  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
      'mcp-chrome-bridge',
      'logs',
    )
  }
  return join(
    process.env.XDG_STATE_HOME || join(home, '.local', 'state'),
    'mcp-chrome-bridge',
    'logs',
  )
}

if (userArgs.length > 0) {
  // Forward single sub-command
  execFileSync('node', [cliPath, ...userArgs], { stdio: 'inherit' })
} else {
  // Full setup sequence
  const steps = [
    ['fix-permissions'],
    ['register', '--browser', 'chrome'],
    ['doctor'],
  ]

  mkdirSync(getChromeMcpLogDir(), { recursive: true })

  for (let i = 0; i < steps.length; i++) {
    const args = steps[i]
    const isLast = i === steps.length - 1
    if (isLast) console.log(`\n[${i + 1}/${steps.length}] ${args.join(' ')}`)
    execFileSync('node', [cliPath, ...args], {
      stdio: isLast ? 'inherit' : 'pipe',
    })
  }

  console.log('\nChrome MCP setup complete!')
}
