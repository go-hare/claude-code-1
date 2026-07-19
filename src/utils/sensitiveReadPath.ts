/**
 * densable YNy residual pure — paths that FileRead should treat as
 * always-sensitive / blocked device-like targets.
 *
 * densable:
 *   KNy = Set of /dev/{zero,random,urandom,full,stdin,tty,console,stdout,stderr,fd/0,1,2}
 *   YNy(path):
 *     KNy.has → true
 *     /proc/<pid>/fd/0|1|2 → true
 *     /proc/<pid>/(environ|cmdline|auxv|maps|mem|stat) → true
 *     else false
 */

/** densable KNy. */
export const SENSITIVE_READ_PATHS: ReadonlySet<string> = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
])

const PROC_FD_STDIO = /^\/proc\/[^/]+\/fd\/[012]$/
const PROC_SENSITIVE =
  /^\/proc\/[^/]+\/(environ|cmdline|auxv|maps|mem|stat)$/

/** densable YNy. */
export function isSensitiveReadPath(filePath: string): boolean {
  if (SENSITIVE_READ_PATHS.has(filePath)) return true
  if (filePath.startsWith('/proc/') && PROC_FD_STDIO.test(filePath)) return true
  if (PROC_SENSITIVE.test(filePath)) return true
  return false
}
