import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

test('real TaskList and Write execution applies command-hook rewrites and classifier provenance in an isolated process', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tool-execution-hooks-'))
  try {
    const config = join(temp, 'config')
    const workspace = join(temp, 'workspace')
    await mkdir(config)
    await mkdir(workspace)
    const hook = join(temp, 'hook.ts')
    await writeFile(
      hook,
      `
const input = await Bun.stdin.json()
await Bun.write(process.env.HOOK_CAPTURE!, JSON.stringify(input))
console.log(JSON.stringify({hookSpecificOutput: {
  hookEventName: 'PostToolUse',
  updatedToolOutput: JSON.parse(await Bun.file(process.env.HOOK_REWRITE!).text()),
  classifierContext: 'User explicitly requested the hook-rewritten task list'
}}))
`,
    )
    await writeFile(
      join(config, 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'TaskList|Write',
              hooks: [
                { type: 'command', command: `'${process.execPath}' '${hook}'` },
              ],
            },
          ],
        },
      }),
    )
    const runner = join(temp, 'runner.ts')
    await writeFile(
      runner,
      `
import { strict as assert } from 'node:assert'
import { runToolUse } from ${JSON.stringify(join(root, 'src/services/tools/toolExecution.ts'))}
import { TaskListTool } from ${JSON.stringify(join(root, 'packages/builtin-tools/src/tools/TaskListTool/TaskListTool.ts'))}
import { FileWriteTool } from ${JSON.stringify(join(root, 'packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts'))}
import { getDefaultAppState } from ${JSON.stringify(join(root, 'src/state/AppStateStore.ts'))}
import { createAssistantMessage } from ${JSON.stringify(join(root, 'src/utils/messages.ts'))}
import { buildTranscriptEntries, buildTranscriptForClassifier } from ${JSON.stringify(join(root, 'src/utils/permissions/yoloClassifier.ts'))}
import { getInitialSettings } from ${JSON.stringify(join(root, 'src/utils/settings/settings.ts'))}
import { setOriginalCwd, setProjectRoot, setAllowedSettingSources, setIsInteractive } from ${JSON.stringify(join(root, 'src/bootstrap/state.ts'))}
setOriginalCwd(process.env.HOOK_WORKSPACE!)
setProjectRoot(process.env.HOOK_WORKSPACE!)
setAllowedSettingSources(['userSettings'])
setIsInteractive(false)
// Fail before dispatch if any machine/user configuration introduces another hook.
const configured = await Bun.file(process.env.CLAUDE_CONFIG_DIR! + '/settings.json').json()
assert.deepEqual(getInitialSettings().hooks, configured.hooks)
let state = getDefaultAppState()
const context: any = {
  options: {tools: [TaskListTool], commands: [], mcpClients: [], mcpResources: {},
    mainLoopModel: 'claude-sonnet-4-6', thinkingConfig: {type: 'disabled'},
    isNonInteractiveSession: true, debug: false, verbose: false,
    agentDefinitions: {activeAgents: [], allAgents: [], allowedAgentTypes: []}},
  abortController: new AbortController(), messages: [], readFileState: new Map(),
  getAppState: () => state, setAppState: (update: any) => { state = update(state) },
  setMessages: () => {}, setInProgressToolUseIDs: () => {},
  updateFileHistoryState: (update: any) => { state = {...state, fileHistory: update(state.fileHistory)} },
}
const cases = [
  {name: 'valid', rewrite: {tasks: [{id: '42', subject: 'Hook replacement', status: 'pending', blockedBy: []}]}, expected: '#42 [pending] Hook replacement'},
  {name: 'invalid', rewrite: {tasks: 'invalid shape'}, expected: 'No tasks found'},
]
const reports = []
for (const scenario of cases) {
  await Bun.write(process.env.HOOK_REWRITE!, JSON.stringify(scenario.rewrite))
  const call: any = {type: 'tool_use', id: 'toolu_' + scenario.name, name: TaskListTool.name, input: {}}
  const assistant = createAssistantMessage({content: [call]})
  context.messages = [assistant]
  const messages: any[] = []
  for await (const update of runToolUse(call, assistant, async () => ({behavior: 'allow', updatedInput: {}}), context)) {
    if ('message' in update) messages.push(update.message)
  }
  const result = messages.find(message => message.type === 'user' && message.message.content.some((block: any) => block.type === 'tool_result'))
  assert.ok(result, JSON.stringify(messages))
  assert.equal(result.message.content[0].content, scenario.expected, JSON.stringify(messages))
  const captured = await Bun.file(process.env.HOOK_CAPTURE!).json()
  assert.equal(captured.hook_event_name, 'PostToolUse')
  assert.deepEqual(captured.tool_response, {tasks: []})
  assert.equal(typeof captured.duration_ms, 'number')
  const entries = buildTranscriptEntries([assistant, result])
  const transcript = buildTranscriptForClassifier([assistant, result], [TaskListTool])
  if (scenario.name === 'valid') {
    assert.deepEqual(result.toolUseResult, scenario.rewrite)
    assert.equal(result.hostClassifierContext, 'User explicitly requested the hook-rewritten task list')
    assert.ok(entries.some(entry => entry.content.some((block: any) => block.type === 'host_context')))
    assert.ok(entries.some(entry => entry.content.some((block: any) => block.type === 'host_context' && !block.live)))
    assert.equal(transcript, '') // TaskList's real read-only projection is omitted.
    const restored = JSON.parse(JSON.stringify(result))
    const restoredEntries = buildTranscriptEntries([assistant, restored])
    assert.ok(restoredEntries.some(entry => entry.content.some((block: any) => block.type === 'host_context' && !block.live)))
  } else {
    assert.deepEqual(result.toolUseResult, {tasks: []})
    assert.equal(result.hostClassifierContext, undefined)
    assert.ok(!transcript.includes('host_context'))
    assert.ok(messages.some(message => message.attachment?.type === 'hook_error_during_execution'), JSON.stringify(messages))
  }
  reports.push({name: scenario.name, content: result.message.content[0].content, transcript})
}
// A real Write to a temporary file also exercises a nonempty classifier projection.
const filePath = process.env.HOOK_WORKSPACE! + '/written.txt'
const rewritten = {type: 'create', filePath: filePath + '.reported', content: 'rewritten output', structuredPatch: [], originalFile: null}
await Bun.write(process.env.HOOK_REWRITE!, JSON.stringify(rewritten))
context.options.tools = [FileWriteTool]
const writeCall: any = {type: 'tool_use', id: 'toolu_write123', name: FileWriteTool.name, input: {file_path: filePath, content: 'actual file content'}}
const writeAssistant = createAssistantMessage({content: [writeCall]})
context.messages = [writeAssistant]
const writeMessages: any[] = []
for await (const update of runToolUse(writeCall, writeAssistant, async () => ({behavior: 'allow', updatedInput: writeCall.input}), context)) {
  if ('message' in update) writeMessages.push(update.message)
}
const writtenResult = writeMessages.find(message => message.type === 'user' && message.message.content.some((block: any) => block.type === 'tool_result'))
assert.ok(writtenResult, JSON.stringify(writeMessages))
assert.equal(await Bun.file(filePath).text(), 'actual file content')
assert.deepEqual(writtenResult.toolUseResult, rewritten, JSON.stringify(writeMessages))
assert.equal(writtenResult.message.content[0].content, 'File created successfully at: ' + rewritten.filePath)
const writeTranscript = buildTranscriptForClassifier([writeAssistant, writtenResult], [FileWriteTool])
assert.ok(writeTranscript.includes('"host_context":"User explicitly requested the hook-rewritten task list"'), writeTranscript)
assert.ok(!writeTranscript.includes('"host_context_live":'), writeTranscript) // Command hooks are never host principals.
assert.ok(writeTranscript.includes('actual file content'), writeTranscript)
const restoredWrite = JSON.parse(JSON.stringify(writtenResult))
assert.equal(buildTranscriptForClassifier([writeAssistant, restoredWrite], [FileWriteTool]), writeTranscript)
reports.push({name: 'write', content: writtenResult.message.content[0].content, transcript: writeTranscript})
console.log('INTEGRATION_RESULT=' + JSON.stringify(reports))
process.exit(0)
`,
    )
    const child = Bun.spawn({
      cmd: [process.execPath, runner],
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: temp,
        TMPDIR: tmpdir(),
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_TELEMETRY: '1',
        NODE_ENV: 'test',
        HOOK_WORKSPACE: workspace,
        HOOK_CAPTURE: join(temp, 'captured.json'),
        HOOK_REWRITE: join(temp, 'rewrite.json'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
    const reportLine = stdout
      .split('\n')
      .find(line => line.startsWith('INTEGRATION_RESULT='))
    expect(reportLine).toBeDefined()
    const reports = JSON.parse(reportLine!.slice('INTEGRATION_RESULT='.length))
    expect(reports.map((report: { name: string }) => report.name)).toEqual([
      'valid',
      'invalid',
      'write',
    ])
    expect(reports[0].content).toBe('#42 [pending] Hook replacement')
    expect(reports[1].content).toBe('No tasks found')
    expect(reports[2].transcript).toContain('"host_context":')
    expect(reports[2].transcript).not.toContain('"host_context_live":')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 60_000)
