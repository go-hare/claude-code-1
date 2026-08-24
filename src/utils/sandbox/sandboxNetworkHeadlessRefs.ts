/**
 * densable print.ts `T.current` / `k.current` — headless sandbox network
 * classifier reads the live messages/tools arrays after loadInitialMessages.
 * Shared module avoids inventing a globalThis bridge.
 */
import type { Tools } from '../../Tool.js'
import type { Message } from '../../types/message.js'

const messagesRef: { current: Message[] } = { current: [] }
const toolsRef: { current: Tools } = { current: [] }

export function setSandboxNetworkHeadlessMessages(messages: Message[]): void {
  messagesRef.current = messages
}

export function setSandboxNetworkHeadlessTools(tools: Tools): void {
  toolsRef.current = tools
}

export function getSandboxNetworkHeadlessMessages(): Message[] {
  return messagesRef.current
}

export function getSandboxNetworkHeadlessTools(): Tools {
  return toolsRef.current
}
