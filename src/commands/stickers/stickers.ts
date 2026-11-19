import chalk from 'chalk'
import type { LocalCommandResult } from '../../types/command.js'

/**
 * Official 2.1.323 (#2192): `/stickers` now reports that the sticker pack is
 * all claimed for now instead of opening a browser page.
 */
export async function call(): Promise<LocalCommandResult> {
  return {
    type: 'text',
    value: `Claude Code sticker pack\n${chalk.dim('All claimed for now. Thanks for the love.')}`,
  }
}
