import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  createDialogMailbox,
  createDialogStore,
  createRequestDialog,
} from '../index.js'
import { answerMcpUrlElicitationComplete } from '../mcpUrlElicitationComplete.js'
import { mcpUrlElicitationSpec } from '../specs/jsuKinds.js'

function wireMailbox(store: ReturnType<typeof createDialogStore>) {
  const mailbox = createDialogMailbox()
  const owned = new Set<string>()
  mailbox.subscribe(entry => {
    owned.add(entry.id)
    store.open(entry)
  })
  store.onClosed(event => {
    if (!owned.delete(event.id)) return
    mailbox.reply(
      event.type === 'answered'
        ? { id: event.id, result: event.result }
        : { id: event.id, cancelled: true },
    )
  })
  return createRequestDialog(mailbox)
}

async function waitForKind(
  store: ReturnType<typeof createDialogStore>,
  kind: string,
) {
  const start = Date.now()
  while (Date.now() - start < 1000) {
    const top = store.getState().open.at(-1)
    if (top?.kind === kind) return top
    await Bun.sleep(0)
  }
  throw new Error(`timed out waiting for ${kind}`)
}

describe('answerMcpUrlElicitationComplete', () => {
  test('settles matching NMs Gbt as accept', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = requestDialog(mcpUrlElicitationSpec, {
      serverName: 'docs',
      params: { mode: 'url', elicitationId: 'el-1' },
    })
    await waitForKind(store, 'mcp_url_elicitation')
    expect(answerMcpUrlElicitationComplete(store, 'docs', 'el-1')).toBe(true)
    expect(await pending).toEqual({ action: 'accept' })
    expect(store.getState().open).toHaveLength(0)
  })

  test('ignores other server or id', async () => {
    const store = createDialogStore()
    const requestDialog = wireMailbox(store)
    const pending = requestDialog(mcpUrlElicitationSpec, {
      serverName: 'docs',
      params: { mode: 'url', elicitationId: 'el-1' },
    })
    await waitForKind(store, 'mcp_url_elicitation')
    expect(answerMcpUrlElicitationComplete(store, 'other', 'el-1')).toBe(false)
    expect(answerMcpUrlElicitationComplete(store, 'docs', 'el-2')).toBe(false)
    store.dismiss(store.getState().open[0]!.id)
    expect(await pending).toEqual({ action: 'cancel' })
  })
})

describe('Gbt complete / opener source lock', () => {
  test('elicitation complete answers NMs Gbt before AppState', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/mcp/elicitationHandler.ts'),
      'utf8',
    )
    expect(src).toContain('answerMcpUrlElicitationComplete(')
    const complete = src.slice(
      src.indexOf('notifications/elicitation/complete'),
    )
    expect(complete).toContain('answerMcpUrlElicitationComplete(')
    expect(complete.indexOf('answerMcpUrlElicitationComplete(')).toBeLessThan(
      complete.indexOf('setAppState(prev =>'),
    )
  })

  test('MCP -32042 opens requestDialog(Gbt), not AppState queue', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/mcp/client.ts'),
      'utf8',
    )
    expect(src).toContain('mcpUrlElicitationSpec')
    expect(src).toContain('requestDialog(')
    const retry = src.slice(src.indexOf('callMCPToolWithUrlElicitationRetry'))
    expect(retry).toContain('mcpUrlElicitationSpec')
    expect(retry).not.toMatch(/elicitation:\s*\{\s*queue:/)
  })

  test('g2A Retry now settles accept', () => {
    const src = readFileSync(
      join(import.meta.dir, '../jsuRenderers.tsx'),
      'utf8',
    )
    expect(src).toContain(
      "if (action === 'retry') answer({ action: 'accept' })",
    )
  })

  test('interactive elicitation/create still AppState Be.queue, not NMs Host', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/mcp/elicitationHandler.ts'),
      'utf8',
    )
    const create = src.slice(
      src.indexOf("setRequestHandler('elicitation/create'"),
    )
    expect(create).toContain('setAppState(prev => ({')
    expect(create).toContain('elicitation:')
    expect(create).toContain('queue:')
    expect(create).not.toContain('mcpUrlElicitationSpec')
    expect(create).not.toContain('requestDialog(')
  })
})
