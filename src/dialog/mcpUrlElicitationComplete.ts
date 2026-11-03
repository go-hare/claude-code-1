/**
 * densable Gbt completion — NMs path does not enqueue AppState.elicitation.
 * `notifications/elicitation/complete` must settle the open mailbox the same
 * way ElicitationDialog waiting + Retry does (`action: 'accept'`).
 */
import type { DialogStore } from './dialogStore.js'
import {
  MCP_ELICITATION_KIND,
  MCP_ELICITATION_WAITING_KIND,
  MCP_URL_ELICITATION_KIND,
} from './specs/jsuKinds.js'

export function answerMcpUrlElicitationComplete(
  store: DialogStore,
  serverName: string,
  elicitationId: string,
): boolean {
  const match = store.getState().open.find(entry => {
    if (
      entry.kind !== MCP_URL_ELICITATION_KIND &&
      entry.kind !== MCP_ELICITATION_KIND &&
      entry.kind !== MCP_ELICITATION_WAITING_KIND
    ) {
      return false
    }
    const payload = entry.payload as {
      serverName?: unknown
      params?: { elicitationId?: unknown }
    } | null
    return (
      payload?.serverName === serverName &&
      payload?.params?.elicitationId === elicitationId
    )
  })
  if (!match) return false
  store.answer(match.id, { action: 'accept' })
  return true
}
