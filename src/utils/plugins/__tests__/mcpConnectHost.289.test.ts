import { describe, expect, test } from 'bun:test'

function runIsolated(script: string): void {
  const result = Bun.spawnSync([process.execPath, '-e', script], {
    cwd: new URL('../../../../', import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: 'test' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect({
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: expect.any(String) })
}

describe('densable 2.1.289 VCt plugin MCP connection', () => {
  test('refusals, twin ownership, joined connections and unload while connecting', () => {
    runIsolated(`
      import { strict as assert } from 'node:assert';
      import { handleHostOp, setLoadedFunctionHooksModules } from './src/utils/plugins/functionHooksModules.ts';
      import { setPluginToolSessionHost } from './src/utils/plugins/pluginToolSessionHost.ts';
      const call = () => handleHostOp('mcp.connect', [{server:'ping'}], 'demo');
      let resolution = {isListed:false,refused:'disabled',message:'turned off'};
      let connection = {isConnected:true};
      let connects=0, settles=0, removed=[], gate;
      const host = {
        tools:()=>[], mcpServers:()=>[], addMcpServer(){throw Error('must not use registrar as connect')},
        removeMcpServer(name){removed.push(name)},
        async resolveMcpServer(){return resolution},
        async settledMcpServer(){settles++; return connection},
        async connectMcpServer(){connects++; return gate ? await gate : connection},
      };
      const mod={name:'demo',root:'/tmp',patterns:[],hooks:[],status:'live'};
      try {
        await assert.rejects(call,/no session is bound/);
        setPluginToolSessionHost(host);
        assert.deepEqual(await call(),{isConnected:false,reason:'disabled',message:'turned off'});
        resolution={isListed:true,isTwin:true,name:'manual'};
        assert.deepEqual(await call(),{isConnected:true,server:'manual'});
        assert.equal(settles,1); assert.equal(connects,0);
        setLoadedFunctionHooksModules([]);
        assert.deepEqual(removed,[]);
        setLoadedFunctionHooksModules([mod]);
        resolution={isListed:true,isTwin:false,name:'plugin:demo:ping',config:{type:'stdio',command:'true',scope:'dynamic'}};
        let finish; gate=new Promise(resolve=>{finish=resolve});
        const first=call(), second=call();
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(connects,1);
        finish({isConnected:true});
        assert.deepEqual(await first,{isConnected:true,server:'plugin:demo:ping'});
        assert.deepEqual(await second,{isConnected:true,server:'plugin:demo:ping'});
        setLoadedFunctionHooksModules([]);
        assert.deepEqual(removed,['plugin:demo:ping']);
        removed=[];
        setLoadedFunctionHooksModules([mod]);
        gate=new Promise(resolve=>{finish=resolve});
        const unloading=call();
        await new Promise(resolve=>setTimeout(resolve,0));
        setLoadedFunctionHooksModules([]);
        finish({isConnected:true});
        const result=await unloading;
        assert.equal(result.isConnected,false); assert.equal(result.reason,'failed');
        assert.match(result.message,/plugin unloaded while it connected/);
        assert.ok(removed.includes('plugin:demo:ping'));
        gate=undefined;
        connection={isConnected:false,refused:'auth',message:'sign in'};
        resolution={isListed:true,isTwin:true,name:'manual'};
        assert.deepEqual(await call(),{isConnected:false,reason:'auth',message:'sign in'});
      } finally { setLoadedFunctionHooksModules([]); setPluginToolSessionHost(undefined); }
    `)
  })

  test('resolver uses manifest, strict/bare/safe mode and per-server disable checks', () => {
    runIsolated(`
      import { strict as assert } from 'node:assert';
      import { mkdtempSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      const root=mkdtempSync(join(tmpdir(),'plugin-connect-'));
      process.env.CLAUDE_CONFIG_DIR=root;
      const { enableConfigs }=await import('./src/utils/config.ts');
      enableConfigs();
      const { resolveLoadedPluginMcpServer }=await import('./src/utils/plugins/pluginMcpConnect.ts');
      const { setStrictMcpConfig }=await import('./src/bootstrap/state.ts');
      const { setMcpServerEnabled }=await import('./src/services/mcp/config.ts');
      const plugin={name:'demo',source:'demo@inline',repository:'demo@inline',path:root,enabled:true,manifest:{name:'demo'},mcpServers:{ping:{command:'true'}}};
      const resolve=key=>resolveLoadedPluginMcpServer(plugin,{key});
      try {
        assert.equal((await resolve('missing')).refused,'unlisted');
        process.env.CLAUDE_CODE_SAFE_MODE='1';
        assert.match((await resolve('ping')).message,/safe mode/);
        delete process.env.CLAUDE_CODE_SAFE_MODE;
        process.env.CLAUDE_CODE_SIMPLE='1';
        assert.match((await resolve('ping')).message,/--bare/);
        delete process.env.CLAUDE_CODE_SIMPLE;
        setStrictMcpConfig(true);
        assert.match((await resolve('ping')).message,/--strict-mcp-config/);
        setStrictMcpConfig(false);
        setMcpServerEnabled('plugin:demo:ping',false);
        assert.equal((await resolve('ping')).refused,'disabled');
        setMcpServerEnabled('plugin:demo:ping',true);
        const { loadAllPluginsCacheOnly }=await import('./src/utils/plugins/pluginLoader.ts');
        loadAllPluginsCacheOnly.cache.set(undefined,Promise.resolve({enabled:[plugin],disabled:[],errors:[]}));
        const { resolvePluginMcpServer }=await import('./src/utils/plugins/pluginMcpConnect.ts');
        const standalone=await resolvePluginMcpServer({pluginId:plugin.source,key:'ping'});
        assert.equal(standalone.isListed,true); assert.equal(standalone.isTwin,false);
        const duplicate=await resolvePluginMcpServer({pluginId:plugin.source,key:'ping',dynamicServers:{manual:{command:'true',scope:'dynamic'}}});
        assert.deepEqual(duplicate,{isListed:true,isTwin:true,name:'manual'});
        const self=await resolvePluginMcpServer({pluginId:plugin.source,key:'ping',dynamicServers:{'plugin:demo:ping':{command:'true',scope:'dynamic'}}});
        assert.equal(self.isTwin,false);
      } finally { setStrictMcpConfig(false); rmSync(root,{recursive:true,force:true}); }
    `)
  })

  test('connection host reuses rows, retries owned failures and preserves timed out pending', () => {
    runIsolated(`
      import { strict as assert } from 'node:assert';
      import { connectPluginMcpServer } from './src/utils/plugins/pluginMcpConnect.ts';
      process.env.MCP_TIMEOUT='5';
      let rows=[{name:'x',type:'connected'}], listeners=new Set(), adds=0, drops=0, forgets=0, owned=false;
      const notify=()=>{for(const fn of listeners) fn()};
      const config={type:'stdio',command:'true',scope:'dynamic'};
      const host={rows:()=>rows,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},holds:()=>owned,
        drop(){drops++; rows=[]; notify()},forget(){forgets++},
        add(){adds++; rows=[{name:'x',type:'pending'}]; queueMicrotask(()=>{rows=[{name:'x',type:'connected'}];notify()})}};
      assert.deepEqual(await connectPluginMcpServer(host,'x',config),{isConnected:true});
      assert.equal(adds,0);
      rows=[{name:'x',type:'failed',error:'bad',config}];
      assert.equal((await connectPluginMcpServer(host,'x',config)).isConnected,false);
      assert.equal(drops,0); assert.equal(adds,0);
      owned=true;
      assert.deepEqual(await connectPluginMcpServer(host,'x',config),{isConnected:true});
      assert.equal(drops,1); assert.equal(forgets,1); assert.equal(adds,1);
      rows=[{name:'x',type:'pending'}];
      assert.match((await connectPluginMcpServer(host,'x',config)).message,/still connecting after 20ms; it stays in the session/);
      assert.equal(adds,1); assert.equal(drops,1);
      rows=[];
      host.add=()=>{adds++};
      assert.match((await connectPluginMcpServer(host,'x',config)).message,/still connecting/);
      assert.equal(listeners.size,0);
    `)
  })

  test('settled rows use real subscriptions and the gold four-attempt timeout', () => {
    runIsolated(`
      import { strict as assert } from 'node:assert';
      import { awaitPluginMcpServer, pluginMcpConnectionFromRow } from './src/utils/plugins/pluginMcpConnect.ts';
      for(const type of ['connected','cached']) assert.deepEqual(pluginMcpConnectionFromRow({name:'x',type}),{isConnected:true});
      assert.equal(pluginMcpConnectionFromRow({name:'x',type:'pending'}),undefined);
      assert.equal(pluginMcpConnectionFromRow({name:'x',type:'needs-auth'}).refused,'auth');
      assert.match(pluginMcpConnectionFromRow({name:'x',type:'failed'}).message,/no reason given/);
      let rows=[{name:'x',type:'pending'}], listener, unsubscriptions=0;
      const host={rows:()=>rows,subscribe(fn){listener=fn;return()=>{unsubscriptions++}}};
      const pending=awaitPluginMcpServer(host,'x');
      rows=[{name:'x',type:'connected'}]; listener();
      assert.deepEqual(await pending,{isConnected:true});
      assert.equal(unsubscriptions,1);
      rows=[];
      assert.match((await awaitPluginMcpServer(host,'x')).message,/not in this session/);
      process.env.MCP_TIMEOUT='5';
      rows=[{name:'x',type:'pending'}];
      assert.match((await awaitPluginMcpServer(host,'x')).message,/within 20ms/);
      assert.equal(unsubscriptions,3);
      process.env.MCP_TIMEOUT='1'; rows=[{name:'x',type:'pending'}];
      assert.match((await awaitPluginMcpServer(host,'x')).message,/within 4ms/);
    `)
  })
})
