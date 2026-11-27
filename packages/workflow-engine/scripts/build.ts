import { spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DIST = new URL('../dist/', import.meta.url)
const require = createRequire(import.meta.url)
const tscPath = require.resolve('typescript/bin/tsc')

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

// Emit dist/**/*.js + dist/**/*.d.ts (+ maps) via local tsc using the active runtime.
const result = spawnSync(
  process.execPath,
  [tscPath, '-p', 'tsconfig.build.json'],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
)
const exitCode = result.status ?? 1
if (result.error || exitCode !== 0) {
  console.error('tsc emit failed', result.error ?? '')
  process.exit(exitCode)
}

console.log('✓ build complete')
