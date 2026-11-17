import { expect, test } from 'bun:test'

// Fresh process keeps effects mocked without polluting the real hook modules.
test('PermissionRequest ignores empty {} updatedInput (preserving original) and denies non-equal accountMemoryServer rewrites', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
import {mock,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {logMock} from './tests/mocks/log.ts';
import {debugMock} from './tests/mocks/debug.ts';
mock.module('src/utils/log.ts',logMock);
mock.module('src/utils/debug.ts',debugMock);
mock.module('bun:bundle',()=>({feature:()=>false}));
const {didAccountMemoryHookRewriteInput,accountMemoryHookRewriteDenied}=await import('./src/utils/hooks/toolCallManagedPass.ts');
const source=readFileSync('./src/hooks/toolPermission/PermissionContext.ts','utf8');
const method=source.slice(source.indexOf('    async runHooks('),source.indexOf('    buildAllow(',source.indexOf('    async runHooks(')));
let rewritten={},rechecks=0,allows=0,lastAllowedInput=undefined;
const tool={name:'memory_write',mcpInfo:{accountMemory:true,accountMemoryServer:true}};
const original={path:'personal/note',content:'original'};
const globals={tool,input:original,toolUseContext:{abortController:new AbortController()},assistantMessage:{},toolUseID:'memory-call',didAccountMemoryHookRewriteInput,accountMemoryHookRewriteDenied,
 executePermissionRequestHooks:async function*(){yield {permissionRequestResult:{behavior:'allow',updatedInput:rewritten}}},
 hasPermissionsToUseTool:async()=>{rechecks++;return {behavior:'allow'}}};
const ctx=runInNewContext(new Bun.Transpiler({loader:'ts'}).transformSync('const ctx={'+method+'};')+'\\nctx',globals);
ctx.logDecision=()=>{};ctx.handleHookAllow=async input=>{allows++;lastAllowedInput=input;return {behavior:'allow',updatedInput:input}};
rewritten={content:'replacement'};
const denied=await ctx.runHooks('default',[]);
expect(denied.behavior).toBe('deny');expect(denied.message).toContain('may allow or deny such a call but not change it');
expect(rechecks).toBe(0);expect(allows).toBe(0);
rewritten={};
const emptyRes=await ctx.runHooks('default',[]);
expect(emptyRes.behavior).toBe('allow');expect(lastAllowedInput).toEqual(original);
expect(rechecks).toBe(0);expect(allows).toBe(1);
rewritten={...original};expect((await ctx.runHooks('default',[])).behavior).toBe('allow');
expect(rechecks).toBe(1);expect(allows).toBe(2);
tool.mcpInfo.accountMemoryServer=false;rewritten={content:'sdk-local-allowed'};expect((await ctx.runHooks('default',[])).behavior).toBe('allow');
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
}, 30000)
