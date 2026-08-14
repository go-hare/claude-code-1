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
    expect(promptSrc).toContain('Any agent from \\`ListAgents\\`')
    expect(promptSrc).toContain('worker [3fa9c1]')
  })

  test('tool call path: in-process local before peer bare-name resolve', () => {
    // densable: bare name always wins → use the in-process one
    // Compare call sites inside call(), not the import / function def order.
    const localCall = toolSrc.indexOf('await tryDeliverToLocalAgent(')
    const peerCall = toolSrc.indexOf('resolvePeerByName({')
    expect(localCall).toBeGreaterThan(0)
    expect(peerCall).toBeGreaterThan(0)
    expect(localCall).toBeLessThan(peerCall)
  })
})
