/**
 * Official 2.1.331 `claude gateway --config <path>` CLI subcommand handler.
 *
 * Validates the gateway YAML config path and surfaces actionable diagnostics
 * matching official `startGatewayOrExit` (`chunk-95k6wzg5.js`).
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

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

export async function startGatewayOrExit(configPath: string): Promise<never> {
  if (typeof Bun === 'undefined') {
    process.stderr.write(
      'claude gateway: claude gateway requires the native binary. Install via https://claude.ai/install.sh instead of npm.\n',
    )
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return undefined as never
  }

  const validated = await validateGatewayConfigPath(configPath)
  if (!validated.ok) {
    process.stderr.write(`claude gateway: ${validated.error}\n`)
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return undefined as never
  }

  process.stderr.write(
    `claude gateway: enterprise auth/telemetry gateway server runtime is not bundled in this build (config loaded from ${validated.resolvedPath}).\n`,
  )
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
  return undefined as never
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
