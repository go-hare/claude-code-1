import { expect, test } from 'bun:test'

async function run(body: string, args: string[] = []) {
  const child = Bun.spawn([process.execPath, '--eval', body, '--', ...args], {
    cwd: new URL('../../../..', import.meta.url).pathname,
    env: { ...process.env, DISABLE_TELEMETRY: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code).toBe(0)
  expect(stderr).toBe('')
  return stdout
}

test('default terminal writer preserves piped JSON and streaming NDJSON byte for byte', async () => {
  for (const format of ['json', 'stream-json']) {
    const stdout = await run(
      `
const {emitTerminalSequence}=await import('./src/utils/hooks/terminalSequence.ts');
const format=${JSON.stringify(format)};
const first={type:'system',subtype:'init'};const last={type:'result',result:'done'};
if(format==='stream-json')process.stdout.write(JSON.stringify(first)+'\\n');
emitTerminalSequence('\\x1b]9;hook notice\\x07');
process.stdout.write(JSON.stringify(last)+'\\n');
emitTerminalSequence('\\x07');
`,
      ['-p', '--output-format', format],
    )
    const expected =
      format === 'stream-json'
        ? [
            { type: 'system', subtype: 'init' },
            { type: 'result', result: 'done' },
          ]
        : [{ type: 'result', result: 'done' }]
    expect(stdout).toBe(
      expected.map(row => JSON.stringify(row) + '\n').join(''),
    )
    expect(
      stdout
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
    ).toEqual(expected)
  }
})

test('TTY default emission and explicit UI writers remain available', async () => {
  const stdout = await run(`
const {emitTerminalSequence,registerTerminalSequenceWriter,unregisterTerminalSequenceWriter}=await import('./src/utils/hooks/terminalSequence.ts');
Object.defineProperty(process.stdout,'isTTY',{value:true,configurable:true});
emitTerminalSequence('\\x07');
Object.defineProperty(process.stdout,'isTTY',{value:false,configurable:true});
const captured=[];const writer=sequence=>captured.push(sequence);
registerTerminalSequenceWriter(writer);emitTerminalSequence('custom');unregisterTerminalSequenceWriter(writer);
emitTerminalSequence('must not leak');
process.stdout.write(JSON.stringify(captured));
`)
  expect(stdout).toBe('\x07["custom"]')
})

test('real outside hook output cannot inject control bytes into piped stream JSON', async () => {
  const stdout = await run(
    `
import {mock} from 'bun:test';
import {logMock} from './tests/mocks/log.ts';import {debugMock} from './tests/mocks/debug.ts';
mock.module('src/utils/log.ts',logMock);mock.module('src/utils/debug.ts',debugMock);mock.module('bun:bundle',()=>({feature:()=>false}));
const state=await import('./src/bootstrap/state.ts');state.setIsInteractive(false);
state.registerHookCallbacks({PreCompact:[{hooks:[{type:'callback',callback:async()=>({terminalSequence:'\\x1b]9;notice\\x07',systemMessage:'instructions'})}]}]});
const {executePreCompactHooks}=await import('./src/utils/hooks.ts');
process.stdout.write(JSON.stringify({type:'system'})+'\\n');
const result=await executePreCompactHooks({trigger:'manual',customInstructions:null});
process.stdout.write(JSON.stringify({type:'result',instructions:result.newCustomInstructions})+'\\n');
`,
    ['-p', '--output-format', 'stream-json'],
  )
  expect(stdout).toBe(
    '{"type":"system"}\n{"type":"result","instructions":"instructions"}\n',
  )
})
