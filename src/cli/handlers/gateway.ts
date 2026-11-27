/**
 * Official 2.1.331 `claude gateway --config <path>` CLI subcommand handler.
 *
 * Validates and parses the gateway YAML/JSON config, starts the cross-process
 * HTTP auth & OTLP telemetry proxy server (`startGatewayServer`), and installs
 * graceful `SIGINT`/`SIGTERM` draining.
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  type GatewayServerHandle,
  parseGatewayConfig,
  startGatewayServer,
} from './gatewayServer.js'

export type GatewayConfigValidationResult =
  | { ok: true; resolvedPath: string; content: string }
  | { ok: false; error: string }

export async function validateGatewayConfigPath(
  configPath: string,
): Promise<GatewayConfigValidationResult> {
  if (!configPath || configPath.trim() === '') {
    return { ok: false, error: 'Missing required --config <path> value.' }
  }
  const resolvedPath = resolve(configPath)
  try {
    const info = await stat(resolvedPath)
    if (!info.isFile()) {
      return {
        ok: false,
        error: `Gateway config path is not a file: ${resolvedPath}`,
      }
    }
    const content = await readFile(resolvedPath, 'utf8')
    if (content.trim().length === 0) {
      return {
        ok: false,
        error: `Gateway config file is empty: ${resolvedPath}`,
      }
    }
    return { ok: true, resolvedPath, content }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `Cannot read gateway config ${resolvedPath}: ${message}`,
    }
  }
}

export async function startGatewayOrExit(
  configPath: string,
  opts?: {
    signal?: AbortSignal
    onListening?: (handle: GatewayServerHandle) => void
  },
): Promise<GatewayServerHandle> {
  const validated = await validateGatewayConfigPath(configPath)
  if (!validated.ok) {
    process.stderr.write(`claude gateway: ${validated.error}\n`)
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return undefined as never
  }

  let config: ReturnType<typeof parseGatewayConfig>
  try {
    config = parseGatewayConfig(validated.content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `claude gateway: invalid config in ${validated.resolvedPath}: ${message}\n`,
    )
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return undefined as never
  }

  let handle: GatewayServerHandle
  try {
    handle = await startGatewayServer(config)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`claude gateway: failed to start server: ${message}\n`)
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return undefined as never
  }

  process.stdout.write(
    `claude gateway: listening on ${handle.url} (config: ${validated.resolvedPath})\n`,
  )
  opts?.onListening?.(handle)

  await new Promise<void>(resolveDrain => {
    let draining = false
    const drain = (): void => {
      if (draining) return
      draining = true
      process.off('SIGINT', drain)
      process.off('SIGTERM', drain)
      opts?.signal?.removeEventListener('abort', drain)
      void handle.close().finally(() => {
        resolveDrain()
      })
    }

    process.on('SIGINT', drain)
    process.on('SIGTERM', drain)
    if (opts?.signal) {
      if (opts.signal.aborted) {
        drain()
      } else {
        opts.signal.addEventListener('abort', drain, { once: true })
      }
    }
  })

  return handle
}

export function registerGatewayCommand(
  program: CommanderCommand,
): CommanderCommand {
  const gatewayCmd = program
    .command('gateway')
    .description('Run the enterprise auth/telemetry gateway')
    .requiredOption('--config <path>', 'Path to gateway YAML config')
    .action(async ({ config }: { config: string }) => {
      try {
        await startGatewayOrExit(config)
      } catch (err) {
        process.stderr.write(
          `claude gateway: ${err instanceof Error ? err.message : String(err)}\n`,
        )
        // eslint-disable-next-line custom-rules/no-process-exit
        process.exit(1)
      }
    })
  return gatewayCmd
}
