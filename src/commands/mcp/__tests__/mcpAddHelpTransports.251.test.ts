import { Command } from '@commander-js/extra-typings'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { registerMcpAddCommand } from '../addCommand.js'

const HEADER_HELP =
  'Set headers for HTTP/SSE servers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")'
const TRANSPORT_HELP =
  'Transport type (stdio, sse, http). Defaults to stdio if not specified.'
const ADD_JSON_HELP =
  'Add an MCP server (stdio, SSE, HTTP, or WebSocket) with a JSON string'
const STDIO_ENV_EXAMPLE =
  'claude mcp add my-server -e API_KEY=xxx -- npx my-mcp-server'

describe('mcp add help transports (251 #37)', () => {
  test('--header and --transport name HTTP/SSE and stdio, sse, http', () => {
    const mcp = new Command('mcp')
    registerMcpAddCommand(mcp)
    const add = mcp.commands.find(command => command.name() === 'add')
    expect(add).toBeDefined()
    const header = add?.options.find(option => option.long === '--header')
    const transport = add?.options.find(option => option.long === '--transport')
    expect(header?.description).toBe(HEADER_HELP)
    expect(transport?.description).toBe(TRANSPORT_HELP)
    expect(header?.description).not.toContain('WebSocket headers')
    expect(add?.description()).toContain(STDIO_ENV_EXAMPLE)
    expect(add?.description()).not.toContain(
      'claude mcp add -e API_KEY=xxx my-server -- npx my-mcp-server',
    )
  })

  test('add-json help names stdio, SSE, HTTP, or WebSocket', () => {
    const main = readFileSync(
      join(import.meta.dir, '../../../main.tsx'),
      'utf8',
    )
    expect(main).toContain(ADD_JSON_HELP)
    expect(main).not.toContain(
      'Add an MCP server (stdio or SSE) with a JSON string',
    )
  })
})
