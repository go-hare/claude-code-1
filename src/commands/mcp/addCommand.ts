/**
 * MCP add CLI subcommand
 *
 * Extracted from main.tsx to enable direct testing.
 */
import { type Command, type Help, Option } from '@commander-js/extra-typings'
import { cliError, cliOk } from '../../cli/exit.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  readClientSecret,
  saveMcpClientSecret,
} from '../../services/mcp/auth.js'
import { addMcpConfig } from '../../services/mcp/config.js'
import {
  describeMcpConfigFilePath,
  ensureConfigScope,
  ensureTransport,
  parseHeaders,
} from '../../services/mcp/utils.js'
import {
  getXaaIdpSettings,
  isXaaEnabled,
} from '../../services/mcp/xaaIdpLogin.js'
import { parseEnvVars } from '../../utils/envUtils.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/**
 * #2034: Wrap help text while preserving indented lines (e.g. CLI examples)
 * verbatim so narrow terminals and pipes never split long example commands
 * across lines and strip `--header` flags when pasted.
 */
export function wrapHelpTextPreservingIndentedLines(
  text: string,
  width: number,
): string {
  const maxWidth = Math.max(width, 1)
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^\s+\S/.test(line)) {
      out.push(line)
      continue
    }
    const tokens = line.match(/\s*\S+/g)
    if (!tokens) {
      out.push('')
      continue
    }
    let current = ''
    let currentLen = 0
    let started = false
    for (const token of tokens) {
      const tokenLen = token.length
      if (!started) {
        current = token
        currentLen = tokenLen
        started = true
      } else if (currentLen + tokenLen <= maxWidth) {
        current += token
        currentLen += tokenLen
      } else {
        out.push(current)
        const trimmed = token.replace(/^\s+/, '')
        current = trimmed
        currentLen = trimmed.length
      }
    }
    out.push(current)
  }
  return out.join('\n')
}

function formatHelpEntry(
  term: string,
  description: string,
  padWidth: number,
  helpWidth: number,
): string {
  const indent = '  '
  if (!description) return indent + term
  if (description.includes('\n')) {
    const gap =
      term.length <= padWidth ? ' '.repeat(padWidth - term.length + 2) : '  '
    return (indent + term + gap + description).replace(/\n/g, `\n${indent}`)
  }
  const available = helpWidth - 2 - padWidth - 2
  if (term.length <= padWidth && available >= 30) {
    const gap = ' '.repeat(padWidth - term.length + 2)
    const contIndent = ' '.repeat(2 + padWidth + 2)
    const wrapped = wrapHelpTextPreservingIndentedLines(description, available)
    return indent + term + gap + wrapped.replace(/\n/g, `\n${contIndent}`)
  }
  const contIndent = '      '
  const wrapped = wrapHelpTextPreservingIndentedLines(
    description,
    helpWidth - 6,
  )
  return `${indent}${term}\n${contIndent}${wrapped.replace(/\n/g, `\n${contIndent}`)}`
}

export function createMcpHelpConfiguration(): Partial<Help> {
  const formatSection = (
    lines: string[],
    heading: string,
    entries: string[],
  ) => {
    if (entries.length === 0) return
    lines.push(heading, ...entries, '')
  }
  const optionKey = (opt: Option) =>
    opt.long?.replace(/^--/, '') ?? opt.short?.replace(/^-/, '') ?? ''
  return Object.assign(
    {
      sortSubcommands: true,
      sortOptions: true,
      formatHelp(cmd: Command, helper: Help) {
        const helpWidth = helper.helpWidth || 80
        const padWidth = Math.min(helper.padWidth(cmd, helper), 36)
        const lines: string[] = [`Usage: ${helper.commandUsage(cmd)}`, '']
        const desc = helper.commandDescription(cmd)
        if (desc.length > 0) {
          lines.push(wrapHelpTextPreservingIndentedLines(desc, helpWidth), '')
        }
        formatSection(
          lines,
          'Arguments:',
          helper
            .visibleArguments(cmd)
            .map(arg =>
              formatHelpEntry(
                helper.argumentTerm(arg),
                helper.argumentDescription(arg),
                padWidth,
                helpWidth,
              ),
            ),
        )
        formatSection(
          lines,
          'Options:',
          helper
            .visibleOptions(cmd)
            .map(opt =>
              formatHelpEntry(
                helper.optionTerm(opt),
                helper.optionDescription(opt),
                padWidth,
                helpWidth,
              ),
            ),
        )
        if (helper.showGlobalOptions) {
          formatSection(
            lines,
            'Global Options:',
            helper
              .visibleGlobalOptions(cmd)
              .map(opt =>
                formatHelpEntry(
                  helper.optionTerm(opt),
                  helper.optionDescription(opt),
                  padWidth,
                  helpWidth,
                ),
              ),
          )
        }
        formatSection(
          lines,
          'Commands:',
          helper
            .visibleCommands(cmd)
            .map(sub =>
              formatHelpEntry(
                helper.subcommandTerm(sub),
                helper.subcommandDescription(sub),
                padWidth,
                helpWidth,
              ),
            ),
        )
        return lines.join('\n')
      },
    } satisfies Partial<Help>,
    {
      compareOptions: (a: Option, b: Option) =>
        optionKey(a).localeCompare(optionKey(b)),
    },
  ) as Partial<Help>
}

/**
 * Registers the `mcp add` subcommand on the given Commander command.
 */
export function registerMcpAddCommand(mcp: Command): void {
  mcp
    .command('add <name> <commandOrUrl> [args...]')
    .summary('Add an MCP server')
    .configureHelp(createMcpHelpConfiguration())
    .description(
      'Add an MCP server to Claude Code.\n\n' +
        'Examples:\n' +
        '  # Add HTTP server:\n' +
        '  claude mcp add --transport http sentry https://mcp.sentry.dev/mcp\n\n' +
        '  # Add HTTP server with headers:\n' +
        '  claude mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."\n\n' +
        '  # Add stdio server with environment variables:\n' +
        '  claude mcp add my-server -e API_KEY=xxx -- node ./my-server.js\n\n' +
        '  # Add stdio server with subprocess flags:\n' +
        '  claude mcp add my-server -- my-command --some-flag arg1',
    )
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-t, --transport <transport>',
      'Transport type (stdio, sse, http). Defaults to stdio if not specified.',
    )
    .option(
      '-e, --env <env...>',
      'Set environment variables (e.g. -e KEY=value)',
    )
    .option(
      '-H, --header <header...>',
      'Set headers for HTTP/SSE servers, repeat for more (e.g. -H "X-Api-Key: abc123")',
    )
    .option('--client-id <clientId>', 'OAuth client ID for HTTP/SSE servers')
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
    )
    .option(
      '--callback-port <port>',
      'Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)',
    )
    .helpOption('-h, --help', 'Display help for command')
    .addOption(
      new Option(
        '--xaa',
        "Enable XAA (SEP-990) for this server. Requires 'claude mcp xaa setup' first. Also requires --client-id and --client-secret (for the MCP server's AS).",
      ).hideHelp(!isXaaEnabled()),
    )
    .action(async (name, commandOrUrl, args, options) => {
      // Commander.js handles -- natively: it consumes -- and everything after becomes args
      const actualCommand = commandOrUrl
      const actualArgs = args

      // If no name is provided, error
      if (!name) {
        cliError(
          'Error: Server name is required.\n' +
            'Usage: claude mcp add <name> <command> [args...]',
        )
      } else if (!actualCommand) {
        cliError(
          'Error: Command is required when server name is provided.\n' +
            'Usage: claude mcp add <name> <command> [args...]',
        )
      }

      try {
        const scope = ensureConfigScope(options.scope)
        const transport = ensureTransport(options.transport)

        // XAA fail-fast: validate at add-time, not auth-time.
        if (options.xaa && !isXaaEnabled()) {
          cliError(
            'Error: --xaa requires CLAUDE_CODE_ENABLE_XAA=1 in your environment',
          )
        }
        const xaa = Boolean(options.xaa)
        if (xaa) {
          const missing: string[] = []
          if (!options.clientId) missing.push('--client-id')
          if (!options.clientSecret) missing.push('--client-secret')
          if (!getXaaIdpSettings()) {
            missing.push(
              "'claude mcp xaa setup' (settings.xaaIdp not configured)",
            )
          }
          if (missing.length) {
            cliError(`Error: --xaa requires: ${missing.join(', ')}`)
          }
        }

        // Check if transport was explicitly provided
        const transportExplicit = options.transport !== undefined

        // Check if the command looks like a URL (likely incorrect usage)
        const looksLikeUrl =
          actualCommand.startsWith('http://') ||
          actualCommand.startsWith('https://') ||
          actualCommand.startsWith('localhost') ||
          actualCommand.endsWith('/sse') ||
          actualCommand.endsWith('/mcp')

        logEvent('tengu_mcp_add', {
          type: transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          scope:
            scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source:
            'command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transport:
            transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transportExplicit: transportExplicit,
          looksLikeUrl: looksLikeUrl,
        })

        if (transport === 'sse') {
          if (!actualCommand) {
            cliError('Error: URL is required for SSE transport.')
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort || xaa
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                  ...(xaa ? { xaa: true } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'sse' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            `Added SSE MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
          )
          if (headers) {
            process.stdout.write(
              `Headers: ${jsonStringify(headers, null, 2)}\n`,
            )
          }
        } else if (transport === 'http') {
          if (!actualCommand) {
            cliError('Error: URL is required for HTTP transport.')
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort || xaa
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                  ...(xaa ? { xaa: true } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'http' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            `Added HTTP MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
          )
          if (headers) {
            process.stdout.write(
              `Headers: ${jsonStringify(headers, null, 2)}\n`,
            )
          }
        } else {
          if (
            options.clientId ||
            options.clientSecret ||
            options.callbackPort ||
            options.xaa
          ) {
            process.stderr.write(
              `Warning: --client-id, --client-secret, --callback-port, and --xaa are only supported for HTTP/SSE transports and will be ignored for stdio.\n`,
            )
          }

          // Warn if this looks like a URL but transport wasn't explicitly specified
          if (!transportExplicit && looksLikeUrl) {
            process.stderr.write(
              `\nWarning: The command "${actualCommand}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.\n`,
            )
            process.stderr.write(
              `If this is an HTTP server, use: claude mcp add --transport http ${name} ${actualCommand}\n`,
            )
            process.stderr.write(
              `If this is an SSE server, use: claude mcp add --transport sse ${name} ${actualCommand}\n`,
            )
          }

          const env = parseEnvVars(options.env)
          await addMcpConfig(
            name,
            { type: 'stdio', command: actualCommand, args: actualArgs, env },
            scope,
          )

          process.stdout.write(
            `Added stdio MCP server ${name} with command: ${actualCommand} ${actualArgs.join(' ')} to ${scope} config\n`,
          )
        }
        cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`)
      } catch (error) {
        cliError((error as Error).message)
      }
    })
}
