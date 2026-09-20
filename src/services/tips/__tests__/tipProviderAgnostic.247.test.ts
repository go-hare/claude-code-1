/**
 * densable 2.1.247 #2 — `Pi` filters to `providerAgnostic` tips whenever the
 * provider is not firstParty (or the base URL is not first-party). Built-in tips
 * therefore have to carry the flag exactly as upstream does, or every non-Anthropic
 * provider silently loses the whole built-in tip set.
 *
 * Gold: gold-tips-providerAgnostic-0.txt (peeled from the 247 SEA tip array).
 */
import { describe, expect, test } from 'bun:test'

const registrySrc = (): Promise<string> =>
  Bun.file(new URL('../tipRegistry.ts', import.meta.url)).text()

/** Parse the peeled gold table into id -> providerAgnostic. */
async function goldFlags(): Promise<Map<string, boolean>> {
  const text = await Bun.file(
    new URL(
      '../../../../docs/upstream-extraction/v2.1.247/snippets/gold-tips-providerAgnostic-0.txt',
      import.meta.url,
    ),
  ).text()
  const flags = new Map<string, boolean>()
  for (const line of text.split('\n')) {
    const m = /^(YES|-)\s+([\w.-]+)$/.exec(line.trim())
    if (m) flags.set(m[2]!, m[1] === 'YES')
  }
  return flags
}

/**
 * Local built-in tips as `id -> providerAgnostic`. Upstream writes the flag
 * immediately after `id`, and so does the local registry.
 */
async function localFlags(): Promise<Map<string, boolean>> {
  const lines = (await registrySrc()).split('\n').map(l => l.trim())
  const flags = new Map<string, boolean>()
  for (let i = 0; i < lines.length; i++) {
    const m = /^id: '([^']+)',$/.exec(lines[i]!)
    if (!m) continue
    flags.set(m[1]!, lines[i + 1] === 'providerAgnostic: true,')
  }
  return flags
}

describe('#2 built-in spinner tips providerAgnostic (2.1.247)', () => {
  test('gold-covered tips match upstream exactly', async () => {
    const gold = await goldFlags()
    const local = await localFlags()
    expect(gold.size).toBeGreaterThan(60)

    const mismatched: string[] = []
    for (const [id, expected] of gold) {
      if (!local.has(id)) continue
      if (local.get(id) !== expected) {
        mismatched.push(`${id}: expected ${expected}, got ${local.get(id)}`)
      }
    }
    expect(mismatched).toEqual([])
  })

  test('the provider-neutral UX tips are tagged', async () => {
    const local = await localFlags()
    // A regression here means Bedrock/Vertex/Foundry/OpenAI/Gemini/Grok users
    // stop seeing these entirely.
    for (const id of [
      'new-user-warmup',
      'plan-mode-for-complex-tasks',
      'terminal-setup',
      'shift-enter',
      'theme-command',
      'memory-command',
      'git-worktrees',
      'colorterm-truecolor',
      'powershell-tool-env',
    ]) {
      expect(local.get(id)).toBe(true)
    }
  })

  test('Anthropic account/subscription tips stay untagged', async () => {
    const local = await localFlags()
    for (const id of ['feedback-command', 'guest-passes']) {
      expect(local.get(id)).toBe(false)
    }
  })

  test('Pi keeps the non-firstParty gate wired to the flag', async () => {
    const src = await registrySrc()
    expect(src).toContain("getAPIProvider() !== 'firstParty'")
    expect(src).toContain('isFirstPartyAnthropicBaseUrl()')
    expect(src).toContain('notFailed.filter(tip => tip.providerAgnostic)')
  })
})
