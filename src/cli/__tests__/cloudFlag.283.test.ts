import { Command } from '@commander-js/extra-typings'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ATTACH_SERVE_HELP,
  CLOUD_ATTACH_DISABLED_ERROR,
  CLOUD_OPTION_FLAGS,
  CLOUD_OPTION_HELP,
  CLOUD_REQUIRES_DESCRIPTION_ERROR,
  ENVIRONMENT_OPTION_HELP,
  ENVIRONMENT_PIPED_STDIN_ERROR,
  HEADLESS_CLOUD_STDIN_TTY_ERROR,
  NON_INTERACTIVE_ENVIRONMENT_PROMPT_ERROR,
  REMOTE_ALIAS_HELP,
  cloudCombineError,
  parseCloudLaunch,
  parseCloudSessionId,
  quoteCloudArg,
  registerCloudCliOptions,
  runHeadlessCloudPrintAttach,
} from '../cloudSession.js'

const ctx = {
  hasSdkUrl: false,
  nonInteractive: false,
  hasConnect: false,
  hasSSH: false,
}

describe('cloudFlag 283 commander', () => {
  test('registers --cloud public; --remote/--attach-serve/--forward-home-settings hidden as gold', () => {
    const program = new Command()
    registerCloudCliOptions(program)
    const byFlags = new Map(program.options.map(o => [o.flags, o]))

    const cloud = byFlags.get(CLOUD_OPTION_FLAGS)
    expect(cloud).toBeDefined()
    expect(cloud!.description).toBe(CLOUD_OPTION_HELP)
    expect(cloud!.hidden).toBe(false)

    const remote = byFlags.get('--remote [description|session_id|url]')
    expect(remote).toBeDefined()
    expect(remote!.description).toBe(REMOTE_ALIAS_HELP)
    expect(remote!.hidden).toBe(true)

    const forward = byFlags.get('--forward-home-settings <true|false>')
    expect(forward!.hidden).toBe(true)

    const attachServe = byFlags.get('--attach-serve <session_id>')
    expect(attachServe!.description).toBe(ATTACH_SERVE_HELP)
    expect(attachServe!.hidden).toBe(true)

    const environment = byFlags.get('--environment <environment_id>')
    expect(environment!.description).toBe(ENVIRONMENT_OPTION_HELP)
    expect(environment!.hidden).toBe(false)

    expect(byFlags.get('--pool <pool_id>')!.hidden).toBe(true)
    expect(byFlags.get('--correlation-id <id>')!.hidden).toBe(true)
    expect(byFlags.get('--ref <ref>')!.hidden).toBe(true)
    expect(byFlags.get('--on-branch <branch>')!.hidden).toBe(true)
  })

  test('main.tsx lands gold --cloud option and hidden --remote alias (source-lock)', () => {
    const src = readFileSync(join(import.meta.dir, '../../main.tsx'), 'utf8')
    expect(src).toContain('registerCloudCliOptions(program)')
    expect(src).not.toContain(
      "new Option('--remote [description]', 'Create a remote session with the given description')",
    )
    expect(src).toContain("from './cli/cloudSession.js'")
  })
})

describe('cloudFlag 283 iXe / os / hZn', () => {
  test('parses session_/cse_ ids and claude.ai/code URLs', () => {
    expect(parseCloudSessionId('session_abc123')).toBe('session_abc123')
    expect(parseCloudSessionId('cse_xyz_99')).toBe('cse_xyz_99')
    expect(
      parseCloudSessionId('https://claude.ai/code/session_abc123?m=0'),
    ).toBe('session_abc123')
    expect(parseCloudSessionId('fix the login')).toBeNull()
  })

  test('print + description is not a session id (gold hZn @188907230)', async () => {
    const r = await parseCloudLaunch(
      { cloud: 'fix-login', print: true },
      { ...ctx, prompt: 'hi', nonInteractive: true },
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe(
      `Error: --cloud ${quoteCloudArg('fix-login')} is not a cloud session ID or URL.\nWith --print, --cloud sends the prompt to an existing cloud session: pass its ID (session_... or cse_...) or its claude.ai/code URL. To start a new cloud session from a description instead, drop --print.`,
    )
  })

  test('print + bare --cloud cannot combine (gold hZn)', () => {
    expect(
      cloudCombineError({
        print: true,
        nonInteractive: true,
        hasTeleport: false,
        hasConnect: false,
        hasSSH: false,
        hasAssistant: false,
        hasPool: false,
        isCloudAttach: false,
        headlessCloud: false,
        headlessCloudPrint: false,
      }),
    ).toBe(
      'Error: --cloud cannot be combined with --print.\nStarting a new cloud session with --cloud is interactive only: drop --print, or drop --cloud to run locally. To message an existing cloud session instead, pass its ID: `claude -p "message" --cloud <session-id>` (find IDs at claude.ai/code).',
    )
  })

  test('non-interactive description is not a session id', () => {
    expect(
      cloudCombineError({
        print: false,
        nonInteractive: true,
        hasTeleport: false,
        hasConnect: false,
        hasSSH: false,
        hasAssistant: false,
        hasPool: false,
        isCloudAttach: false,
        headlessCloud: false,
        headlessCloudPrint: false,
        loneWordValue: 'hello',
      }),
    ).toBe(
      `Error: --cloud ${quoteCloudArg('hello')} is not a cloud session ID or URL.\nWithout an interactive terminal, --cloud can only send the prompt to an existing cloud session: pass its ID (session_... or cse_...) or its claude.ai/code URL. To start a new cloud session, run from a TTY.`,
    )
  })

  test('non-interactive bare --cloud requires a TTY', () => {
    expect(
      cloudCombineError({
        print: false,
        nonInteractive: true,
        hasTeleport: false,
        hasConnect: false,
        hasSSH: false,
        hasAssistant: false,
        hasPool: false,
        isCloudAttach: false,
        headlessCloud: false,
        headlessCloudPrint: false,
      }),
    ).toBe(
      'Error: --cloud requires an interactive terminal.\nNon-interactive invocations (piped stdout, --init-only, --sdk-url) run locally and would silently ignore --cloud. Drop --cloud, or run from a TTY.',
    )
  })

  test('cannot combine with --continue / --teleport / --resume', () => {
    expect(
      cloudCombineError({
        print: false,
        nonInteractive: false,
        continue: true,
        hasTeleport: false,
        hasConnect: false,
        hasSSH: false,
        hasAssistant: false,
        hasPool: false,
        isCloudAttach: false,
        headlessCloud: false,
        headlessCloudPrint: false,
      }),
    ).toContain('Error: --cloud cannot be combined with --continue.')
    expect(
      cloudCombineError({
        print: false,
        nonInteractive: false,
        hasTeleport: true,
        hasConnect: false,
        hasSSH: false,
        hasAssistant: false,
        hasPool: false,
        isCloudAttach: false,
        headlessCloud: false,
        headlessCloudPrint: false,
      }),
    ).toBe(
      'Error: --cloud cannot be combined with --teleport — both select a remote backend; pick one.',
    )
    expect(
      cloudCombineError({
        print: false,
        nonInteractive: false,
        resume: 'abc',
        hasTeleport: false,
        hasConnect: false,
        hasSSH: false,
        hasAssistant: false,
        hasPool: false,
        isCloudAttach: false,
        headlessCloud: false,
        headlessCloudPrint: false,
      }),
    ).toContain('Error: --cloud cannot be combined with --resume.')
  })

  test('os() attach-serve / environment / ref / on-branch gate strings 1:1', async () => {
    expect(
      await parseCloudLaunch({ attachServe: 'cse_1', cloud: 'x' }, { ...ctx }),
    ).toEqual({
      ok: false,
      error: 'Error: --attach-serve cannot be combined with --cloud/--remote',
    })

    const badServe = await parseCloudLaunch(
      { attachServe: 'not-an-id' },
      { ...ctx },
    )
    expect(badServe).toEqual({
      ok: false,
      error: `Error: --attach-serve expects a session id (cse_...), got ${quoteCloudArg('not-an-id')}`,
    })

    const badEnv = await parseCloudLaunch({ environment: 'env_x' }, { ...ctx })
    expect(badEnv).toEqual({
      ok: false,
      error: `Error: --environment expects a self-hosted environment id (ccpool_...), got ${quoteCloudArg('env_x')}`,
    })

    expect(
      await parseCloudLaunch(
        { environment: 'ccpool_1', continue: true },
        { ...ctx },
      ),
    ).toEqual({
      ok: false,
      error:
        'Error: --environment cannot be combined with --resume, --continue, or --teleport',
    })

    expect(
      await parseCloudLaunch(
        { environment: 'ccpool_1', cloud: 'session_abc' },
        { ...ctx },
      ),
    ).toEqual({
      ok: false,
      error:
        'Error: --environment creates a new session; it cannot be combined with --cloud <session_id|url>',
    })

    expect(
      await parseCloudLaunch(
        { environment: 'ccpool_1', cloud: 'do the thing', print: true },
        { ...ctx, nonInteractive: true, prompt: 'x' },
      ),
    ).toEqual({
      ok: false,
      error:
        'Error: non-interactive --environment reads the prompt from the positional or stdin; drop --cloud/--remote <description>.',
    })

    expect(
      await parseCloudLaunch(
        { environment: 'ccpool_1', print: true },
        { ...ctx, nonInteractive: true, outputFormat: 'stream-json' },
      ),
    ).toEqual({
      ok: false,
      error:
        'Error: --environment does not support --output-format stream-json',
    })

    expect(
      await parseCloudLaunch(
        { environment: 'ccpool_1', cloud: 'task' },
        { ...ctx, prompt: 'also' },
      ),
    ).toEqual({
      ok: false,
      error:
        'Error: --environment with --cloud <description> cannot also take a positional prompt. Pass the task as the description, or drop --cloud.',
    })

    expect(await parseCloudLaunch({ ref: 'main' }, { ...ctx })).toEqual({
      ok: false,
      error:
        'Error: --ref sets the base branch for a cloud session; pass --cloud or --environment',
    })

    expect(
      await parseCloudLaunch({ cloud: 'session_abc', ref: 'main' }, { ...ctx }),
    ).toEqual({
      ok: false,
      error:
        'Error: --ref sets the base for a new cloud session; it cannot be combined with --cloud <session_id|url>',
    })

    expect(
      await parseCloudLaunch(
        { cloud: 'do it', onBranch: 'x', ref: 'y' },
        { ...ctx },
      ),
    ).toEqual({
      ok: false,
      error:
        "Error: --on-branch and --ref both set the cloud session's base branch; pass one or the other",
    })

    expect(await parseCloudLaunch({ correlationId: 'x' }, { ...ctx })).toEqual({
      ok: false,
      error: 'Error: --correlation-id requires --environment',
    })
  })

  test('print attach session id is allowed through os()', async () => {
    const r = await parseCloudLaunch(
      { cloud: 'session_abc', print: true },
      { ...ctx, nonInteractive: true, prompt: 'hi' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.cloudAttachId).toBe('session_abc')
    expect(r.value.remote).toBe('session_abc')
  })
})

describe('cloudFlag 283 print-attach / interactive strings', () => {
  test('stream-json attach refuses (gold @81225692)', async () => {
    const r = await runHeadlessCloudPrintAttach({
      sessionId: 'session_abc',
      prompt: 'hi',
      outputFormat: 'stream-json',
    })
    expect(r).toEqual({
      kind: 'error',
      message:
        'Error: --cloud <session_id> does not support --output-format stream-json',
    })
  })

  test('empty prompt refuses (gold @81225816)', async () => {
    const r = await runHeadlessCloudPrintAttach({
      sessionId: 'session_abc',
      prompt: '  ',
      outputFormat: 'text',
    })
    expect(r).toEqual({
      kind: 'error',
      message:
        'Error: non-interactive --cloud <session_id> requires a prompt (positional or stdin).',
    })
  })

  test('interactive / headless error constants source-lock vs gold', () => {
    expect(HEADLESS_CLOUD_STDIN_TTY_ERROR).toBe(
      'Error: headless --cloud reads the SDK host messages from stdin as stream-json; stdin is a terminal here.',
    )
    expect(CLOUD_ATTACH_DISABLED_ERROR).toBe(
      'Error: Attaching to an existing cloud session is not enabled for your account.',
    )
    expect(CLOUD_REQUIRES_DESCRIPTION_ERROR).toBe(
      'Error: --cloud requires a description.\nUsage: claude --cloud "your task description"',
    )
    expect(ENVIRONMENT_PIPED_STDIN_ERROR).toBe(
      'Error: --environment with --cloud <description> cannot also take piped stdin. Pass the task as the description, or drop --cloud.',
    )
    expect(NON_INTERACTIVE_ENVIRONMENT_PROMPT_ERROR).toBe(
      'Error: non-interactive --environment requires a prompt (positional or stdin). Run from a TTY for an interactive cloud session.',
    )
  })
})
