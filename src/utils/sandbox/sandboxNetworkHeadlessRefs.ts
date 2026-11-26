/**
 * densable print.ts `T.current` / `k.current` — headless sandbox network
 * classifier reads the live messages/tools arrays after loadInitialMessages.
 * Shared module avoids inventing a globalThis bridge.
 */
import type { Tools } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'

type SandboxNetworkHeadlessRefsState = {
  messagesRef: { current: Message[] }
  toolsRef: { current: Tools }
}

const headlessRefsBySession =
  new RootSessionSlot<SandboxNetworkHeadlessRefsState>(() => ({
    messagesRef: { current: [] },
    toolsRef: { current: [] },
  }))

function getHeadlessRefsState(): SandboxNetworkHeadlessRefsState {
  return headlessRefsBySession.of(getBootstrapSession())
}

export function setSandboxNetworkHeadlessMessages(messages: Message[]): void {
  getHeadlessRefsState().messagesRef.current = messages
}

export function setSandboxNetworkHeadlessTools(tools: Tools): void {
  getHeadlessRefsState().toolsRef.current = tools
}

export function getSandboxNetworkHeadlessMessages(): Message[] {
  return getHeadlessRefsState().messagesRef.current
}

export function getSandboxNetworkHeadlessTools(): Tools {
  return getHeadlessRefsState().toolsRef.current
}
