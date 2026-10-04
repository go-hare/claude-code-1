/**
 * densable `va` — isolated eval sandbox (config/home/cwd/out/tmp).
 */

import { mkdtemp, mkdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { GIT_SANDBOX_CONFIG } from './constants.js'
import type { EvalSandbox } from './types.js'

/** densable `va`. */
export async function createEvalSandbox(): Promise<EvalSandbox> {
  const base = process.platform === 'darwin' ? '/tmp' : tmpdir()
  const prefix = process.platform === 'darwin' ? 'e-' : 'claude-eval-'
  const root = await mkdtemp(join(base, prefix))
  const configDir = join(root, 'config')
  const home = join(root, 'home')
  const cwd = join(home, 'cwd')
  const outDir = join(root, 'out')
  const tmpDir = join(root, 'tmp')
  await mkdir(cwd, { recursive: true })
  await mkdir(configDir, { recursive: true })
  await mkdir(outDir, { recursive: true })
  await mkdir(tmpDir, { recursive: true, mode: 0o700 })
  await writeFile(
    join(configDir, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      autoUpdates: false,
      bypassPermissionsModeAccepted: false,
    }),
  )
  await writeFile(
    join(home, '.gitconfig'),
    `[user]
	name = Plugin Eval
	email = eval@example.invalid
`,
  )
  const git = join(home, '.git')
  await mkdir(join(git, 'objects'), { recursive: true })
  await mkdir(join(git, 'refs', 'heads'), { recursive: true })
  await mkdir(join(git, 'hooks'), { recursive: true })
  await writeFile(join(git, 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(join(git, 'config'), GIT_SANDBOX_CONFIG)
  await writeFile(join(git, 'commondir'), '.\n')
  return {
    root: await realpath(root),
    cwd: await realpath(cwd),
    configDir: await realpath(configDir),
    home: await realpath(home),
    outDir: await realpath(outDir),
    tmpDir: await realpath(tmpDir),
    operatorConfigDir: getClaudeConfigHomeDir(),
    cleanup: async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 2 })
    },
  }
}
