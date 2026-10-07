/**
 * densable 2.1.233 — MCP Client factory (public `@modelcontextprotocol/client@2`).
 * SEA embeds the same surface; no 1.x schema adapter.
 *
 * Gold (SEA create factory `k`):
 *   new Client(info, {
 *     capabilities: YMr(),
 *     jsonSchemaValidator: new k0i,
 *     versionNegotiation: Z,
 *     listChanged: { tools|prompts|resources: {autoRefresh:false, debounceMs:0, onChanged:()=>{}} }
 *   })
 *   setRequestHandler("roots/list", ...)  // string methods, not Zod schemas
 */

import {
  Client,
  type ClientOptions,
  type Implementation,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type jsonSchemaValidator,
} from '@modelcontextprotocol/client'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv'
import { PRODUCT_URL } from '../../constants/product.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  isMcpCcrProxyServerConfig,
  matchMcpServerDenylist,
  type McpProtocolNegotiationPlan,
} from './mcpConnectTimeout.js'

export type DensableClientCapabilities = NonNullable<
  ClientOptions['capabilities']
>

/** Server config slice read by Idt/bn/Lr (gold only checks type + bare flag + url CCR). */
export type DensableElicitationCapabilityServerConfig = {
  type?: string
  bareElicitationCapability?: boolean
  url?: string
  command?: string
  [key: string]: unknown
}

/**
 * densable `uNn` / `TDt` — bare elicitation bag.
 * Local stack is v2-only; tasks/extensions residuals stay off (invent-ban).
 */
export function densableBareClientCapabilities(): DensableClientCapabilities {
  return {
    roots: { listChanged: true },
    elicitation: {},
  }
}

/** densable `qst` — GB `tengu_mcp_url_elicitation` default true. */
export function isMcpUrlElicitationCapabilityEnabled(
  readFeature: (key: string, def: boolean) => boolean = (key, def) =>
    getFeatureValue_CACHED_MAY_BE_STALE(key, def),
): boolean {
  return readFeature('tengu_mcp_url_elicitation', true)
}

/** densable `Kst` — GB `tengu_mcp_legacy_url_elicitation` default true. */
export function isMcpLegacyUrlElicitationCapabilityEnabled(
  readFeature: (key: string, def: boolean) => boolean = (key, def) =>
    getFeatureValue_CACHED_MAY_BE_STALE(key, def),
): boolean {
  return readFeature('tengu_mcp_legacy_url_elicitation', true) === true
}

/**
 * densable `To` — `xwi("tengu_mcp_legacy_url_elicitation_server_denylist", e)`.
 */
export function isMcpLegacyUrlElicitationServerDenylisted(
  serverConfig: DensableElicitationCapabilityServerConfig | undefined,
  readFeature: (key: string, def: unknown[]) => unknown = (key, def) =>
    getFeatureValue_CACHED_MAY_BE_STALE(key, def),
): boolean {
  if (serverConfig === undefined) return false
  return matchMcpServerDenylist(
    readFeature('tengu_mcp_legacy_url_elicitation_server_denylist', []),
    serverConfig,
  )
}

/**
 * densable `cln` — advertise 2025-11-25 form/url elicitation when URL gate is on.
 */
export function densableFormUrlClientCapabilities(
  readFeature: (key: string, def: boolean) => boolean = (key, def) =>
    getFeatureValue_CACHED_MAY_BE_STALE(key, def),
): DensableClientCapabilities {
  const bare = densableBareClientCapabilities()
  if (!isMcpUrlElicitationCapabilityEnabled(readFeature)) return bare
  return {
    ...bare,
    elicitation: { form: {}, url: {} },
  }
}

/**
 * densable `Idt(e,{denylisted})` — choose bare vs form/url elicitation bag.
 * Gold: legacy URL gate + !denylist + stdio/sse/http/ws + !CCR/cliOwned +
 * !bareElicitationCapability → form/url; else bare.
 * `isMcpCcrProxyServerConfig` implements densable `HEe` (URL-CCR OR
 * `isCliOwnedConfig` / `nf`). Ownership registered by bridge projects /
 * meta / carrier / REMOTE `markCliOwnedConfig` callers.
 */
export function densableClientCapabilitiesForServer(
  serverConfig: DensableElicitationCapabilityServerConfig | undefined,
  opts: {
    denylisted?: boolean
    readFeature?: (key: string, def: boolean) => boolean
  } = {},
): DensableClientCapabilities {
  const readFeature =
    opts.readFeature ??
    ((key, def) => getFeatureValue_CACHED_MAY_BE_STALE(key, def))
  const denylisted =
    opts.denylisted ?? isMcpLegacyUrlElicitationServerDenylisted(serverConfig)
  const type = serverConfig?.type
  const typeOk =
    type === undefined ||
    type === 'stdio' ||
    type === 'sse' ||
    type === 'http' ||
    type === 'ws'
  const barePinned =
    serverConfig !== undefined &&
    'bareElicitationCapability' in serverConfig &&
    serverConfig.bareElicitationCapability === true
  if (
    isMcpLegacyUrlElicitationCapabilityEnabled(readFeature) &&
    !denylisted &&
    typeOk &&
    !isMcpCcrProxyServerConfig(serverConfig) &&
    !barePinned
  ) {
    return densableFormUrlClientCapabilities(readFeature)
  }
  return densableBareClientCapabilities()
}

/**
 * densable factory default / projection payload.
 * Prefer `densableClientCapabilitiesForServer` at connect; this remains the
 * bare bag for claude.ai init-projection headers and tests.
 */
export function densableClientCapabilities(): DensableClientCapabilities {
  return densableBareClientCapabilities()
}

/** densable Java reject message rewrite (`ma`). */
export const JAVA_MCP_BARE_ELICITATION_HINT =
  'This server (Java MCP SDK 0.17.0 or older) rejected Claude Code\'s elicitation capability. Set "bareElicitationCapability": true for it, or upgrade to Java MCP SDK 0.17.1+ (Spring AI 1.0.7+ or 1.1.6+).'

/** densable `ua` — Jackson unrecognized form/url elicitation field. */
export const JAVA_MCP_FORM_URL_ELICITATION_REJECT_RE =
  /Unrecognized field "?(?:form|url)"? \(class [\w.$]*ClientCapabilities\$Elicitation\)/

const JAVA_MCP_STACK_TRACE_SCHEMA_MAX_BYTES = 262144

function hasJavaMcpTransportStackTrace(text: unknown): boolean {
  if (
    typeof text !== 'string' ||
    text.length > JAVA_MCP_STACK_TRACE_SCHEMA_MAX_BYTES
  ) {
    return false
  }
  try {
    const parsed = JSON.parse(text) as {
      message?: unknown
      stackTrace?: Array<{ className?: unknown }>
    }
    if (parsed.message !== 'Invalid message format') return false
    if (!Array.isArray(parsed.stackTrace)) return false
    return parsed.stackTrace.some(
      frame =>
        typeof frame?.className === 'string' &&
        frame.className.startsWith('io.modelcontextprotocol.server.transport.'),
    )
  } catch {
    return false
  }
}

/**
 * densable `bn` — Java MCP SDK rejected form/url elicitation capability, and
 * the current capability plan would still advertise `elicitation.url`.
 */
export function isJavaMcpFormUrlElicitationReject(
  error: unknown,
  serverConfig: DensableElicitationCapabilityServerConfig | undefined,
  transport?: object | null,
  opts: {
    denylisted?: boolean
    readFeature?: (key: string, def: boolean) => boolean
  } = {},
): boolean {
  const negotiated =
    transport !== null &&
    transport !== undefined &&
    typeof transport === 'object' &&
    'protocolVersion' in transport &&
    (transport as { protocolVersion?: unknown }).protocolVersion !== undefined
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof (error as { code?: unknown }).code === 'number' &&
          ((error as { code: number }).code >= 400 ||
            (error as { code: number }).code < 0)
        ? (error as { code: number }).code
        : undefined
  const dataText =
    error &&
    typeof error === 'object' &&
    'data' in error &&
    (error as { data?: { text?: unknown } }).data &&
    typeof (error as { data?: { text?: unknown } }).data === 'object'
      ? (error as { data: { text?: unknown } }).data.text
      : undefined
  const messageMatch =
    JAVA_MCP_FORM_URL_ELICITATION_REJECT_RE.test(message) ||
    (status === 400 && !negotiated && hasJavaMcpTransportStackTrace(dataText))
  if (!messageMatch) return false
  const caps = densableClientCapabilitiesForServer(serverConfig, opts)
  const elicitation = caps.elicitation
  return (
    elicitation !== undefined &&
    elicitation !== null &&
    typeof elicitation === 'object' &&
    'url' in elicitation
  )
}

/**
 * densable `Lr` — on auto negotiation, rewrite initialize capabilities through
 * `Idt` so form/url advertising stays config-gated even when Client was built
 * with a temporary bag.
 */
export function patchMcpInitializeCapabilities(
  client: { send: (...args: never[]) => unknown },
  serverConfig: DensableElicitationCapabilityServerConfig | undefined,
  opts: {
    denylisted?: boolean
    readFeature?: (key: string, def: boolean) => boolean
  } = {},
): void {
  const mutable = client as {
    send: (...args: unknown[]) => unknown
  }
  const originalSend = mutable.send.bind(client)
  mutable.send = (...args: unknown[]) => {
    const message = args[0]
    const options = args[1]
    if (
      message &&
      typeof message === 'object' &&
      'method' in message &&
      (message as { method?: unknown }).method === 'initialize' &&
      'params' in message &&
      (message as { params?: { capabilities?: unknown } }).params
        ?.capabilities !== undefined
    ) {
      const msg = message as {
        method: string
        params: { capabilities?: unknown } & Record<string, unknown>
      }
      return originalSend(
        {
          ...msg,
          params: {
            ...msg.params,
            capabilities: densableClientCapabilitiesForServer(serverConfig, {
              denylisted:
                opts.denylisted ??
                isMcpLegacyUrlElicitationServerDenylisted(serverConfig),
              readFeature: opts.readFeature,
            }),
          },
        },
        options,
      )
    }
    return originalSend(...args)
  }
}

/**
 * densable `kpS` — exact draft `$schema` URIs stripped before Ajv validate.
 * SEA gold:
 *   new Set([
 *     "http://json-schema.org/draft-04/schema",
 *     "https://json-schema.org/draft-04/schema",
 *     "http://json-schema.org/draft-06/schema",
 *     "https://json-schema.org/draft-06/schema",
 *     "http://json-schema.org/draft-07/schema",
 *     "https://json-schema.org/draft-07/schema",
 *     "http://json-schema.org/draft/2019-09/schema",
 *     "https://json-schema.org/draft/2019-09/schema",
 *     "http://json-schema.org/schema",
 *     "https://json-schema.org/schema",
 *   ])
 */
export const DENSABLE_JSON_SCHEMA_DRAFT_URIS = new Set([
  'http://json-schema.org/draft-04/schema',
  'https://json-schema.org/draft-04/schema',
  'http://json-schema.org/draft-06/schema',
  'https://json-schema.org/draft-06/schema',
  'http://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft-07/schema',
  'http://json-schema.org/draft/2019-09/schema',
  'https://json-schema.org/draft/2019-09/schema',
  'http://json-schema.org/schema',
  'https://json-schema.org/schema',
])

/**
 * densable k0i — Ajv validator that strips `$schema` when it is in kpS
 * (after trailing `#` strip) so tool output schemas still validate.
 * Implements client@2 `jsonSchemaValidator` (no cast at Client construction).
 */
export class DensableAjvJsonSchemaValidator implements jsonSchemaValidator {
  private readonly inner = new AjvJsonSchemaValidator()

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const draft = (schema as { $schema?: unknown }).$schema
    if (
      typeof draft === 'string' &&
      DENSABLE_JSON_SCHEMA_DRAFT_URIS.has(draft.replace(/#$/, ''))
    ) {
      const { $schema: _drop, ...rest } = schema as JsonSchemaType & {
        $schema?: unknown
      }
      return this.inner.getValidator<T>(rest as JsonSchemaType)
    }
    return this.inner.getValidator<T>(schema)
  }
}

/** densable listChanged stubs — autoRefresh off; product refresh via handlers. */
export function densableListChangedOptions(): NonNullable<
  ClientOptions['listChanged']
> {
  const noop = (): void => {}
  return {
    tools: { autoRefresh: false, debounceMs: 0, onChanged: noop },
    prompts: { autoRefresh: false, debounceMs: 0, onChanged: noop },
    resources: { autoRefresh: false, debounceMs: 0, onChanged: noop },
  }
}

function clientVersion(): string {
  // MACRO is inject-only at build/dev; unit tests may lack the define.
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (typeof MACRO !== 'undefined' && MACRO.VERSION) || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function densableClientInfo(): Implementation {
  return {
    name: 'claude-code',
    title: 'Claude Code',
    version: clientVersion(),
    description: "Anthropic's agentic coding tool",
    websiteUrl: PRODUCT_URL,
  }
}

/**
 * Map local negotiation plan → v2 ClientOptions.versionNegotiation.
 * densable BVa: `{mode:'legacy'} | {mode:'auto', probe:{timeoutMs}}`.
 */
export function toV2VersionNegotiation(
  plan: McpProtocolNegotiationPlan,
): NonNullable<ClientOptions['versionNegotiation']> {
  if (plan.mode === 'legacy') return { mode: 'legacy' }
  return {
    mode: 'auto',
    probe: { timeoutMs: plan.probe.timeoutMs },
  }
}

/**
 * densable `ze` capability ternary:
 *   Ee ? TDt() : A.mode==="auto" ? cln() : Idt(n,{denylisted:To(n)})
 * Local: forceBare (Java retry) → bare; auto → form/url when gated; else Idt.
 */
export function densableClientCapabilitiesForConnect(
  plan: McpProtocolNegotiationPlan,
  serverConfig?: DensableElicitationCapabilityServerConfig,
  opts: {
    forceBare?: boolean
    denylisted?: boolean
    readFeature?: (key: string, def: boolean) => boolean
  } = {},
): DensableClientCapabilities {
  if (opts.forceBare) return densableBareClientCapabilities()
  if (plan.mode === 'auto') {
    return densableFormUrlClientCapabilities(opts.readFeature)
  }
  return densableClientCapabilitiesForServer(serverConfig, opts)
}

/** densable k(Z) — plain v2 Client, string handlers at call sites. */
export function createDensableMcpClient(
  plan: McpProtocolNegotiationPlan,
  serverConfig?: DensableElicitationCapabilityServerConfig,
  opts: {
    forceBare?: boolean
    denylisted?: boolean
    readFeature?: (key: string, def: boolean) => boolean
  } = {},
): Client {
  const capabilities = densableClientCapabilitiesForConnect(
    plan,
    serverConfig,
    opts,
  )
  const client = new Client(densableClientInfo(), {
    capabilities,
    jsonSchemaValidator: new DensableAjvJsonSchemaValidator(),
    versionNegotiation: toV2VersionNegotiation(plan),
    listChanged: densableListChangedOptions(),
  })
  // densable Lr — auto-mode initialize rewrite through Idt (config gate).
  if (plan.mode === 'auto' && !opts.forceBare) {
    patchMcpInitializeCapabilities(
      client as unknown as { send: (...args: never[]) => unknown },
      serverConfig,
      opts,
    )
  }
  return client
}
