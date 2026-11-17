import { describe, expect, test } from 'bun:test'

// Run the real host in a fresh process: other tests replace its large import
// graph with process-global mocks, and this test must neither inherit nor add them.
describe('densable 2.1.289 ZOt MCP call session host', () => {
  test('session list order, qualified names, shared execution and missing host', async () => {
    const script = `
      import { strict as assert } from 'node:assert';
      import { handleHostOp, setFunctionHooksAppStateReader, setToolCallHandler } from './src/utils/plugins/functionHooksModules.ts';
      import { setPluginToolSessionHost } from './src/utils/plugins/pluginToolSessionHost.ts';
      const call = () => handleHostOp('mcp.call', [{ server: 'demo.server', tool: 'ping' }], 'demo');
      let tools = [{ name: 'mcp__demo.server__ping' }, { name: 'mcp__demo_server__ping' }];
      let calls = [];
      setFunctionHooksAppStateReader(() => ({ mcp: { clients: [], tools: [{ name: 'ping', mcpInfo: { serverName: 'demo.server', toolName: 'ping' } }] } }));
      setToolCallHandler(async input => { calls.push(input); return { content: [{ type: 'text', text: 'pong' }] }; });
      try {
        await assert.rejects(call, /no session is bound/);
        setPluginToolSessionHost({ tools: () => tools, mcpServers: () => [], addMcpServer() {} });
        assert.deepEqual(await call(), { content: [{ type: 'text', text: 'pong' }], isError: false });
        assert.equal(calls[0].tool, 'mcp__demo.server__ping');
        tools.reverse();
        await call();
        assert.equal(calls[1].tool, 'mcp__demo_server__ping');
        tools = [{ name: 'ping', mcpInfo: { serverName: 'demo.server', toolName: 'ping' } }];
        await assert.rejects(call, /no connected MCP tool/);
        assert.equal(calls.length, 2);
        tools = [{ name: 'mcp__demo_server__ping' }];
        setToolCallHandler(undefined);
        await assert.rejects(call, /produced no result/);
        setToolCallHandler(async () => ({ deny: 'policy says no' }));
        await assert.rejects(call, /refused: policy says no/);
        setToolCallHandler(async () => ({ text: 'failed', isError: true }));
        assert.deepEqual(await call(), { content: [{ type: 'text', text: 'failed' }], isError: true });
      } finally {
        setPluginToolSessionHost(undefined);
        setToolCallHandler(undefined);
        setFunctionHooksAppStateReader(undefined);
      }
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], {
      cwd: new URL('../../../../', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr.toString(),
    }).toEqual({
      exitCode: 0,
      stderr: expect.any(String),
    })
  })
})
