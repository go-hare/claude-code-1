import {
  runExtraUsage,
  USAGE_CREDITS_ADMIN_REQUEST_INTERACTIVE_HINT,
} from './extra-usage-core.js'

/**
 * densable cob — noninteractive `/usage-credits`.
 * confirm-admin-request defers with UTr (do not auto-create).
 */
export async function call(): Promise<{ type: 'text'; value: string }> {
  const result = await runExtraUsage({ openInBrowser: true })

  if (result.type === 'message') {
    return { type: 'text', value: result.value }
  }

  if (result.type === 'confirm-admin-request') {
    return { type: 'text', value: USAGE_CREDITS_ADMIN_REQUEST_INTERACTIVE_HINT }
  }

  return {
    type: 'text',
    value: result.opened
      ? `Browser opened to manage usage credits. If it didn't open, visit: ${result.url}`
      : `Visit ${result.url} to manage usage credits.`,
  }
}
