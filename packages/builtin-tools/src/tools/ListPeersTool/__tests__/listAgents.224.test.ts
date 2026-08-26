/**
 * densable 2.1.224 #7 — ListAgents wire name + ListPeers alias + gold prompt.
 */
import { describe, expect, test } from 'bun:test'
import { toolMatchesName } from 'src/Tool.js'
import { normalizeLegacyToolName } from 'src/utils/permissions/permissionRuleParser.js'
import {
  LIST_AGENTS_TOOL_NAME,
  LIST_PEERS_LEGACY_TOOL_NAME,
} from '../constants.js'
import { ListAgentsTool, ListPeersTool } from '../ListPeersTool.js'
import { getListAgentsPrompt } from '../prompt.js'

describe('densable 2.1.224 #7 ListAgents wire', () => {
  test('primary name is ListAgents; ListPeers is alias', () => {
    expect(LIST_AGENTS_TOOL_NAME).toBe('ListAgents')
    expect(LIST_PEERS_LEGACY_TOOL_NAME).toBe('ListPeers')
    expect(ListAgentsTool.name).toBe('ListAgents')
    expect(ListAgentsTool.aliases).toContain('ListPeers')
    expect(ListPeersTool).toBe(ListAgentsTool)
  })

  test('toolMatchesName accepts both ListAgents and ListPeers', () => {
    expect(toolMatchesName(ListAgentsTool, 'ListAgents')).toBe(true)
    expect(toolMatchesName(ListAgentsTool, 'ListPeers')).toBe(true)
    expect(toolMatchesName(ListAgentsTool, 'ListPeer')).toBe(false)
  })

  test('LEGACY_TOOL_NAME_ALIASES ListPeers→ListAgents', () => {
    expect(normalizeLegacyToolName('ListPeers')).toBe('ListAgents')
    expect(normalizeLegacyToolName('ListAgents')).toBe('ListAgents')
  })

  test('userFacingName + classifier + searchHint gold', () => {
    expect(ListAgentsTool.userFacingName?.()).toBe('ListAgents')
    expect(ListAgentsTool.toAutoClassifierInput?.({} as never)).toBe(
      'list agents',
    )
    expect(ListAgentsTool.searchHint).toBe('list agents you can SendMessage to')
    expect(ListAgentsTool.maxResultSizeChars).toBe(10_000)
  })

  test('prompt gold (IRs / K5_ 2.1.225)', async () => {
    const p = getListAgentsPrompt()
    expect(p).toContain('Lists agents you can SendMessage to')
    expect(p).toContain(
      "when Remote Control is connected here) your account's other sessions",
    )
    expect(p).not.toContain('only in reply, after it messages you first')
    expect(p).toContain('SendMessage({to: "<name>", message: "..."})')
    expect(p).toContain('[ref]')
    expect(await ListAgentsTool.prompt()).toBe(p)
    expect(await ListAgentsTool.description()).toBe(p)
  })

  test('input schema has densable channel/q optional stubs', () => {
    const schema = ListAgentsTool.inputSchema
    const parsed = schema.safeParse({})
    expect(parsed.success).toBe(true)
    const withOpts = schema.safeParse({ channel: 'x', q: 'y' })
    expect(withOpts.success).toBe(true)
  })

  test('mapToolResult returns listing string', () => {
    const block = ListAgentsTool.mapToolResultToToolResultBlockParam(
      { listing: 'Found 1 agent(s):\nworker' },
      'tu-1',
    )
    expect(block).toEqual({
      tool_use_id: 'tu-1',
      type: 'tool_result',
      content: 'Found 1 agent(s):\nworker',
    })
  })
})
