/**
 * densable `fVp` / agent-sdk `hl` product twin: in-process SDK MCP server.
 *
 * Gold (claude-agent-sdk sdk.mjs `hl` / SEA `fVp` / densable `cr4`):
 *   new McpServer({name, version}) → tools.forEach → registerTool →
 *   return { type: 'sdk', name, instance }
 *
 * densable SEA is untyped JS: `registerTool(name, {inputSchema, …}, handler)`
 * with **no** cast. Our TS twin:
 *   - per-tool `tool()` keeps full Zod generics
 *   - heterogeneous `tools[]` uses `any` variance (same as agent-sdk / densable forEach)
 *   - `registerTool` gets raw Zod shape + handler without `as never`
 *
 * densable 1:1 registry: do **not** null-proto McpServer maps — densable SEA
 * and public MCP SDK keep plain `_registeredTools = {}` + truthy membership.
 * Official 2.1.221 #10 is the **API-request** path (toolToAPISchema / SWARM),
 * not inventing a densable-absent registry fix here.
 */

import { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult, ToolAnnotations } from 'src/services/mcp/types.js'
import { globalRegistry, type z } from 'zod/v4'
import type {
  AnyZodRawShape,
  InferShape,
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from './runtimeTypes.js'

export type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  /**
   * densable `cr4` / agent-sdk: heterogeneous tool list (each schema differs).
   * SEA is untyped; agent-sdk uses `SdkMcpToolDefinition<any>` for variance.
   */
  tools?: Array<SdkMcpToolDefinition<any>>
}

/**
 * densable `gl` / agent-sdk `tool()` — pure definition factory (no side effects).
 */
export function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  const meta: Record<string, unknown> = {}
  if (extras?.searchHint) meta['anthropic/searchHint'] = extras.searchHint
  if (extras?.alwaysLoad) meta['anthropic/alwaysLoad'] = true
  return {
    name,
    description,
    inputSchema,
    handler,
    annotations: extras?.annotations,
    _meta: Object.keys(meta).length > 0 ? meta : undefined,
  }
}

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === 'object' && value !== null && '_zod' in value
}

/**
 * densable `fVp` / agent-sdk `hl` / densable `cr4` — create in-process SDK MCP server.
 * Registry left as MCP SDK default (plain `{}`) for densable 1:1.
 * registerTool args match densable: no `as never` on inputSchema/handler.
 */
export function createSdkMcpServer(
  options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  const mcp = new McpServer(
    {
      name: options.name,
      version: options.version ?? '1.0.0',
    },
    {
      capabilities: {
        tools: options.tools ? {} : undefined,
      },
    },
  )

  if (options.tools) {
    for (const def of options.tools) {
      // densable/agent-sdk: push Zod field `.description` into globalRegistry
      // so MCP JSON Schema conversion can surface field docs.
      for (const field of Object.values(def.inputSchema ?? {})) {
        if (!isZodType(field)) continue
        const desc = field.description
        if (desc && !globalRegistry.has(field)) {
          globalRegistry.add(field, { description: desc })
        }
      }
      // densable cr4: registerTool(name, {description, inputSchema, annotations, _meta}, handler)
      mcp.registerTool(
        def.name,
        {
          description: def.description,
          inputSchema: def.inputSchema,
          annotations: def.annotations,
          _meta: def._meta,
        },
        def.handler,
      )
    }
  }

  return {
    type: 'sdk',
    name: options.name,
    instance: mcp,
  }
}
