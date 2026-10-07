import { describe, expect, test } from 'bun:test'
import {
  normalizeCarrierSessionMcpQuery,
  rewriteCarrierSessionMcpUrl,
} from '../bridgeCarrier.js'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_ID,
  CLAUDE_CODE_REMOTE_META_MCP_PATH,
} from '../hearthbotMcp.js'

describe('densable 2.1.289 Ykn/W carrier query rewrite', () => {
  const origin = 'https://api.example'
  const sid = 'cse_1'

  test('requires toolbox_mcp_server_id === iqt', () => {
    expect(
      rewriteCarrierSessionMcpUrl(
        `${origin}/v2/ccr-sessions/${sid}/mcp?toolbox_mcp_server_id=x`,
        origin,
        sid,
      ),
    ).toBeNull()
    expect(
      rewriteCarrierSessionMcpUrl(
        `${origin}/v2/ccr-sessions/${sid}/mcp`,
        origin,
        sid,
      ),
    ).toBeNull()
  })

  test('rejects non-uuid mcp_server_id', () => {
    expect(
      rewriteCarrierSessionMcpUrl(
        `${origin}/v2/ccr-sessions/${sid}/mcp?mcp_server_id=not-a-uuid&toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}`,
        origin,
        sid,
      ),
    ).toBeNull()
  })

  test('rejects mcp_url that is not meta path p', () => {
    expect(
      rewriteCarrierSessionMcpUrl(
        `${origin}/v2/ccr-sessions/${sid}/mcp?toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}&mcp_url=${origin}/wrong`,
        origin,
        sid,
      ),
    ).toBeNull()
  })

  test('forces toolbox=iqt and normalizes mcp_url to origin+p', () => {
    const rewritten = rewriteCarrierSessionMcpUrl(
      `${origin}/v2/ccr-sessions/${sid}/mcp?mcp_server_id=11111111-1111-1111-1111-111111111111&toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}&mcp_url=${origin}${CLAUDE_CODE_REMOTE_META_MCP_PATH}`,
      origin,
      sid,
    )
    expect(rewritten).toBe(
      `${origin}/v2/ccr-sessions/${sid}/mcp?mcp_url=${encodeURIComponent(`${origin}${CLAUDE_CODE_REMOTE_META_MCP_PATH}`)}&mcp_server_id=11111111-1111-1111-1111-111111111111&toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}`,
    )
    const parsed = new URL(
      `${origin}/v2/ccr-sessions/${sid}/mcp?toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}`,
    )
    expect(normalizeCarrierSessionMcpQuery(parsed, origin)).toBe(
      `toolbox_mcp_server_id=${CLAUDE_CODE_REMOTE_MCP_SERVER_ID}`,
    )
  })
})
