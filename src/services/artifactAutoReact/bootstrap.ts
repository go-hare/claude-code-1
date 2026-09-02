/**
 * Product bootstrap — install Qem+Cji arm deps + watch_url MCP dialer.
 */
import type { MCPServerConnection } from '../mcp/types.js'
import { setArtifactLiveArmDeps, type ArmLiveDeps } from './arm.js'
import { createFrameLiveTransform, openFrameLiveSocket } from './cji.js'
import { mintSubscriptionToken, renewWatchToken } from './mint.js'
import { setArtifactScanDeps, type ScanDeps } from './scan.js'
import { mcpResultToText, setWatchUrlDeps } from './watchUrl.js'
import { notifyArtifactChanged, yWt } from './wake.js'
import { mI } from './gates.js'
import {
  artifactLiveEditVf,
  resetArtifactLiveEditVfForTests,
  setArtifactLiveEditVf,
} from './liveEditPermissions.js'
import {
  createCcrGatewayArtifactFrameRelayHost,
  getArtifactFrameRelayHost,
  resetArtifactFrameRelayHostForTests,
  setArtifactFrameRelayHost,
  type ArtifactFrameRelayHost,
  type CcrGatewayArtifactFrameRelayHostDeps,
} from './frameRelay.js'
import { un } from './store.js'

export type InstallProductOpts = {
  withTransform?: boolean
  overrides?: ArmLiveDeps
  /** AppState.mcp.clients getter — wires watch_url when remote. */
  getMcpClients?: () => readonly MCPServerConnection[]
  /** Permission mode + nzt compose / probe for zPw auto-reply. */
  scan?: ScanDeps
  /**
   * densable ccr-gateway frame relay host. Defaults to production JWT host.
   * Pass null to leave unbound; pass a custom host to inject.
   */
  frameRelayHost?: ArtifactFrameRelayHost | null
  /** Deps for the default ccr-gateway host (ignored when frameRelayHost set). */
  frameRelayHostDeps?: CcrGatewayArtifactFrameRelayHostDeps
}

let productInstalled = false

export function isArtifactAutoReactProductInstalled(): boolean {
  return productInstalled
}

/**
 * densable product host: mint=Qem, renew=ttm, open=Cji+ODw→yWt, MCP watch_url.
 */
export function installArtifactAutoReactProduct(
  opts: InstallProductOpts = {},
): void {
  setArtifactLiveArmDeps({
    mintSubscription: mintSubscriptionToken,
    renewWatchToken: async (slug, signal) => {
      const r = await renewWatchToken(slug, signal)
      if (r.err !== null) return { err: true, status: r.status }
      return {
        err: null,
        token: r.token,
        ver: r.ver,
        tokenExp: r.tokenExp,
        renewable: true,
      }
    },
    openLiveSocket: async input => {
      const transform =
        opts.withTransform !== false
          ? createFrameLiveTransform({
              slug: input.slug,
              url: input.url,
              onComment: () => {
                if (!mI()) return
                const sup = un().live.supervisors.get(input.slug)
                const title =
                  (sup?.autoReactWiring?.title as string | undefined) ??
                  input.slug
                yWt({ slug: input.slug, url: input.url, title })
              },
              onSurfaced: ver => {
                const sup = un().live.supervisors.get(input.slug)
                notifyArtifactChanged({
                  slug: input.slug,
                  url: input.url,
                  ver,
                  title:
                    (sup?.autoReactWiring?.title as string | undefined) ??
                    undefined,
                })
              },
            })
          : undefined
      return openFrameLiveSocket({
        ...input,
        ...(transform !== undefined ? { transform } : {}),
      })
    },
    ...opts.overrides,
  })

  // densable defaults: qPw/KPw compose + aDw/lDw attemptEdit; host scan overrides
  void Promise.all([import('./compose.js'), import('./edit.js')]).then(
    ([{ defaultComposeAutoReply }, { defaultAttemptEdit }]) => {
      setArtifactScanDeps({
        composeAutoReply: defaultComposeAutoReply,
        attemptEdit: defaultAttemptEdit,
        ...opts.scan,
      })
    },
  )

  if (opts.getMcpClients) {
    const getClients = opts.getMcpClients
    setWatchUrlDeps({
      callTool: async (name, args) => {
        const clients = getClients()
        const connected = clients.find(c => c.type === 'connected')
        if (!connected || connected.type !== 'connected') return null
        try {
          // Lazy: avoid mcp/client ↔ artifactAutoReact cycles at module load
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { ensureConnectedClient } =
            require('../mcp/client.js') as typeof import('../mcp/client.js')
          const live = await ensureConnectedClient(connected)
          const result = await live.client.callTool(
            { name, arguments: args },
            { timeout: 15_000 },
          )
          return {
            isError: Boolean(
              result &&
                typeof result === 'object' &&
                'isError' in result &&
                (result as { isError?: boolean }).isError,
            ),
            text: mcpResultToText(
              result as { content?: unknown; isError?: boolean },
            ),
          }
        } catch {
          return null
        }
      },
    })
  }

  // densable vf bind — SEA keeps vf=null until feature module; tip binds on install
  // so live-edit checkPermissions/call are not permanently "not available".
  setArtifactLiveEditVf(artifactLiveEditVf)

  // densable Fdw ccr-gateway session-jwt — bind production host (injectable).
  if (opts.frameRelayHost !== undefined) {
    setArtifactFrameRelayHost(opts.frameRelayHost)
  } else if (getArtifactFrameRelayHost() === null) {
    setArtifactFrameRelayHost(
      createCcrGatewayArtifactFrameRelayHost(opts.frameRelayHostDeps),
    )
  }

  productInstalled = true
}

/** Alias used by installDefaults / tests. */
export function installDefaultArtifactLiveArmDeps(
  opts: InstallProductOpts = {},
): void {
  installArtifactAutoReactProduct(opts)
}

export function resetArtifactAutoReactProductForTests(): void {
  productInstalled = false
  resetArtifactLiveEditVfForTests()
  resetArtifactFrameRelayHostForTests()
}
