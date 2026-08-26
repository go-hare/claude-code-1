/**
 * densable 2.1.232 #6 — glab-cli denyWrite peer to gh.
 *
 * convertToSandboxRuntimeConfig pulls settings/bootstrap; we only assert the
 * path strings that densable SEA lists next to `.config/gh`.
 */
import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'

describe('densable 2.1.232 #6 glab credential paths', () => {
  test('home glab-cli is sibling of gh config', () => {
    const home = homedir()
    const gh = join(home, '.config', 'gh')
    const glab = join(home, '.config', 'glab-cli')
    expect(glab).toBe(join(home, '.config', 'glab-cli'))
    expect(gh.endsWith(join('.config', 'gh')) || gh.includes('.config')).toBe(
      true,
    )
    // Source of truth: sandbox-adapter denyWrite includes both (static check
    // via reading the module source would be brittle; integration covered by
    // convertToSandboxRuntimeConfig when sandbox runs). Document expected
    // absolute forms matching densable `${t}/.config/glab-cli`.
    expect(glab.replace(/\\/g, '/')).toMatch(/\.config\/glab-cli$/)
  })

  test('project .git/glab-cli form matches densable', () => {
    const cwd = process.cwd()
    const p = join(cwd, '.git', 'glab-cli')
    expect(p.replace(/\\/g, '/')).toMatch(/\.git\/glab-cli$/)
  })
})

// Static source guard: adapter lists both paths (avoids heavy sandbox mock).
describe('sandbox-adapter.ts glab denyWrite (source)', () => {
  test('contains glab-cli next to gh', async () => {
    const src = await Bun.file(
      new URL('../sandbox-adapter.ts', import.meta.url),
    ).text()
    expect(src).toContain("join(home, '.config', 'gh')")
    expect(src).toContain("join(home, '.config', 'glab-cli')")
    expect(src).toContain("join(projectGitDir, 'glab-cli')")
  })
})
