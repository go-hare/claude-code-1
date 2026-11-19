import { statfs } from 'fs/promises'
import { logForDebugging } from './debug.js'
import { getErrnoCode, isENOENT } from './errors.js'

/**
 * Official 2.1.319 `ide` (#1725): Linux/WSL `statfs` filesystem magic numbers
 * for network filesystems (NFS, CIFS, SMB2, Ceph, Lustre, GPFS, BeeGFS, AFS, OCFS2)
 * where listing every project file at startup is prohibitively slow.
 */
export const NETWORK_FILESYSTEM_STATFS_MAGICS: ReadonlySet<number> = new Set([
  0x6969, // 26985: NFS_SUPER_MAGIC
  0xff534d42, // 4283649346: CIFS_MAGIC_NUMBER
  0xfe534d42, // 4266872130: SMB2_MAGIC_NUMBER
  0x00c36400, // 12805120: CEPH_SUPER_MAGIC
  0x0bd00bd0, // 198183888: LUSTRE / LL_SUPER_MAGIC
  0x47504653, // 1196443219: GPFS_SUPER_MAGIC
  0x19830326, // 428016422: FHGFS / BeeGFS
  0x5346414f, // 1397113167: AFS_SUPER_MAGIC
  0x6b414653, // 1799439955: kAFS
  0x7461636f, // 1952539503: OCFS2_SUPER_MAGIC
])

function isLinuxOrWslPlatform(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'linux'
}

/**
 * Official 2.1.319 `uW(dir)` (#1725): returns true when `dir` resides on a
 * Linux/WSL network filesystem (NFS, SMB/CIFS, Lustre, GPFS, etc.) or when
 * `statfs` fails unexpectedly (fail-closed to avoid hammering slow mounts).
 */
export async function isNetworkFilesystemPath(
  dir: string,
  opts?: {
    platform?: NodeJS.Platform
    statfsFn?: (path: string) => Promise<{ type: number | bigint }>
  },
): Promise<boolean> {
  if (!isLinuxOrWslPlatform(opts?.platform)) {
    return false
  }
  const readStatfs = opts?.statfsFn ?? (p => statfs(p))
  try {
    const info = await readStatfs(dir)
    const magic = Number(info.type) >>> 0
    return NETWORK_FILESYSTEM_STATFS_MAGICS.has(magic)
  } catch (err) {
    if (isENOENT(err) || getErrnoCode(err) === 'ERR_INVALID_ARG_VALUE') {
      return false
    }
    logForDebugging(
      `Could not ask for the file system of ${dir}: ${String(err)}`,
    )
    return true
  }
}

/**
 * Official 2.1.319 (#1725): skip full startup project file indexing when the
 * project directory lives on a network filesystem on Linux/WSL.
 */
export async function shouldSkipStartupFileIndexing(
  dir: string,
  opts?: {
    platform?: NodeJS.Platform
    statfsFn?: (path: string) => Promise<{ type: number | bigint }>
  },
): Promise<boolean> {
  return isNetworkFilesystemPath(dir, opts)
}
