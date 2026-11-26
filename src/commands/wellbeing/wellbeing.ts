import type * as React from 'react'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

/** Official 2.1.331 `H` (`WRITE_DELAY_MS`) in `chunk-rqa65x80.js`. */
export const WRITE_DELAY_MS = 200

/**
 * Official 2.1.331 `P` (`call`) in `chunk-rqa65x80.js`.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<React.ReactNode> {
  onDone("Wellbeing settings aren't available in this version")
  return null
}
