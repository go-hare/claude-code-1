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
} from '@modelcontextprotocol/client'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv'
import { PRODUCT_URL } from '../../constants/product.js'
import type { McpProtocolNegotiationPlan } from './mcpConnectTimeout.js'

/** densable KPb / YMr (v2 tasks strip residual left off — BW()!==v2). */
export function densableClientCapabilities(): NonNullable<
  ClientOptions['capabilities']
> {
  return {
    roots: { listChanged: true },
    // Empty object declares elicitation (Java Spring MCP rejects form/url bags).
    elicitation: {},
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
 */
export class DensableAjvJsonSchemaValidator {
  private readonly inner = new AjvJsonSchemaValidator()

  getValidator(
    schema: Record<string, unknown>,
  ): ReturnType<AjvJsonSchemaValidator['getValidator']> {
    const draft = schema.$schema
    if (
      typeof draft === 'string' &&
      DENSABLE_JSON_SCHEMA_DRAFT_URIS.has(draft.replace(/#$/, ''))
    ) {
      const { $schema: _drop, ...rest } = schema
      return this.inner.getValidator(rest)
    }
    return this.inner.getValidator(schema)
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

/** densable k(Z) — plain v2 Client, string handlers at call sites. */
export function createDensableMcpClient(
  plan: McpProtocolNegotiationPlan,
): Client {
  return new Client(densableClientInfo(), {
    capabilities: densableClientCapabilities(),
    jsonSchemaValidator: new DensableAjvJsonSchemaValidator() as never,
    versionNegotiation: toV2VersionNegotiation(plan),
    listChanged: densableListChangedOptions(),
  })
}
