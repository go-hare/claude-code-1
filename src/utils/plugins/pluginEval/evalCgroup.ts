/**
 * densable `la(kind)` — spawn extras `{cgroup}` for eval child (`agent`) and
 * scaffold bash (`plugin`). Gold: `n===void 0?{}:{cgroup:n}` wrapping `ie(kind)`.
 * Live host is `resolveToolMemoryCgroupForSpawn` (Qfp).
 */
import { resolveToolMemoryCgroupForSpawn } from '../../shell/toolMemoryCgroup.js'

export type EvalSpawnCgroupKind = 'agent' | 'plugin'

/** densable `la`. */
export function evalSpawnCgroupExtras(_kind: EvalSpawnCgroupKind): {
  cgroup?: string
} {
  const dir = resolveToolMemoryCgroupForSpawn(true)
  return dir === undefined ? {} : { cgroup: dir }
}
