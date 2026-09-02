/**
 * densable Mlw / Dlw — map /api/frame/* paths to relay family for o$i telemetry.
 * Gold: gold-sEe-relay / `.tmp-gold-Dlw.js` — path.slice(10) drops `/api/frame`.
 */
export type FrameRelayFamily =
  | 'boot'
  | 'publish'
  | 'comments'
  | 'db'
  | 'subscriptions'

type FrameRoute = {
  method: 'GET' | 'POST'
  pattern: string[]
  family: FrameRelayFamily
}

function route(
  method: 'GET' | 'POST',
  family: FrameRelayFamily,
  pathPattern: string,
): FrameRoute {
  return {
    method,
    family,
    pattern: pathPattern.split('/'),
  }
}

/** densable Dlw — sorted by pattern length (yZf) not required for find-first match. */
const FRAME_RELAY_ROUTES: FrameRoute[] = [
  route('GET', 'boot', '/{slug}'),
  route('GET', 'boot', '/versions/{slug}'),
  route('GET', 'boot', '/frames'),
  route('POST', 'boot', '/track'),
  route('POST', 'publish', '/deploy/direct'),
  route('POST', 'publish', '/deploy/prepare'),
  route('POST', 'publish', '/upload'),
  route('GET', 'publish', '/contract/latest'),
  route('GET', 'publish', '/contract/{v}'),
  route('GET', 'publish', '/contract/{v}/{file}'),
  route('GET', 'publish', '/contract/{v}/prompt'),
  route('GET', 'publish', '/read/{slug}'),
  route('GET', 'comments', '/comments/{slug}'),
  route('POST', 'comments', '/comments/{slug}/{thread}'),
  route('POST', 'comments', '/comments/{slug}/{thread}/resolve'),
  route('POST', 'comments', '/comments/{slug}/{thread}/summon-status'),
  route('POST', 'db', '/db/agent'),
  route('POST', 'subscriptions', '/subscribe/{slug}'),
  route('POST', 'subscriptions', '/unsubscribe/{slug}'),
]

const API_FRAME_PREFIX = '/api/frame'
const API_FRAME_PREFIX_LEN = API_FRAME_PREFIX.length

/**
 * densable Mlw(method, path) — family for o$i probe/success telemetry, or null.
 */
export function resolveFrameRelayFamily(
  method: 'GET' | 'POST',
  path: string,
): FrameRelayFamily | null {
  if (!path.startsWith(API_FRAME_PREFIX)) return null
  const rest = path.slice(API_FRAME_PREFIX_LEN).replace(/[?#].*$/s, '')
  const parts = rest.split('/')
  for (const o of FRAME_RELAY_ROUTES) {
    if (o.method !== method) continue
    if (o.pattern.length !== parts.length) continue
    if (
      o.pattern.every((i, s) =>
        i.startsWith('{') ? parts[s] !== '' : i === parts[s],
      )
    ) {
      return o.family
    }
  }
  return null
}
