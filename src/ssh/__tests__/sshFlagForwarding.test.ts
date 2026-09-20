/**
 * `claude ssh` forwards a whitelist of flags to the remote CLI spawn.
 *
 * This matters because the agent loop runs entirely on the remote: useSSHSession
 * sets isRemoteMode, REPL sends input over stream-json and returns before
 * handlePromptSubmit, so a loop-affecting flag left out of the whitelist stays
 * in process.argv, configures the local UI shell, and silently does nothing.
 *
 * The extraction runs inline in main()'s startup path (before commander parses),
 * so it isn't importable — these are source assertions. The negative cases are
 * deliberate: adding forwarding for one of them should fail here so the docs and
 * the criterion comment get updated in the same change.
 */
import { describe, expect, test } from 'bun:test'

async function mainSrc(): Promise<string> {
  return await Bun.file(new URL('../../main.tsx', import.meta.url)).text()
}

/** The `extractFlag(...)` block that builds _pendingSSH.extraCliArgs. */
async function forwardBlock(): Promise<string> {
  const src = await mainSrc()
  const start = src.indexOf("extractFlag('-c'")
  expect(start).toBeGreaterThan(0)
  return src.slice(start, src.indexOf('\n    }', start))
}

describe('claude ssh flag forwarding', () => {
  test('session-history flags forward with their short aliases', async () => {
    const block = await forwardBlock()
    expect(block).toContain("extractFlag('-c', { as: '--continue' })")
    expect(block).toContain("extractFlag('--continue')")
    // -r is the documented alias of --resume; without `as` it would reach the
    // remote as a bare `-r` and the local REPL would keep the uuid.
    expect(block).toContain(
      "extractFlag('-r', { as: '--resume', hasValue: true })",
    )
    expect(block).toContain("extractFlag('--resume', { hasValue: true })")
  })

  test('both model flags forward, not just --model', async () => {
    const block = await forwardBlock()
    expect(block).toContain("extractFlag('--model', { hasValue: true })")
    // The remote is the process that calls the API, so a local-only
    // --fallback-model can never take effect.
    expect(block).toContain(
      "extractFlag('--fallback-model', { hasValue: true })",
    )
  })

  test('variadic flags stay out until extractFlag can consume many values', async () => {
    const block = await forwardBlock()
    // extractFlag pushes at most one value, so forwarding any of these today
    // would truncate the list. Needs a variadic-aware extractor first.
    for (const flag of [
      '--betas',
      '--allowed-tools',
      '--disallowed-tools',
      '--tools',
      '--add-dir',
      '--mcp-config',
      '--file',
    ]) {
      expect(block).not.toContain(`extractFlag('${flag}'`)
    }
  })

  test('path-valued flags stay out — they resolve on the wrong host', async () => {
    const block = await forwardBlock()
    // These also legitimately configure the local UI shell (theme, keybindings,
    // statusline), so they are not inert locally and must not simply move.
    for (const flag of ['--settings', '--plugin-dir', '--debug-file']) {
      expect(block).not.toContain(`extractFlag('${flag}'`)
    }
  })

  test('the criterion comment travels with the whitelist', async () => {
    const src = await mainSrc()
    expect(src).toContain('Forward a flag only when all three hold')
    expect(src).toContain('docs/features/ssh-remote.md')
  })

  test('extractFlag consumes a single value', async () => {
    const src = await mainSrc()
    const helper = src.slice(
      src.indexOf('const extractFlag = ('),
      src.indexOf("extractFlag('-c'"),
    )
    // One push of the value, guarded on the next arg not being a flag.
    expect(helper).toContain("!val.startsWith('-')")
    expect(helper).not.toContain('while (')
  })
})
