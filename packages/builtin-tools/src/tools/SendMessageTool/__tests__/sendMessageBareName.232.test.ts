/**
 * densable 2.1.232 #3 — SendMessage bare unique live name prompt + resolve order.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const promptPath = join(import.meta.dir, '../prompt.ts')
const toolPath = join(import.meta.dir, '../SendMessageTool.ts')
const promptSrc = readFileSync(promptPath, 'utf8')
const toolSrc = readFileSync(toolPath, 'utf8')

describe('densable 2.1.232 #3 SendMessage bare name', () => {
  test('prompt has densable T5f bare-name deliver-directly gold', () => {
    expect(promptSrc).toContain(
      'exactly matches one live agent or session (on this machine, on another machine, or in the cloud) delivers directly',
    )
    expect(promptSrc).toContain(
      'if the same name also names an in-process agent, the bare name always wins',
    )
    // Source template escapes backticks as \`from\` / \`to\`
    expect(promptSrc).toContain(
      'copy its \\`from\\` attribute as your \\`to\\`',
    )
    expect(promptSrc).toContain('cross-session permission laundering')
  })

  test('ListAgents-oriented worker rows present', () => {
    // densable 2.1.239 BEm interpolates e_ (LIST_AGENTS_TOOL_NAME), not a
    // hardcoded ListAgents token in the template.
    expect(promptSrc).toContain('Any agent from \\`')
    expect(promptSrc.includes('$' + '{listAgents}')).toBe(true)
    expect(promptSrc).toContain('LIST_AGENTS_TOOL_NAME')
    expect(promptSrc).toContain('worker [3fa9c1]')
  })

  test('tool call path: in-process local before peer bare-name resolve', () => {
    // densable: bare name always wins → use the in-process one
    // Compare call sites inside call(), not the import / function def order.
    // densable 2.1.236 C1 may resolve peers earlier for pure notify_when_idle;
    // text-path order is still local_agent before gIn peer resolve.
    const localCall = toolSrc.indexOf('await tryDeliverToLocalAgent(')
    expect(localCall).toBeGreaterThan(0)
    const peerCall = toolSrc.indexOf('resolvePeerByName({', localCall)
    expect(peerCall).toBeGreaterThan(localCall)
  })
})
