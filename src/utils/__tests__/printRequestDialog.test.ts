import { describe, expect, test } from 'bun:test'
import {
  createPrintRequestDialog,
  FABLE_OVERAGE_CONSENT_DIALOG_KIND,
  fableOverageConsentDialogSpec,
  findDialogKindSpec,
  MCP_URL_ELICITATION_DIALOG_KIND,
  REFUSAL_FALLBACK_DIALOG_KIND,
  refusalFallbackDialogSpec,
} from '../printRequestDialog.js'

describe('printRequestDialog densables', () => {
  test('findDialogKindSpec registry', () => {
    expect(findDialogKindSpec(REFUSAL_FALLBACK_DIALOG_KIND)?.default).toBe(
      'cancelled',
    )
    expect(findDialogKindSpec(FABLE_OVERAGE_CONSENT_DIALOG_KIND)?.default).toBe(
      'cancelled',
    )
    expect(findDialogKindSpec(MCP_URL_ELICITATION_DIALOG_KIND)?.kind).toBe(
      MCP_URL_ELICITATION_DIALOG_KIND,
    )
    expect(findDialogKindSpec('unknown')).toBeUndefined()
  })

  test('requestUserDialog completed parses result', async () => {
    const requestUserDialog = async () => ({
      behavior: 'completed' as const,
      result: 'retry_fallback',
    })
    const requestDialog = createPrintRequestDialog({
      handleElicitation: async () => ({ action: 'cancel' }),
      requestUserDialog,
    })
    await expect(
      requestDialog(refusalFallbackDialogSpec, {
        originalModel: 'a',
        fallbackModel: 'b',
      }),
    ).resolves.toBe('retry_fallback')
  })

  test('cancelled returns default', async () => {
    const requestDialog = createPrintRequestDialog({
      handleElicitation: async () => ({ action: 'cancel' }),
      requestUserDialog: async () => ({ behavior: 'cancelled' }),
    })
    await expect(
      requestDialog(fableOverageConsentDialogSpec, {
        overagesEnabled: false,
      }),
    ).resolves.toBe('cancelled')
  })

  test('queued command cancels with default', async () => {
    let cancelled: string | undefined
    const requestDialog = createPrintRequestDialog({
      handleElicitation: async () => ({ action: 'cancel' }),
      requestUserDialog: async () => ({
        behavior: 'completed',
        result: 'retry_fallback',
      }),
      peekQueuedCommand: () => ({ mode: 'prompt' }),
      cancelPendingUserDialogs: kind => {
        cancelled = kind
        return 1
      },
    })
    await expect(requestDialog(refusalFallbackDialogSpec, {})).resolves.toBe(
      'cancelled',
    )
    expect(cancelled).toBe(REFUSAL_FALLBACK_DIALOG_KIND)
  })

  test('mcp_url_elicitation routes to handleElicitation', async () => {
    let seen: string | undefined
    const requestDialog = createPrintRequestDialog({
      handleElicitation: async (serverName, message) => {
        seen = `${serverName}:${message}`
        return { action: 'accept' }
      },
      requestUserDialog: async () => ({ behavior: 'cancelled' }),
    })
    await expect(
      requestDialog(
        {
          kind: MCP_URL_ELICITATION_DIALOG_KIND,
          default: { action: 'cancel' },
        },
        {
          serverName: 'srv',
          params: { message: 'open url', mode: 'url', url: 'https://x' },
        },
      ),
    ).resolves.toEqual({ action: 'accept' })
    expect(seen).toBe('srv:open url')
  })

  test('unknown kind returns default', async () => {
    const requestDialog = createPrintRequestDialog({
      handleElicitation: async () => ({}),
      requestUserDialog: async () => ({ behavior: 'completed', result: 1 }),
    })
    await expect(
      requestDialog({ kind: 'not_a_kind', default: 'fallback' }, {}),
    ).resolves.toBe('fallback')
  })
})
