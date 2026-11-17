/**
 * Regression tests for Shard 5 #2: postInterClaudeMessage (peerSessions.ts)
 * forwards inboundHopChain (Tkn(prior, cBe("bridge:" + from))) and fromPlugin.
 */
import axios from 'axios'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  HOP_TOKEN_HEX_LEN,
  hashAddressToHopToken,
} from '../../utils/peerAdmission.js'
import { postInterClaudeMessage } from '../peerSessions.js'
import type { ReplBridgeHandle } from '../replBridge.js'
import { setReplBridgeHandle } from '../replBridgeHandle.js'

const prevBridgeToken = process.env.CLAUDE_BRIDGE_OAUTH_TOKEN

afterEach(() => {
  setReplBridgeHandle(null)
  if (prevBridgeToken === undefined) {
    delete process.env.CLAUDE_BRIDGE_OAUTH_TOKEN
  } else {
    process.env.CLAUDE_BRIDGE_OAUTH_TOKEN = prevBridgeToken
  }
})

describe('Shard 5 #2: postInterClaudeMessage hop-chain & from_plugin', () => {
  test('omits hop-chain on human-originated send and appends bridge hop token on peer relay', async () => {
    process.env.CLAUDE_BRIDGE_OAUTH_TOKEN = 'test-bridge-oauth-token'
    const selfId = 'session_011111111111111111111111'
    const targetId = 'session_022222222222222222222222'
    setReplBridgeHandle({
      bridgeSessionId: selfId,
      sessionIngressUrl: 'https://bridge.example.test',
    } as unknown as ReplBridgeHandle)

    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const postSpy = spyOn(axios, 'post').mockImplementation((async (
      url: string,
      data: unknown,
    ) => {
      calls.push({ url, body: data as Record<string, unknown> })
      return { status: 200, data: {} }
    }) as unknown as typeof axios.post)

    try {
      // 1. Human-originated send -> no inboundHopChain -> no hop-chain attribute
      const r1 = await postInterClaudeMessage(targetId, 'human hello', {
        fromName: 'lead',
      })
      expect(r1).toEqual({ ok: true })
      expect(calls).toHaveLength(1)
      expect(String(calls[0]?.body.content)).not.toContain('hop-chain=')
      expect(calls[0]?.body.from_plugin).toBeUndefined()

      // 2. Peer-triggered send -> inboundHopChain appended with HMAC("bridge:" + from)
      const tokA = 'a'.repeat(HOP_TOKEN_HEX_LEN)
      const expectedOwnTok = hashAddressToHopToken(`bridge:${selfId}`)
      const r2 = await postInterClaudeMessage(targetId, 'peer relay', {
        fromName: 'lead',
        fromMode: 'bypass',
        inboundHopChain: [tokA],
        fromPlugin: 'acme@claude-plugins-official',
      })
      expect(r2).toEqual({ ok: true })
      expect(calls).toHaveLength(2)
      expect(calls[1]?.body.type).toBe('peer_message')
      expect(calls[1]?.body.from).toBe(selfId)
      expect(calls[1]?.body.from_plugin).toBe('acme@claude-plugins-official')
      const content = String(calls[1]?.body.content)
      expect(content).toContain(`hop-chain="${tokA},${expectedOwnTok}"`)
      expect(content).toContain('from-mode="bypass"')
    } finally {
      postSpy.mockRestore()
    }
  })
})
