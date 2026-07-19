/**
 * densable evs residual — thin-client slash dispatch in remote/CCR mode.
 *
 * densable:
 *   prompt type → always "post-text"
 *   thinClientDispatch:
 *     post-text → post-text
 *     control-request | local-then-rpc → local if rpcOk else unavailable (local only)
 *     twin → post-text
 *     undefined → local-jsx → local, else post-text
 */

export type ThinClientDispatch =
  | 'post-text'
  | 'control-request'
  | 'local-then-rpc'
  | 'twin'

export type RemoteSlashDispatchKind = 'local' | 'post-text' | 'unavailable'

export type RemoteSlashDispatchInput = {
  type: string
  thinClientDispatch?: ThinClientDispatch
  /** densable Lb() — true when control/rpc path is available. */
  rpcOk?: boolean
}

/** densable evs(command, rpcOk) */
export function resolveRemoteSlashDispatch(
  input: RemoteSlashDispatchInput,
): RemoteSlashDispatchKind {
  if (input.type === 'prompt') return 'post-text'
  switch (input.thinClientDispatch) {
    case 'post-text':
      return 'post-text'
    case 'control-request':
    case 'local-then-rpc':
      if (input.type === 'local' && !input.rpcOk) return 'unavailable'
      return 'local'
    case 'twin':
      return 'post-text'
    case undefined:
      return input.type === 'local-jsx' ? 'local' : 'post-text'
    default:
      return 'post-text'
  }
}

/** densable notification copy for remote_unavailable. */
export function remoteUnavailableNotificationText(
  commandName: string,
  viewerOnly: boolean,
): string {
  return viewerOnly
    ? `/${commandName} isn't available while viewing read-only`
    : `/${commandName} isn't available in cloud sessions yet`
}
