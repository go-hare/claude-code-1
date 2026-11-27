/**
 * Official 2.1.331 chunk `#2465`: `claude mcp xaa` CLI subcommands
 * (`setup`, `login`, `show`, `clear`) for managing the user-level XAA
 * (SEP-990) IdP connection.
 *
 * Exports pure testable handler functions (`runMcpXaaSetup`, `runMcpXaaLogin`,
 * `runMcpXaaShow`, `runMcpXaaClear`) alongside `registerMcpXaaCommands(mcp)`.
 */

import type { Command } from '@commander-js/extra-typings'
import {
  acquireIdpIdToken,
  clearIdpClientSecret,
  clearIdpIdToken,
  getCachedIdpIdToken,
  getIdpClientSecret,
  getXaaIdpSettings,
  type IdpLoginOptions,
  issuerKey,
  saveIdpClientSecret,
  saveIdpIdTokenFromJwt,
  type XaaIdpSettings,
} from '../../services/mcp/xaaIdpLogin.js'
import { errorMessage } from '../../utils/errors.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { cliError, cliOk } from '../exit.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export type McpXaaHandlerResult =
  | { ok: true; output: string }
  | { ok: false; error: string }

export type McpXaaDeps = {
  env?: NodeJS.ProcessEnv
  getXaaIdpSettings?: () => XaaIdpSettings | undefined
  updateUserSettings?: (patch: { xaaIdp: XaaIdpSettings | undefined }) => {
    error: Error | null
  }
  getCachedIdpIdToken?: (issuer: string) => string | undefined
  saveIdpIdTokenFromJwt?: (issuer: string, jwt: string) => number
  clearIdpIdToken?: (issuer: string) => void
  getIdpClientSecret?: (issuer: string) => string | undefined
  saveIdpClientSecret?: (
    issuer: string,
    secret: string,
  ) => { success: boolean; warning?: string }
  clearIdpClientSecret?: (issuer: string) => void
  acquireIdpIdToken?: (opts: IdpLoginOptions) => Promise<string>
  writeStdout?: (text: string) => void
}

export type McpXaaSetupOptions = {
  issuer: string
  clientId: string
  clientSecret?: boolean
  callbackPort?: string | number
}

export type McpXaaLoginOptions = {
  force?: boolean
  idToken?: string
}

function defaultUpdateUserSettings(patch: {
  xaaIdp: XaaIdpSettings | undefined
}): { error: Error | null } {
  return updateSettingsForSource('userSettings', patch)
}

function isAllowedIssuerUrl(issuerUrl: URL): boolean {
  if (
    issuerUrl.username !== '' ||
    issuerUrl.password !== '' ||
    issuerUrl.search !== '' ||
    issuerUrl.hash !== ''
  ) {
    return false
  }
  if (issuerUrl.protocol === 'https:') {
    return true
  }
  return (
    issuerUrl.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(issuerUrl.hostname.toLowerCase())
  )
}

function parseCallbackPort(
  raw: string | number | undefined,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, value: undefined }
  }
  let parsed: number
  if (typeof raw === 'number') {
    parsed = raw
  } else {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) {
      return {
        ok: false,
        error: 'Error: --callback-port must be an integer between 1 and 65535',
      }
    }
    parsed = Number(trimmed)
  }
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return {
      ok: false,
      error: 'Error: --callback-port must be an integer between 1 and 65535',
    }
  }
  return { ok: true, value: parsed }
}

export function runMcpXaaSetup(
  options: McpXaaSetupOptions,
  deps: McpXaaDeps = {},
): McpXaaHandlerResult {
  const env = deps.env ?? process.env
  const readSettings = deps.getXaaIdpSettings ?? getXaaIdpSettings
  const writeSettings = deps.updateUserSettings ?? defaultUpdateUserSettings
  const clearToken = deps.clearIdpIdToken ?? clearIdpIdToken
  const clearSecret = deps.clearIdpClientSecret ?? clearIdpClientSecret
  const saveSecret = deps.saveIdpClientSecret ?? saveIdpClientSecret

  let issuerUrl: URL
  try {
    issuerUrl = new URL(options.issuer)
  } catch {
    return {
      ok: false,
      error: `Error: --issuer must be a valid URL (got "${options.issuer}")`,
    }
  }

  if (!isAllowedIssuerUrl(issuerUrl)) {
    if (
      issuerUrl.username !== '' ||
      issuerUrl.password !== '' ||
      issuerUrl.search !== '' ||
      issuerUrl.hash !== ''
    ) {
      return {
        ok: false,
        error:
          'Error: --issuer must not contain credentials, query parameters, or fragments',
      }
    }
    return {
      ok: false,
      error: `Error: --issuer must use https:// (got "${issuerUrl.protocol}//${issuerUrl.host}")`,
    }
  }

  const parsedPort = parseCallbackPort(options.callbackPort)
  if (!parsedPort.ok) {
    return parsedPort
  }
  const callbackPort = parsedPort.value

  const secret = options.clientSecret
    ? env.MCP_XAA_IDP_CLIENT_SECRET
    : undefined
  if (options.clientSecret && !secret) {
    return {
      ok: false,
      error:
        'Error: --client-secret requires MCP_XAA_IDP_CLIENT_SECRET env var',
    }
  }

  const old = readSettings()
  const oldIssuer = old?.issuer
  const oldClientId = old?.clientId

  const { error } = writeSettings({
    xaaIdp: {
      issuer: options.issuer,
      clientId: options.clientId,
      callbackPort,
    },
  })
  if (error) {
    return {
      ok: false,
      error: `Error writing settings: ${error.message}`,
    }
  }

  if (oldIssuer) {
    if (
      issuerKey(oldIssuer) !== issuerKey(options.issuer) ||
      oldClientId !== options.clientId
    ) {
      clearToken(oldIssuer)
      clearSecret(oldIssuer)
    }
  }

  if (secret) {
    const { success, warning } = saveSecret(options.issuer, secret)
    if (!success) {
      return {
        ok: false,
        error:
          `Error: settings written but keychain save failed${warning ? ` — ${warning}` : ''}. ` +
          `Re-run with --client-secret once keychain is available.`,
      }
    }
  }

  return {
    ok: true,
    output: `XAA IdP connection configured for ${options.issuer}`,
  }
}

export async function runMcpXaaLogin(
  options: McpXaaLoginOptions = {},
  deps: McpXaaDeps = {},
): Promise<McpXaaHandlerResult> {
  const readSettings = deps.getXaaIdpSettings ?? getXaaIdpSettings
  const getCachedToken = deps.getCachedIdpIdToken ?? getCachedIdpIdToken
  const saveTokenFromJwt = deps.saveIdpIdTokenFromJwt ?? saveIdpIdTokenFromJwt
  const clearToken = deps.clearIdpIdToken ?? clearIdpIdToken
  const getSecret = deps.getIdpClientSecret ?? getIdpClientSecret
  const acquireToken = deps.acquireIdpIdToken ?? acquireIdpIdToken
  const writeStdout =
    deps.writeStdout ?? ((text: string) => process.stdout.write(text))

  const idp = readSettings()
  if (!idp) {
    return {
      ok: false,
      error: "Error: no XAA IdP connection. Run 'claude mcp xaa setup' first.",
    }
  }

  if (options.idToken) {
    try {
      const expiresAt = saveTokenFromJwt(idp.issuer, options.idToken)
      return {
        ok: true,
        output: `id_token cached for ${idp.issuer} (expires ${new Date(expiresAt).toISOString()})`,
      }
    } catch (err) {
      return {
        ok: false,
        error: `Couldn't save id_token: ${errorMessage(err)}`,
      }
    }
  }

  if (options.force) {
    clearToken(idp.issuer)
  }

  if (getCachedToken(idp.issuer) !== undefined) {
    return {
      ok: true,
      output: `Already logged in to ${idp.issuer} (cached id_token still valid). Use --force to re-login.`,
    }
  }

  writeStdout(`Opening browser for IdP login at ${idp.issuer}…\n`)
  try {
    await acquireToken({
      idpIssuer: idp.issuer,
      idpClientId: idp.clientId,
      idpClientSecret: getSecret(idp.issuer),
      callbackPort: idp.callbackPort,
      onAuthorizationUrl: url => {
        writeStdout(`If the browser did not open, visit:\n  ${url}\n`)
      },
    })
    return {
      ok: true,
      output:
        'Logged in. MCP servers with --xaa will now authenticate silently.',
    }
  } catch (e) {
    return {
      ok: false,
      error: `IdP login failed: ${errorMessage(e)}`,
    }
  }
}

export function runMcpXaaShow(deps: McpXaaDeps = {}): McpXaaHandlerResult {
  const readSettings = deps.getXaaIdpSettings ?? getXaaIdpSettings
  const getSecret = deps.getIdpClientSecret ?? getIdpClientSecret
  const getCachedToken = deps.getCachedIdpIdToken ?? getCachedIdpIdToken

  const idp = readSettings()
  if (!idp) {
    return {
      ok: true,
      output: 'No XAA IdP connection configured.',
    }
  }

  const hasSecret = getSecret(idp.issuer) !== undefined
  const hasIdToken = getCachedToken(idp.issuer) !== undefined
  const lines = [
    `Issuer:        ${idp.issuer}`,
    `Client ID:     ${idp.clientId}`,
    ...(idp.callbackPort !== undefined
      ? [`Callback port: ${idp.callbackPort}`]
      : []),
    `Client secret: ${hasSecret ? '(stored in keychain)' : '(not set — PKCE-only)'}`,
    `Logged in:     ${hasIdToken ? 'yes (id_token cached)' : "no — run 'claude mcp xaa login'"}`,
  ]
  return {
    ok: true,
    output: lines.join('\n'),
  }
}

export function runMcpXaaClear(deps: McpXaaDeps = {}): McpXaaHandlerResult {
  const readSettings = deps.getXaaIdpSettings ?? getXaaIdpSettings
  const writeSettings = deps.updateUserSettings ?? defaultUpdateUserSettings
  const clearToken = deps.clearIdpIdToken ?? clearIdpIdToken
  const clearSecret = deps.clearIdpClientSecret ?? clearIdpClientSecret

  const idp = readSettings()
  const { error } = writeSettings({
    xaaIdp: undefined,
  })
  if (error) {
    return {
      ok: false,
      error: `Error writing settings: ${error.message}`,
    }
  }

  if (idp) {
    clearToken(idp.issuer)
    clearSecret(idp.issuer)
  }

  return {
    ok: true,
    output: 'XAA IdP connection cleared',
  }
}

export function registerMcpXaaCommands(mcpCommand: Command): Command {
  const xaa = mcpCommand
    .command('xaa')
    .description('Manage the XAA (SEP-990) IdP connection')

  xaa
    .command('setup')
    .description(
      'Configure the IdP connection (one-time setup for all XAA-enabled servers)',
    )
    .requiredOption('--issuer <url>', 'IdP issuer URL (OIDC discovery)')
    .requiredOption('--client-id <id>', "Claude Code's client_id at the IdP")
    .option(
      '--client-secret',
      'Read IdP client secret from MCP_XAA_IDP_CLIENT_SECRET env var',
    )
    .option(
      '--callback-port <port>',
      'Fixed loopback callback port (only if IdP does not honor RFC 8252 port-any matching)',
    )
    .action(options => {
      const result = runMcpXaaSetup({
        issuer: options.issuer,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        callbackPort: options.callbackPort,
      })
      if (!result.ok) {
        return cliError(result.error)
      }
      return cliOk(result.output)
    })

  xaa
    .command('login')
    .description(
      'Cache an IdP id_token so XAA-enabled MCP servers authenticate ' +
        'silently. Default: run the OIDC browser login. With --id-token: ' +
        'write a pre-obtained JWT directly (used by conformance/e2e tests ' +
        'where the mock IdP does not serve /authorize).',
    )
    .option(
      '--force',
      'Ignore any cached id_token and re-login (useful after IdP-side revocation)',
    )
    .option(
      '--id-token <jwt>',
      'Write this pre-obtained id_token directly to cache, skipping the OIDC browser login',
    )
    .action(async options => {
      const result = await runMcpXaaLogin({
        force: options.force,
        idToken: options.idToken,
      })
      if (!result.ok) {
        return cliError(result.error)
      }
      return cliOk(result.output)
    })

  xaa
    .command('show')
    .description('Show the current IdP connection config')
    .action(() => {
      const result = runMcpXaaShow()
      if (!result.ok) {
        return cliError(result.error)
      }
      return cliOk(result.output)
    })

  xaa
    .command('clear')
    .description('Clear the IdP connection config and cached id_token')
    .action(() => {
      const result = runMcpXaaClear()
      if (!result.ok) {
        return cliError(result.error)
      }
      return cliOk(result.output)
    })

  return xaa
}
