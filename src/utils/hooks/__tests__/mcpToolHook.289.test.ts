import { expect, test } from 'bun:test'

async function isolated(body: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
import {mock,expect} from 'bun:test';
import {logMock} from './tests/mocks/log.ts';
import {debugMock} from './tests/mocks/debug.ts';
mock.module('src/utils/log.ts',logMock);
mock.module('src/utils/debug.ts',debugMock);
mock.module('bun:bundle',()=>({feature:()=>false}));
const keepAlive=setInterval(()=>{},1000);
try { ${body} } finally {clearInterval(keepAlive)}
`,
    ],
    {
      cwd: new URL('../../../..', import.meta.url).pathname,
      env: { ...process.env, DISABLE_TELEMETRY: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: '', stderr: '' })
}

const setup = `
const {execMcpToolHook,interpolateMcpHookInput}=await import('./src/utils/hooks/execMcpToolHook.ts');
const {getBootstrapSession}=await import('./src/utils/sessionRoot.ts');
const session=getBootstrapSession();
let clients, calls=[];
session.mcpSessionWiring.registerClientsAccessor(()=>clients);
session.host.mcpProcessWiring.registerEnsureConnectedClient(async client=>client);
const hook={type:'mcp_tool',server:'test',tool:'inspect',input:{path:'\${tool_input.path}'}};
let response={content:[{type:'text',text:'{"decision":"block","reason":"missing"}'},{type:'image',data:'unused',mimeType:'image/png'}]};
const connected={type:'connected',name:'test',config:{type:'sdk',scope:'dynamic'},capabilities:{},client:{callTool:async(...args)=>{calls.push(args);return response}}};
`

test('persistent MCP and prompt schemas retain official options and interpolation', async () => {
  await isolated(
    setup +
      `
const {HookCommandSchema}=await import('./src/schemas/hooks.ts');
expect(HookCommandSchema().parse(hook)).toEqual(hook);
expect(HookCommandSchema().parse({type:'prompt',prompt:'check',continueOnBlock:true}).continueOnBlock).toBe(true);
expect(HookCommandSchema().safeParse({...hook,timeout:0}).success).toBe(false);
const input={text:'a=\${tool_input.path};b=\${flag};c=\${missing};d=\${object}',nested:[{value:'\${nil}'},false,4]};
expect(interpolateMcpHookInput(input,{tool_input:{path:'a b'},flag:false,object:{x:1},nil:null})).toEqual({text:'a=a b;b=false;c=;d={"x":1}',nested:[{value:''},false,4]});
`,
  )
})

test('MCP hooks use live clients, SDK call options and raw text/error output', async () => {
  await isolated(
    setup +
      `
clients=[connected];
const result=await execMcpToolHook(hook,'PreToolUse','{"tool_input":{"path":"file.ts"}}',[] ,undefined,1000);
expect(result).toEqual({ok:true,body:'{"decision":"block","reason":"missing"}\\n[image]'});
expect(calls[0][0]).toEqual({name:'inspect',arguments:{path:'file.ts'}});
expect(calls[0][1].signal).toBeInstanceOf(AbortSignal);
expect(calls[0][1].timeout).toBeLessThanOrEqual(1000);
response={isError:true,content:[{type:'text',text:'failed'}]};
expect(await execMcpToolHook(hook,'SessionStart','{}')).toEqual({ok:false,body:'failed',error:'failed'});
response={isError:true,content:[]};expect((await execMcpToolHook(hook,'PreToolUse','{}')).error).toBe('MCP tool returned an error');
clients=undefined;expect((await execMcpToolHook(hook,'SessionEnd','{}')).error).toContain('no MCP client context');
`,
  )
})

test('pending MCP waits only for blocking events and respects cancellation and deadlines', async () => {
  await isolated(
    setup +
      `
const pending={...connected,type:'pending'};clients=[pending];
expect((await execMcpToolHook(hook,'SessionStart','{}')).error).toContain('not connected');expect(calls.length).toBe(0);
const timer=setTimeout(()=>{clients=[connected]},15);
expect((await execMcpToolHook(hook,'PreToolUse','{}',clients,undefined,1000)).ok).toBe(true);clearTimeout(timer);
const controller=new AbortController();controller.abort();expect((await execMcpToolHook(hook,'PreToolUse','{}',clients,controller.signal)).aborted).toBe(true);
session.host.mcpProcessWiring.registerEnsureConnectedClient(()=>new Promise(()=>{}));
const start=Date.now();expect((await execMcpToolHook(hook,'PreToolUse','{}',clients,undefined,20)).aborted).toBe(true);expect(Date.now()-start).toBeLessThan(1000);
`,
  )
})

test('account memory hook calls withhold writes and attach the worker principal to reads', async () => {
  await isolated(
    setup +
      `
connected.name='memory';clients=[connected];
const memoryHook={...hook,server:'memory',tool:'memory_write'};
expect((await execMcpToolHook(memoryHook,'PreToolUse','{}')).withheld).toBe(true);expect(calls.length).toBe(0);
expect((await execMcpToolHook({...memoryHook,tool:'memory_read'},'PreToolUse','{}')).ok).toBe(true);
expect(calls[0][0]._meta).toEqual({'anthropic/memory.caller':'worker'});
connected.capabilities={experimental:{'anthropic/memory':{subagent_memory:'none'}}};
expect((await execMcpToolHook({...memoryHook,tool:'memory_read'},'PreToolUse','{}')).withheld).toBe(true);
`,
  )
})

test('HTTP hooks honor caller timeout and explicit hook overrides', async () => {
  await isolated(`
let requests=[];
mock.module('axios',()=>({default:{post:async(url,body,options)=>{requests.push(options);return await new Promise((resolve,reject)=>{if(options.signal.aborted)reject(new Error('aborted'));else options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})})}}}));
const {execHttpHook}=await import('./src/utils/hooks/execHttpHook.ts');
await import('./src/utils/sandbox/sandbox-adapter.ts');
const start=Date.now();
expect((await execHttpHook({type:'http',url:'https://example.com/hook'},'SessionEnd','{}',undefined,20)).aborted).toBe(true);
expect(Date.now()-start).toBeLessThan(1000);
const overrideStart=Date.now();
expect((await execHttpHook({type:'http',url:'https://example.com/hook',timeout:0.04},'SessionEnd','{}',undefined,1)).aborted).toBe(true);
expect(Date.now()-overrideStart).toBeGreaterThanOrEqual(25);expect(requests.length).toBe(2);
`)
})
