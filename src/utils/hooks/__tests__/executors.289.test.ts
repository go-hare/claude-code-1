import { expect, test } from 'bun:test'

// Every scenario imports the real executor in a fresh Bun process. API/query and
// progress events are effect boundaries; schemas, messages and helpers stay real.
const setup = `
import {mock, expect} from 'bun:test';
import {logMock} from './tests/mocks/log.ts';
import {debugMock} from './tests/mocks/debug.ts';
mock.module('src/utils/log.ts', logMock);
mock.module('src/utils/debug.ts', debugMock);
mock.module('bun:bundle',()=>({feature:()=>false}));
`
async function isolated(body: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      setup +
        'const keepAlive=setInterval(()=>{},1000); try {\n' +
        body +
        '\n} finally { clearInterval(keepAlive) }',
    ],
    {
      cwd: new URL('../../../..', import.meta.url).pathname,
      env: { ...process.env, DISABLE_TELEMETRY: '1' },
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

const promptSetup = `
let answer = {ok:false,reason:'unavailable',impossible:true};
let calls=[], evaluator;
const unusedApi=()=>{throw Error('unexpected API call')};
mock.module('src/services/api/claude.ts',()=>({queryHaiku:unusedApi,queryWithModel:unusedApi,queryModelWithStreaming:unusedApi,executeNonStreamingRequest:unusedApi,verifyApiKey:unusedApi,getAPIMetadata:()=>({}),getExtraBodyParams:()=>({}),getCacheControl:()=>({}),getPromptCachingEnabled:()=>false,should1hCacheTTL:()=>false,configureTaskBudgetParams:()=>{},userMessageToMessageParam:unusedApi,assistantMessageToMessageParam:unusedApi,appendSystemReminderToLastUserMessage:unusedApi,cleanupStream:()=>{},updateUsage:()=>{},accumulateUsage:()=>{},addCacheBreakpoints:unusedApi,buildSystemPromptBlocks:unusedApi,MAX_NON_STREAMING_TOKENS:64000,adjustParamsForNonStreaming:unusedApi,getMaxOutputTokensForModel:()=>4096,queryModelWithoutStreaming:async args=>{calls.push(args);return evaluator ? evaluator(args) : {type:'assistant',message:{content:[{type:'text',text:JSON.stringify(answer)}]}}}}));
const {execPromptHook}=await import('./src/utils/hooks/execPromptHook.ts');
const controller=new AbortController();
const ctx={options:{tools:[{name:'Bash'}]},abortController:controller,getAppState:()=>({toolPermissionContext:{}}),setResponseLength:()=>{}};
const hook={type:'prompt',prompt:'condition',model:'claude-haiku-4-5'};
const run=(event,extra={},history=[],signal=controller.signal)=>execPromptHook({...hook,...extra},event,event,'{}',signal,ctx,history);
`

test('prompt evaluator preserves impossible, stop continuation and wire schema', async () => {
  await isolated(
    promptSetup +
      `
for(const event of ['Stop','SubagentStop']) {
 const result=await run(event);expect(result.outcome).toBe('success');expect(result.impossible).toBe(true);expect(result.stopReason).toBe('unavailable');expect(result.blockingError).toBeUndefined();
}
expect(calls[0].tools).toEqual([]);expect(calls[0].options.outputFormat.schema.required).toEqual(['ok','reason']);
expect(JSON.stringify(calls[0].systemPrompt)).toContain('stop-condition hook');
expect(JSON.stringify(calls[0].messages)).toContain('transcript evidence only');
expect((await run('PostToolUse')).preventContinuation).toBe(true);
expect((await run('PostToolUse',{continueOnBlock:true})).preventContinuation).toBe(false);
answer={ok:false,reason:'missing'};expect((await run('Stop')).preventContinuation).toBe(false);
answer={ok:true,reason:'done'};expect((await run('Stop')).stopReason).toBe('done');
`,
  )
}, 30000)

test('prompt history trimming retains whole rounds and retries prompt-too-long once', async () => {
  await isolated(
    promptSetup +
      `
const assistant=(id,text,usage=300000)=>({type:'assistant',uuid:id,message:{id,role:'assistant',model:'claude-sonnet-4-5',content:[{type:'text',text}],usage:{input_tokens:usage,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}});
const history=[{type:'user',message:{content:'old prompt'}},assistant('old','x'.repeat(240000)),{type:'user',message:{content:[{type:'tool_result',tool_use_id:'read',content:'result'}]}},assistant('recent','y'.repeat(200000)),{type:'user',message:{content:'recent user'}}];
let count=0;
evaluator=async()=> ++count===1 ? {type:'assistant',isApiErrorMessage:true,message:{content:[{type:'text',text:'Prompt is too long'}]}} : {type:'assistant',message:{content:[{type:'text',text:'{"ok":true,"reason":"done"}'}]}};
expect((await run('Stop',{},history)).outcome).toBe('success');expect(count).toBe(2);
expect(calls[0].messages.some(m=>m.message?.id==='old')).toBe(false);
expect(calls[0].messages.some(m=>m.message?.id==='recent')).toBe(true);
expect(calls[0].messages[0].message.content).toContain('earlier messages omitted');
expect(calls[1].messages.some(m=>m.message?.id==='recent')).toBe(true);
// Repeated API errors remain non-blocking evaluator errors, never success.
evaluator=async()=>({type:'assistant',isApiErrorMessage:true,message:{content:[{type:'text',text:'Prompt is too long'}]}});
const failed=await run('Stop',{},history);expect(failed.outcome).toBe('non_blocking_error');expect(failed.message.attachment.stderr).toContain('Hook evaluator API error');
`,
  )
}, 30000)

test('prompt timeout differs from parent cancellation and removes abort listeners', async () => {
  await isolated(
    promptSetup +
      `
evaluator=args=>new Promise((resolve,reject)=>{args.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})});
const originalAdd=controller.signal.addEventListener.bind(controller.signal), originalRemove=controller.signal.removeEventListener.bind(controller.signal);
let added=0,removed=0;
controller.signal.addEventListener=(...args)=>{added++;return originalAdd(...args)};
controller.signal.removeEventListener=(...args)=>{removed++;return originalRemove(...args)};
const timed=await run('Stop',{timeout:0.01});expect(timed.outcome).toBe('cancelled');expect(timed.timedOut).toBe(true);expect(removed).toBe(added);
const pending=run('Stop',{timeout:10});controller.abort();const cancelled=await pending;expect(cancelled.timedOut).toBe(false);expect(removed).toBe(added);
`,
  )
}, 30000)

test('agent evaluator uses generic event prompt and cleans session hooks on success, throw and abort', async () => {
  await isolated(`
let behavior='success',calls=[];
mock.module('src/query.ts',()=>({query:async function*(args){calls.push(args);expect(args.toolUseContext.getAppState().sessionHooks.has(args.toolUseContext.agentId)).toBe(true);if(behavior==='throw')throw new Error('query failed');if(behavior==='empty')return;if(behavior==='max'){for(let i=0;i<50;i++)yield {type:'assistant',message:{id:String(i),content:[]}};return}if(behavior==='abort'){await new Promise((resolve,reject)=>args.toolUseContext.abortController.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));return}yield {type:'attachment',attachment:{type:'structured_output',data:{ok:behavior!=='block',reason:'condition',impossible:true}}};}}));
const {execAgentHook}=await import('./src/utils/hooks/execAgentHook.ts');
let state={toolPermissionContext:{alwaysAllowRules:{}},sessionHooks:new Map()};
const controller=new AbortController();
const ctx={options:{tools:[]},abortController:controller,getAppState:()=>state,setAppState:fn=>{state=fn(state)},setResponseLength:()=>{}};
const hook={type:'agent',prompt:'evaluate',model:'claude-haiku-4-5'};
const run=(event,extra={})=>execAgentHook({...hook,...extra},event,event,'{}',controller.signal,ctx,'tool','reviewer');
let result=await run('PostToolUse');expect(result.outcome).toBe('success');expect(JSON.stringify(calls[0].systemPrompt)).toContain('evaluating a PostToolUse hook');expect(state.sessionHooks.size).toBe(0);
behavior='block';result=await run('Stop');expect(result.outcome).toBe('blocking');expect(result.impossible).toBeUndefined();expect(state.sessionHooks.size).toBe(0);
behavior='throw';result=await run('Stop');expect(result.outcome).toBe('non_blocking_error');expect(state.sessionHooks.size).toBe(0);
for(behavior of ['empty','max']){result=await run('Stop');expect(result.outcome).toBe('cancelled');expect(state.sessionHooks.size).toBe(0);}
behavior='abort';result=await run('Stop',{timeout:0.01});expect(result.outcome).toBe('cancelled');expect(state.sessionHooks.size).toBe(0);
const parentPending=run('Stop',{timeout:10});controller.abort();result=await parentPending;expect(result.outcome).toBe('cancelled');expect(state.sessionHooks.size).toBe(0);
`)
}, 30000)

test('async empty stdout awaits result, emits final response, cleans and invalidates SessionStart', async () => {
  await isolated(`
let events=[],invalidations=0,cleanups=0,stops=0;
mock.module('src/utils/hooks/hookEvents.ts',()=>({startHookProgressInterval:()=>()=>{stops++},emitHookResponse:event=>events.push(event)}));
mock.module('src/utils/sessionEnvironment.ts',()=>({invalidateSessionEnvCache:()=>{invalidations++}}));
const api=await import('./src/utils/hooks/AsyncHookRegistry.ts');
function register(id,stdout,stderr,code,event='SessionStart') {
 let awaited=false;
 const shell={status:'completed',result:{then(resolve){awaited=true;return Promise.resolve({code}).then(resolve)}},taskOutput:{getStdout:async()=>stdout,getStderr:()=>stderr},cleanup:()=>{cleanups++}};
 api.registerPendingAsyncHook({processId:id,hookId:id,asyncResponse:{async:true},hookName:event,hookEvent:event,command:'unused',shellCommand:shell});
 return ()=>awaited;
}
const awaited=register('failure','','failed',2);
let results=await api.checkForAsyncHookResponses();expect(awaited()).toBe(true);expect(results).toHaveLength(1);expect(results[0].stderr).toBe('failed');expect(results[0].exitCode).toBe(2);expect(events[0].outcome).toBe('error');expect(cleanups).toBe(1);expect(invalidations).toBe(1);
register('empty','','',0);expect(await api.checkForAsyncHookResponses()).toEqual([]);expect(cleanups).toBe(2);expect(events).toHaveLength(2);expect(invalidations).toBe(2);
register('plain','unstructured output','',0);expect(await api.checkForAsyncHookResponses()).toEqual([]);expect(cleanups).toBe(3);
register('stderr','','warning',0);expect(await api.checkForAsyncHookResponses()).toHaveLength(1);
register('bad',JSON.stringify({continue:'bad',systemMessage:'keep',hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:42}}),'',0);
results=await api.checkForAsyncHookResponses();expect(results).toHaveLength(1);expect(results[0].response.systemMessage).toBe('keep');expect(results[0].response.continue).toBeUndefined();expect(results[0].response.hookSpecificOutput.additionalContext).toBeUndefined();
register('good',JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'context'}}),'',0);
results=await api.checkForAsyncHookResponses();expect(results[0].response.hookSpecificOutput.additionalContext).toBe('context');
expect(api.getPendingAsyncHooks()).toEqual([]);
register('announced','{"async":true}\\n{"systemMessage":"later"}','',0);
results=await api.checkForAsyncHookResponses();expect(results[0].response.systemMessage).toBe('later');
register('killed','','',0);api.getPendingAsyncHooks()[0].shellCommand.status='killed';
const beforeEvents=events.length,beforeCleanup=cleanups;
expect(await api.checkForAsyncHookResponses()).toEqual([]);expect(events).toHaveLength(beforeEvents);expect(cleanups).toBe(beforeCleanup+1);
register('sent','','',0);api.getPendingAsyncHooks()[0].responseAttachmentSent=true;
const beforeSentCleanup=cleanups;expect(await api.checkForAsyncHookResponses()).toEqual([]);expect(cleanups).toBe(beforeSentCleanup);expect(events).toHaveLength(beforeEvents);
register('pending','','',0);const pending=api.getPendingAsyncHooks()[0];pending.shellCommand.status='running';pending.shellCommand.taskOutput.getStdout=async()=>{throw Error('must not read unfinished output')};
expect(await api.checkForAsyncHookResponses()).toEqual([]);expect(api.getPendingAsyncHooks()).toHaveLength(1);api.clearAllAsyncHooks();
`)
}, 30000)
