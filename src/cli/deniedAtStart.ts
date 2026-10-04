/**
 * densable RH start fatal: Sx(Bn); await D6({sessionId:V(),message:Bn,reason}); Fi()
 *
 * Sx = console.error(chalk.red). D6 = writeStartupFailureResult.
 * Fi = analytics flush + process.exit(1) — not gold token Fi @175490813.
 *
 * MAIN src/main.tsx (after formatDeniedModelsBlockMessage import):
 *   import { fatalDeniedAtStart } from './cli/deniedAtStart.js';
 * Replace deniedAtStart process.exit(1) with:
 *   if (deniedAtStart !== null) {
 *     await fatalDeniedAtStart(deniedAtStart);
 *   }
 */
import chalk from 'chalk'
import { getSessionId } from '../bootstrap/state.js'
import {
  exitAfterAnalyticsFlush,
  MANAGED_SETTINGS_INVALID_REASON,
  writeStartupFailureResult,
} from './startupFailure.js'

export async function fatalDeniedAtStart(message: string): Promise<never> {
  console.error(chalk.red(message))
  await writeStartupFailureResult({
    sessionId: getSessionId(),
    message,
    reason: MANAGED_SETTINGS_INVALID_REASON,
  })
  return await exitAfterAnalyticsFlush()
}
