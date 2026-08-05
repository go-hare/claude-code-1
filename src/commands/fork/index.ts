import type { Command } from '../../commands.js'
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js'

/**
 * densable 2.1.212 `/fork` — background session copy (main keeps working).
 * In-session full-context worker is `/subtask`.
 *
 * densable `_wd` meta in the binary has description/argumentHint/isEnabled but
 * **no `load()`** — the real body is registered separately as `M2p`/`nZ_`/`L2p`.
 * Local product intentionally wires `load → fork.tsx` (nZ_ + L2p + D$t keepParent)
 * so the slash command is a complete L2p body, not densable's incomplete shell.
 */
const fork = {
  type: 'local-jsx',
  name: 'fork',
  description:
    'Copy this conversation into a new background session and keep working here',
  argumentHint: '[prompt]',
  isEnabled: () => !isCoordinatorMode(),
  load: () => import('./fork.js'),
} satisfies Command

export default fork
