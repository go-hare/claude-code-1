/**
 * densable 2.1.283 `designLoginStatus` / `runDesignLoginSignIn` @205300340.
 * Gold `_(i)` / `v({stdin,write,signal})` / `m(i)`.
 */
import { jsonStringify } from '../../utils/slowOperations.js'
import { logEventAsync } from '../../services/analytics/index.js'
import {
  designLoginFailureMessage,
  isDesignLoginAvailable,
  isDesignLoginRemote,
  isDesignOAuthClientConfigured,
  readDesignOauth,
  runDesignOAuthFlow,
} from './designOauth.js'

export type DesignLoginStatus = {
  available: boolean
  signed_in: boolean
  can_sign_in_here: boolean
  reason?: string
}

export async function designLoginStatus(
  storageV5?: unknown,
): Promise<DesignLoginStatus> {
  const available = isDesignLoginAvailable()
  const signedIn = (await readDesignOauth(storageV5)) !== null
  const reason = isDesignOAuthClientConfigured()
    ? undefined
    : 'The Claude Design sign-in is not configured in this build.'
  return {
    available,
    signed_in: signedIn,
    can_sign_in_here: reason === undefined,
    ...(reason !== undefined ? { reason } : {}),
  }
}

export async function runDesignLoginSignIn(opts: {
  stdin: NodeJS.ReadableStream
  write: (line: string) => void | Promise<void>
  signal: AbortSignal
}): Promise<{ ok: boolean; event: 'done'; message?: string }> {
  if (!isDesignLoginAvailable()) {
    await logEventAsync('design_login_host', {})
    const done = {
      event: 'done' as const,
      ok: false,
      message: 'Claude Design sync is not available in this session.',
    }
    await opts.write(jsonStringify(done))
    return done
  }
  const result = await runDesignOAuthFlow(opts.signal, {
    onAuthUrl: (url, manual) => {
      void opts.write(
        jsonStringify({
          event: 'pages',
          url,
          manual_url: manual,
          manual_first: isDesignLoginRemote(),
        }),
      )
    },
    onManualCode: set => {
      void (async () => {
        let buf = ''
        for await (const chunk of opts.stdin) {
          buf += typeof chunk === 'string' ? chunk : chunk.toString()
          let nl = buf.indexOf('\n')
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            nl = buf.indexOf('\n')
            if (line === '') continue
            let parsed: { code?: unknown }
            try {
              parsed = JSON.parse(line) as { code?: unknown }
            } catch {
              continue
            }
            if (typeof parsed.code !== 'string') continue
            const raw = parsed.code.trim()
            const hash = raw.indexOf('#')
            set(
              hash >= 0 ? raw.slice(0, hash) : raw,
              hash >= 0 ? raw.slice(hash + 1) : '',
            )
          }
        }
      })()
    },
  })
  if (result.ok) {
    const done = { event: 'done' as const, ok: true }
    await opts.write(jsonStringify(done))
    return done
  }
  await logEventAsync('design_login_host', {})
  const done = {
    event: 'done' as const,
    ok: false,
    message: designLoginFailureMessage(result),
  }
  await opts.write(jsonStringify(done))
  return done
}
