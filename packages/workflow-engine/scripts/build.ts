import { spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DIST = new URL('../dist/', import.meta.url)

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

// Emit dist/**/*.js + dist/**/*.d.ts (+ maps) via tsc.
const result = spawnSync('bunx', ['tsc', '-p', 'tsconfig.build.json'], {
  cwd: ROOT,
  stdio: 'inherit',
})
const exitCode = result.status ?? 1
if (result.error || exitCode !== 0) {
  console.error('tsc emit failed', result.error ?? '')
  process.exit(exitCode)
}

console.log('✓ build complete')
