import { expect, test } from 'bun:test'
import { getHookStdioError, selectCompleteHookOutput } from '../hookStdIO.js'

const setup = `
import {mock, expect} from 'bun:test';
import {logMock} from './tests/mocks/log.ts';
import {debugMock} from './tests/mocks/debug.ts';
mock.module('src/utils/log.ts', logMock);
mock.module('src/utils/debug.ts', debugMock);
mock.module('bun:bundle',()=>({feature:()=>false}));
const state=await import('./src/bootstrap/state.ts');
state.setIsInteractive(false);
const hooks=await import('./src/utils/hooks.ts');
const register=(event,hook)=>{state.resetSdkInitState();state.registerHookCallbacks({[event]:[{hooks:[hook]}]})};
`

async function isolated(body: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      setup +
        'const keepAlive=setInterval(()=>{},1000);try {' +
        body +
        '} finally {clearInterval(keepAlive)}',
    ],
    {
      cwd: new URL('../../../..', import.meta.url).pathname,
      env: {
        ...process.env,
        DISABLE_TELEMETRY: '1',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: '', stderr: '' })
}

test('partial captures reject grants and rewrites but preserve safe denial and exit 2', () => {
  const capture = { status: 0, stdout: '{', stderr: '', stdioIncomplete: true }
  const grant = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'allow' as const,
    },
  }
  const deny = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
    },
  }
  expect(
    getHookStdioError(capture, 'PreToolUse', grant, () => undefined),
  ).toContain('grants, rewrites or injects')
  expect(
    getHookStdioError(capture, 'PreToolUse', deny, () => undefined),
  ).toBeUndefined()
  expect(
    getHookStdioError(capture, 'PreToolUse', undefined, () => undefined),
  ).toContain('never completed')
  expect(
    getHookStdioError(
      { ...capture, status: 2 },
      'PreToolUse',
      grant,
      () => undefined,
    ),
  ).toBeUndefined()
  expect(
    selectCompleteHookOutput({ ...capture, status: 2 }, 'PreToolUse', grant),
  ).toBeUndefined()
  expect(
    selectCompleteHookOutput({ ...capture, status: 2 }, 'PreToolUse', deny),
  ).toEqual(deny)
  expect(
    getHookStdioError(
      { ...capture, stdout: '', stderr: '{', status: 1 },
      'Elicitation',
      undefined,
      () => undefined,
    ),
  ).toContain('never completed')
})

test('outside callback cancellation is silent to compact consumers and timeout remains a failure', async () => {
  await isolated(`
const {ControlStreamClosedError,AbortError}=await import('./src/utils/errors.ts');
register('PreCompact',{type:'callback',callback:async()=>{throw new ControlStreamClosedError()}});
let result=await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null});
expect(result.userDisplayMessage).toBeUndefined();
register('PreCompact',{type:'callback',timeout:0.01,callback:async(_input,_id,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new AbortError('timeout')),{once:true}))});
result=await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null});
expect(result.userDisplayMessage).toBe('PreCompact [callback] failed');
const controller=new AbortController();
register('PreCompact',{type:'callback',callback:async(_input,_id,signal)=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new AbortError('cancelled')),{once:true});controller.abort()})});
result=await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null},controller.signal);
expect(result.userDisplayMessage).toBeUndefined();
`)
}, 30000)

test('HTTP and command block reasons never become compact instructions', async () => {
  await isolated(`
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({decision:'block',reason:'wait for review',systemMessage:'notice'})});
try {
register('PreCompact',{type:'http',url:server.url.href});
let result=await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null});
expect(result.newCustomInstructions).toBeUndefined();expect(result,JSON.stringify(result)).toHaveProperty('blockedBy');expect(result.blockedBy).toContain('wait for review');expect(result.blockedBy).not.toContain('decision');
register('PreCompact',{type:'command',command:process.execPath,args:['-e','console.log(JSON.stringify({decision:"block",reason:"command review"}))']});
result=await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null});
expect(result.newCustomInstructions).toBeUndefined();expect(result.blockedBy).toContain('command review');
} finally {server.stop(true)}
`)
}, 30000)

test('environment hook collectors retain HTTP/MCP metadata and normal command exits', async () => {
  await isolated(`
const {getBootstrapSession}=await import('./src/utils/sessionRoot.ts');
const session=getBootstrapSession();
const payload={decision:'block',reason:'guarded',systemMessage:'notice',hookSpecificOutput:{hookEventName:'FileChanged',watchPaths:['/tmp/watched']}};
session.mcpSessionWiring.registerClientsAccessor(()=>[{type:'connected',name:'test',config:{type:'sdk',scope:'dynamic'},capabilities:{},client:{callTool:async()=>({content:[{type:'text',text:JSON.stringify(payload)}]})}}]);
session.host.mcpProcessWiring.registerEnsureConnectedClient(async client=>client);
register('FileChanged',{type:'mcp_tool',server:'test',tool:'inspect'});
let result=await hooks.executeFileChangedHooks('/tmp/input','change');
expect(result.watchPaths).toEqual(['/tmp/watched']);expect(result.systemMessages).toEqual(['notice']);expect(result.results[0].output).toBe('guarded');
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json(payload)});
try {
register('FileChanged',{type:'http',url:server.url.href});
result=await hooks.executeFileChangedHooks('/tmp/input','change');
expect(result.watchPaths).toEqual([]);expect(result.systemMessages).toEqual(['notice']);expect(result.results[0].output).toBe('guarded');
} finally {server.stop(true)}
register('FileChanged',{type:'command',command:process.execPath,args:['-e','process.exit(7)'],statusMessage:'spinner label'});
result=await hooks.executeFileChangedHooks('/tmp/input','change');expect(result.results[0].exitCode).toBe(7);expect(result.results[0].command).toBe(process.execPath+' -e process.exit(7)');
register('FileChanged',{type:'command',command:process.execPath,args:['-e','process.kill(process.pid,"SIGKILL")']});
result=await hooks.executeFileChangedHooks('/tmp/input','change');expect(result.results[0]).not.toHaveProperty('exitCode');
`)
}, 30000)

test('real classic dispatch sandwiches plugin and core between managed and unwind', async () => {
  await isolated(`
const {mkdtemp,readFile,appendFile,rm}=await import('node:fs/promises');
const {tmpdir}=await import('node:os');const {join}=await import('node:path');
const {setLoadedFunctionHooksModules}=await import('./src/utils/plugins/functionHooksModules.ts');
const {setCachedSettingsForSource,setSessionSettingsCache}=await import('./src/utils/settings/settingsCache.ts');
const {resetHooksConfigSnapshot}=await import('./src/utils/hooks/hooksConfigSnapshot.ts');
const directory=await mkdtemp(join(tmpdir(),'hook-sandwich-'));const file=join(directory,'order');
resetHooksConfigSnapshot();setSessionSettingsCache({settings:{},errors:[]});
setCachedSettingsForSource('policySettings',{hooks:{PreCompact:[{hooks:[{type:'command',command:process.execPath,args:['-e','require("node:fs").appendFileSync('+JSON.stringify(file)+',"managed"+String.fromCharCode(10))']}]}]}});
register('PreCompact',{type:'callback',callback:async()=>{await appendFile(file,'core\\n');return {}}});
setLoadedFunctionHooksModules([{name:'sandwich-test',patterns:['classic.PreCompact'],hooks:[{pattern:'classic.PreCompact',hook:async(_api,event,next)=>{await appendFile(file,'plugin-before\\n');const result=await next();await appendFile(file,'plugin-after\\n');return result}}]}]);
try {
await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null});
expect((await readFile(file,'utf8')).trim().split('\\n')).toEqual(['managed','plugin-before','core','plugin-after']);
} finally {setLoadedFunctionHooksModules([]);await rm(directory,{recursive:true,force:true})}
`)
}, 30000)

test('worktree lifecycle uses the last path line and preserves failure versus removal', async () => {
  await isolated(`
const {mkdtemp,rm}=await import('node:fs/promises');
const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');
register('WorktreeCreate',{type:'callback',callback:async()=>({hookSpecificOutput:{hookEventName:'WorktreeCreate',worktreePath:'log line\\n\\x1b[32mrelative-worktree\\x1b[0m'}})});
expect((await hooks.executeWorktreeCreateHook('demo')).worktreePath).toBe(resolve(state.getCwd?.()??process.cwd(),'relative-worktree'));
state.resetSdkInitState();expect(await hooks.executeWorktreeRemoveHook('/tmp/not-configured')).toEqual({kind:'not_configured'});
const path=await mkdtemp(join(tmpdir(),'hook-remove-'));
try {
register('WorktreeRemove',{type:'command',command:process.execPath,args:['-e','console.error("failure detail");process.exit(7)']});
expect(await hooks.executeWorktreeRemoveHook(path)).toEqual({kind:'failed',summary:'exited 7 (“failure detail”)'});
register('WorktreeRemove',{type:'callback',callback:async()=>{await rm(path,{recursive:true,force:true});throw Error('failed after removing')}});
expect(await hooks.executeWorktreeRemoveHook(path)).toEqual({kind:'removed'});
} finally {await rm(path,{recursive:true,force:true})}
`)
}, 30000)

test('compact context gates delegated observers while preserving ordinary subagents', async () => {
  await isolated(`
const {runWithAgentContext}=await import('./src/utils/agentContext.ts');
register('PreCompact',{type:'callback',callback:async()=>({systemMessage:'injected'})});
const data={trigger:'manual',customInstructions:null};
expect(await hooks.executePreCompactHooks(data,undefined,undefined,{options:{settingsHooksOff:true}})).toEqual({});
let result=await runWithAgentContext({agentType:'subagent',delegatedObservation:true},()=>hooks.executePreCompactHooks(data));
expect(result).toEqual({});
result=await runWithAgentContext({agentType:'subagent',delegatedObservation:false},()=>hooks.executePreCompactHooks(data));
expect(result.newCustomInstructions).toBe('injected');
register('PostCompact',{type:'callback',callback:async()=>{throw Error('must not run')}});
expect(await runWithAgentContext({agentType:'subagent',delegatedObservation:true},()=>hooks.executePostCompactHooks({trigger:'auto',compactSummary:'summary'}))).toEqual({});
`)
}, 30000)

test('compact stops on a PreCompact block before requesting a summary', async () => {
  await isolated(`
const {compactConversation,CompactionBlockedByHookError}=await import('./src/services/compact/compact.ts');
const {createUserMessage}=await import('./src/utils/messages.ts');
register('PreCompact',{type:'callback',callback:async()=>({decision:'block',systemMessage:'review first'})});
const notices=[];
const context={options:{},abortController:new AbortController(),getAppState:()=>({toolPermissionContext:{mode:'default'}}),addNotification:notice=>notices.push(notice)};
let error;try {await compactConversation([createUserMessage({content:'hello'})],context,{},false)} catch(caught) {error=caught}
expect(error).toBeInstanceOf(CompactionBlockedByHookError);expect(error.message).toContain('review first');
expect(notices.map(notice=>notice.key)).toEqual(['compaction-blocked-by-hook']);
notices.length=0;
try {await compactConversation([createUserMessage({content:'hello'})],context,{},false,undefined,true)} catch(caught) {expect(caught).toBeInstanceOf(CompactionBlockedByHookError)}
expect(notices).toEqual([]);
`)
}, 30000)

test('outside hook progress tracks immutable settlements and always disposes', async () => {
  await isolated(`
const {getHookExecutionStore}=await import('./src/utils/hooks/hookExecutionState.ts');
const store=getHookExecutionStore();const snapshots=[];const unsubscribe=store.subscribe(()=>snapshots.push(store.getState()));
register('FileChanged',{type:'command',command:process.execPath,args:['-e','process.exit(0)'],statusMessage:'checking'});
await hooks.executeFileChangedHooks('/tmp/input','change');unsubscribe();
expect(snapshots[0][0].hooks[0].statusMessage).toBe('checking');
expect(snapshots.some(rows=>rows[0]?.settled.has(0))).toBe(true);expect(store.getState()).toEqual([]);
`)
}, 30000)

test('a command with inherited open pipes returns after quiet and rejects partial JSON', async () => {
  await isolated(`
register('PreCompact',{type:'command',command:process.execPath,args:['-e',
'const {spawn}=require("child_process");spawn(process.execPath,["-e","setTimeout(()=>{},2000)"],{stdio:["ignore",1,2],detached:true}).unref();process.stdout.write("{");']});
const start=Date.now();const result=await hooks.executePreCompactHooks({trigger:'manual',customInstructions:null});
expect(result.blockedBy).toContain('never completed');expect(Date.now()-start).toBeLessThan(1800);
`)
}, 30000)
