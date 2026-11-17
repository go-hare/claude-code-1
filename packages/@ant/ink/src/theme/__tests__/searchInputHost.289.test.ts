import { expect, test } from 'bun:test'

// Real Ink must load in a fresh process: other suites replace its modules globally.
test('gold 289 search Input hosts edit, paste, share kills, and accept picker rows', () => {
  const result = Bun.spawnSync(
    [process.execPath, `${import.meta.dir}/searchInputHost.fixture.tsx`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  expect(result.stdout.toString() + result.stderr.toString()).toContain(
    'SEARCH_INPUT_HOST_OK',
  )
  expect(result.exitCode).toBe(0)
})
